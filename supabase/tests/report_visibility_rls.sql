BEGIN;

SELECT plan(26);

-- SEC-03 / REP-01: report visibility must match PERMISSIONS.md §3.4 + D1.
-- daily_reports carries only compliance metadata; report_items carries the
-- private content. Roles beyond the owner see content exclusively through an
-- active reviewer_assignments row. Super Admin sees neither.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-owner@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-ko-assigned@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000803', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-ko-teammate@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000804', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-pengurus@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000805', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-yayasan@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000806', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-yayasan-granted@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000807', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-sa@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000808', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-outsider@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000809', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-ko-expired@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000810', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-owner2@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000801', 'vis-owner@example.test', 'Santri Pemilik', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000802', 'vis-ko-assigned@example.test', 'Ko Assigned', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000803', 'vis-ko-teammate@example.test', 'Ko Teammate', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000804', 'vis-pengurus@example.test', 'Pengurus Besar', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000805', 'vis-yayasan@example.test', 'Yayasan Biasa', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000806', 'vis-yayasan-granted@example.test', 'Yayasan Grant', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000807', 'vis-sa@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000808', 'vis-outsider@example.test', 'Santri Lain', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000809', 'vis-ko-expired@example.test', 'Ko Expired', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000810', 'vis-owner2@example.test', 'Santri Kedua', 'active', 'santri');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000801', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000802', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000803', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000804', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000805', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000806', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000807', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000808', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000809', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000810', (SELECT id FROM public.roles WHERE key = 'santri'));

-- Owner, koordinator 803 (never assigned) and koordinator 809 (expired
-- assignment) share one team, so the koordinator team scope is exercised.
INSERT INTO public.teams (id, name, slug, status)
VALUES ('00000000-0000-0000-0000-000000000840', 'Tim Visibilitas RLS', 'vis-rls-test', 'active');
INSERT INTO public.team_members (team_id, user_id, team_role)
VALUES
  ('00000000-0000-0000-0000-000000000840', '00000000-0000-0000-0000-000000000801', 'member'),
  ('00000000-0000-0000-0000-000000000840', '00000000-0000-0000-0000-000000000803', 'coordinator'),
  -- idx_one_active_coordinator_per_team allows one coordinator row per team;
  -- the koordinator app role comes from user_roles, team_role stays 'member'.
  ('00000000-0000-0000-0000-000000000840', '00000000-0000-0000-0000-000000000809', 'member');

-- idx_reviewer_assignments_one_active allows a single ACTIVE assignment per
-- reviewee, so the yayasan explicit grant is modeled on second owner 810.
INSERT INTO public.reviewer_assignments (reviewee_id, reviewer_id, kind, valid_from, valid_to)
VALUES
  ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000802', 'report', CURRENT_DATE - 5, NULL),
  ('00000000-0000-0000-0000-000000000810', '00000000-0000-0000-0000-000000000806', 'report', CURRENT_DATE - 5, NULL),
  ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000809', 'report', CURRENT_DATE - 30, CURRENT_DATE - 2);

INSERT INTO public.daily_reports (id, user_id, report_date, submission_status, review_status, first_submitted_at)
VALUES ('00000000-0000-0000-0000-000000000850', '00000000-0000-0000-0000-000000000801', DATE '2026-11-20', 'submitted', 'not_reviewed', now());
INSERT INTO public.report_items (id, report_id, title, description, duration_minutes)
VALUES ('00000000-0000-0000-0000-000000000851', '00000000-0000-0000-0000-000000000850', 'Setoran hafalan', 'Juz 30 ayat 1-20', 60);

INSERT INTO public.daily_reports (id, user_id, report_date, submission_status, review_status, first_submitted_at)
VALUES ('00000000-0000-0000-0000-000000000852', '00000000-0000-0000-0000-000000000810', DATE '2026-11-21', 'submitted', 'not_reviewed', now());
INSERT INTO public.report_items (id, report_id, title, description, duration_minutes)
VALUES ('00000000-0000-0000-0000-000000000853', '00000000-0000-0000-0000-000000000852', 'Kajian kitab', 'Fathul Qarib bab thaharah', 90);

-- PostgreSQL has no temporary functions: the switch helper is a plain function
-- inside this rolled-back transaction, dropped again before finish().
CREATE FUNCTION public.vis_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

SET LOCAL ROLE authenticated;

-- 1) Owner always sees metadata and content.
SELECT public.vis_as('00000000-0000-0000-0000-000000000801');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000850'), 1,
  'owner sees own report metadata');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000851'), 1,
  'owner sees own report content');

-- 2) Assigned koordinator sees metadata and content.
SELECT public.vis_as('00000000-0000-0000-0000-000000000802');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000850'), 1,
  'assigned koordinator sees report metadata');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000851'), 1,
  'assigned koordinator sees report content');

