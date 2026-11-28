BEGIN;

SELECT plan(23);

-- ROLE-SYNC (PERMISSIONS.md §3.1, decided by the operator on 2026-11-25): the IAM mutation
-- path belongs to super_admin alone, and the checks that get there are explicit pairs
-- rather than a role ranking.
--
-- Current state:
--   * 20261102000005 seeded `iam.account.decide` for pengurus although §3.1 marks the row
--     `—` for S/K/P/Y; the RLS policy on account_requests reads that grant.
--   * app.approve_account_application() picked the approver's "highest" role with
--     ORDER BY CASE r.key… and compared v_target_priority >= v_approver_priority, then
--     wrote profiles.member_type = the role key, so an ustadz applicant lost the category
--     the moment they were approved (§2 rules 1 and 2).
--   * app.admin_update_user() trusted p_admin_id blindly, set member_type from
--     p_new_role_key, and had no rule about the last active super_admin.
--
-- After this migration:
--   * only super_admin holds the five IAM mutation permissions;
--   * the approver must hold an active super_admin role in user_roles; the assignable roles
--     are the four non-super_admin ones; member_type follows the applicant's claim;
--   * admin_update_user verifies the actor's roles in the database, honours an explicit
--     p_member_type instead of deriving one, refuses super_admin as an assigned role, and
--     never leaves the pondok without an active super_admin.
--
--   741 santri applicant     742 pengurus approver (refused)
--   743 yayasan approver     744 super_admin A (the acting operator)
--   745 super_admin B        746 ustadz applicant (claim vs role)
--   747 super_admin C

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000741', 'sync-applicant@example.test'),
  ('00000000-0000-0000-0000-000000000742', 'sync-pengurus-iam@example.test'),
  ('00000000-0000-0000-0000-000000000743', 'sync-yayasan-iam@example.test'),
  ('00000000-0000-0000-0000-000000000744', 'sync-admin-a@example.test'),
  ('00000000-0000-0000-0000-000000000745', 'sync-admin-b@example.test'),
  ('00000000-0000-0000-0000-000000000746', 'sync-ustadz@example.test'),
  ('00000000-0000-0000-0000-000000000747', 'sync-admin-c@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000742', 'sync-pengurus-iam@example.test', 'Pengurus Menunggu', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000743', 'sync-yayasan-iam@example.test', 'Yayasan Pengawas', 'active', 'yayasan'),
  ('00000000-0000-0000-0000-000000000744', 'sync-admin-a@example.test', 'Super Admin A', 'active', 'super_admin'),
  ('00000000-0000-0000-0000-000000000745', 'sync-admin-b@example.test', 'Super Admin B', 'active', 'super_admin'),
  ('00000000-0000-0000-0000-000000000747', 'sync-admin-c@example.test', 'Super Admin C', 'active', 'super_admin');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000742', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000743', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000744', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000745', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000747', (SELECT id FROM public.roles WHERE key = 'super_admin'));

INSERT INTO public.teams (id, name, slug, status, archived_at)
VALUES ('00000000-0000-0000-0000-000000000750', 'Tim Sinkronisasi', 'tim-sinkron', 'active', NULL);

INSERT INTO public.account_requests (
  id, full_name, email, phone_number, role_requested, team_requested, status,
  auth_user_id, claimed_member_type
)
VALUES
  ('00000000-0000-0000-0000-000000000741', 'Santri Menunggu', 'sync-applicant@example.test',
   '08000000741', 'santri', 'Tim Sinkronisasi', 'pending',
   '00000000-0000-0000-0000-000000000741', 'santri'),
  ('00000000-0000-0000-0000-000000000746', 'Ustadz Farhan', 'sync-ustadz@example.test',
   '08000000746', 'pengurus', 'Tim Sinkronisasi', 'pending',
   '00000000-0000-0000-0000-000000000746', 'ustadz');

-- The server action calls both RPCs with the service-role key, so the tests do the same and
-- let the database answer the permission question by itself.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role","iss":"supabase"}', true);

-- 1-2: the permission data matches §3.1 — mutation grants exist for super_admin only.
SELECT is((SELECT count(*)::int FROM public.role_permissions rp
           JOIN public.roles r ON r.id = rp.role_id
           JOIN public.permissions p ON p.id = rp.permission_id
           WHERE p.key IN ('iam.account.request.read', 'iam.account.decide', 'iam.account.suspend',
                           'iam.role.assign', 'iam.session.revoke')
             AND r.key <> 'super_admin'), 0,
  'no role other than super_admin holds an IAM mutation permission');
SELECT is((SELECT count(*)::int FROM public.role_permissions rp
           JOIN public.roles r ON r.id = rp.role_id
           JOIN public.permissions p ON p.id = rp.permission_id
           WHERE p.key IN ('iam.account.request.read', 'iam.account.decide', 'iam.account.suspend',
                           'iam.role.assign', 'iam.session.revoke')
             AND r.key = 'super_admin'), 5,
  'super_admin still holds all five IAM permissions from §3.1');

-- 3-6: approval is a super_admin decision, asked of the same entry point the action uses.
SELECT is(public.approve_account_application(
            '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000741',
            'santri', '00000000-0000-0000-0000-000000000742',
            '00000000-0000-0000-0000-000000000750')->>'success', 'false',
  'a pengurus may no longer approve an account application');
SELECT is((SELECT status::text FROM public.account_requests
           WHERE id = '00000000-0000-0000-0000-000000000741'), 'pending',
  'a refused approval leaves the application pending');
SELECT is(public.approve_account_application(
            '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000741',
            'santri', '00000000-0000-0000-0000-000000000743',
            '00000000-0000-0000-0000-000000000750')->>'success', 'false',
  'a yayasan approver is refused too: §3.1 has no dash-free row for them here');
SELECT is(public.approve_account_application(
            '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000741',
            'santri', '00000000-0000-0000-0000-000000000744',
            '00000000-0000-0000-0000-000000000750')->>'success', 'true',
  'an active super_admin approves the application');

-- 7-9: the approved account keeps the category it claimed and gains the role separately.
SELECT is((SELECT member_type FROM public.profiles
           WHERE id = '00000000-0000-0000-0000-000000000741'), 'santri',
  'the profile category comes from the claim, not from the assigned role');
SELECT is((SELECT count(*)::int FROM public.user_roles ur
           JOIN public.roles r ON r.id = ur.role_id
           WHERE ur.user_id = '00000000-0000-0000-0000-000000000741'
             AND r.key = 'santri' AND ur.revoked_at IS NULL), 1,
  'the approved santri holds the santri role in user_roles');
SELECT is((SELECT count(*)::int FROM public.audit_logs
           WHERE event_name = 'iam.account_approved' AND actor_id = '00000000-0000-0000-0000-000000000744'), 1,
  'the approval writes its audit row in the same transaction');

-- 10-12: super_admin is not an assignable role, and the ustadz case is the point of §5.2.
SELECT is(public.approve_account_application(
            '00000000-0000-0000-0000-000000000746', '00000000-0000-0000-0000-000000000746',
            'super_admin', '00000000-0000-0000-0000-000000000744',
            '00000000-0000-0000-0000-000000000750')->>'success', 'false',
  'the registration queue cannot mint a super_admin');
SELECT is(public.approve_account_application(
            '00000000-0000-0000-0000-000000000746', '00000000-0000-0000-0000-000000000746',
            'pengurus', '00000000-0000-0000-0000-000000000744',
            '00000000-0000-0000-0000-000000000750')->>'success', 'true',
  'an ustadz applicant can be given the pengurus role');
SELECT is((SELECT member_type FROM public.profiles
           WHERE id = '00000000-0000-0000-0000-000000000746'), 'ustadz',
  'the ustadz category survives approval instead of becoming the role name');

-- 13-16: admin_update_user authenticates its actor and stops inventing categories.
SELECT is(public.admin_update_user(
            '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000742',
            NULL, NULL, 'suspended', NULL, NULL, NULL)->>'success', 'false',
  'a pengurus named as p_admin_id can no longer mutate an account');
SELECT is((SELECT status FROM public.profiles
           WHERE id = '00000000-0000-0000-0000-000000000741'), 'active',
  'the refused update changed nothing on the profile');
SELECT is(public.admin_update_user(
            '00000000-0000-0000-0000-000000000746', '00000000-0000-0000-0000-000000000744',
            NULL, NULL, NULL, NULL, 'koordinator', NULL)->>'success', 'true',
  'an active super_admin can change a role through the RPC');
SELECT is((SELECT member_type FROM public.profiles
           WHERE id = '00000000-0000-0000-0000-000000000746'), 'ustadz',
  'a role change no longer overwrites profiles.member_type');

-- 17-20: the super_admin set stays reachable, whatever the order of operations.
SELECT is(public.admin_update_user(
            '00000000-0000-0000-0000-000000000746', '00000000-0000-0000-0000-000000000744',
            NULL, NULL, NULL, NULL, 'super_admin', NULL)->>'success', 'false',
  'super_admin is not something this RPC can hand out');
SELECT is(public.admin_update_user(
            '00000000-0000-0000-0000-000000000745', '00000000-0000-0000-0000-000000000744',
            NULL, NULL, NULL, NULL, 'santri', NULL)->>'success', 'true',
  'demoting one of three super admins leaves the pondok administered');
SELECT is(public.admin_update_user(
            '00000000-0000-0000-0000-000000000747', '00000000-0000-0000-0000-000000000744',
            NULL, NULL, 'suspended', NULL, NULL, NULL)->>'success', 'true',
  'suspending a second super admin still leaves one active operator');
SELECT is(public.admin_update_user(
            '00000000-0000-0000-0000-000000000744', '00000000-0000-0000-0000-000000000744',
            NULL, NULL, 'suspended', NULL, NULL, NULL)->>'success', 'false',
  'the last active super admin cannot suspend themselves out of the platform');

-- 21-23: a super_admin may retain its protected role while adding an operational role, but
-- the same RPC cannot mint super_admin for a normal account.
SELECT is(public.admin_set_user_roles(
            '00000000-0000-0000-0000-000000000744', '00000000-0000-0000-0000-000000000744',
            ARRAY['super_admin', 'pengurus'], NULL)->>'success', 'true',
  'an existing super_admin can add pengurus without losing the protected role');
SELECT is((SELECT count(*)::int FROM public.user_roles ur
           JOIN public.roles r ON r.id = ur.role_id
           WHERE ur.user_id = '00000000-0000-0000-0000-000000000744'
             AND ur.revoked_at IS NULL AND r.key IN ('super_admin', 'pengurus')), 2,
  'the multi-role set is active in user_roles');
SELECT is(public.admin_set_user_roles(
            '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000744',
            ARRAY['super_admin', 'pengurus'], NULL)->>'success', 'false',
  'the multi-role RPC cannot mint super_admin for a non-admin account');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
