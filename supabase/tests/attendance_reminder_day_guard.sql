BEGIN;

SELECT plan(20);

-- CRON-DAY + DEAD-RPC (Gelombang 3, catatan TEMPORAL §7 yang disetujui operator) —
-- PERMISSIONS.md §3.3 "hari libur/Ahad sesuai kalender".
--
-- Current state:
--   * app.is_operational_day(date) exists since 20261122000011 but lives in the private "app"
--     schema, so PostgREST cannot expose it and the notification cron never consults it. The
--     reminder audience comes from the snapshot ('no_checkin'), which is only correct while the
--     snapshot refresh succeeds: when refresh_attendance_effective fails the route falls back to
--     "every santri with no attendance_records row today" and reminds people on a Sunday or on a
--     closed day. The admin picker (src/app/(app)/admin/cron/page.tsx:12) offers "Min" as a
--     selectable weekday, so an admin can also schedule the job on Sunday directly.
--   * app.report_submit(uuid, uuid) is dead code: revoked from authenticated
--     (20261102000003:265-266), no public wrapper, no caller in src/ — and it still computes
--     is_late against a concatenated ' 21:00:00' instead of policy_settings, runs with
--     search_path = public, app (no pg_temp), and takes p_user_id from the caller rather than
--     auth.uid(). It is a trap for the next writer, not a live path.
--
-- After these migrations:
--   * public.is_operational_day(date) exposes the same single answer to the cron, service_role
--     only (the reminder audience must not become enumerable by callers);
--   * app.report_submit is gone, while the live report command path (save_report / review_report)
--     is asserted to survive the drop.

-- A calendar closure that is NOT a Sunday: this is the case the snapshot-based filter happens to
-- cover only while the refresh succeeds, and the fallback path never covers.
INSERT INTO public.non_operational_dates (attendance_date, reason)
VALUES (date '2026-11-24', 'Libur pondok (fixtures pgTAP CRON-DAY)');

-- 1-2: the rule and its exposure
SELECT has_function('app', 'is_operational_day', ARRAY['date'],
  'app.is_operational_day(date) still answers the day rule (20261122000011)');
SELECT has_function('public', 'is_operational_day', ARRAY['date'],
  'public.is_operational_day(date) exists so the cron can call it through PostgREST');

-- 3-5: the wrapper obeys the RPC house rules
SELECT is(
  (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.is_operational_day(date)'::regprocedure),
  true, 'the public wrapper is SECURITY DEFINER like every app schema escape hatch');
SELECT ok(
  coalesce((SELECT array_to_string(p.proconfig, ',') FROM pg_proc p
            WHERE p.oid = 'public.is_operational_day(date)'::regprocedure), '')
    LIKE '%search_path%',
  'the public wrapper pins search_path');
SELECT is(
  (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'public.is_operational_day(date)'::regprocedure),
  's'::"char", 'the public wrapper is STABLE, it reads no state it could mutate');

-- 6-10: same answers as app.is_operational_day, including the closure and NULL
SELECT is((SELECT public.is_operational_day(date '2026-11-22')), false,
  'Sunday 2026-11-22 is non-operational for the cron too');
SELECT is((SELECT public.is_operational_day(date '2026-11-23')), true,
  'Monday 2026-11-23 is operational');
SELECT is((SELECT public.is_operational_day(date '2026-11-24')), false,
  'a calendar closure that is not a Sunday is non-operational');
DELETE FROM public.non_operational_dates WHERE attendance_date = date '2026-11-24';
SELECT is((SELECT public.is_operational_day(date '2026-11-24')), true,
  'withdrawing the closure makes the day operational again, it is not a one-way switch');
SELECT is((SELECT public.is_operational_day(NULL::date)), false,
  'a missing date is never operational, so a broken cron clock cannot send reminders');

-- 11-13: service_role only. The reminder list is an operational detail; granting authenticated
-- would let any signed-in account probe the pondok calendar through the API.
RESET ROLE;
SELECT is((SELECT has_function_privilege('authenticated', 'public.is_operational_day(date)', 'EXECUTE')), false,
  'authenticated cannot execute the day guard');
SELECT is((SELECT has_function_privilege('anon', 'public.is_operational_day(date)', 'EXECUTE')), false,
  'anon cannot execute the day guard');
SELECT is((SELECT has_function_privilege('service_role', 'public.is_operational_day(date)', 'EXECUTE')), true,
  'service_role can execute the day guard, that is the cron identity');

-- 14-20: the dead RPC is removed and the live one is untouched
SELECT hasnt_function('app', 'report_submit', ARRAY['uuid', 'uuid'],
  'app.report_submit(uuid, uuid) is dropped: no caller, no grant, stale deadline and weak search_path');
SELECT hasnt_function('public', 'report_submit', ARRAY['uuid', 'uuid'],
  'no public.report_submit wrapper was left behind');
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'report_submit'),
  0::bigint, 'the name report_submit is gone from every schema, so a future writer cannot find it');
SELECT has_function('app', 'save_report', ARRAY['uuid', 'date', 'text', 'boolean', 'jsonb'],
  'app.save_report is the live submit path and survives the drop');
SELECT has_function('public', 'save_report', ARRAY['uuid', 'date', 'text', 'boolean', 'jsonb'],
  'public.save_report is reachable from the application after the drop');
SELECT has_function('app', 'review_report', ARRAY['uuid', 'integer', 'text', 'text', 'text'],
  'app.review_report (idempotency wave) survives the drop');
SELECT has_function('public', 'review_report', ARRAY['uuid', 'integer', 'text', 'text', 'text'],
  'public.review_report survives the drop, so the review screen is not collateral damage');

SELECT * FROM finish();

ROLLBACK;
