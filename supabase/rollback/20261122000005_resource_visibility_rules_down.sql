-- Rollback for: 20261122000005_resource_visibility_rules.sql
-- Restores, verbatim: the resources SELECT policy from
-- 20261101000002_resource_library_schema.sql (published internal rows only),
-- and removes the D6 rule table, app.can_view_resource() and the
-- app./public. resource_rule_set() pair.
-- NOTE: this returns the system to the LIB-02 finding state — restricted rows
-- become unreadable through RLS for every role again — and is only for incident
-- recovery, not for normal operation. Any rule rows granted since the migration
-- are lost with the table.

BEGIN;

DROP POLICY IF EXISTS "Active members can view granted resources" ON public.resources;

CREATE POLICY "Active users can view published internal resources"
  ON public.resources FOR SELECT
  USING (app.is_active_member() AND status = 'published' AND visibility = 'internal');

DROP FUNCTION IF EXISTS public.resource_rule_set(uuid, text[], uuid[]);
DROP FUNCTION IF EXISTS app.resource_rule_set(uuid, text[], uuid[]);
DROP FUNCTION IF EXISTS app.can_view_resource(uuid, uuid);
DROP TABLE IF EXISTS public.resource_visibility_rules;

NOTIFY pgrst, 'reload schema';

COMMIT;
