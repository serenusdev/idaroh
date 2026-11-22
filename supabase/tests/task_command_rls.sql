BEGIN;

SELECT plan(40);

-- SEC-04 / TASK-01: the Tasks & Projects command surface must match
-- PERMISSIONS.md §3.5 and the locked decision D4.
--
--   * task.read / task.create / project.* : super_admin has no dash-free row in
--     §3.5 — it must lose the blanket elevated branch in app.can_access_task,
--     the projects SELECT policy and the attachment DELETE policy.
--   * task.update_status : koordinator gains its own team (D4 keeps yayasan out
--     of daily transitions), yayasan keeps only task.cancel/reopen.
--   * task.review : only the designated reviewer, never the creator or an
--     active assignee of the same task (self-review ban), and never yayasan.
--   * every successful transition writes audit_logs in the same transaction,
--     and status changes travel only through app.task_transition.
--
-- Disposable fixtures inside one rolled-back transaction; local/CI only.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-creator@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-assignee@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-ko-x@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-ko-y@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000705', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-pengurus@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000706', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-yayasan@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000707', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-super-admin@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000708', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-outsider@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000709', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmd-multirole@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000701', 'cmd-creator@example.test', 'Santri Pembuat', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000702', 'cmd-assignee@example.test', 'Santri PIC', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000703', 'cmd-ko-x@example.test', 'Koordinator Tim X', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000704', 'cmd-ko-y@example.test', 'Koordinator Tim Y', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000705', 'cmd-pengurus@example.test', 'Pengurus Pusat', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000706', 'cmd-yayasan@example.test', 'Yayasan Pengawas', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000707', 'cmd-super-admin@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000708', 'cmd-outsider@example.test', 'Santri Lain Tim', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000709', 'cmd-multirole@example.test', 'Santri Merangkap Yayasan', 'active', 'santri');

-- 709 carries two active roles so the multi-role rule of AGENTS.md is exercised:
-- yayasan must add cancel/reopen without adding daily transitions or review.
INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000701', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000702', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000703', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000704', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000705', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000706', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000707', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000708', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000709', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000709', (SELECT id FROM public.roles WHERE key = 'yayasan'));

INSERT INTO public.teams (id, name, slug, status)
VALUES
  ('00000000-0000-0000-0000-000000000740', 'Tim Command X', 'cmd-x', 'active'),
  ('00000000-0000-0000-0000-000000000741', 'Tim Command Y', 'cmd-y', 'active');

-- idx_one_active_coordinator_per_team: one coordinator row per team, so the
-- koordinator app role of 703/704 is paired with exactly one team each.
INSERT INTO public.team_members (team_id, user_id, team_role)
VALUES
  ('00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000701', 'member'),
  ('00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000702', 'member'),
  ('00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000703', 'coordinator'),
  ('00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000709', 'member'),
  ('00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000704', 'coordinator');

INSERT INTO public.projects (id, name, team_id, status, owner_id, created_by)
VALUES
  ('00000000-0000-0000-0000-000000000750', 'Proyek Tim X', '00000000-0000-0000-0000-000000000740', 'active',
   '00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000703'),
  ('00000000-0000-0000-0000-000000000751', 'Proyek Tim Y', 'cmd-y', 'active',
   '00000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000704');

INSERT INTO public.tasks
  (id, project_id, team_id, title, priority, status, requires_review, reviewer_id, visibility, created_by)
VALUES
  -- Working task of team X: creator 701, active assignee 702.
  ('00000000-0000-0000-0000-000000000760', '00000000-0000-0000-0000-000000000750', '00000000-0000-0000-0000-000000000740',
   'Menyusun laporan mingguan', 'normal', 'todo', false, NULL, 'team', '00000000-0000-0000-0000-000000000701'),
  -- Self-review trap: creator and reviewer are the same koordinator.
  ('00000000-0000-0000-0000-000000000761', '00000000-0000-0000-0000-000000000750', 'cmd-x',
   'Menyusun SOP review', 'normal', 'in_review', true, '00000000-0000-0000-0000-000000000703', 'team', '00000000-0000-0000-0000-000000000703'),
  -- Organization-wide task, readable by every active non-super_admin member.
  ('00000000-0000-0000-0000-000000000762', NULL, '00000000-0000-0000-0000-000000000740',
   'Persiapan Haflah Akhirussanah', 'high', 'in_progress', false, NULL, 'organization', '00000000-0000-0000-0000-000000000701'),
  -- Private task of one santri.
  ('00000000-0000-0000-0000-000000000763', NULL, NULL,
   'Setoran hafalan pribadi', 'low', 'todo', false, NULL, 'private', '00000000-0000-0000-0000-000000000701'),
  -- Team Y task used for the cross-team probes.
  ('00000000-0000-0000-0000-000000000764', '00000000-0000-0000-0000-000000000751', '00000000-0000-0000-0000-000000000741',
   'Review dokumentasi tim Y', 'normal', 'in_review', true, '00000000-0000-0000-0000-000000000704', 'team', '00000000-0000-0000-0000-000000000702'),
  -- Legitimate review queue entry: assignee 702, reviewer 703.
  ('00000000-0000-0000-0000-000000000765', '00000000-0000-0000-0000-000000000750', 'Tim Command X',
   'Rekap absensi halaqah', 'normal', 'in_review', true, '00000000-0000-0000-0000-000000000703', 'team', '00000000-0000-0000-0000-000000000702'),
  -- Self-review trap of the second kind: assignee is also the reviewer.
  ('00000000-0000-0000-0000-000000000768', '00000000-0000-0000-0000-000000000750', 'cmd-x',
   'Menyusun jadwal piket', 'normal', 'in_review', true, '00000000-0000-0000-0000-000000000702', 'team', '00000000-0000-0000-0000-000000000702'),
  -- Team Y working task, created by the team Y koordinator.
  ('00000000-0000-0000-0000-000000000767', '00000000-0000-0000-0000-000000000751', 'cmd-y',
   'Pembaruan konten direktori', 'normal', 'todo', false, NULL, 'team', '00000000-0000-0000-0000-000000000704');

