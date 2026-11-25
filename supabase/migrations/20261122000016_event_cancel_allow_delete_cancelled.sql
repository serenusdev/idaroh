-- Allow deleting (setting deleted_at) an event that already has status = 'cancelled'
-- while still rejecting duplicate 'cancelled' transitions.

CREATE OR REPLACE FUNCTION app.event_cancel(
  p_event_id uuid,
  p_status text DEFAULT 'cancelled',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.events%ROWTYPE;
  v_state text;
  v_reason text;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus', 'koordinator') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengelola agenda.');
  END IF;

  v_state := lower(trim(COALESCE(NULLIF(p_status, ''), 'cancelled')));
  IF v_state NOT IN ('cancelled', 'deleted') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status penghapusan agenda tidak valid.');
  END IF;

  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 300 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Alasan pembatalan maksimal 300 karakter.');
  END IF;

  SELECT * INTO v_existing FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_existing.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Agenda tidak ditemukan.');
  END IF;
  IF v_state = 'cancelled' AND v_existing.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Agenda seluruhnya sudah dibatalkan.');
  END IF;
  -- A coordinator only decides for its own teams (§3.6 scope own).
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') AND NOT (
    v_existing.team_id IS NOT NULL AND v_existing.team_id = ANY (app.coordinator_team_keys(v_uid))
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Agenda ini berada di luar tim Anda.');
  END IF;

  UPDATE public.events SET
      status = 'cancelled',
      deleted_at = CASE WHEN v_state = 'deleted' THEN timezone('utc'::text, now()) ELSE deleted_at END,
      updated_at = timezone('utc'::text, now())
    WHERE id = p_event_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
      CASE WHEN v_state = 'deleted' THEN 'event.deleted' ELSE 'event.cancelled' END,
      v_uid,
      COALESCE(v_actor_name, v_uid::text),
      p_event_id::text,
      v_existing.title,
      format(
        '%s.%s',
        CASE WHEN v_state = 'deleted' THEN 'Agenda dihapus' ELSE 'Agenda dibatalkan' END,
        COALESCE(' Alasan: ' || v_reason, '')
      )
    );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'status', 'cancelled',
    'deleted', v_state = 'deleted'
  );
END;
$$;

REVOKE ALL ON FUNCTION app.event_cancel(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.event_cancel(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
