BEGIN;

CREATE OR REPLACE FUNCTION public.save_mutabaah_log_for_date(
  p_student_id uuid, p_log_date date, p_checklist jsonb
) RETURNS public.mutabaah_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date; v_row public.mutabaah_logs;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_log_date IS NULL OR p_log_date > v_today THEN RAISE EXCEPTION 'LOG_DATE_OUT_OF_RANGE'; END IF;
  IF NOT app.has_any_role('pengurus', 'super_admin') AND p_log_date <> v_today THEN RAISE EXCEPTION 'LOG_DATE_OUT_OF_RANGE'; END IF;
  IF app.has_any_role('pengurus', 'super_admin') AND p_log_date < v_today - 30 THEN RAISE EXCEPTION 'LOG_DATE_OUT_OF_RANGE'; END IF;
  IF NOT app.has_any_role('pengurus', 'super_admin') AND NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND profile_id = v_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  INSERT INTO public.mutabaah_logs(student_id, log_date, checklist, recorded_by)
  VALUES (p_student_id, p_log_date, COALESCE(p_checklist, '{}'::jsonb), v_uid)
  ON CONFLICT (student_id, log_date) DO UPDATE SET checklist = EXCLUDED.checklist, recorded_by = v_uid, updated_at = now()
  RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
  VALUES ('mutabaah.log_saved', v_uid, v_row.id::text, 'mutabaah_log', 'Log mutabaah disimpan', jsonb_build_object('student_id', p_student_id, 'log_date', p_log_date));
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.save_mutabaah_log_for_date(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_mutabaah_log_for_date(uuid, date, jsonb) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
