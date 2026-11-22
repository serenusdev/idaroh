-- Rollback for: 20261122000002_report_rls_review_scope.sql
-- Restores, verbatim: the three report policies as shipped by
-- 20261102000005_audit_hardening.sql, the 20261118000001 revision of
-- app.review_report (elevated bypass + super_admin self-review exception),
-- and the 20261122000001 revision of app.save_report (raw SQLERRM tail).
-- NOTE: this returns the system to the SEC-03/REP-01 finding state and is
-- only for incident recovery, not for normal operation.

BEGIN;

DROP POLICY IF EXISTS "Members can view report compliance metadata" ON public.daily_reports;
CREATE POLICY "Users and assigned reviewers can view reports"
  ON public.daily_reports FOR SELECT TO authenticated
  USING (
    app.is_active_member() AND (
      user_id = auth.uid() OR reviewer_id = auth.uid() OR
      app.has_any_role('super_admin', 'yayasan', 'pengurus') OR
      EXISTS (
        SELECT 1 FROM public.reviewer_assignments ra
        WHERE ra.reviewee_id = daily_reports.user_id
          AND ra.reviewer_id = auth.uid() AND ra.kind = 'report'
          AND ra.valid_from <= CURRENT_DATE AND (ra.valid_to IS NULL OR ra.valid_to >= CURRENT_DATE)
      )
    )
  );

DROP POLICY IF EXISTS "Assigned reviewers can view report items" ON public.report_items;
CREATE POLICY "Authorized reviewers can view report items"
  ON public.report_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.daily_reports dr WHERE dr.id = report_id AND (dr.reviewer_id = auth.uid() OR app.has_any_role('super_admin', 'yayasan', 'pengurus'))));

