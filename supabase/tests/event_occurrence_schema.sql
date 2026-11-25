BEGIN;

SELECT plan(15);

-- SCH-01: the per-occurrence cancellation surface has to exist before any read
-- path can honour it. This file stays catalog-only on purpose: every assertion
-- answers false instead of erroring when the objects are missing, so the same
-- file is usable as the Stage-B red evidence. Behaviour lives in
-- event_occurrence_rls.sql.

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'event_occurrence_exceptions' AND c.relkind = 'r'
  ),
  'public.event_occurrence_exceptions exists'
);

SELECT ok(
  COALESCE((SELECT count(*) > 0 FROM pg_constraint
            WHERE conrelid = to_regclass('public.event_occurrence_exceptions') AND contype = 'u'), false),
  'one exception row per (event, occurrence_date) keeps the write idempotent'
);

SELECT ok(
  COALESCE((SELECT c.relrowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'event_occurrence_exceptions'), false),
  'event_occurrence_exceptions is protected by row level security'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'event_occurrence_exceptions'
      AND cmd = 'SELECT'
      AND qual LIKE '%is_active_member%'
  ),
  'the exception book is readable only through an active-member policy'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'event_occurrence_exceptions' AND cmd <> 'SELECT'
  ),
  'no INSERT/UPDATE/DELETE policy: writes belong to the RPC alone'
);

SELECT is(
  COALESCE((SELECT p.prosecdef::text FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.proname = 'event_occurrence_set'), 'false'),
  'true',
  'app.event_occurrence_set is SECURITY DEFINER'
);

SELECT ok(
  COALESCE((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=%' FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.proname = 'event_occurrence_set'), false),
  'app.event_occurrence_set pins search_path (AGENTS.md SECURITY DEFINER rule)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'event_occurrence_set' AND p.prosecdef = false
  ),
  'the PostgREST wrapper exists as SECURITY INVOKER so the RPC guard still runs'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'is_event_occurrence_cancelled'
  ),
  'app.is_event_occurrence_cancelled exists as the shared read predicate'
);

SELECT is(
  CASE WHEN to_regclass('public.event_occurrence_exceptions') IS NULL THEN 'missing'
       ELSE has_table_privilege('authenticated', 'public.event_occurrence_exceptions', 'INSERT')::text END,
  'false',
  'authenticated never writes the exception table directly'
);

SELECT is(
  CASE WHEN to_regclass('public.event_occurrence_exceptions') IS NULL THEN 'missing'
       ELSE has_table_privilege('authenticated', 'public.event_occurrence_exceptions', 'SELECT')::text END,
  'true',
  'authenticated can read the exception table, under RLS'
);

SELECT is(
  CASE WHEN to_regclass('public.event_occurrence_exceptions') IS NULL THEN 'missing'
       ELSE has_table_privilege('anon', 'public.event_occurrence_exceptions', 'SELECT')::text END,
  'false',
  'anon has no access to the schedule exception book'
);

-- The rules that make an occurrence addressable have to live in the function, not
-- in the caller: WIB date math, the weekly step, the series window and the audit
-- row in the same transaction.
SELECT ok(
  COALESCE((SELECT p.prosrc LIKE '%Asia/Jakarta%' FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.proname = 'event_occurrence_set'), false),
  'the occurrence date is derived in Asia/Jakarta, not the server timezone'
);

SELECT ok(
  COALESCE((SELECT p.prosrc LIKE '%MOD(%' FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.proname = 'event_occurrence_set'), false),
  'a weekly series refuses dates its own rule never produces'
);

SELECT ok(
  COALESCE((SELECT p.prosrc LIKE '%event.occurrence_cancelled%' AND p.prosrc LIKE '%event.occurrence_restored%'
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.proname = 'event_occurrence_set'), false),
  'app.event_occurrence_set writes its audit_logs row in the same transaction'
);

SELECT * FROM finish();
ROLLBACK;
