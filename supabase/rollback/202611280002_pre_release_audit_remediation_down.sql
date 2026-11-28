BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.stored_files WHERE folder_category = 'backups') THEN
    RAISE EXCEPTION 'Cannot roll back while backup metadata exists in public.stored_files';
  END IF;
END
$$;

ALTER TABLE public.stored_files
  DROP CONSTRAINT IF EXISTS stored_files_folder_category_check;

ALTER TABLE public.stored_files
  ADD CONSTRAINT stored_files_folder_category_check
  CHECK (folder_category IN ('avatars','reports','resources','raw-imports','rapor'));

CREATE OR REPLACE FUNCTION app.update_own_profile(
  p_full_name text,
  p_phone_number text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(COALESCE(p_full_name, ''));
  v_phone text := btrim(COALESCE(p_phone_number, ''));
  v_avatar text;
  v_old_name text;
  v_saved_name text;
  v_changed text[] := '{}';
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.'); END IF;
  IF length(v_name) = 0 THEN RETURN jsonb_build_object('success', false, 'message', 'Nama lengkap wajib diisi.'); END IF;
  IF length(v_name) > 100 THEN RETURN jsonb_build_object('success', false, 'message', 'Nama lengkap maksimal 100 karakter.'); END IF;
  IF length(v_phone) > 30 THEN RETURN jsonb_build_object('success', false, 'message', 'Nomor telepon maksimal 30 karakter.'); END IF;
  IF p_avatar_url IS NOT NULL THEN
    v_avatar := btrim(p_avatar_url);
    IF length(v_avatar) > 0 AND (v_avatar LIKE '%..%' OR position('/storage/v1/object/public/avatars/' || v_uid::text || '/' IN v_avatar) = 0) THEN
      RETURN jsonb_build_object('success', false, 'message', 'URL avatar tidak valid atau bukan milik akun Anda.');
    END IF;
    IF length(v_avatar) = 0 THEN v_avatar := NULL; END IF;
  END IF;
  SELECT full_name INTO v_old_name FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', 'Profil Anda tidak ditemukan.'); END IF;
  UPDATE public.profiles SET full_name = v_name, phone_number = v_phone, avatar_url = CASE WHEN p_avatar_url IS NULL THEN avatar_url ELSE v_avatar END, updated_at = now() WHERE id = v_uid RETURNING profiles.full_name INTO v_saved_name;
  IF v_old_name IS DISTINCT FROM v_saved_name THEN v_changed := array_append(v_changed, 'nama'); END IF;
  IF p_phone_number IS NOT NULL THEN v_changed := array_append(v_changed, 'nomor telepon'); END IF;
  IF p_avatar_url IS NOT NULL THEN v_changed := array_append(v_changed, 'foto profil'); END IF;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES ('iam.profile_updated', v_uid, COALESCE(v_saved_name, 'Anggota'), v_uid::text, COALESCE(v_saved_name, 'Anggota'), 'Profil diri diperbarui melalui app.update_own_profile (' || array_to_string(v_changed, ', ') || ').');
  RETURN jsonb_build_object('success', true, 'full_name', v_saved_name);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_term_activity_to_report_cards(p_term_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  INSERT INTO public.report_cards(student_id,term_id,attendance_summary,updated_by)
  SELECT s.id,p_term_id,jsonb_build_object('present',COUNT(*) FILTER (WHERE ar.classification IN ('on_time','grace')),'late',COUNT(*) FILTER (WHERE ar.classification='late'),'excused',COUNT(*) FILTER (WHERE ar.classification IN ('excused','sick')),'tasks_completed',COALESCE((SELECT COUNT(*) FROM public.tasks t WHERE t.created_by=s.profile_id AND t.status='done' AND t.completed_at::date BETWEEN at.start_date AND at.end_date),0),'reports_submitted',COALESCE((SELECT COUNT(*) FROM public.daily_reports d WHERE d.user_id=s.profile_id AND d.report_date BETWEEN at.start_date AND at.end_date AND d.submission_status='submitted'),0),'source','auto_idaroh'),auth.uid()
  FROM public.students s JOIN public.academic_terms at ON at.id=p_term_id LEFT JOIN public.attendance_records ar ON ar.user_id=s.profile_id AND ar.attendance_date BETWEEN at.start_date AND at.end_date
  WHERE s.profile_id IS NOT NULL GROUP BY s.id,at.start_date,at.end_date
  ON CONFLICT(student_id,term_id) DO UPDATE SET attendance_summary=EXCLUDED.attendance_summary,updated_by=auth.uid(),updated_at=now();
  GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.sync_term_activity_to_report_cards(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_term_activity_to_report_cards(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
