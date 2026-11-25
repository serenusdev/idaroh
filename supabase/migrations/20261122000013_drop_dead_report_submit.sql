-- DEAD-RPC (Gelombang 3, catatan TEMPORAL §7 yang disetujui operator 2026-11-25).
--
-- app.report_submit(uuid, uuid) has been unreachable since 20261102000003:
--   * REVOKE ALL FROM PUBLIC and FROM authenticated (20261102000003:265-266), no GRANT anywhere
--     afterwards, and no wrapper in the public schema, so no REST caller can reach it;
--   * grep over src/ and e2e/ shows no call site: the live submit path is app.save_report().
--
-- It is also the wrong shape in three ways that a future writer would inherit if it stayed:
--   1. is_late is computed against a concatenated ' 21:00:00' from the report date
--      (20261101000004:127), not policy_settings.report_deadline_time, so it contradicts the rule
--      that app.report_time_is_late() now owns (20261122000011, PERMISSIONS.md §3.4);
--   2. search_path is "public, app" without pg_temp, which predates the hardening pass;
--   3. it trusts p_user_id from the caller instead of auth.uid(), which §2 rule 1 forbids.
--
-- Dropping it removes a trap. The DO block at the end fails the migration closed if any live
-- report command is missing, so this file cannot be used to take the submit or review screen down.

BEGIN;

DROP FUNCTION IF EXISTS app.report_submit(uuid, uuid);
DROP FUNCTION IF EXISTS public.report_submit(uuid, uuid);

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(signature, ', ' ORDER BY signature) INTO v_missing
  FROM unnest(ARRAY[
    'app.save_report(uuid, date, text, boolean, jsonb)',
    'public.save_report(uuid, date, text, boolean, jsonb)',
    'app.review_report(uuid, integer, text, text, text)',
    'public.review_report(uuid, integer, text, text, text)'
  ]) AS signature
  WHERE to_regprocedure(signature) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Penghapusan report_submit tidak aman: jalur laporan hidup berikut hilang: %', v_missing;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
