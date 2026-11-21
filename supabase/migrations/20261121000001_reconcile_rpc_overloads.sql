-- Migration: 20261121000001_reconcile_rpc_overloads.sql
-- Purpose: schema-drift reconciliation for RPC signatures after the operator
--          replays the pending migration sequence onto production, where
--          out-of-band changes left obsolete overloads in place:
--            * public.approve_account_application had both the obsolete 4-arg
--              overload (20261105000004) and the 5-arg one (20261112000005);
--              PostgREST cannot disambiguate an overloaded RPC.
--            * public.review_attendance_correction was still the 3-arg version
--              while app.* and the application code send 4 arguments.
--            * public.review_report kept the legacy 3-arg wrapper alongside the
--              5-arg idempotent command (20261118000001).
-- Replaying this file is always safe: it only drops known-obsolete signatures
-- (IF EXISTS) and then asserts the expected ones exist, failing loudly instead
-- of leaving the app against a half-migrated schema.

BEGIN;

-- 1. Drop obsolete overloads. These signatures have no remaining callers; the
--    replacements are provided by 20261112000005, 20261114000007 and
--    20261118000001 respectively.
DROP FUNCTION IF EXISTS public.approve_account_application(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS app.approve_account_application(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.review_attendance_correction(uuid, text, text);
DROP FUNCTION IF EXISTS app.review_attendance_correction(uuid, text, text);
DROP FUNCTION IF EXISTS public.review_report(uuid, text, text);
DROP FUNCTION IF EXISTS app.review_report(uuid, text, text);

-- 2. Fail closed if the expected signatures are still missing after the drop.
DO $$
DECLARE
  v_required text[] := ARRAY[
    'app.approve_account_application(uuid, uuid, text, uuid, uuid)',
    'public.approve_account_application(uuid, uuid, text, uuid, uuid)',
    'app.review_attendance_correction(uuid, text, text, text)',
    'public.review_attendance_correction(uuid, text, text, text)',
    'app.review_report(uuid, integer, text, text, text)',
    'public.review_report(uuid, integer, text, text, text)'
  ];
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY v_required LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION
        'RPC reconciliation failed: % is missing; apply the full pending migration sequence first',
        v_signature
        USING HINT = 'Expected from 20261112000005 / 20261114000007 / 20261118000001';
    END IF;
  END LOOP;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