INSERT INTO public.task_assignees (task_id, user_id, assigned_by)
VALUES
  ('00000000-0000-0000-0000-000000000760', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000701'),
  ('00000000-0000-0000-0000-000000000765', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000701'),
  ('00000000-0000-0000-0000-000000000768', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000701');

INSERT INTO public.task_attachments (id, task_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
VALUES ('00000000-0000-0000-0000-000000000770', '00000000-0000-0000-0000-000000000760',
        '00000000-0000-0000-0000-000000000701', 'tasks/cmd-x/laporan-mingguan.pdf', 'laporan-mingguan.pdf', 'application/pdf', 1024);

-- PostgreSQL has no temporary functions: this identity switcher lives only
-- inside the rolled-back transaction and is dropped again before finish().
CREATE FUNCTION public.tcmd_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

SET LOCAL ROLE authenticated;

-- 1) §3.5 task.read: own, assigned, team and organization scopes stay.
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000701');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000760'), true,
  'creator santri keeps access to an own team task');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000702');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000760'), true,
  'active assignee keeps access to an assigned team task');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000703');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000760'), true,
  'koordinator of the task team keeps team scope');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000704');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000760'), false,
  'koordinator of another team stays outside the task');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000705');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000760'), true,
  'pengurus keeps the all-team read scope');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000706');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000760'), true,
  'yayasan keeps the all-team read scope');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000708');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000760'), false,
  'unrelated santri cannot read a team task');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000762'), true,
  'unrelated santri reads an organization task (TSK-05 alignment)');

-- 2) super_admin loses the whole task surface (§3.5 dash on every row).
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000707');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000760'), false,
  'super_admin has no task read scope through the SQL helper');
SELECT is((SELECT count(*)::int FROM public.tasks WHERE id = '00000000-0000-0000-0000-000000000760'), 0,
  'super_admin selects no task row through RLS');
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = '00000000-0000-0000-0000-000000000750'), 0,
  'super_admin selects no project row through RLS');
SELECT is(app.can_access_task('00000000-0000-0000-0000-000000000763'), false,
  'super_admin cannot reach a private santri task either');

-- 3) project.read stays yayasan/pengurus/own-team.
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000706');
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = '00000000-0000-0000-0000-000000000750'), 1,
  'yayasan keeps project.read all scope');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000704');
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = '00000000-0000-0000-0000-000000000750'), 0,
  'koordinator sees no project outside the team');

-- 4) The elevated attachment delete must follow the same denial.
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000707');
DELETE FROM public.task_attachments WHERE id = '00000000-0000-0000-0000-000000000770';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.task_attachments WHERE id = '00000000-0000-0000-0000-000000000770'), 1,
  'super_admin cannot delete another member''s task attachment');

-- 5) §3.5 task.update_status: koordinator gains the team scope (TASK-01).
SET LOCAL ROLE authenticated;
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000703');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000760', 'in_progress',
  '00000000-0000-0000-0000-000000000703', 'dikerjakan koordinator tim')::jsonb->>'success'), 'true',
  'koordinator can move a task of its own team to in_progress');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000704');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000767', 'in_progress',
  '00000000-0000-0000-0000-000000000704')::jsonb->>'success'), 'true',
  'koordinator keeps authority inside its own team');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000762', 'in_review',
  '00000000-0000-0000-0000-000000000704')::jsonb->>'success'), 'false',
  'koordinator of another team cannot transition the task');

