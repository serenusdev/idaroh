-- Rollback for 20261122000015_task_command_scope_rpcs.sql
DROP FUNCTION IF EXISTS public.project_archive(uuid);
DROP FUNCTION IF EXISTS app.project_archive(uuid);
DROP FUNCTION IF EXISTS public.project_upsert(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS app.project_upsert(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.task_checklist_mutate(uuid, text, uuid, text, boolean);
DROP FUNCTION IF EXISTS app.task_checklist_mutate(uuid, text, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.task_assign_reviewer(uuid, uuid);
DROP FUNCTION IF EXISTS app.task_assign_reviewer(uuid, uuid);
DROP FUNCTION IF EXISTS public.task_archive(uuid);
DROP FUNCTION IF EXISTS app.task_archive(uuid);
DROP FUNCTION IF EXISTS public.task_update(uuid, text, text, text, boolean, uuid, date, text);
DROP FUNCTION IF EXISTS app.task_update(uuid, text, text, text, boolean, uuid, date, text);
DROP FUNCTION IF EXISTS app.is_team_coordinator_for(text, uuid);

GRANT INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.task_checklist_items TO authenticated;

NOTIFY pgrst, 'reload schema';
