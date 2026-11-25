-- Rollback for 20261122000010_role_sync_ustadz_and_matrix.sql
--
-- Restores the pre-migration state of ROLE-SYNC: the two attendance SELECT policies that
-- decided visibility with app.has_any_role(...), the member_type default inside
-- app.refresh_attendance_effective(), the ranked approver comparison in
-- app.approve_account_application(), the eight-argument app/public admin_update_user pair
-- that derived member_type from the role key, and the IAM permission grants that
-- 20261102000005 seeded for pengurus and yayasan. The attendance.record.read permission and
-- the two app.* helpers are dropped because neither existed before the migration.
--
-- Apply with: supabase db query --local --file supabase/rollback/20261122000010_role_sync_ustadz_and_matrix_down.sql
-- (or the equivalent psql invocation against the target database). Production is never
-- touched by this file on its own; it is a manual recovery path only.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Attendance read: back to the role-list policies, helpers and seed removed.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Attendance history readable through the scope helper" ON public.attendance_records;
CREATE POLICY "Active users can view scoped attendance"
  ON public.attendance_records FOR SELECT TO authenticated
  USING (app.is_active_member() AND (user_id = auth.uid() OR app.has_any_role('super_admin', 'yayasan', 'pengurus')));

DROP POLICY IF EXISTS "Effective attendance readable through the scope helper" ON public.attendance_effective;
CREATE POLICY "Users can view own effective attendance"
  ON public.attendance_effective FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR app.has_any_role('super_admin', 'yayasan', 'pengurus'));

DROP FUNCTION IF EXISTS app.can_view_attendance_of(uuid);
DROP FUNCTION IF EXISTS app.permission_scope(text);

DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id AND p.key = 'attendance.record.read';

DELETE FROM public.permissions WHERE key = 'attendance.record.read';

