BEGIN;

-- Restore the direct-write policy/grant only as a rollback operation. Added
-- lifecycle columns are deliberately retained: rollback must not destroy data
-- written after this migration without an operator inspection.
DROP FUNCTION IF EXISTS public.resolve_gate_pass_token(text);
DROP FUNCTION IF EXISTS public.cancel_gate_pass(uuid);
DROP FUNCTION IF EXISTS public.approve_gate_pass_v2(uuid,boolean,text);
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
GRANT EXECUTE ON FUNCTION public.approve_gate_pass(uuid,boolean) TO authenticated;
GRANT SELECT, INSERT ON public.gate_passes TO authenticated;
DROP POLICY IF EXISTS gate_passes_request_scoped ON public.gate_passes;
CREATE POLICY gate_passes_request_scoped ON public.gate_passes FOR INSERT TO authenticated
  WITH CHECK (
    app.is_active_member() AND created_by = auth.uid() AND (
      app.has_any_role('pengurus','super_admin') OR EXISTS (
        SELECT 1 FROM public.students s WHERE s.id = gate_passes.student_id AND s.profile_id = auth.uid()
      )
    )
  );

COMMIT;
NOTIFY pgrst, 'reload schema';
