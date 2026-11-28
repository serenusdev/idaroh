BEGIN;

CREATE OR REPLACE FUNCTION public.create_academic_term(
  p_code text, p_name text, p_start_date date, p_end_date date
) RETURNS public.academic_terms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.academic_terms;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN RAISE EXCEPTION 'INVALID_TERM_RANGE'; END IF;
  IF NULLIF(btrim(p_code), '') IS NULL OR NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'INVALID_TERM_INPUT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('academic_terms_range'));
  IF EXISTS (SELECT 1 FROM public.academic_terms WHERE lower(code) = lower(btrim(p_code))) THEN RAISE EXCEPTION 'TERM_CODE_EXISTS'; END IF;
  IF EXISTS (SELECT 1 FROM public.academic_terms WHERE daterange(start_date, end_date, '[]') && daterange(p_start_date, p_end_date, '[]')) THEN RAISE EXCEPTION 'TERM_OVERLAP'; END IF;
  INSERT INTO public.academic_terms(code, name, start_date, end_date) VALUES (btrim(p_code), btrim(p_name), p_start_date, p_end_date) RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
  VALUES ('academic.term_created', v_uid, v_row.id::text, v_row.code, 'Tahun ajaran dibuat', jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date));
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.create_academic_term(text,text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_academic_term(text,text,date,date) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
