-- Controlled rollback for 20261118000001_report_review_command_idempotency.
--
-- This artifact is intentionally manual. It removes command idempotency and
-- restores the exact app/public review_report definitions from:
--   supabase/migrations/20261102000006_audit_followup.sql
--   supabase/migrations/20261105000004_expose_app_rpcs_to_public.sql
--
-- Required order:
--   1. Stop callers that send the five-parameter RPC.
--   2. Confirm no deployment still depends on command idempotency.
--   3. Run this file in one controlled database transaction.
--   4. Redeploy the matching application version.
--
-- This rollback removes atomic command + outbox behavior (including the
-- in-transaction audit record and durable push event) and must not be
-- treated as a normal application recovery path. The restored historical
-- application version records audit and push app-side after the RPC.

BEGIN;

DROP FUNCTION IF EXISTS public.review_report(uuid, integer, text, text, text);
DROP FUNCTION IF EXISTS app.review_report(uuid, integer, text, text, text);

-- Exact historical app implementation.
CREATE OR REPLACE FUNCTION app.review_report(
  p_report_id uuid,
  p_decision text,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_report public.daily_reports%ROWTYPE;
  v_elevated boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF p_decision NOT IN ('approved', 'revision_required') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Keputusan review tidak valid.');
  END IF;
  IF p_decision = 'revision_required' AND length(trim(COALESCE(p_notes, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Catatan revisi wajib diisi.');
  END IF;

  SELECT * INTO v_report
  FROM public.daily_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan santri tidak ditemukan.');
  END IF;
  IF v_report.user_id = auth.uid() AND NOT app.has_role('super_admin') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak dapat meninjau laporan sendiri.');
  END IF;
  IF v_report.submission_status <> 'submitted' OR v_report.review_status = 'approved' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan tidak berada pada status yang dapat direview.');
  END IF;

  v_elevated := app.has_any_role('super_admin', 'yayasan', 'pengurus');
  IF NOT v_elevated AND NOT EXISTS (
    SELECT 1 FROM public.reviewer_assignments ra
    WHERE ra.reviewee_id = v_report.user_id
      AND ra.reviewer_id = auth.uid()
      AND ra.kind = 'report'
      AND ra.valid_from <= CURRENT_DATE
      AND (ra.valid_to IS NULL OR ra.valid_to >= CURRENT_DATE)
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda belum ditetapkan sebagai reviewer laporan ini.');
  END IF;

  INSERT INTO public.report_reviews (report_id, revision_no, reviewer_id, decision, notes, decided_at)
  VALUES (v_report.id, v_report.revision_no, auth.uid(), p_decision, COALESCE(p_notes, ''), now());

  UPDATE public.daily_reports
  SET review_status = p_decision,
      reviewer_id = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = v_report.id;

  RETURN jsonb_build_object('success', true, 'message', 'Review laporan berhasil disimpan.', 'user_id', v_report.user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION app.review_report(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.review_report(uuid, text, text) TO authenticated;

-- Exact historical public wrapper.
CREATE OR REPLACE FUNCTION public.review_report(
  p_report_id uuid,
  p_decision  text,
  p_notes     text DEFAULT ''
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.review_report(p_report_id, p_decision, p_notes);
$$;

REVOKE ALL ON FUNCTION public.review_report(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_report(uuid, text, text) TO authenticated;

DROP TABLE IF EXISTS public.report_review_idempotency;

COMMIT;
