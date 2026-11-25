-- ROLE-SYNC — PERMISSIONS.md §2 rules 1-2, §3.1, §3.3, §3.7 (operator decision 2026-11-25).
--
-- Four separate gaps are closed here, all of them the same underlying mistake: the
-- application decided access from profiles.member_type and from an ordering of the role
-- names, while PERMISSIONS.md describes access as a (permission, scope) pair read from
-- user_roles.
--
--   1. §3.3 attendance read: `attendance.record.read` was never seeded, so the RLS clause
--      that referenced it (20261101000003) was dead and the surviving policy
--      (20261102000005) handed every row to super_admin/yayasan/pengurus while a
--      koordinator — whom §3.3 gives `team` — got nothing but their own. The server action
--      read the tables with the service-role client, which ignores RLS, and replaced the
--      missing rule with a rank comparison on profiles.member_type: an account whose
--      category was not one of the five role names (`ustadz`, `lainnya`) normalised to null
--      and the comparison was skipped, so any pengurus could read any ustadz's history.
--   2. §3.1 IAM mutations: 20261102000005 granted pengurus `iam.account.decide` and both
--      pengurus and yayasan `iam.account.request.read`, although every row of §3.1 marks
--      those permissions `—` for S/K/P/Y. The account_requests policy reads that grant, so
--      the seed — not the matrix — was the effective rule.
--   3. §2 rule 1 in provisioning: app.approve_account_application() wrote
--      profiles.member_type = the assigned role key, which is precisely the conflation the
--      rule forbids and the reason an ustadz applicant stopped being an ustadz the moment
--      they were approved. app.admin_update_user() did the same thing and also accepted
--      p_admin_id as proof of identity without checking it, so a caller could name anyone
--      as the acting administrator.
--   4. §2 rule 5: the approval wrote team_members.valid_from from CURRENT_DATE, i.e. the
--      database server's calendar day rather than the WIB day.
--
-- Rollback: supabase/rollback/20261122000010_role_sync_ustadz_and_matrix_down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. §3.3 — attendance.record.read becomes a real, scoped permission.
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (key, description) VALUES
  ('attendance.record.read', 'Melihat riwayat presensi sesuai scope peran')
ON CONFLICT (key) DO NOTHING;

-- super_admin is deliberately absent: §3.3 marks the column `—` for SA. The universal
-- self-read is handled by app.can_view_attendance_of() itself, so the absence of a grant
-- still leaves every account able to see its own history.
DELETE FROM public.role_permissions rp
USING public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND p.key = 'attendance.record.read'
  AND r.key = 'super_admin';

INSERT INTO public.role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, s.scope::public.scope_type_enum
FROM (VALUES
  ('santri', 'own'),
  ('koordinator', 'team'),
  ('pengurus', 'global'),
  ('yayasan', 'global')
) AS s (role_key, scope)
JOIN public.roles r ON r.key = s.role_key
JOIN public.permissions p ON p.key = 'attendance.record.read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET scope = EXCLUDED.scope;

