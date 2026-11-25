BEGIN;

SELECT plan(24);

-- ROLE-SYNC (PERMISSIONS.md §2 rules 1-2, §3.1, §3.3): who may read whose attendance.
--
-- Current state:
--   * `attendance.record.read` was never seeded into public.permissions, so the RLS
--     predicate that referenced it was dead, and the server action read the tables with
--     the service-role client — which ignores RLS entirely. The only real control was a
--     `ROLE_PRIORITY[member_type] >= ROLE_PRIORITY[caller]` comparison in TypeScript.
--   * The live SELECT policy (20261102000005) granted super_admin, yayasan and pengurus
--     every row and gave a koordinator nothing but its own, while §3.3 says S `own`,
--     K `team`, P/Y `all`, SA `—`.
--
-- After this migration:
--   * the permission exists and is seeded with the §3.3 scopes, so `role_permissions.scope`
--     finally decides something;
--   * app.permission_scope(text) reads the widest scope the active caller holds, and
--     app.can_view_attendance_of(uuid) turns that scope into a row-level answer using
--     user_roles and team_members only — never profiles.member_type, never a role rank;
--   * both attendance SELECT policies call the helper, so the database and the action agree
--     even when the action is the one asking.
--
--   721 santri            722 koordinator of team 730
--   723 pengurus          724 yayasan
--   725 super_admin       726 santri, inactive account
--   727 santri outside every team

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000721', 'sync-santri@example.test'),
  ('00000000-0000-0000-0000-000000000722', 'sync-koordinator@example.test'),
  ('00000000-0000-0000-0000-000000000723', 'sync-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000724', 'sync-yayasan@example.test'),
  ('00000000-0000-0000-0000-000000000725', 'sync-super-admin@example.test'),
  ('00000000-0000-0000-0000-000000000726', 'sync-inactive@example.test'),
  ('00000000-0000-0000-0000-000000000727', 'sync-outsider@example.test')
) AS seed (id, email);

-- member_type is deliberately misleading here: the ustadz account holds the santri role
-- and must therefore see exactly what a santri sees (§5.2 of PERMISSIONS.md).
INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000721', 'sync-santri@example.test', 'Santri Biasa', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000722', 'sync-koordinator@example.test', 'Koordinator Tujuh', 'active', 'koordinator'),
  ('00000000-0000-0000-0000-000000000723', 'sync-pengurus@example.test', 'Pengurus Harian', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000724', 'sync-yayasan@example.test', 'Yayasan Pengawas', 'active', 'yayasan'),
  ('00000000-0000-0000-0000-000000000725', 'sync-super-admin@example.test', 'Super Admin Uji', 'active', 'super_admin'),
  ('00000000-0000-0000-0000-000000000726', 'sync-inactive@example.test', 'Santri Nonaktif', 'suspended', 'santri'),
  ('00000000-0000-0000-0000-000000000727', 'sync-outsider@example.test', 'Ustadz_far', 'active', 'ustadz');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000721', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000722', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000723', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000724', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000725', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000726', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000727', (SELECT id FROM public.roles WHERE key = 'santri'));

INSERT INTO public.teams (id, name, slug, status, archived_at)
VALUES ('00000000-0000-0000-0000-000000000730', 'Tim Sinergi Tujuh', 'tim-sinergi-7', 'active', NULL);

INSERT INTO public.team_members (team_id, user_id, team_role, valid_to)
VALUES
  ('00000000-0000-0000-0000-000000000730', '00000000-0000-0000-0000-000000000722', 'coordinator', NULL),
  ('00000000-0000-0000-0000-000000000730', '00000000-0000-0000-0000-000000000721', 'member', NULL),
  ('00000000-0000-0000-0000-000000000730', '00000000-0000-0000-0000-000000000723', 'member', NULL);

-- One attendance row per actor. The AFTER INSERT trigger on attendance_records calls
-- app.refresh_attendance_effective() for the date, which is the point: the operational
-- layer has to decide "is this person expected to check in" from the assigned role rather
-- than from profiles.member_type, and an ustadz holding the santri role used to be recorded
-- as `not_required` and lose their history.
SET LOCAL ROLE service_role;
INSERT INTO public.attendance_records (user_id, attendance_date, classification)
VALUES
  ('00000000-0000-0000-0000-000000000721', '2027-03-01', 'on_time'),
  ('00000000-0000-0000-0000-000000000727', '2027-03-01', 'late'),
  ('00000000-0000-0000-0000-000000000723', '2027-03-01', 'grace'),
  ('00000000-0000-0000-0000-000000000725', '2027-03-01', 'on_time');
RESET ROLE;

-- PostgreSQL has no temporary functions: this identity switcher lives only inside the
-- rolled-back transaction.
CREATE FUNCTION public.roledb_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

-- 1-3: the helper exists and follows the RPC checklist (definer + pinned search_path),
-- because both SELECT policies are going to depend on it.
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'can_view_attendance_of'),
  'app.can_view_attendance_of exists so attendance scope is decided in the database');
SELECT ok((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'can_view_attendance_of'),
  'app.can_view_attendance_of is SECURITY DEFINER');
