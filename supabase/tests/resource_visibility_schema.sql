BEGIN;

SELECT plan(11);

-- LIB-02 / D6: PERMISSIONS.md §3.2 requires that a `restricted` resource only
-- opens through resource_visibility_rules (role_key or team_id), so the schema
-- must carry the rules table and one predicate that both RLS and the Server
-- Actions can agree on. Shape only: behaviour lives in
-- resource_visibility_rls.sql.

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'resource_visibility_rules'
      AND c.relkind = 'r'
  ),
  'public.resource_visibility_rules exists (D6 role/team table)'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'resource_visibility_rules'
      AND a.attname = 'resource_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ),
  'resource_visibility_rules.resource_id exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'resource_visibility_rules'
      AND a.attname = 'role_key'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ),
  'resource_visibility_rules.role_key exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'resource_visibility_rules'
      AND a.attname = 'team_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ),
  'resource_visibility_rules.team_id exists'
);

SELECT ok(
  COALESCE(
    (
      SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'resource_visibility_rules'
    ),
    false
  ),
  'resource_visibility_rules is protected by row level security'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'can_view_resource'
  ),
  'app.can_view_resource exists as the single D6 predicate'
);

SELECT is(
  COALESCE(
    (
      SELECT p.prosecdef::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.proname = 'can_view_resource'
    ),
    'false'
  ),
  'true',
  'app.can_view_resource is SECURITY DEFINER so the resources policy cannot recurse'
);

SELECT ok(
  COALESCE(
    (
      SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=%'
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.proname = 'can_view_resource'
    ),
    false
  ),
  'app.can_view_resource pins search_path (AGENTS.md SECURITY DEFINER rule)'
);

-- The predicate decides for the session owner only; a caller-supplied identity
-- would be a "what does X see" oracle next to an active-check for the asker.
SELECT is(
  COALESCE(
    (
      SELECT array_length(p.proargnames, 1)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.proname = 'can_view_resource'
    ),
    0
  )::text,
  '1',
  'app.can_view_resource takes only the resource id, never a caller-supplied user'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resources'
      AND policyname = 'Active members can view granted resources'
      AND qual LIKE '%can_view_resource%'
  ),
  'the resources SELECT policy delegates to app.can_view_resource'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resources'
      AND policyname = 'Active users can view published internal resources'
  ),
  'the internal-only policy is replaced rather than left as an OR branch'
);

SELECT * FROM finish();
ROLLBACK;