-- 6) D4: yayasan supervises cancel/reopen but never the daily transitions.
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000706');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000762', 'in_review',
  '00000000-0000-0000-0000-000000000706')::jsonb->>'success'), 'false',
  'yayasan cannot run a daily status transition (D4)');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000760', 'cancelled',
  '00000000-0000-0000-0000-000000000706', 'dibatalkan yayasan')::jsonb->>'success'), 'true',
  'yayasan keeps task.cancel/reopen over every team (D4)');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000709');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000760', 'todo',
  '00000000-0000-0000-0000-000000000709', 'dibuka ulang')::jsonb->>'success'), 'true',
  'multi-role santri+yayasan reopens through the yayasan cancel/reopen scope');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000762', 'in_review',
  '00000000-0000-0000-0000-000000000709')::jsonb->>'success'), 'false',
  'the secondary yayasan role adds no daily transition (multi-role evaluation)');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000705');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000762', 'in_review',
  '00000000-0000-0000-0000-000000000705')::jsonb->>'success'), 'true',
  'pengurus keeps the all-scope daily transition');

-- 7) §3.5 task.review: designated reviewer only, self-review never.
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000703');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000761', 'done',
  '00000000-0000-0000-0000-000000000703')::jsonb->>'success'), 'false',
  'koordinator cannot approve a task it created (self-review ban)');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000702');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000768', 'done',
  '00000000-0000-0000-0000-000000000702')::jsonb->>'success'), 'false',
  'assignee cannot approve a task it reviews itself (self-review ban)');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000706');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000765', 'done',
  '00000000-0000-0000-0000-000000000706')::jsonb->>'success'), 'false',
  'yayasan has no task.review scope (§3.5 dash)');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000707');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000760', 'in_progress',
  '00000000-0000-0000-0000-000000000707')::jsonb->>'success'), 'false',
  'super_admin cannot transition a task at all');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000703');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000765', 'done',
  '00000000-0000-0000-0000-000000000703', 'review diterima')::jsonb->>'success'), 'true',
  'designated team koordinator approves another member''s task');
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000702');
SELECT is((public.task_transition('00000000-0000-0000-0000-000000000760', 'in_progress',
  '00000000-0000-0000-0000-000000000702')::jsonb->>'success'), 'true',
  'active assignee still drives its own task');

-- 8) Status changes travel only through app.task_transition. The probe runs as
--    the creator of the private task, so the row is visible and a surviving
--    UPDATE policy would really move it.
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000701');
SELECT is((SELECT count(*)::int FROM public.tasks
  WHERE id = '00000000-0000-0000-0000-000000000763' AND status = 'todo'), 1, 'private task still todo');
UPDATE public.tasks SET status = 'in_progress' WHERE id = '00000000-0000-0000-0000-000000000763';
SELECT is((SELECT count(*)::int FROM public.tasks
  WHERE id = '00000000-0000-0000-0000-000000000763' AND status = 'todo'), 1,
  'a direct authenticated UPDATE can no longer change task status');
SELECT is((SELECT count(*)::int FROM public.task_status_history
  WHERE task_id = '00000000-0000-0000-0000-000000000763'), 0,
  'the blocked direct write leaves no status history row');

-- 9) Denied calls stay silent; successful ones write audit_logs atomically.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_logs
  WHERE event_name = 'task.status_changed' AND target_id = '00000000-0000-0000-0000-000000000762'), 1,
  'the one accepted transition on the organization task wrote its audit event');
SELECT is((SELECT actor_id::text FROM public.audit_logs
  WHERE event_name = 'task.status_changed' AND target_id = '00000000-0000-0000-0000-000000000762'
  LIMIT 1), '00000000-0000-0000-0000-000000000705',
  'the audit actor is the authenticated performer, not a client-supplied identity');
SELECT is((SELECT count(*)::int FROM public.audit_logs
  WHERE event_name = 'task.status_changed'
    AND target_id IN ('00000000-0000-0000-0000-000000000761',
                      '00000000-0000-0000-0000-000000000768')), 0,
  'rejected transitions write no audit event');
SELECT is((SELECT count(*)::int FROM public.task_status_history
  WHERE task_id = '00000000-0000-0000-0000-000000000762'), 1,
  'the accepted transition kept its task_status_history row');

-- 10) The fix must not widen grants or relax the state machine.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.task_transition('00000000-0000-0000-0000-000000000760', 'done',
       '00000000-0000-0000-0000-000000000701')$$,
  '42501', NULL, 'anon cannot execute the task transition RPC');
RESET ROLE;
SELECT is((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'task_transition'), true,
  'app.task_transition stays SECURITY DEFINER');
SELECT is((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'can_access_task'), true,
  'app.can_access_task stays SECURITY DEFINER');

-- The state machine itself, called through the schema-qualified name: as the
-- migration owner this probe reaches the trigger, which is the point—the
-- legal-transition matrix must still refuse in_review back to todo. The
-- authenticated path goes through public.task_transition and its grants are
-- covered above.
SET LOCAL ROLE postgres;
SELECT public.tcmd_as('00000000-0000-0000-0000-000000000705');
SELECT throws_ok(
  $$SELECT app.task_transition('00000000-0000-0000-0000-000000000761', 'todo',
       '00000000-0000-0000-0000-000000000705')$$,
  'P0001', NULL, 'the state machine still refuses in_review back to todo for every role');

RESET ROLE;
DROP FUNCTION public.tcmd_as(uuid);

SELECT * FROM finish();
ROLLBACK;