-- ---------------------------------------------------------------------------
-- 2. The scope column finally decides something: read the widest scope the caller holds
--    across every active role, then turn it into a row-level answer.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.permission_scope(p_permission text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, pg_temp
STABLE
AS $$
  SELECT rp.scope::text
  FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.user_roles ur ON ur.role_id = r.id
    AND ur.user_id = auth.uid()
    AND ur.revoked_at IS NULL
  WHERE p.key = p_permission
  ORDER BY CASE rp.scope::text
    WHEN 'global' THEN 4
    WHEN 'assigned' THEN 3
    WHEN 'team' THEN 2
    WHEN 'own' THEN 1
    ELSE 0
  END DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app.permission_scope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.permission_scope(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app.can_view_attendance_of(p_target uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, pg_temp
STABLE
AS $$
  SELECT app.is_active_member() AND CASE app.permission_scope('attendance.record.read')
    -- `assigned` has no meaning for attendance history (no assignee table exists for it)
    -- and therefore falls through to the self-read branch, like an absent grant does.
    WHEN 'global' THEN true
    WHEN 'team' THEN p_target = auth.uid() OR EXISTS (
      SELECT 1
      FROM public.team_members own
      JOIN public.team_members peer ON peer.team_id = own.team_id
        AND peer.user_id = p_target
        AND peer.valid_to IS NULL
      WHERE own.user_id = auth.uid()
        AND own.valid_to IS NULL
    )
    ELSE p_target = auth.uid()
  END;
$$;

REVOKE ALL ON FUNCTION app.can_view_attendance_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.can_view_attendance_of(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION app.can_view_attendance_of(uuid)
  IS '§3.3 attendance.record.read scope (own/team/global) evaluated over the caller''s active roles in user_roles; never profiles.member_type and never a role rank.';

-- Both attendance tables are now decided by the same helper, so the action and the database
-- agree even when the action is the one asking.
DROP POLICY IF EXISTS "Active users can view scoped attendance" ON public.attendance_records;
DROP POLICY IF EXISTS "Users can view own attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Attendance history readable through the scope helper" ON public.attendance_records;
CREATE POLICY "Attendance history readable through the scope helper"
  ON public.attendance_records FOR SELECT TO authenticated
  USING (app.can_view_attendance_of(user_id));

DROP POLICY IF EXISTS "Users can view own effective attendance" ON public.attendance_effective;
DROP POLICY IF EXISTS "Effective attendance readable through the scope helper" ON public.attendance_effective;
CREATE POLICY "Effective attendance readable through the scope helper"
  ON public.attendance_effective FOR SELECT TO authenticated
  USING (app.can_view_attendance_of(user_id));

-- ---------------------------------------------------------------------------
-- 3. The operational default for "is this person expected to check in" followed the same
--    mistake: it read profiles.member_type, so an ustadz holding the santri role was
--    classified `not_required` and their real check-ins never surfaced in their own
--    history. The expectation belongs to the assigned role.
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
      WHEN COALESCE(df.attendance_required, role_expect.attendance_required) = false THEN 'not_required'
      WHEN corr.id IS NOT NULL THEN corr.final_classification
      WHEN exc.id IS NOT NULL THEN exc.type
      WHEN ar.id IS NOT NULL THEN ar.classification::text
      ELSE 'no_checkin'
    END,
    CASE
      WHEN nod.attendance_date IS NOT NULL THEN 'calendar'
      WHEN COALESCE(df.attendance_required, role_expect.attendance_required) = false THEN 'duty_flag'
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
    -- EXISTS, not a filtered row: an account with no attended-role grant has to answer
    -- false rather than NULL, otherwise it falls through to `no_checkin` and every
    -- administrator appears absent in the operational layer.
    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = p.id
        AND ur.revoked_at IS NULL
        AND r.key IN ('santri', 'koordinator')
    ) AS attendance_required
  ) role_expect ON true
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
-- 4. §3.1 — the approval RPC keeps its atomicity and loses the ranking.
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
  v_is_super_admin boolean;
  v_existing_role uuid;
BEGIN
  -- Transport guard kept from 20261112000005: the server action calls with the service-role
  -- key; a signed-in client may only settle its own application.
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

  -- §3.1: iam.account.decide is super_admin only, and the claim has to be checked in the
  -- database rather than taken from the caller. p_approver_id travels over a service-role
  -- channel, so it is a claim about who is acting; this is where it is verified.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.profiles ap ON ap.id = ur.user_id AND ap.status = 'active'
    WHERE ur.user_id = p_approver_id
      AND ur.revoked_at IS NULL
      AND r.key = 'super_admin'
  ) INTO v_is_super_admin;

  IF NOT v_is_super_admin THEN
    RETURN jsonb_build_object('success', false, 'message', 'Approver bukan super_admin aktif.');
  END IF;

  SELECT * INTO v_role FROM public.roles WHERE key = lower(trim(p_role_key));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Role tujuan tidak ditemukan.');
  END IF;
  -- §3.1 iam.role.assign: the registration queue cannot mint the role that owns it.
  IF v_role.key = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peran super_admin tidak dapat ditetapkan dari antrean pendaftaran.');
  END IF;

  IF p_team_id IS NOT NULL THEN
    SELECT * INTO v_team FROM public.teams WHERE id = p_team_id AND status = 'active';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tim tujuan tidak ditemukan atau sudah diarsipkan.');
    END IF;
  END IF;

  -- All writes below are in the same transaction as the request transition.
  -- member_type is the category the applicant claimed (COALESCE keeps the historical
  -- behaviour for rows written before 20261113000001, which have no claim), and the role is
  -- granted separately in user_roles — §2 rule 1.
  INSERT INTO public.profiles (
    id, email, full_name, phone_number, status, member_type, team_name, updated_at
  ) VALUES (
    p_auth_user_id, v_request.email, v_request.full_name, v_request.phone_number,
    'active',
    COALESCE(v_request.claimed_member_type, v_role.key),
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
    VALUES (v_team.id, p_auth_user_id, 'member', (now() AT TIME ZONE 'Asia/Jakarta')::date)
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
-- 5. §3.1 — admin_update_user authenticates its actor in the database, keeps the category
--    beside the role, and protects the last active super_admin.
-- ---------------------------------------------------------------------------

-- The extra argument has a DEFAULT, so an existing eight-argument call would become
-- ambiguous if the old signature were left in place: both pair is dropped and recreated
-- under the same name, which keeps the file replay-safe and idempotent.
DROP FUNCTION IF EXISTS app.admin_update_user(uuid, uuid, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS app.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid, uuid, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text);

CREATE OR REPLACE FUNCTION app.admin_update_user(
  p_target_user_id  uuid,
  p_admin_id        uuid,
  p_full_name       text        DEFAULT NULL,
  p_phone_number    text        DEFAULT NULL,
  p_status          text        DEFAULT NULL,
  p_team_name       text        DEFAULT NULL,
  p_new_role_key    text        DEFAULT NULL,
  p_old_role_id     uuid        DEFAULT NULL,
  p_member_type     text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_new_role_id       uuid;
  v_new_role_key      text;
  v_admin_name        text;
  v_detail            text := '';
  v_update_cols       text[] := '{}';
  v_now               timestamptz := now();
  v_actor_is_super    boolean;
  v_target_is_super   boolean;
  v_other_super_admin integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
  END IF;

  -- iam.account.suspend / iam.role.assign are super_admin only, and the caller has to prove
  -- it. Without this, p_admin_id was whatever the request body said.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.profiles ap ON ap.id = ur.user_id AND ap.status = 'active'
    WHERE ur.user_id = p_admin_id
      AND ur.revoked_at IS NULL
      AND r.key = 'super_admin'
  ) INTO v_actor_is_super;

  IF NOT v_actor_is_super THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pemanggil bukan super_admin aktif.');
  END IF;

  IF p_full_name IS NOT NULL AND length(trim(p_full_name)) < 2 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nama lengkap minimal 2 karakter.');
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'suspended', 'deactivated') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status akun tidak valid.');
  END IF;
  IF p_member_type IS NOT NULL
     AND p_member_type NOT IN ('santri', 'ustadz', 'pengurus', 'yayasan', 'lainnya') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kategori anggota tidak valid.');
  END IF;

  IF p_new_role_key IS NOT NULL THEN
    v_new_role_key := lower(trim(p_new_role_key));
    -- §3.1 iam.role.assign forbids self-escalation; this RPC cannot hand out the role that
    -- authorises it. Promotions belong to the dedicated role-assignment path.
    IF v_new_role_key = 'super_admin' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Peran super_admin tidak dapat ditetapkan dari layar pengguna.');
    END IF;
    SELECT id INTO v_new_role_id FROM public.roles WHERE key = v_new_role_key;
    IF v_new_role_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Role tujuan tidak ditemukan.');
    END IF;
  END IF;

  -- §3.1: minimal 1 super_admin aktif must survive the write, whether it is a demotion or a
  -- suspension. Evaluated before any change is applied.
  IF p_new_role_key IS NOT NULL OR COALESCE(p_status, '') IN ('suspended', 'deactivated') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = p_target_user_id
        AND ur.revoked_at IS NULL
        AND r.key = 'super_admin'
    ) INTO v_target_is_super;

    IF v_target_is_super THEN
      SELECT count(*) INTO v_other_super_admin
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      JOIN public.profiles p ON p.id = ur.user_id AND p.status = 'active'
      WHERE ur.revoked_at IS NULL
        AND r.key = 'super_admin'
        AND ur.user_id <> p_target_user_id;

      IF v_other_super_admin = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Harus tetap ada minimal satu super_admin aktif.');
      END IF;
    END IF;
  END IF;

  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = p_admin_id;

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
  IF p_member_type IS NOT NULL THEN
    v_update_cols := v_update_cols || ARRAY['member_type=' || p_member_type];
  END IF;
  IF p_new_role_key IS NOT NULL THEN
    v_update_cols := v_update_cols || ARRAY['role=' || p_new_role_key];
  END IF;
  v_detail := 'Bidang diubah: ' || array_to_string(v_update_cols, ', ') || '.';

  -- 1. Update profiles — member_type only changes when the caller states a category, so a
  -- role change no longer overwrites it (§2 rule 1).
  UPDATE public.profiles
  SET
    full_name          = COALESCE(p_full_name,     full_name),
    phone_number       = COALESCE(p_phone_number,  phone_number),
    status             = COALESCE(p_status,        status),
    team_name          = COALESCE(p_team_name,     team_name),
    member_type        = COALESCE(p_member_type,   member_type),
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

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_target_user_id  uuid,
  p_admin_id        uuid,
  p_full_name       text        DEFAULT NULL,
  p_phone_number    text        DEFAULT NULL,
  p_status          text        DEFAULT NULL,
  p_team_name       text        DEFAULT NULL,
  p_new_role_key    text        DEFAULT NULL,
  p_old_role_id     uuid        DEFAULT NULL,
  p_member_type     text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.admin_update_user(
    p_target_user_id, p_admin_id, p_full_name, p_phone_number,
    p_status, p_team_name, p_new_role_key, p_old_role_id, p_member_type
  );
$$;

REVOKE ALL ON FUNCTION app.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text) TO service_role;

COMMENT ON FUNCTION app.admin_update_user(uuid, uuid, text, text, text, text, text, uuid, text)
  IS '§3.1 IAM mutation RPC: actor must hold an active super_admin role, super_admin is not assignable here, and the last active super_admin cannot be demoted or suspended.';

-- ---------------------------------------------------------------------------
-- 6. §3.1 data — the queue and the decision surface stop existing for P and Y. The
--    account_requests RLS policy reads iam.account.decide, so this narrows the policy and
--    the action at once.
-- ---------------------------------------------------------------------------

DELETE FROM public.role_permissions rp
USING public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.key <> 'super_admin'
  AND p.key IN (
    'iam.account.request.read', 'iam.account.decide', 'iam.account.suspend',
    'iam.role.assign', 'iam.session.revoke'
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
