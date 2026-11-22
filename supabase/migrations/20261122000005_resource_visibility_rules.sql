-- Migration: 20261122000005_resource_visibility_rules.sql
-- LIB-02: give PERMISSIONS.md §3.2 / decision D6 a place to live.
--
-- Current state: `resource_visibility_rules` does not exist anywhere in the
-- schema, so the only rule the resources SELECT policy can express is
-- `visibility = 'internal'`. Every read of a `restricted` row therefore happens
-- through the Server Action, where visibilityFilter() hands restricted content
-- to super_admin, yayasan and pengurus on the caller's primary role alone —
-- blanket access with no role/team grant, and blind to secondary roles.
--
-- After this migration:
--   * resource_visibility_rules(resource_id, role_key, team_id) exists, RLS-
--     protected, and is writable only through app.resource_rule_set() at the
--     library.resource.update tier (pengurus/yayasan/super_admin, §3.2).
--   * app.can_view_resource(id) is the single predicate behind the resources
--     SELECT policy: an active member sees a published resource when it is
--     internal, or when a rule names one of their ACTIVE role keys or one of
--     their current team memberships. No role gets a blanket branch, so
--     super_admin loses the restricted rows it never had a rule for.
--   * app.resource_rule_set() replaces the rule set for one resource in a
--     single transaction and writes audit_logs in that same transaction, so a
--     visibility grant can never commit without its ledger row.
-- A restricted resource with no rule becomes invisible to everybody; that is
-- D6's intent, and the management path above is how an operator opens one.

