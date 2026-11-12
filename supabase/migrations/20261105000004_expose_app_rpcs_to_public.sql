-- Migration: 20261105000004_expose_app_rpcs_to_public
-- Purpose: Create thin public-schema wrapper functions so that PostgREST
--          (which only exposes the `public` schema by default) can relay
--          supabase.rpc("...") calls from the client to the real
--          implementations in the `app` schema.
--
-- Strategy: Each wrapper is SECURITY INVOKER (the caller's JWT is used for
--           authz), delegates immediately to its `app.*` counterpart, and
--           inherits the same GRANT/REVOKE as the underlying function.
--
-- Functions wrapped (14 total):
--   attendance_check_in, analytics_operational_summary,
--   save_report, review_report, assign_reviewer, create_task,
--   touch_presence, approve_account_application, team_set_coordinator,
--   task_transition, activate_policy, review_attendance_correction,
--   review_attendance_exception, verify_audit_chain

-- ---------------------------------------------------------------------------
-- 1. attendance_check_in
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_check_in(
  p_user_id      uuid,
  p_client_meta  jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.attendance_check_in(p_user_id, p_client_meta);
$$;

REVOKE ALL ON FUNCTION public.attendance_check_in(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. analytics_operational_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_operational_summary(
  p_from    date,
  p_to      date,
  p_team_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.analytics_operational_summary(p_from, p_to, p_team_id);
$$;

REVOKE ALL ON FUNCTION public.analytics_operational_summary(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_operational_summary(date, date, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. save_report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_report(
  p_user_id           uuid,
  p_report_date       date,
  p_submission_status text,
  p_is_late           boolean,
  p_items             jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.save_report(p_user_id, p_report_date, p_submission_status, p_is_late, p_items);
$$;

REVOKE ALL ON FUNCTION public.save_report(uuid, date, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_report(uuid, date, text, boolean, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. review_report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_report(
  p_report_id uuid,
  p_decision  text,
  p_notes     text DEFAULT ''
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.review_report(p_report_id, p_decision, p_notes);
$$;

REVOKE ALL ON FUNCTION public.review_report(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_report(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. assign_reviewer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_reviewer(
  p_reviewee_id uuid,
  p_reviewer_id uuid,
  p_kind        text DEFAULT 'report',
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.assign_reviewer(p_reviewee_id, p_reviewer_id, p_kind, p_reason);
$$;

REVOKE ALL ON FUNCTION public.assign_reviewer(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_reviewer(uuid, uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. create_task
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_task(
  p_title          text,
  p_description    text          DEFAULT '',
  p_priority       text          DEFAULT 'normal',
  p_requires_review boolean     DEFAULT false,
  p_project_id     uuid          DEFAULT NULL,
  p_due_date       date          DEFAULT NULL,
  p_visibility     text          DEFAULT 'team',
  p_assignee_ids   uuid[]        DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.create_task(
    p_title, p_description, p_priority, p_requires_review,
    p_project_id, p_due_date, p_visibility, p_assignee_ids
  );
$$;

REVOKE ALL ON FUNCTION public.create_task(text, text, text, boolean, uuid, date, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_task(text, text, text, boolean, uuid, date, text, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. touch_presence
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_presence()
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.touch_presence();
$$;

REVOKE ALL ON FUNCTION public.touch_presence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_presence() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. approve_account_application
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_account_application(
  p_request_id   uuid,
  p_auth_user_id uuid,
  p_role_key     text,
  p_approver_id  uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.approve_account_application(p_request_id, p_auth_user_id, p_role_key, p_approver_id);
$$;

REVOKE ALL ON FUNCTION public.approve_account_application(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_account_application(uuid, uuid, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. team_set_coordinator
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_set_coordinator(
  p_team_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.team_set_coordinator(p_team_id, p_user_id);
$$;

REVOKE ALL ON FUNCTION public.team_set_coordinator(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_set_coordinator(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. task_transition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.task_transition(
  p_task_id    uuid,
  p_new_status text,
  p_user_id    uuid,
  p_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.task_transition(p_task_id, p_new_status, p_user_id, p_note);
$$;

REVOKE ALL ON FUNCTION public.task_transition(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_transition(uuid, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. activate_policy
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_policy(p_policy_id text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.activate_policy(p_policy_id);
$$;

REVOKE ALL ON FUNCTION public.activate_policy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_policy(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. review_attendance_correction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_attendance_correction(
  p_correction_id uuid,
  p_decision      text,
  p_note          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.review_attendance_correction(p_correction_id, p_decision, p_note);
$$;

REVOKE ALL ON FUNCTION public.review_attendance_correction(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_attendance_correction(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. review_attendance_exception
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_attendance_exception(
  p_exception_id uuid,
  p_decision     text,
  p_note         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.review_attendance_exception(p_exception_id, p_decision, p_note);
$$;

REVOKE ALL ON FUNCTION public.review_attendance_exception(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_attendance_exception(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14. verify_audit_chain
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_audit_chain()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, extensions, app, pg_temp
AS $$
  SELECT app.verify_audit_chain();
$$;

REVOKE ALL ON FUNCTION public.verify_audit_chain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain() TO authenticated;