SELECT ok((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=%'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'can_view_attendance_of'),
  'app.can_view_attendance_of pins its search_path');

-- 4-8: the permission behind §3.3 exists and carries the matrix scopes, which is what the
-- helper reads instead of a role rank.
SELECT ok(EXISTS (SELECT 1 FROM public.permissions WHERE key = 'attendance.record.read'),
  'attendance.record.read is a seeded permission, not a dangling RLS reference');
SELECT is((SELECT rp.scope::text FROM public.role_permissions rp
           JOIN public.roles r ON r.id = rp.role_id
           JOIN public.permissions p ON p.id = rp.permission_id
           WHERE r.key = 'santri' AND p.key = 'attendance.record.read'), 'own',
  'santri holds attendance.record.read at scope own');
SELECT is((SELECT rp.scope::text FROM public.role_permissions rp
           JOIN public.roles r ON r.id = rp.role_id
           JOIN public.permissions p ON p.id = rp.permission_id
           WHERE r.key = 'koordinator' AND p.key = 'attendance.record.read'), 'team',
  'koordinator holds attendance.record.read at scope team');
SELECT is((SELECT count(*)::int FROM public.role_permissions rp
           JOIN public.roles r ON r.id = rp.role_id
           JOIN public.permissions p ON p.id = rp.permission_id
           WHERE p.key = 'attendance.record.read' AND r.key IN ('pengurus', 'yayasan')
             AND rp.scope = 'global'::public.scope_type_enum), 2,
  'pengurus and yayasan hold attendance.record.read at scope global');
SELECT is((SELECT count(*)::int FROM public.role_permissions rp
           JOIN public.roles r ON r.id = rp.role_id
           JOIN public.permissions p ON p.id = rp.permission_id
           WHERE p.key = 'attendance.record.read' AND r.key = 'super_admin'), 0,
  'super_admin holds no attendance.record.read, matching the dash in §3.3');

-- 9-16: the helper, asked as each identity.
SET LOCAL ROLE authenticated;
SELECT public.roledb_as('00000000-0000-0000-0000-000000000721');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000721'), true,
  'a santri reads their own attendance history');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000727'), false,
  'a santri cannot read another member''s attendance history');

SELECT public.roledb_as('00000000-0000-0000-0000-000000000722');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000721'), true,
  'a koordinator reads the history of a member of a team they coordinate');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000727'), false,
  'a koordinator cannot read past their own team');

SELECT public.roledb_as('00000000-0000-0000-0000-000000000723');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000727'), true,
  'pengurus reads any account''s history because the scope is global, not because of a rank');

SELECT public.roledb_as('00000000-0000-0000-0000-000000000724');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000727'), true,
  'yayasan reads any account''s history at scope global');

SELECT public.roledb_as('00000000-0000-0000-0000-000000000725');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000721'), false,
  'super_admin no longer sweeps attendance: §3.3 gives the role no read scope');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000725'), true,
  'super_admin still reads their own row, which every account may do');

-- 17: an inactive account keeps no read path, even for its own history.
SELECT public.roledb_as('00000000-0000-0000-0000-000000000726');
SELECT is(app.can_view_attendance_of('00000000-0000-0000-0000-000000000726'), false,
  'a suspended account cannot read attendance history at all');

-- The identity above is `authenticated` (and a suspended one), and both of these reads answer a
-- question about the operational layer rather than about visibility — assertion 24 below is the
-- one that tests the row-level view through RLS. Reading here would only see an empty table.
RESET ROLE;

-- 18-20: the operational layer, refreshed by the insert trigger above, follows the role in
-- user_roles rather than the descriptive category. This is the "riwayat presensi pribadi"
-- half of ROLE-SYNC: without it an ustadz checks in every day and still reads `not_required`.
SELECT is((SELECT status FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000727' AND attendance_date = '2027-03-01'),
  'late',
  'an ustadz holding the santri role keeps a personal attendance history');
SELECT is((SELECT status FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000723' AND attendance_date = '2027-03-01'),
  'not_required',
  'a pengurus stays exempt because the santri/koordinator role is absent, not because of a label');
SELECT is((SELECT prosrc LIKE '%member_type%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'refresh_attendance_effective'), false,
  'app.refresh_attendance_effective no longer reads profiles.member_type');

-- 21-24: the policies delegate to the helper, and the delegation is what the client sees.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'attendance_records'
             AND cmd = 'SELECT' AND qual LIKE '%has_any_role%'), 0,
  'no attendance_records SELECT policy grants visibility by a bare role list anymore');
SELECT ok((SELECT count(*)::int FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'attendance_records'
             AND cmd = 'SELECT' AND qual LIKE '%can_view_attendance_of%') >= 1,
  'attendance_records SELECT is decided by app.can_view_attendance_of');
SELECT ok((SELECT count(*)::int FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'attendance_effective'
             AND cmd = 'SELECT' AND qual LIKE '%can_view_attendance_of%') >= 1,
  'attendance_effective SELECT is decided by the same helper');

SET LOCAL ROLE authenticated;
SELECT public.roledb_as('00000000-0000-0000-0000-000000000725');
SELECT is((SELECT count(*)::int FROM public.attendance_records), 1,
  'a super_admin reading through RLS sees only their own attendance row');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
