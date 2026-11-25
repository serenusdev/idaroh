-- Rollback untuk 20261122000013_drop_dead_report_submit.sql.
--
-- Mengembalikan app.report_submit(uuid, uuid) PERSIS seperti 20261101000004:91-158 menanamnya
-- (salinan verbatim, bukan parafrase), beserta sepasang REVOKE dari 20261102000003:265-266 supaya
-- hasil rollback tetap sama tidak tercapainya dengan keadaan sebelum migrasi.
--
-- Perlu disadari: rollback ini menghidupkan kembali fungsi mati yang mengandung tiga cacat yang
-- dilaporkan di header migrasinya (deadline ' 21:00:00' tetap, search_path tanpa pg_temp,
-- p_user_id dari pemanggil). Tidak ada pembungkus public. yang dibuat dan tidak ada GRANT baru,
-- sehingga fungsi hasil rollback masih tidak dapat dicapai dari aplikasi.

BEGIN;

CREATE OR REPLACE FUNCTION app.report_submit(
  p_report_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_report public.daily_reports%ROWTYPE;
  v_now timestamptz := now();
  v_now_wib timestamp;
  v_deadline timestamp;
  v_is_late boolean;
  v_item_count int;
BEGIN
  SELECT * INTO v_report FROM public.daily_reports WHERE id = p_report_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan tidak ditemukan atau Anda tidak memiliki akses.');
  END IF;

  IF v_report.review_status = 'approved' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan sudah disetujui dan tidak dapat diedit atau dikirim ulang.');
  END IF;

  -- Verify at least 1 item exists
  SELECT count(*) INTO v_item_count FROM public.report_items WHERE report_id = p_report_id;
  IF v_item_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan wajib memiliki minimal 1 item aktivitas.');
  END IF;

  -- Calculate late status (21:00 WIB on report_date)
  -- Per BR-REP-11: is_late is fixed on first submission
  v_now_wib := (v_now AT TIME ZONE 'Asia/Jakarta');
  v_deadline := (v_report.report_date::text || ' 21:00:00')::timestamp;

  IF v_report.first_submitted_at IS NULL THEN
    v_is_late := v_now_wib > v_deadline;
    UPDATE public.daily_reports
    SET
      submission_status = 'submitted',
      is_late = v_is_late,
      first_submitted_at = v_now,
      last_submitted_at = v_now,
      review_status = 'not_reviewed',
      updated_at = v_now
    WHERE id = p_report_id;
  ELSE
    -- Revising existing report
    UPDATE public.daily_reports
    SET
      submission_status = 'submitted',
      last_submitted_at = v_now,
      revision_no = revision_no + 1,
      review_status = 'not_reviewed',
      updated_at = v_now
    WHERE id = p_report_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Laporan aktivitas harian berhasil dikirim.',
    'is_late', COALESCE(v_report.is_late, v_is_late)
  );
END;
$$;

REVOKE ALL ON FUNCTION app.report_submit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.report_submit(uuid, uuid) FROM authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
