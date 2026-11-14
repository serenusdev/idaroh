-- SEC-01 + FUNC-04 + SEC-05: Atomic admin_update_user RPC.
-- Wraps profiles.update → user_roles revoke → user_roles insert + audit_log in one
-- transaction so a mid-flight failure cannot leave state inconsistent.
-- Also sets session_revoked_at when status is changed to 'suspended' (SEC-05).

BEGIN;

CREATE OR REPLACE FUNCTION app.admin_update_user(
  p_target_user_id  uuid,
  p_admin_id        uuid,
  p_full_name       text        DEFAULT NULL,
  p_phone_number    text        DEFAULT NULL,
  p_status          text        DEFAULT NULL,
  p_team_name       text        DEFAULT NULL,
  p_new_role_key    text        DEFAULT NULL,
  p_old_role_id     uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_new_role_id  uuid;
  v_admin_name   text;
  v_detail       text := '';
  v_update_cols  text[] := '{}';
  v_now          timestamptz := now();
BEGIN
  -- Only the service-role key (server-side admin client) may call this.
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
  END IF;

  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = p_admin_id;

  -- Resolve new role id when a role change was requested
  IF p_new_role_key IS NOT NULL THEN
    SELECT id INTO v_new_role_id FROM public.roles WHERE key = lower(trim(p_new_role_key));
    IF v_new_role_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Role tujuan tidak ditemukan.');
    END IF;
  END IF;

  -- Build a list of changed fields for the audit detail
  IF p_full_name IS NOT NULL THEN
    v_update_cols := v_update_cols || ARRAY['full_name'];
  END IF;
  IF p_phone_number IS NOT NULL THEN
    v_update_cols := v_update_cols || ARRAY['phone_number'];
  END IF;
  IF p_status IS NOT NULL THEN
    v_update_cols := v_update_cols || ARRAY['status=' || p_status];
  END IF;
  IF p_team_name IS NOT NULL THEN
    v_update_cols := v_update_cols || ARRAY['team_name'];
  END IF;
  IF p_new_role_key IS NOT NULL THEN
    v_update_cols := v_update_cols || ARRAY['role=' || p_new_role_key];
  END IF;
  v_detail := 'Bidang diubah: ' || array_to_string(v_update_cols, ', ') || '.';

  -- 1. Update profiles — conditionally set session_revoked_at when suspending
  UPDATE public.profiles
  SET
    full_name          = COALESCE(p_full_name,     full_name),
    phone_number       = COALESCE(p_phone_number,  phone_number),
    status             = COALESCE(p_status,        status),
    team_name          = COALESCE(p_team_name,     team_name),
    member_type        = COALESCE(p_new_role_key,  member_type),
    session_revoked_at = CASE
                           WHEN p_status = 'suspended' THEN v_now
                           ELSE session_revoked_at
                         END,
    updated_at         = v_now
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengguna tidak ditemukan.');
  END IF;

  -- 2. Role rotation (only when a role change was requested)
  IF v_new_role_id IS NOT NULL THEN
    -- Revoke all current active roles
    UPDATE public.user_roles
    SET revoked_at = v_now,
        revoked_by = p_admin_id,
        reason     = 'Role diperbarui oleh administrator'
    WHERE user_id  = p_target_user_id
      AND revoked_at IS NULL;

    -- Grant the new role
    INSERT INTO public.user_roles (user_id, role_id, granted_by)
    VALUES (p_target_user_id, v_new_role_id, p_admin_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- 3. Write audit log
  INSERT INTO public.audit_logs (
    event_name, actor_id, actor_name, target_id, target_label, action_detail
  ) VALUES (
    'iam.admin_update_user',
    p_admin_id,
    COALESCE(v_admin_name, p_admin_id::text),
    p_target_user_id::text,
    'Profil pengguna ' || p_target_user_id::text,
    v_detail
  );

  RETURN jsonb_build_object('success', true, 'message', 'Profil pengguna berhasil diperbarui.');
END;
$$;

-- Allow the server-side admin client (service_role) to call this function.
REVOKE ALL ON FUNCTION app.admin_update_user FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.admin_update_user TO service_role;

-- Public wrapper so PostgREST can relay supabase.rpc("admin_update_user").
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_target_user_id  uuid,
  p_admin_id        uuid,
  p_full_name       text        DEFAULT NULL,
  p_phone_number    text        DEFAULT NULL,
  p_status          text        DEFAULT NULL,
  p_team_name       text        DEFAULT NULL,
  p_new_role_key    text        DEFAULT NULL,
  p_old_role_id     uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.admin_update_user(
    p_target_user_id, p_admin_id, p_full_name, p_phone_number,
    p_status, p_team_name, p_new_role_key, p_old_role_id
  );
$$;

REVOKE ALL ON FUNCTION public.admin_update_user FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user TO service_role;

COMMIT;
