BEGIN;
SELECT plan(12);

-- Fixture users: one per role + second team for koordinator isolation
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('c3000000-0000-0000-0000-000000000001', 'c3-sa@example.test', 'x', now(), '{}', '{}', now(), now()),
  ('c3000000-0000-0000-0000-000000000002', 'c3-yayasan@example.test', 'x', now(), '{}', '{}', now(), now()),
  ('c3000000-0000-0000-0000-000000000003', 'c3-pengurus@example.test', 'x', now(), '{}', '{}', now(), now()),
  ('c3000000-0000-0000-0000-000000000004', 'c3-koor-a@example.test', 'x', now(), '{}', '{}', now(), now()),
  ('c3000000-0000-0000-0000-000000000005', 'c3-santri@example.test', 'x', now(), '{}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, member_type, status)
VALUES
  ('c3000000-0000-0000-0000-000000000001', 'c3-sa@example.test', 'C3 SA', 'pengurus', 'active'),
  ('c3000000-0000-0000-0000-000000000002', 'c3-yayasan@example.test', 'C3 Yayasan', 'yayasan', 'active'),
  ('c3000000-0000-0000-0000-000000000003', 'c3-pengurus@example.test', 'C3 Pengurus', 'pengurus', 'active'),
  ('c3000000-0000-0000-0000-000000000004', 'c3-koor-a@example.test', 'C3 Koor A', 'santri', 'active'),
  ('c3000000-0000-0000-0000-000000000005', 'c3-santri@example.test', 'C3 Santri', 'santri', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.uid, r.id
FROM (VALUES
  ('c3000000-0000-0000-0000-000000000001'::uuid, 'super_admin'),
  ('c3000000-0000-0000-0000-000000000002'::uuid, 'yayasan'),
  ('c3000000-0000-0000-0000-000000000003'::uuid, 'pengurus'),
  ('c3000000-0000-0000-0000-000000000004'::uuid, 'koordinator'),
  ('c3000000-0000-0000-0000-000000000005'::uuid, 'santri')
) AS u(uid, role_key)
JOIN public.roles r ON r.key = u.role_key
ON CONFLICT DO NOTHING;

INSERT INTO public.teams (id, name, slug, status)
VALUES
  ('c3100000-0000-0000-0000-000000000001', 'Tim C3 A', 'tim-c3-a', 'active'),
  ('c3100000-0000-0000-0000-000000000002', 'Tim C3 B', 'tim-c3-b', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (team_id, user_id, team_role, valid_from)
VALUES
  ('c3100000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000004', 'coordinator', CURRENT_DATE)
ON CONFLICT DO NOTHING;

INSERT INTO public.projects (id, name, team_id, status, owner_id, created_by)
VALUES
  ('c3200000-0000-0000-0000-000000000001', 'Proyek Tim A', 'tim-c3-a', 'active', 'c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003'),
  ('c3200000-0000-0000-0000-000000000002', 'Proyek Tim B', 'tim-c3-b', 'active', 'c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tasks (id, project_id, team_id, title, priority, status, visibility, created_by)
VALUES
  ('c3300000-0000-0000-0000-000000000001', 'c3200000-0000-0000-0000-000000000001', 'tim-c3-a', 'Tugas Tim A', 'normal', 'todo', 'team', 'c3000000-0000-0000-0000-000000000003'),
  ('c3300000-0000-0000-0000-000000000002', 'c3200000-0000-0000-0000-000000000002', 'tim-c3-b', 'Tugas Tim B', 'normal', 'todo', 'team', 'c3000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;

-- 1-3: Direct table writes on tasks, projects, task_checklist_items revoked from authenticated
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  $$UPDATE public.tasks SET title = 'hack' WHERE id = 'c3300000-0000-0000-0000-000000000001'$$,
  '42501',
  NULL,
  'authenticated cannot directly UPDATE public.tasks'
);
SELECT throws_ok(
  $$INSERT INTO public.projects (name, owner_id, created_by) VALUES ('hack', auth.uid(), auth.uid())$$,
  '42501',
  NULL,
  'authenticated cannot directly INSERT public.projects'
);
SELECT throws_ok(
  $$INSERT INTO public.task_checklist_items (task_id, text) VALUES ('c3300000-0000-0000-0000-000000000001', 'hack')$$,
  '42501',
  NULL,
  'authenticated cannot directly INSERT public.task_checklist_items'
);

-- 4-6: super_admin (SA = —) rejected by create_task, task_update, project_upsert
SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000001', true);
SELECT is(
  (public.create_task('SA Task', '', 'normal', false, NULL, NULL, 'private', '{}'::uuid[]) ->> 'success')::boolean,
  false,
  'super_admin is rejected by create_task (SA = —)'
);
SELECT is(
  (public.task_update('c3300000-0000-0000-0000-000000000001', 'SA Edit', '', 'normal', false, NULL, NULL, 'team') ->> 'success')::boolean,
  false,
  'super_admin is rejected by task_update (SA = —)'
);
SELECT is(
  (public.project_upsert(NULL, 'SA Project', '', 'tim-c3-a', 'active') ->> 'success')::boolean,
  false,
  'super_admin is rejected by project_upsert (SA = —)'
);

-- 7-9: koordinator Tim A allowed on Tim A, rejected on Tim B
SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000004', true);
SELECT is(
  (public.project_upsert(NULL, 'Proyek Baru Koor A', '', 'tim-c3-a', 'active') ->> 'success')::boolean,
  true,
  'koordinator Tim A can create project for Tim A'
);
SELECT is(
  (public.project_upsert(NULL, 'Proyek Ilegal Tim B', '', 'tim-c3-b', 'active') ->> 'success')::boolean,
  false,
  'koordinator Tim A cannot create project for Tim B'
);
SELECT is(
  (public.task_update('c3300000-0000-0000-0000-000000000002', 'Edit Tim B', '', 'normal', false, NULL, NULL, 'team') ->> 'success')::boolean,
  false,
  'koordinator Tim A cannot update task of Tim B'
);

-- 10-12: pengurus can update task, add checklist, and writes audit_logs
SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000003', true);
SELECT is(
  (public.task_update('c3300000-0000-0000-0000-000000000001', 'Tugas Tim A Revisi', '', 'high', false, NULL, NULL, 'team') ->> 'success')::boolean,
  true,
  'pengurus can update task via task_update RPC'
);
SELECT is(
  (public.task_checklist_mutate('c3300000-0000-0000-0000-000000000001', 'add', NULL, 'Item 1', false) ->> 'success')::boolean,
  true,
  'pengurus can add checklist item via task_checklist_mutate RPC'
);

RESET ROLE;
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE target_id = 'c3300000-0000-0000-0000-000000000001'
      AND event_name = 'task.updated'
      AND actor_id = 'c3000000-0000-0000-0000-000000000003'
  ),
  'task_update writes audit_logs with session actor_id'
);

SELECT * FROM finish();
ROLLBACK;