DROP POLICY IF EXISTS "Assigned reviewers can insert reviews" ON public.report_reviews;
CREATE POLICY "Assigned reviewers can insert reviews"
  ON public.report_reviews FOR INSERT TO authenticated
  WITH CHECK (
    app.is_active_member() AND reviewer_id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.daily_reports dr WHERE dr.id = report_id AND dr.user_id = auth.uid())
    AND (
      app.has_any_role('super_admin', 'yayasan', 'pengurus') OR EXISTS (
        SELECT 1 FROM public.daily_reports dr
        JOIN public.reviewer_assignments ra ON ra.reviewee_id = dr.user_id AND ra.kind = 'report'
        WHERE dr.id = report_id AND ra.reviewer_id = auth.uid()
          AND ra.valid_from <= CURRENT_DATE AND (ra.valid_to IS NULL OR ra.valid_to >= CURRENT_DATE)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- app.review_report as of 20261118000001
-- ---------------------------------------------------------------------------
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

  SELECT NULLIF(btrim(p.email), ''), NULLIF(btrim(p.full_name), '')
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

-- ---------------------------------------------------------------------------
-- app.save_report as of 20261122000001 (raw SQLERRM tail restored)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.save_report(
  p_user_id           uuid,
  p_report_date       date,
  p_submission_status text,
  p_is_late           boolean,
  p_items             jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_report      public.daily_reports%ROWTYPE;
  v_existing    public.daily_reports%ROWTYPE;
  v_now         timestamptz := now();
  v_now_wib     timestamp := (v_now AT TIME ZONE 'Asia/Jakarta');
  v_today_wib   date := (v_now AT TIME ZONE 'Asia/Jakarta')::date;
  v_deadline    time;
  v_is_late     boolean;
  v_item        jsonb;
  v_index       integer := 0;
  v_category_id uuid;
  v_snapshot    jsonb;
  v_duration    integer;
  v_category_key text;
  v_actor_name  text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses ke laporan ini.');
  END IF;
  IF p_submission_status NOT IN ('draft', 'submitted') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status laporan tidak valid.');
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan wajib memiliki minimal 1 item.');
  END IF;

  IF p_report_date IS DISTINCT FROM v_today_wib THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan harian hanya untuk tanggal operasional hari ini (WIB).');
  END IF;

  SELECT report_deadline_time INTO v_deadline
  FROM public.policy_settings
  WHERE status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;
  v_deadline := COALESCE(v_deadline, time '21:00:00');
  v_is_late := v_now_wib::time > v_deadline;

  SELECT * INTO v_existing
  FROM public.daily_reports
  WHERE user_id = p_user_id AND report_date = p_report_date
  FOR UPDATE;

  IF FOUND AND v_existing.review_status = 'approved' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan yang sudah disetujui tidak dapat diubah.');
  END IF;

  IF FOUND THEN
    SELECT jsonb_agg(to_jsonb(ri) ORDER BY ri.sort_order) INTO v_snapshot
    FROM public.report_items ri
    WHERE ri.report_id = v_existing.id;
    IF v_snapshot IS NOT NULL THEN
      INSERT INTO public.report_revisions (report_id, revision_no, snapshot_items, submitted_at, submitted_by)
      VALUES (v_existing.id, v_existing.revision_no, v_snapshot, v_now, p_user_id);
    END IF;
  END IF;

  INSERT INTO public.daily_reports (
    user_id, report_date, submission_status, is_late,
    first_submitted_at, last_submitted_at, review_status, updated_at
  ) VALUES (
    p_user_id, p_report_date, p_submission_status,
    CASE WHEN p_submission_status = 'submitted' THEN v_is_late ELSE false END,
    CASE WHEN p_submission_status = 'submitted' THEN v_now ELSE NULL END,
    CASE WHEN p_submission_status = 'submitted' THEN v_now ELSE NULL END,
    'not_reviewed', v_now
  )
  ON CONFLICT (user_id, report_date) DO UPDATE SET
    submission_status = EXCLUDED.submission_status,
    is_late = CASE
      WHEN public.daily_reports.first_submitted_at IS NULL
           AND EXCLUDED.submission_status = 'submitted'
      THEN v_is_late
      ELSE public.daily_reports.is_late
    END,
    first_submitted_at = COALESCE(public.daily_reports.first_submitted_at, EXCLUDED.first_submitted_at),
    last_submitted_at = CASE WHEN EXCLUDED.submission_status = 'submitted'
                             THEN EXCLUDED.last_submitted_at
                             ELSE public.daily_reports.last_submitted_at END,
    review_status = CASE WHEN EXCLUDED.submission_status = 'submitted'
                         THEN 'not_reviewed' ELSE public.daily_reports.review_status END,
    revision_no = CASE WHEN EXCLUDED.submission_status = 'submitted'
                       THEN public.daily_reports.revision_no + 1
                       ELSE public.daily_reports.revision_no END,
    updated_at = v_now
  RETURNING * INTO v_report;

  DELETE FROM public.report_items WHERE report_id = v_report.id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_index := v_index + 1;
    v_category_id := NULL;
    v_category_key := NULLIF(trim(v_item->>'categoryId'), '');
    IF v_category_key IS NOT NULL THEN
      IF v_category_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        SELECT id INTO v_category_id FROM public.report_categories WHERE id = v_category_key::uuid;
      ELSE
        SELECT id INTO v_category_id FROM public.report_categories WHERE slug = v_category_key AND is_active = true;
      END IF;
    END IF;
    v_duration := CASE
      WHEN COALESCE(v_item->>'durationMinutes', '') ~ '^\d+$' THEN (v_item->>'durationMinutes')::integer
      ELSE 60
    END;
    INSERT INTO public.report_items (
      report_id, category_id, title, description, result_progress,
      obstacles, duration_minutes, sort_order
    ) VALUES (
      v_report.id,
      v_category_id,
      COALESCE(NULLIF(v_item->>'title', ''), 'Aktivitas ' || v_index),
      COALESCE(v_item->>'description', ''),
      NULLIF(v_item->>'resultProgress', ''),
      NULLIF(v_item->>'obstacles', ''),
      v_duration,
      v_index
    );
  END LOOP;

  IF p_submission_status = 'submitted' THEN
    SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = p_user_id;
    INSERT INTO public.audit_logs (
      event_name, actor_id, actor_name, target_id, target_label, action_detail
    ) VALUES (
      'report.submitted',
      p_user_id,
      COALESCE(v_actor_name, p_user_id::text),
      v_report.id::text,
      format('Laporan Santri (%s)', v_report.id),
      format('Laporan harian dikirim (revision %s, %s).', v_report.revision_no,
             CASE WHEN v_report.is_late THEN 'terlambat' ELSE 'tepat waktu' END)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'report_id', v_report.id,
    'revision_no', v_report.revision_no,
    'is_late', v_report.is_late
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION app.save_report(uuid, date, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_report(uuid, date, text, boolean, jsonb) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