-- 3) Unassigned koordinator in the same team sees metadata only (§3.4 compliance.read = team).
SELECT public.vis_as('00000000-0000-0000-0000-000000000803');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000850'), 1,
  'team koordinator sees compliance metadata');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000851'), 0,
  'unassigned koordinator cannot read report content');

-- 4) Pengurus without assignment sees metadata only (report.read = assigned).
SELECT public.vis_as('00000000-0000-0000-0000-000000000804');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000850'), 1,
  'pengurus sees compliance metadata');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000851'), 0,
  'unassigned pengurus cannot read report content');

-- 5) Yayasan default is compliance metadata; content requires an explicit grant (D1).
SELECT public.vis_as('00000000-0000-0000-0000-000000000805');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000850'), 1,
  'yayasan sees compliance metadata');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000851'), 0,
  'yayasan without explicit grant cannot read report content');
SELECT public.vis_as('00000000-0000-0000-0000-000000000806');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000852'), 1,
  'explicitly granted yayasan sees report metadata');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000853'), 1,
  'explicitly granted yayasan reads report content (D1 explicit grant)');

-- 6) Super Admin is denied everything report-related (§3.4 dashes).
SELECT public.vis_as('00000000-0000-0000-0000-000000000807');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000850'), 0,
  'super_admin sees no report metadata');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000851'), 0,
  'super_admin reads no report content');

-- 7) Unrelated santri sees nothing.
SELECT public.vis_as('00000000-0000-0000-0000-000000000808');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000850'), 0,
  'unrelated santri sees no report metadata');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000851'), 0,
  'unrelated santri reads no report content');

-- 8) Expired assignment revokes content while the team metadata scope stays.
SELECT public.vis_as('00000000-0000-0000-0000-000000000809');
SELECT is((SELECT count(*)::int FROM public.daily_reports WHERE id = '00000000-0000-0000-0000-000000000850'), 1,
  'koordinator with expired assignment keeps team metadata scope');
SELECT is((SELECT count(*)::int FROM public.report_items WHERE id = '00000000-0000-0000-0000-000000000851'), 0,
  'expired assignment revokes report content');

-- 9) report_reviews direct INSERT: active assignment plus koordinator/pengurus role, never self.
SELECT public.vis_as('00000000-0000-0000-0000-000000000804');
SELECT throws_ok(
  $$ INSERT INTO public.report_reviews (report_id, revision_no, reviewer_id, decision, notes)
     VALUES ('00000000-0000-0000-0000-000000000850', 1, '00000000-0000-0000-0000-000000000804', 'approved', 'tanpa penugasan') $$,
  '42501', NULL, 'unassigned pengurus cannot insert a review row');
SELECT public.vis_as('00000000-0000-0000-0000-000000000801');
SELECT throws_ok(
  $$ INSERT INTO public.report_reviews (report_id, revision_no, reviewer_id, decision, notes)
     VALUES ('00000000-0000-0000-0000-000000000850', 1, '00000000-0000-0000-0000-000000000801', 'approved', 'self review') $$,
  '42501', NULL, 'owner cannot insert a review row for own report');
SELECT public.vis_as('00000000-0000-0000-0000-000000000802');
SELECT lives_ok(
  $$ INSERT INTO public.report_reviews (report_id, revision_no, reviewer_id, decision, notes)
     VALUES ('00000000-0000-0000-0000-000000000850', 1, '00000000-0000-0000-0000-000000000802', 'approved', 'dengan penugasan') $$,
  'assigned koordinator can insert a review row');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.report_reviews WHERE report_id = '00000000-0000-0000-0000-000000000850'), 1,
  'only the assigned reviewer row was persisted');

-- 10) app.review_report must reject elevated-but-unassigned actors and honor assignments.
SET LOCAL ROLE authenticated;
SELECT public.vis_as('00000000-0000-0000-0000-000000000807');
SELECT is((app.review_report('00000000-0000-0000-0000-000000000850', 1, 'approved', '', 'vis-rpc-sa')->>'success'), 'false',
  'super_admin without assignment cannot review through the RPC');
SELECT public.vis_as('00000000-0000-0000-0000-000000000806');
SELECT is((app.review_report('00000000-0000-0000-0000-000000000850', 1, 'approved', '', 'vis-rpc-yay')->>'success'), 'false',
  'yayasan read grant does not confer review rights (§3.4 report.review = assigned koordinator/pengurus)');
SELECT public.vis_as('00000000-0000-0000-0000-000000000802');
SELECT is((app.review_report('00000000-0000-0000-0000-000000000850', 1, 'approved', '', 'vis-rpc-ko')->>'success'), 'true',
  'assigned koordinator reviews successfully through the RPC');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.daily_reports
           WHERE id = '00000000-0000-0000-0000-000000000850'
             AND review_status = 'approved'
             AND reviewer_id = '00000000-0000-0000-0000-000000000802'), 1,
  'RPC approved the report on behalf of the assigned koordinator');

DROP FUNCTION public.vis_as(uuid);

SELECT * FROM finish();
ROLLBACK;
