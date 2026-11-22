BEGIN;

SELECT plan(29);

-- LIB-02 / D6: PERMISSIONS.md §3.2 lets a `restricted` resource open only for
-- the roles and teams named in resource_visibility_rules, so no elevated role
-- keeps a blanket branch and a santri in the granted team does get in.
--
--   a021 internal  published                     everyone active
--   a022 restricted published, rule role=pengurus
--   a023 restricted published, rule team=A
--   a024 restricted published, no rule            nobody
--   a025 restricted draft,     rule role=pengurus still hidden (not published)
--   a026 restricted published, rule team=B

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000a11', 'lib-santri@example.test'),
  ('00000000-0000-0000-0000-000000000a12', 'lib-santri-team-a@example.test'),
  ('00000000-0000-0000-0000-000000000a13', 'lib-koordinator-a@example.test'),
  ('00000000-0000-0000-0000-000000000a14', 'lib-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000a15', 'lib-yayasan@example.test'),
  ('00000000-0000-0000-0000-000000000a16', 'lib-super-admin@example.test'),
  ('00000000-0000-0000-0000-000000000a17', 'lib-multi-role@example.test'),
  ('00000000-0000-0000-0000-000000000a18', 'lib-revoked-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000a19', 'lib-suspended-yayasan@example.test'),
  ('00000000-0000-0000-0000-000000000a20', 'lib-expired-team-a@example.test'),
  ('00000000-0000-0000-0000-000000000a21', 'lib-santri-team-b@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000a11', 'lib-santri@example.test', 'Santri Biasa', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000a12', 'lib-santri-team-a@example.test', 'Santri Tim A', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000a13', 'lib-koordinator-a@example.test', 'Koordinator A', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000a14', 'lib-pengurus@example.test', 'Pengurus Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000a15', 'lib-yayasan@example.test', 'Yayasan Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000a16', 'lib-super-admin@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000a17', 'lib-multi-role@example.test', 'Santri Sekaligus Pengurus', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000a18', 'lib-revoked-pengurus@example.test', 'Pengurus Dicabut', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000a19', 'lib-suspended-yayasan@example.test', 'Yayasan Nonaktif', 'suspended', 'pengurus'),
  ('00000000-0000-0000-0000-000000000a20', 'lib-expired-team-a@example.test', 'Mantan Tim A', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000a21', 'lib-santri-team-b@example.test', 'Santri Tim B', 'active', 'santri');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000a11', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000a12', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000a13', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000a14', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000a15', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000a16', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000a17', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000a17', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000a19', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000a20', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000a21', (SELECT id FROM public.roles WHERE key = 'santri'));

-- a018 holds the pengurus grant only historically: revoked_at must take the
-- role rule away again.
INSERT INTO public.user_roles (user_id, role_id, revoked_at, revoked_by, reason)
VALUES (
  '00000000-0000-0000-0000-000000000a18',
  (SELECT id FROM public.roles WHERE key = 'pengurus'),
  now() - interval '1 day',
  '00000000-0000-0000-0000-000000000a16',
  'Fixture: grant revoked before the rule is evaluated.'
);

INSERT INTO public.teams (id, name, slug)
VALUES
  ('00000000-0000-0000-0000-000000000a01', 'Tim Satu Uji', 'tim-satu-uji'),
  ('00000000-0000-0000-0000-000000000a02', 'Tim Dua Uji', 'tim-dua-uji');

INSERT INTO public.team_members (team_id, user_id, team_role, valid_from, valid_to)
VALUES
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a12', 'member', CURRENT_DATE - 30, NULL),
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a13', 'coordinator', CURRENT_DATE - 30, NULL),
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a20', 'member', CURRENT_DATE - 60, CURRENT_DATE - 5),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000a21', 'member', CURRENT_DATE - 30, NULL);

INSERT INTO public.resources (id, name, slug, description, visibility, status, created_by)
VALUES
  ('00000000-0000-0000-0000-000000000a21', 'Panduan Internal', 'lib-internal', 'Terbuka untuk semua anggota aktif.', 'internal', 'published', '00000000-0000-0000-0000-000000000a14'),
  ('00000000-0000-0000-0000-000000000a22', 'Runbook Pengurus', 'lib-role-rule', 'Rule by role pengurus.', 'restricted', 'published', '00000000-0000-0000-0000-000000000a14'),
  ('00000000-0000-0000-0000-000000000a23', 'Dokumen Tim Satu', 'lib-team-rule-a', 'Rule by team A.', 'restricted', 'published', '00000000-0000-0000-0000-000000000a14'),
  ('00000000-0000-0000-0000-000000000a24', 'Rahasia Belum Ditugaskan', 'lib-no-rule', 'Tidak ada rule sama sekali.', 'restricted', 'published', '00000000-0000-0000-0000-000000000a14'),
  ('00000000-0000-0000-0000-000000000a25', 'Draf Terbatas', 'lib-draft-rule', 'Rule ada tapi status draf.', 'restricted', 'draft', '00000000-0000-0000-0000-000000000a14'),
  ('00000000-0000-0000-0000-000000000a26', 'Dokumen Tim Dua', 'lib-team-rule-b', 'Rule by team B.', 'restricted', 'published', '00000000-0000-0000-0000-000000000a14');

INSERT INTO public.resource_visibility_rules (resource_id, role_key, team_id, created_by)
VALUES
  ('00000000-0000-0000-0000-000000000a22', 'pengurus', NULL, '00000000-0000-0000-0000-000000000a16'),
  ('00000000-0000-0000-0000-000000000a23', NULL, '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a16'),
  ('00000000-0000-0000-0000-000000000a25', 'pengurus', NULL, '00000000-0000-0000-0000-000000000a16'),
  ('00000000-0000-0000-0000-000000000a26', NULL, '00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000a16');

