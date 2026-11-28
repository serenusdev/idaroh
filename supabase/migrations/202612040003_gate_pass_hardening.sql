BEGIN;

ALTER TABLE public.gate_passes ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.gate_passes ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE public.gate_passes ADD COLUMN IF NOT EXISTS out_recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.gate_passes ADD COLUMN IF NOT EXISTS back_recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.gate_passes ADD COLUMN IF NOT EXISTS returned_late boolean;
ALTER TABLE public.gate_passes ADD COLUMN IF NOT EXISTS late_minutes integer CHECK (late_minutes >= 0);

REVOKE INSERT ON public.gate_passes FROM authenticated;
DROP POLICY IF EXISTS gate_passes_request_scoped ON public.gate_passes;

CREATE OR REPLACE FUNCTION public.request_gate_pass(
  p_student_id uuid, p_reason text, p_destination text, p_due_back_at timestamptz
) RETURNS public.gate_passes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.gate_passes;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND is_active) THEN RAISE EXCEPTION 'GATE_PASS_NOT_FOUND'; END IF;
  IF NOT (app.has_any_role('pengurus','super_admin') OR EXISTS (
    SELECT 1 FROM public.students WHERE id = p_student_id AND profile_id = v_uid
  )) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_due_back_at <= now() OR p_due_back_at > now() + interval '30 days' THEN RAISE EXCEPTION 'DUE_BACK_MUST_BE_FUTURE'; END IF;
  INSERT INTO public.gate_passes(student_id, reason, destination, due_back_at, created_by)
  VALUES (p_student_id, trim(p_reason), trim(p_destination), p_due_back_at, v_uid)
  RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
  VALUES ('gate_pass.requested', v_uid, v_row.id::text, 'gate_pass', 'Pengajuan izin keluar dibuat', jsonb_build_object('student_id', p_student_id, 'due_back_at_wib', to_char(p_due_back_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS')));
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_gate_pass_v2(
  p_gate_pass_id uuid, p_approved boolean, p_note text DEFAULT NULL
) RETURNS public.gate_passes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.gate_passes;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT gp.* INTO v_row
  FROM public.gate_passes gp
  JOIN public.students s ON s.id = gp.student_id
  WHERE gp.id = p_gate_pass_id
  FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'pending' THEN RAISE EXCEPTION 'GATE_PASS_NOT_PENDING'; END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = v_row.student_id AND profile_id = v_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.gate_passes
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      approved_by = v_uid, approved_at = now(), review_note = NULLIF(trim(COALESCE(p_note, '')), ''), updated_at = now()
  WHERE id = p_gate_pass_id
  RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
  VALUES ('gate_pass.reviewed', v_uid, v_row.id::text, 'gate_pass', 'Pengajuan izin ditinjau', jsonb_build_object('approved', p_approved, 'note_present', p_note IS NOT NULL));
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_gate_pass(p_gate_pass_id uuid, p_approved boolean)
RETURNS public.gate_passes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
BEGIN
  RETURN public.approve_gate_pass_v2(p_gate_pass_id, p_approved, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.scan_gate_pass(p_qr_token text, p_direction text)
RETURNS public.gate_passes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.gate_passes;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_direction NOT IN ('out','back') THEN RAISE EXCEPTION 'INVALID_GATE_DIRECTION'; END IF;
  SELECT * INTO v_row FROM public.gate_passes WHERE qr_token = p_qr_token FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'GATE_PASS_SCAN_NOT_ALLOWED'; END IF;
  IF p_direction = 'out' THEN
    IF v_row.status <> 'approved' THEN RAISE EXCEPTION 'GATE_PASS_SCAN_NOT_ALLOWED'; END IF;
    IF v_now > v_row.due_back_at THEN
      UPDATE public.gate_passes SET status = 'cancelled', updated_at = v_now WHERE id = v_row.id RETURNING * INTO v_row;
      INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail) VALUES ('gate_pass.expired', v_uid, v_row.id::text, 'gate_pass', 'Izin disetujui kedaluwarsa sebelum keluar');
      RAISE EXCEPTION 'GATE_PASS_EXPIRED';
    END IF;
    UPDATE public.gate_passes SET out_at = v_now, out_recorded_by = v_uid, status = 'out', updated_at = v_now WHERE id = v_row.id RETURNING * INTO v_row;
  ELSE
    IF v_row.status NOT IN ('out','overdue') OR v_row.out_at IS NULL THEN RAISE EXCEPTION 'GATE_PASS_SCAN_NOT_ALLOWED'; END IF;
    UPDATE public.gate_passes
    SET actual_back_at = v_now, back_recorded_by = v_uid, status = 'returned',
        returned_late = v_now > due_back_at,
        late_minutes = GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_now - due_back_at)) / 60)::integer),
        updated_at = v_now
    WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
  VALUES ('gate_pass.scanned', v_uid, v_row.id::text, 'gate_pass', 'QR izin dipindai', jsonb_build_object('direction', p_direction, 'scanned_at_wib', to_char(v_now AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS')));
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.refresh_gate_pass_overdue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_count integer := 0; v_row public.gate_passes;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  FOR v_row IN SELECT * FROM public.gate_passes WHERE status = 'out' AND due_back_at < now() FOR UPDATE LOOP
    UPDATE public.gate_passes SET status = 'overdue', updated_at = now() WHERE id = v_row.id;
    INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail) VALUES ('gate_pass.overdue', v_uid, v_row.id::text, 'gate_pass', 'Izin sedang keluar melewati batas kembali');
    v_count := v_count + 1;
  END LOOP;
  FOR v_row IN SELECT * FROM public.gate_passes WHERE status = 'approved' AND due_back_at < now() FOR UPDATE LOOP
    UPDATE public.gate_passes SET status = 'cancelled', updated_at = now() WHERE id = v_row.id;
    INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail) VALUES ('gate_pass.expired', v_uid, v_row.id::text, 'gate_pass', 'Izin disetujui tidak dipakai sebelum batas kembali');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_gate_pass_token(p_qr_token text)
RETURNS TABLE(id uuid, status text, student_full_name text, nis text, destination text, reason text, out_at timestamptz, due_back_at timestamptz, is_overdue_now boolean, allowed_action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT gp.id, gp.status, s.full_name, s.nis, gp.destination, gp.reason, gp.out_at, gp.due_back_at,
    (gp.status = 'out' AND gp.due_back_at < now()),
    CASE WHEN gp.status = 'approved' AND gp.due_back_at >= now() THEN 'out' WHEN gp.status IN ('out','overdue') AND gp.out_at IS NOT NULL THEN 'back' ELSE NULL END
  FROM public.gate_passes gp JOIN public.students s ON s.id = gp.student_id
  WHERE gp.qr_token = p_qr_token;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_gate_pass(p_id uuid)
RETURNS public.gate_passes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.gate_passes;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT * INTO v_row FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'GATE_PASS_NOT_PENDING'; END IF;
  IF v_row.created_by <> v_uid AND NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.gate_passes SET status = 'cancelled', updated_at = now() WHERE id = p_id RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail) VALUES ('gate_pass.cancelled', v_uid, v_row.id::text, 'gate_pass', 'Izin dibatalkan');
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.request_gate_pass(uuid,text,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_gate_pass(uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_gate_pass_v2(uuid,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scan_gate_pass(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_gate_pass_overdue() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_gate_pass_token(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_gate_pass(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_gate_pass(uuid,text,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_gate_pass(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_gate_pass_v2(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_gate_pass(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_gate_pass_overdue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_gate_pass_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_gate_pass(uuid) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