-- ---------------------------------------------------------------------------
-- 2. app.refresh_attendance_effective: the live 20261114000007 body, verbatim.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.refresh_attendance_effective(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tanggal snapshot wajib diisi.');
  END IF;

  INSERT INTO public.attendance_effective (
    user_id, attendance_date, status, source_type, source_id, policy_version_id, generated_at
  )
  SELECT
    p.id,
    p_date,
    CASE
      WHEN nod.attendance_date IS NOT NULL THEN 'non_operational'
      WHEN COALESCE(df.attendance_required, (p.member_type IN ('santri', 'koordinator'))) = false THEN 'not_required'
      WHEN corr.id IS NOT NULL THEN corr.final_classification
      WHEN exc.id IS NOT NULL THEN exc.type
      WHEN ar.id IS NOT NULL THEN ar.classification::text
      ELSE 'no_checkin'
    END,
    CASE
      WHEN nod.attendance_date IS NOT NULL THEN 'calendar'
      WHEN COALESCE(df.attendance_required, (p.member_type IN ('santri', 'koordinator'))) = false THEN 'duty_flag'
      WHEN corr.id IS NOT NULL THEN 'correction'
      WHEN exc.id IS NOT NULL THEN 'exception'
      WHEN ar.id IS NOT NULL THEN 'attendance_record'
      ELSE 'attendance_record'
    END,
    COALESCE(corr.id, exc.id, ar.id),
    ar.policy_version_id,
    now()
  FROM public.profiles p
  LEFT JOIN public.non_operational_dates nod ON nod.attendance_date = p_date
  LEFT JOIN LATERAL (
    SELECT f.attendance_required
    FROM public.attendance_duty_flags f
    WHERE f.user_id = p.id AND f.date_from <= p_date AND (f.date_to IS NULL OR f.date_to >= p_date)
    ORDER BY f.created_at DESC LIMIT 1
  ) df ON true
  LEFT JOIN LATERAL (
    SELECT c.id, COALESCE(c.effective_classification, c.requested_classification) AS final_classification
    FROM public.attendance_corrections c
    WHERE c.user_id = p.id AND c.attendance_date = p_date AND c.status = 'approved'
    ORDER BY c.decided_at DESC NULLS LAST LIMIT 1
  ) corr ON true
  LEFT JOIN LATERAL (
    SELECT e.id, e.type
    FROM public.attendance_exceptions e
    WHERE e.user_id = p.id AND e.date_from <= p_date AND e.date_to >= p_date AND e.status = 'approved'
    ORDER BY e.decided_at DESC NULLS LAST LIMIT 1
  ) exc ON true
  LEFT JOIN public.attendance_records ar ON ar.user_id = p.id AND ar.attendance_date = p_date
  WHERE p.status = 'active'
  ON CONFLICT (user_id, attendance_date) DO UPDATE SET
    status = EXCLUDED.status,
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    policy_version_id = EXCLUDED.policy_version_id,
    generated_at = EXCLUDED.generated_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'attendance_date', p_date, 'rows', v_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. app.approve_account_application: the 20261112000005 body, verbatim.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.approve_account_application(
  p_request_id uuid,
  p_auth_user_id uuid,
  p_role_key text,
  p_approver_id uuid,
  p_team_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_request public.account_requests%ROWTYPE;
  v_role public.roles%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_approver_role text;
  v_approver_priority integer;
  v_target_priority integer;
  v_existing_role uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND auth.uid() IS DISTINCT FROM p_approver_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pemanggil tidak memiliki kewenangan menyetujui akun.');
  END IF;

  SELECT * INTO v_request
  FROM public.account_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengajuan akun tidak ditemukan.');
  END IF;
  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'message', format('Pengajuan ini sudah berstatus "%s".', v_request.status));
  END IF;
  IF v_request.auth_user_id IS DISTINCT FROM p_auth_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akun Auth pengajuan tidak cocok.');
  END IF;

  SELECT * INTO v_role FROM public.roles WHERE key = lower(trim(p_role_key));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Role tujuan tidak ditemukan.');
  END IF;

  IF p_team_id IS NOT NULL THEN
    SELECT * INTO v_team FROM public.teams WHERE id = p_team_id AND status = 'active';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tim tujuan tidak ditemukan atau sudah diarsipkan.');
    END IF;
  END IF;

  SELECT r.key INTO v_approver_role
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.profiles p ON p.id = ur.user_id AND p.status = 'active'
  WHERE ur.user_id = p_approver_id
    AND ur.revoked_at IS NULL
    AND r.key IN ('super_admin', 'yayasan', 'pengurus')
  ORDER BY CASE r.key WHEN 'super_admin' THEN 1 WHEN 'yayasan' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_approver_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Approver bukan anggota aktif dengan kewenangan IAM.');
  END IF;

  v_approver_priority := CASE v_approver_role
    WHEN 'super_admin' THEN 5
    WHEN 'yayasan' THEN 4
    WHEN 'pengurus' THEN 3
    ELSE 0
  END;
  v_target_priority := CASE v_role.key
    WHEN 'super_admin' THEN 5
    WHEN 'yayasan' THEN 4
    WHEN 'pengurus' THEN 3
    WHEN 'koordinator' THEN 2
    ELSE 1
  END;
  IF v_target_priority >= v_approver_priority THEN
    RETURN jsonb_build_object('success', false, 'message', 'Role tujuan setara atau lebih tinggi dari approver.');
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name, phone_number, status, member_type, team_name, updated_at
  ) VALUES (
    p_auth_user_id, v_request.email, v_request.full_name, v_request.phone_number,
    'active', v_role.key,
    COALESCE(v_team.name, v_request.team_requested, 'Sentra Santri'),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone_number = EXCLUDED.phone_number,
    status = 'active',
    member_type = EXCLUDED.member_type,
    team_name = EXCLUDED.team_name,
    updated_at = now();

  SELECT ur.id INTO v_existing_role
  FROM public.user_roles ur
  WHERE ur.user_id = p_auth_user_id
    AND ur.role_id = v_role.id
    AND ur.revoked_at IS NULL
  FOR UPDATE;

  IF v_existing_role IS NULL THEN
    INSERT INTO public.user_roles (user_id, role_id, granted_by)
    VALUES (p_auth_user_id, v_role.id, p_approver_id);
  END IF;

  IF v_team.id IS NOT NULL THEN
    INSERT INTO public.team_members (team_id, user_id, team_role, valid_from)
    VALUES (v_team.id, p_auth_user_id, 'member', CURRENT_DATE)
    ON CONFLICT (team_id, user_id) WHERE valid_to IS NULL DO NOTHING;
  END IF;

  UPDATE public.account_requests
  SET status = 'approved',
      approved_at = now(),
      approved_by = p_approver_id,
      reviewed_at = now(),
      reviewed_by = p_approver_id,
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_logs (
    event_name, actor_id, actor_name, target_id, target_label, action_detail
  )
  SELECT
    'iam.account_approved', p_approver_id, p.full_name, p_request_id::text,
    format('Permohonan %s', p_request_id),
    format('Persetujuan akun dengan peran %s%s.', v_role.key,
      CASE WHEN v_team.id IS NOT NULL THEN format(' di tim %s', v_team.name) ELSE '' END)
  FROM public.profiles p
  WHERE p.id = p_approver_id;

  RETURN jsonb_build_object('success', true, 'message', 'Akun berhasil diprovisikan secara atomik.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. app/public admin_update_user: the 20261114000004 eight-argument pair, verbatim.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS app.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text);

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
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
  END IF;

  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = p_admin_id;

  IF p_new_role_key IS NOT NULL THEN
    SELECT id INTO v_new_role_id FROM public.roles WHERE key = lower(trim(p_new_role_key));
    IF v_new_role_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Role tujuan tidak ditemukan.');
    END IF;
  END IF;

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

  IF v_new_role_id IS NOT NULL THEN
    UPDATE public.user_roles
    SET revoked_at = v_now,
        revoked_by = p_admin_id,
        reason     = 'Role diperbarui oleh administrator'
    WHERE user_id  = p_target_user_id
      AND revoked_at IS NULL;

    INSERT INTO public.user_roles (user_id, role_id, granted_by)
    VALUES (p_target_user_id, v_new_role_id, p_admin_id)
    ON CONFLICT DO NOTHING;
  END IF;

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

REVOKE ALL ON FUNCTION app.admin_update_user(uuid, uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.admin_update_user(uuid, uuid, text, text, text, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_update_user(uuid, uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, uuid, text, text, text, text, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. §3.1 grants: the 20261102000005 seed for pengurus and yayasan, restored.
-- ---------------------------------------------------------------------------

INSERT INTO public.role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'global'::public.scope_type_enum
FROM public.roles r
JOIN public.permissions p ON p.key IN (
  'iam.account.request.read', 'iam.account.decide', 'iam.account.suspend',
  'iam.role.assign', 'iam.user.read', 'iam.audit.read', 'iam.session.revoke'
)
WHERE r.key = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'global'::public.scope_type_enum
FROM public.roles r
JOIN public.permissions p ON p.key IN (
  'iam.account.request.read', 'iam.account.decide', 'iam.user.read'
)
WHERE r.key = 'pengurus'
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope = EXCLUDED.scope;

INSERT INTO public.role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'global'::public.scope_type_enum
FROM public.roles r
JOIN public.permissions p ON p.key IN ('iam.account.request.read', 'iam.user.read')
WHERE r.key = 'yayasan'
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope = EXCLUDED.scope;

COMMIT;

NOTIFY pgrst, 'reload schema';