-- ---------------------------------------------------------------------------
-- 1. The D6 rule table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resource_visibility_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  role_key text REFERENCES public.roles(key) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (role_key IS NOT NULL OR team_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS resource_visibility_rules_resource_id_idx
  ON public.resource_visibility_rules(resource_id);

-- One row per (resource, role) and per (resource, team). NULLs are excluded by
-- the partial predicates, so a role rule and a team rule coexist.
CREATE UNIQUE INDEX IF NOT EXISTS resource_visibility_rules_unique_role
  ON public.resource_visibility_rules(resource_id, role_key)
  WHERE role_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS resource_visibility_rules_unique_team
  ON public.resource_visibility_rules(resource_id, team_id)
  WHERE team_id IS NOT NULL;

ALTER TABLE public.resource_visibility_rules ENABLE ROW LEVEL SECURITY;

-- Rules are read by the roles that manage them; everyone else learns about a
-- grant only through the resource becoming visible. Writes stay service-role
-- only, because app.resource_rule_set() owns validation and the audit ledger.
DROP POLICY IF EXISTS "Resource rule managers can read rules" ON public.resource_visibility_rules;
CREATE POLICY "Resource rule managers can read rules"
  ON public.resource_visibility_rules FOR SELECT TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus', 'yayasan', 'super_admin'));

REVOKE ALL ON public.resource_visibility_rules FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.resource_visibility_rules FROM authenticated;
GRANT SELECT ON public.resource_visibility_rules TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.can_view_resource: the one predicate §3.2 / D6 describes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.can_view_resource(p_resource_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, pg_temp
STABLE
AS $$
  SELECT p_user_id IS NOT NULL
    AND app.is_active_member()
    AND EXISTS (
      SELECT 1
      FROM public.resources r
      WHERE r.id = p_resource_id
        AND r.status = 'published'
        AND (
          r.visibility = 'internal'
          OR EXISTS (
            SELECT 1
            FROM public.resource_visibility_rules v
            WHERE v.resource_id = r.id
              AND (
                (
                  v.role_key IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM public.user_roles ur
                    JOIN public.roles ro ON ro.id = ur.role_id
                    WHERE ur.user_id = p_user_id
                      AND ur.revoked_at IS NULL
                      AND ro.key = v.role_key
                  )
                )
                OR (
                  v.team_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM public.team_members tm
                    WHERE tm.user_id = p_user_id
                      AND tm.team_id = v.team_id
                      AND tm.valid_to IS NULL
                      AND tm.valid_from <= CURRENT_DATE
                  )
                )
              )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION app.can_view_resource(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_view_resource(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.resource_rule_set: the only writer, with the audit row it belongs to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.resource_rule_set(
  p_resource_id uuid,
  p_role_keys text[] DEFAULT NULL,
  p_team_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_resource public.resources%ROWTYPE;
  v_role_key text;
  v_team_id uuid;
  v_actor_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  -- §3.2 library.resource.update = pengurus/yayasan/super_admin. Koordinator
  -- authoring (D7) does not extend to deciding who reads restricted content.
  IF NOT app.has_any_role('pengurus', 'yayasan', 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengelola aturan visibilitas resource.');
  END IF;

  SELECT * INTO v_resource FROM public.resources WHERE id = p_resource_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Resource tidak ditemukan.');
  END IF;

  FOREACH v_role_key IN ARRAY COALESCE(p_role_keys, '{}'::text[])
  LOOP
    IF v_role_key IS NULL OR NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.key = v_role_key) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Peran aturan visibilitas tidak dikenal.');
    END IF;
  END LOOP;
  FOREACH v_team_id IN ARRAY COALESCE(p_team_ids, '{}'::uuid[])
  LOOP
    IF v_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = v_team_id) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tim aturan visibilitas tidak dikenal.');
    END IF;
  END LOOP;

  DELETE FROM public.resource_visibility_rules WHERE resource_id = p_resource_id;

  INSERT INTO public.resource_visibility_rules (resource_id, role_key, created_by)
  SELECT p_resource_id, d.role_key, auth.uid()
  FROM (SELECT DISTINCT unnest(COALESCE(p_role_keys, '{}'::text[])) AS role_key) d;

  INSERT INTO public.resource_visibility_rules (resource_id, team_id, created_by)
  SELECT p_resource_id, d.team_id, auth.uid()
  FROM (SELECT DISTINCT unnest(COALESCE(p_team_ids, '{}'::uuid[])) AS team_id) d;

  -- Same transaction as the grant change (AGENTS.md: every SECURITY DEFINER
  -- RPC writes audit_logs alongside its mutation).
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'library.visibility_rules_updated',
    auth.uid(),
    COALESCE(v_actor_name, auth.uid()::text),
    p_resource_id::text,
    v_resource.name,
    format(
      'Aturan visibilitas resource diperbarui (peran: %s; tim: %s).',
      COALESCE(NULLIF(array_to_string(ARRAY(SELECT DISTINCT unnest(COALESCE(p_role_keys, '{}'::text[]))), ', '), ''), '-'),
      COALESCE(NULLIF(array_to_string(ARRAY(SELECT DISTINCT unnest(COALESCE(p_team_ids, '{}'::uuid[]))::text), ', '), ''), '-')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Aturan visibilitas resource berhasil disimpan.',
    'role_keys', COALESCE(ARRAY(SELECT DISTINCT unnest(COALESCE(p_role_keys, '{}'::text[]))), '{}'::text[]),
    'team_ids', COALESCE(ARRAY(SELECT DISTINCT unnest(COALESCE(p_team_ids, '{}'::uuid[]))), '{}'::uuid[])
  );
END;
$$;

REVOKE ALL ON FUNCTION app.resource_rule_set(uuid, text[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resource_rule_set(uuid, text[], uuid[]) TO authenticated;

-- PostgREST wrapper, mirroring the app./public. pair used by every other
-- command RPC in this schema.
CREATE OR REPLACE FUNCTION public.resource_rule_set(
  p_resource_id uuid,
  p_role_keys text[] DEFAULT NULL,
  p_team_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app
AS $$
  SELECT app.resource_rule_set(p_resource_id, p_role_keys, p_team_ids);
$$;

REVOKE ALL ON FUNCTION public.resource_rule_set(uuid, text[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resource_rule_set(uuid, text[], uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.resource_rule_set(uuid, text[], uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The resources SELECT policy now travels through the predicate.
-- ---------------------------------------------------------------------------
-- The old rule could only say `visibility = 'internal'` because no grant table
-- existed, which pushed every restricted read into the Server Action. With
-- app.can_view_resource() the database is the enforcement point again, so the
-- action-layer filter is a projection of this policy rather than its substitute.
DROP POLICY IF EXISTS "Active users can view published internal resources" ON public.resources;
DROP POLICY IF EXISTS "Active members can view granted resources" ON public.resources;

CREATE POLICY "Active members can view granted resources"
  ON public.resources FOR SELECT TO authenticated
  USING (app.can_view_resource(id));

NOTIFY pgrst, 'reload schema';
