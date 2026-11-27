BEGIN;

CREATE TABLE IF NOT EXISTS public.gate_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(trim(reason)) >= 3),
  destination text NOT NULL CHECK (char_length(trim(destination)) >= 2),
  out_at timestamptz,
  due_back_at timestamptz NOT NULL,
  actual_back_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','out','returned','overdue','rejected','cancelled')),
  qr_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_back_at > created_at),
  CHECK (actual_back_at IS NULL OR out_at IS NULL OR actual_back_at >= out_at)
);

CREATE INDEX IF NOT EXISTS idx_gate_passes_student_created ON public.gate_passes(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_passes_status_due_back ON public.gate_passes(status, due_back_at);

ALTER TABLE public.gate_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gate_passes FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.gate_passes TO authenticated;
GRANT ALL ON public.gate_passes TO service_role;

DROP POLICY IF EXISTS gate_passes_read_scoped ON public.gate_passes;
CREATE POLICY gate_passes_read_scoped ON public.gate_passes FOR SELECT TO authenticated
  USING (
    app.is_active_member() AND (
      app.has_any_role('pengurus','super_admin') OR EXISTS (
        SELECT 1 FROM public.students s WHERE s.id = gate_passes.student_id AND s.profile_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS gate_passes_request_scoped ON public.gate_passes;
CREATE POLICY gate_passes_request_scoped ON public.gate_passes FOR INSERT TO authenticated
  WITH CHECK (
    app.is_active_member() AND created_by = auth.uid() AND (
      app.has_any_role('pengurus','super_admin') OR EXISTS (
        SELECT 1 FROM public.students s WHERE s.id = gate_passes.student_id AND s.profile_id = auth.uid()
      )
    )
  );

CREATE OR REPLACE FUNCTION public.request_gate_pass(
  p_student_id uuid, p_reason text, p_destination text, p_due_back_at timestamptz
) RETURNS public.gate_passes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.gate_passes;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF NOT (app.has_any_role('pengurus','super_admin') OR EXISTS (
    SELECT 1 FROM public.students WHERE id = p_student_id AND profile_id = v_uid
  )) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_due_back_at <= now() THEN RAISE EXCEPTION 'DUE_BACK_MUST_BE_FUTURE'; END IF;
  INSERT INTO public.gate_passes(student_id, reason, destination, due_back_at, created_by)
  VALUES (p_student_id, trim(p_reason), trim(p_destination), p_due_back_at, v_uid)
  RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
  VALUES ('gate_pass.requested', v_uid, v_row.id::text, 'gate_pass', 'Pengajuan izin keluar dibuat', jsonb_build_object('student_id', p_student_id, 'due_back_at', p_due_back_at));
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.request_gate_pass(uuid,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_gate_pass(uuid,text,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_gate_pass(p_gate_pass_id uuid, p_approved boolean)
RETURNS public.gate_passes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.gate_passes;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.gate_passes SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END, approved_by = v_uid, updated_at = now()
  WHERE id = p_gate_pass_id AND status = 'pending' RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'GATE_PASS_NOT_PENDING'; END IF;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
  VALUES ('gate_pass.reviewed', v_uid, v_row.id::text, 'gate_pass', 'Pengajuan izin ditinjau', jsonb_build_object('approved', p_approved));
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.approve_gate_pass(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_gate_pass(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.scan_gate_pass(p_qr_token text, p_direction text)
RETURNS public.gate_passes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.gate_passes; v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_direction NOT IN ('out','back') THEN RAISE EXCEPTION 'INVALID_GATE_DIRECTION'; END IF;
  UPDATE public.gate_passes
  SET out_at = CASE WHEN p_direction = 'out' THEN v_now ELSE out_at END,
      actual_back_at = CASE WHEN p_direction = 'back' THEN v_now ELSE actual_back_at END,
      status = CASE WHEN p_direction = 'out' THEN 'out' ELSE 'returned' END,
      updated_at = v_now
  WHERE qr_token = p_qr_token
    AND (p_direction = 'out' AND status = 'approved' OR p_direction = 'back' AND status IN ('out','overdue'))
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'GATE_PASS_SCAN_NOT_ALLOWED'; END IF;
  INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
  VALUES ('gate_pass.scanned', v_uid, v_row.id::text, 'gate_pass', 'QR izin dipindai', jsonb_build_object('direction', p_direction, 'scanned_at_wib', to_char(v_now AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS')));
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.scan_gate_pass(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_gate_pass(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_gate_pass_overdue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.gate_passes SET status = 'overdue', updated_at = now()
  WHERE status IN ('approved','out') AND due_back_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_gate_pass_overdue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_gate_pass_overdue() TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