-- PostgreSQL has no temporary functions: the switch helper is a plain function
-- inside this rolled-back transaction, dropped again before finish().
CREATE FUNCTION public.rsrvis_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

SET LOCAL ROLE authenticated;

-- 1-11: what each identity can actually read through the RLS policy.
SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a11');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 1,
  'a plain santri reads only the internal resource');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a12');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 2,
  'a team rule opens the restricted resource for a santri in that team');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a13');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 2,
  'a coordinator reads team-restricted content through membership, not rank');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a14');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 2,
  'pengurus reads the resource its role rule names');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a15');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 1,
  'yayasan no longer reads every restricted resource by rank alone (§3.2/D6)');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a16');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 1,
  'super admin no longer reads every restricted resource by rank alone (§3.2/D6)');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a17');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 2,
  'a secondary role grant counts: santri+pengurus gets the pengurus rule (LIB-04)');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a18');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 1,
  'a revoked role grant stops matching the rule');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a19');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 0,
  'a suspended account reads nothing at all');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a20');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 1,
  'an ended team membership no longer matches the team rule');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a21');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id IN (
  '00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-000000000a22',
  '00000000-0000-0000-0000-000000000a23', '00000000-0000-0000-0000-000000000a24',
  '00000000-0000-0000-0000-000000000a25', '00000000-0000-0000-0000-000000000a26')), 2,
  'a team rule opens only the resource of that same team');

-- 12-16: the predicate the policy is built on, called directly.
SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a11');
SELECT is(app.can_view_resource('00000000-0000-0000-0000-000000000a21'), true,
  'app.can_view_resource allows internal content for an active santri');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a16');
SELECT is(app.can_view_resource('00000000-0000-0000-0000-000000000a22'), false,
  'app.can_view_resource refuses super admin a role rule it does not hold');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a12');
SELECT is(app.can_view_resource('00000000-0000-0000-0000-000000000a23'), true,
  'app.can_view_resource resolves the team branch');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a14');
SELECT is(app.can_view_resource('00000000-0000-0000-0000-000000000a24'), false,
  'a restricted resource without a rule stays closed even for pengurus');
SELECT is(app.can_view_resource('00000000-0000-0000-0000-000000000a25'), false,
  'a rule never publishes a draft');

-- 17-18: who may read the rule book itself.
SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a11');
SELECT is((SELECT count(*)::int FROM public.resource_visibility_rules), 0,
  'santri cannot read the visibility rules');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a14');
SELECT is((SELECT count(*)::int FROM public.resource_visibility_rules), 4,
  'pengurus reads the rules it is allowed to manage (§3.2 update tier)');

-- 19-20: the rules table itself is read-only for readers and unwritable
-- without the service-role path.
SELECT throws_ok(
  $$INSERT INTO public.resource_visibility_rules (resource_id, role_key)
    VALUES ('00000000-0000-0000-0000-000000000a24', 'santri')$$,
  '42501', NULL,
  'santri cannot write a rule directly');
SELECT throws_ok(
  $$INSERT INTO public.resource_visibility_rules (resource_id, role_key)
    VALUES ('00000000-0000-0000-0000-000000000a24', 'yayasan')$$,
  '42501', NULL,
  'even pengurus writes rules through resource_rule_set, never raw DML');

-- 21: nothing has been audited before the command RPC runs. audit_logs is only
-- readable by yayasan/super_admin (§3.8), so this one read is privileged.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE event_name = 'library.visibility_rules_updated'), 0,
  'no rule change has been audited yet');

-- 22-29: the command RPC, its guard, its effect and its ledger row.
SET LOCAL ROLE authenticated;
SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a11');
SELECT is(public.resource_rule_set('00000000-0000-0000-0000-000000000a24', ARRAY['yayasan'], NULL)->>'success', 'false',
  'santri is refused by the rule RPC');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a14');
SELECT is(public.resource_rule_set('00000000-0000-0000-0000-000000000a24', ARRAY['yayasan'], NULL)->>'success', 'true',
  'pengurus can replace the rule set for one resource');
SELECT is((SELECT count(*)::int FROM public.resource_visibility_rules
           WHERE resource_id = '00000000-0000-0000-0000-000000000a24'), 1,
  'the RPC replaced the rule set with exactly the yayasan role');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a15');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id = '00000000-0000-0000-0000-000000000a24'), 1,
  'the fresh role rule opens the resource for yayasan');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a14');
SELECT is(public.resource_rule_set('00000000-0000-0000-0000-000000000a24', ARRAY[]::text[], ARRAY[]::uuid[])->>'success', 'true',
  'clearing the rules of a resource is an allowed write');
SELECT is(public.resource_rule_set('00000000-0000-0000-0000-000000000a24', ARRAY['bukan-peran'], NULL)->>'success', 'false',
  'an unknown role key is rejected instead of silently ignored');

SELECT public.rsrvis_as('00000000-0000-0000-0000-000000000a15');
SELECT is((SELECT count(*)::int FROM public.resources WHERE id = '00000000-0000-0000-0000-000000000a24'), 0,
  'once the rule is gone the restricted resource is closed again');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE event_name = 'library.visibility_rules_updated'), 2,
  'both accepted rule changes landed in audit_logs in their own transaction');
DROP FUNCTION public.rsrvis_as(uuid);

SELECT * FROM finish();
ROLLBACK;
