-- Migration: 20261118000001_report_review_command_idempotency
-- Purpose: make review commands idempotent without collapsing independent
--          decisions that concern the same report revision.
-- One transaction persists: the review decision, report status, command
-- completion, email outbox event, durable push event (inbox + outbox trigger),
-- and the required audit record. External delivery (Resend/FCM) never runs
-- inside this transaction; workers drain the outboxes after commit.

BEGIN;

CREATE TABLE IF NOT EXISTS public.report_review_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  command_hash text NOT NULL,
  report_id uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  decision text NOT NULL CHECK (decision IN ('approved', 'revision_required')),
  review_id uuid REFERENCES public.report_reviews(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT report_review_idempotency_key_nonempty CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT report_review_idempotency_hash_sha256 CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT report_review_idempotency_completion_state CHECK (
    (status = 'processing' AND review_id IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND review_id IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT report_review_idempotency_actor_key_unique UNIQUE (actor_id, idempotency_key),
  CONSTRAINT report_review_idempotency_review_unique UNIQUE (review_id)
);

CREATE INDEX IF NOT EXISTS idx_report_review_idempotency_report
  ON public.report_review_idempotency(report_id, revision_no);

ALTER TABLE public.report_review_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_review_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_review_idempotency TO service_role;

-- Remove both old entry points so no caller can create a review without an
-- idempotency key. The public wrapper remains the PostgREST entry point.
DROP FUNCTION IF EXISTS public.review_report(uuid, text, text);
DROP FUNCTION IF EXISTS app.review_report(uuid, text, text);

CREATE OR REPLACE FUNCTION app.review_report(
  p_report_id uuid,
  p_revision_no integer,
  p_decision text,
  p_notes text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_report public.daily_reports%ROWTYPE;
  v_command public.report_review_idempotency%ROWTYPE;
  v_review_id uuid;
  v_outbox_id uuid;
  v_command_hash text;
  v_notes text := COALESCE(p_notes, '');
  v_key text := btrim(p_idempotency_key);
  v_recipient text;
  v_recipient_name text;
  v_reviewer_name text;
  v_elevated boolean;
BEGIN
  IF v_actor_id IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF p_decision NOT IN ('approved', 'revision_required') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Keputusan review tidak valid.');
  END IF;
  IF p_revision_no IS NULL OR p_revision_no < 1 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nomor revisi laporan tidak valid.');
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kunci idempotensi wajib diisi.');
  END IF;
  IF p_decision = 'revision_required' AND length(btrim(v_notes)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Catatan revisi wajib diisi.');
  END IF;

  -- JSONB text is deterministic for the same fields. The hash is calculated
  -- server-side; a client-provided hash is never trusted.
  v_command_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'actor_id', v_actor_id,
        'report_id', p_report_id,
        'revision_no', p_revision_no,
        'decision', p_decision,
        'notes', v_notes
      )::text,
      'sha256'
    ),
    'hex'
  );

  -- Lock the report before checking authorization and the command record. This
  -- serializes competing decisions for one report while still allowing more
  -- than one decision row for the same report/revision when keys differ.
  SELECT * INTO v_report
  FROM public.daily_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan santri tidak ditemukan.');
  END IF;
  IF v_report.user_id = v_actor_id AND NOT app.has_role('super_admin') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak dapat meninjau laporan sendiri.');
  END IF;

  v_elevated := app.has_any_role('super_admin', 'yayasan', 'pengurus');
  IF NOT v_elevated AND NOT EXISTS (
    SELECT 1 FROM public.reviewer_assignments ra
    WHERE ra.reviewee_id = v_report.user_id
      AND ra.reviewer_id = v_actor_id
      AND ra.kind = 'report'
      AND ra.valid_from <= CURRENT_DATE
      AND (ra.valid_to IS NULL OR ra.valid_to >= CURRENT_DATE)
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda belum ditetapkan sebagai reviewer laporan ini.');
  END IF;

  -- The row lock makes the same actor/key pair deterministic under retries and
  -- concurrent requests. A completed row is returned before current report
  -- status checks, so a retry still receives its original result.
  SELECT * INTO v_command
  FROM public.report_review_idempotency
  WHERE actor_id = v_actor_id AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_command.command_hash <> v_command_hash
       OR v_command.report_id <> p_report_id
       OR v_command.revision_no <> p_revision_no
       OR v_command.decision <> p_decision THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'message', 'Kunci idempotensi sudah digunakan untuk perintah review yang berbeda.'
      );
    END IF;
    IF v_command.status = 'completed' AND v_command.review_id IS NOT NULL THEN
      SELECT id INTO v_outbox_id
      FROM public.email_outbox
      WHERE reference_type = 'report_review_email'
        AND reference_id = v_command.review_id::text;
      IF v_outbox_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'IDEMPOTENCY_OUTBOX_MISSING',
          'message', 'Hasil review ditemukan tetapi event email tidak tersedia.'
        );
      END IF;
      RETURN jsonb_build_object(
        'success', true,
        'created', false,
        'idempotent', true,
        'review_id', v_command.review_id,
        'outbox_event_id', v_outbox_id,
        'report_id', v_command.report_id,
        'revision_no', v_command.revision_no,
        'decision', v_command.decision,
        'notes', v_notes,
        'user_id', v_report.user_id,
        'message', 'Perintah review sebelumnya sudah berhasil disimpan.'
      );
    END IF;
    -- A committed processing row should be impossible because reservation,
    -- decision insert, and completion are one transaction. Fail closed if a
    -- manually repaired database ever violates that invariant.
    RETURN jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_INCOMPLETE',
      'message', 'Perintah review sebelumnya belum memiliki hasil yang lengkap.'
    );
  END IF;

  IF v_report.revision_no <> p_revision_no THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nomor revisi laporan sudah berubah. Muat ulang antrean review.');
  END IF;
  IF v_report.submission_status <> 'submitted' OR v_report.review_status = 'approved' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan tidak berada pada status yang dapat direview.');
  END IF;

  INSERT INTO public.report_review_idempotency (
    actor_id, idempotency_key, command_hash, report_id, revision_no, decision, status
  ) VALUES (
    v_actor_id, v_key, v_command_hash, p_report_id, p_revision_no, p_decision, 'processing'
  )
  ON CONFLICT (actor_id, idempotency_key) DO NOTHING;

  -- A different report can be submitted concurrently with the same actor/key.
  -- Re-read after the conflict-safe insert so that case also returns the
  -- original result or a clear payload conflict instead of a unique violation.
  SELECT * INTO v_command
  FROM public.report_review_idempotency
  WHERE actor_id = v_actor_id AND idempotency_key = v_key
  FOR UPDATE;
  IF v_command.command_hash <> v_command_hash
     OR v_command.report_id <> p_report_id
     OR v_command.revision_no <> p_revision_no
     OR v_command.decision <> p_decision THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_CONFLICT',
      'message', 'Kunci idempotensi sudah digunakan untuk perintah review yang berbeda.'
    );
  END IF;
  IF v_command.status = 'completed' AND v_command.review_id IS NOT NULL THEN
    SELECT id INTO v_outbox_id
    FROM public.email_outbox
    WHERE reference_type = 'report_review_email'
      AND reference_id = v_command.review_id::text;
    IF v_outbox_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'IDEMPOTENCY_OUTBOX_MISSING',
        'message', 'Hasil review ditemukan tetapi event email tidak tersedia.'
      );
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'idempotent', true,
      'review_id', v_command.review_id,
      'outbox_event_id', v_outbox_id,
      'report_id', v_command.report_id,
      'revision_no', v_command.revision_no,
      'decision', v_command.decision,
      'notes', v_notes,
      'user_id', v_report.user_id,
      'message', 'Perintah review sebelumnya sudah berhasil disimpan.'
    );
  END IF;

  SELECT NULLIF(btrim(p.email)), NULLIF(btrim(p.full_name), '')
    INTO v_recipient, v_recipient_name
  FROM public.profiles p
  WHERE p.id = v_report.user_id;
  IF v_recipient IS NULL
     OR v_recipient_name IS NULL
     OR v_recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION USING MESSAGE = 'NOTIFICATION_RECIPIENT_UNAVAILABLE';
  END IF;

  SELECT NULLIF(btrim(p.full_name), '') INTO v_reviewer_name
  FROM public.profiles p
  WHERE p.id = v_actor_id;
  IF v_reviewer_name IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'REVIEWER_PROFILE_UNAVAILABLE';
  END IF;

  INSERT INTO public.report_reviews (report_id, revision_no, reviewer_id, decision, notes, decided_at)
  VALUES (v_report.id, v_report.revision_no, v_actor_id, p_decision, v_notes, now())
  RETURNING id INTO v_review_id;

  UPDATE public.daily_reports
  SET review_status = p_decision,
      reviewer_id = v_actor_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = v_report.id;

  INSERT INTO public.email_outbox (
    recipient,
    subject,
    body_text,
    reference_id,
    reference_type,
    status
  ) VALUES (
    v_recipient,
    CASE WHEN p_decision = 'approved'
      THEN format('Laporan Harian Anda (%s) Telah Disetujui', v_report.report_date)
      ELSE format('Laporan Harian Anda (%s) Memerlukan Revisi', v_report.report_date)
    END,
    CASE WHEN p_decision = 'approved' THEN
      format(
        E'Yth. %s,\n\nLaporan harian Anda untuk tanggal %s pada revisi ke-%s telah disetujui oleh %s.\n\nTerima kasih atas laporan yang Anda kirimkan.',
        v_recipient_name,
        v_report.report_date,
        v_report.revision_no,
        v_reviewer_name
      )
    ELSE
      format(
        E'Yth. %s,\n\nLaporan harian Anda untuk tanggal %s pada revisi ke-%s memerlukan revisi.\n\nCatatan dari ustadz/pembina: %s\n\nSilakan perbaiki dan kirim ulang laporan Anda.',
        v_recipient_name,
        v_report.report_date,
        v_report.revision_no,
        v_notes
      )
    END,
    v_review_id::text,
    'report_review_email',
    'pending'
  )
  RETURNING id INTO v_outbox_id;

  -- Durable push event keyed by the review decision, not the report, so a
  -- second independent decision is a new logical notification. The insert
  -- trigger enqueues notification_push_outbox in this same transaction;
  -- the FCM worker delivers asynchronously after commit.
  INSERT INTO public.notifications (user_id, notification_type, title, body, url, reference_id)
  VALUES (
    v_report.user_id,
    CASE WHEN p_decision = 'approved' THEN 'REPORT_APPROVED' ELSE 'REPORT_REVISION_REQUIRED' END,
    'Status Laporan Diperbarui',
    CASE WHEN p_decision = 'approved'
      THEN 'Laporan harian Anda telah disetujui.'
      ELSE 'Laporan harian Anda memerlukan revisi.'
    END,
    '/laporan',
    v_review_id::text
  )
  ON CONFLICT (user_id, notification_type, reference_id) DO NOTHING;

  -- Required audit record: committed with the decision so a persisted review
  -- can never lack its audit event. Idempotent retries return before this
  -- point and never insert a second audit row. The actor is the authenticated
  -- uid resolved server-side; the chain-hash trigger fires inside this
  -- transaction and any failure rolls the whole command back.
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'report.review_' || p_decision,
    v_actor_id,
    v_reviewer_name,
    v_report.id::text,
    format('Laporan Santri (%s)', v_report.id),
    format('Keputusan: %s. Catatan: %s', p_decision, CASE WHEN v_notes = '' THEN '-' ELSE v_notes END)
  );

  UPDATE public.report_review_idempotency
  SET review_id = v_review_id,
      status = 'completed',
      completed_at = now()
  WHERE actor_id = v_actor_id AND idempotency_key = v_key;

  RETURN jsonb_build_object(
    'success', true,
    'created', true,
    'idempotent', false,
    'review_id', v_review_id,
    'outbox_event_id', v_outbox_id,
    'report_id', v_report.id,
    'revision_no', v_report.revision_no,
    'decision', p_decision,
    'notes', v_notes,
    'user_id', v_report.user_id,
    'message', 'Review laporan berhasil disimpan.'
  );
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'NOTIFICATION_RECIPIENT_UNAVAILABLE' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOTIFICATION_RECIPIENT_UNAVAILABLE',
      'message', 'Alamat email penerima laporan tidak tersedia.'
    );
  END IF;
  IF SQLERRM = 'REVIEWER_PROFILE_UNAVAILABLE' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'REVIEWER_PROFILE_UNAVAILABLE',
      'message', 'Profil reviewer tidak tersedia.'
    );
  END IF;
  RETURN jsonb_build_object('success', false, 'message', 'Review laporan gagal disimpan.');
END;
$$;

REVOKE ALL ON FUNCTION app.review_report(uuid, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.review_report(uuid, integer, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_report(
  p_report_id uuid,
  p_revision_no integer,
  p_decision text,
  p_notes text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.review_report(p_report_id, p_revision_no, p_decision, p_notes, p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION public.review_report(uuid, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_report(uuid, integer, text, text, text) TO authenticated;

COMMIT;

-- Manual rollback is defined in:
--   supabase/rollback/20261118000001_report_review_command_idempotency_down.sql
-- It restores the exact historical app/public functions and grants, then
-- removes this table. Do not run automatically: it removes idempotency.
