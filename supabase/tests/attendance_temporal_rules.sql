BEGIN;

SELECT plan(36);

-- TEMPORAL (Gelombang 3) — PERMISSIONS.md §3.3 "hari libur/Ahad" and §3.4 "is_late > 21.00 WIB".
--
-- Current state:
--   * 20261102000012 added "Ahad is always non-operational" to the snapshot layer
--     (EXTRACT(DOW FROM p_date) = 0 -> 'non_operational' / 'calendar'), and 20261114000007
--     rewrote the same function for the correction layer without that clause. Since then a
--     Sunday without an explicit non_operational_dates row is snapshotted as 'no_checkin',
--     i.e. a santri who correctly did not check in is reported as having missed attendance.
--   * app.attendance_check_in blocks Sunday but ignores non_operational_dates, although §3.3
--     describes the block as "hari libur/Ahad sesuai kalender".
--   * The 08:00/08:15 rule and the 21:00 rule are inline expressions inside functions that
--     read now(), so no test could ever place a clock on the boundary.
--   * nothing refreshes the snapshot when a calendar closure is added or withdrawn, and the
--     cron only ever refreshes today, so historical Sundays stay wrong forever.
--
-- After this migration:
--   * app.is_operational_day(date) is the single answer for both layers (Sunday OR closed);
--   * app.classify_checkin_time(time, time, time) and app.report_time_is_late(time, time) hold
--     the boundary arithmetic, so the cut-off minutes are testable without a mutable clock. The
--     literals below are the seeded baseline policy (20261102000005:478: 08:00/08:15/21:00) —
--     the RPC passes whatever the active policy row says.
--   * a trigger on non_operational_dates refreshes the affected date in both directions, and
--     app.backfill_non_operational_effective(from, to) repairs rows written by the defect;
--   * the snapshot keeps the role-based expectation from ROLE-SYNC (never member_type).
--
--   761 santri           762 santri (backfill fixture)
--   Sunday 2026-11-22, Monday 2026-11-23, Sundays 2026-11-15 (inside the backfill window)
--   and 2026-12-06 (outside it), Monday 2026-11-30 (operational, must survive the backfill).

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000761', 'temporal-santri-a@example.test'),
  ('00000000-0000-0000-0000-000000000762', 'temporal-santri-b@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000761', 'temporal-santri-a@example.test', 'Santri Ahad', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000762', 'temporal-santri-b@example.test', 'Santri Backfill', 'active', 'santri');

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('00000000-0000-0000-0000-000000000761'::uuid),
  ('00000000-0000-0000-0000-000000000762'::uuid)
) AS u(id)
JOIN public.roles r ON r.key = 'santri';

-- PostgreSQL has no temporary functions: this identity switcher lives only inside the
-- rolled-back transaction.
CREATE FUNCTION public.temporal_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

-- 1-4: the four new objects exist, which is what makes the rest of the rules testable.
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'is_operational_day'),
  'app.is_operational_day exists as the single answer for Sunday and calendar closures');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'classify_checkin_time'),
  'app.classify_checkin_time exists so the cutoff minutes can be tested without a mutable clock');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'report_time_is_late'),
  'app.report_time_is_late exists so the 21:00 boundary can be tested');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'backfill_non_operational_effective'),
  'app.backfill_non_operational_effective exists to repair rows written by the defect');

-- 5-9: the rule is really delegated — an inline copy elsewhere would drift again the way
-- 20261114000007 silently dropped the clause from 20261102000012.
SELECT ok((SELECT prosrc LIKE '%is_operational_day%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'refresh_attendance_effective'),
  'app.refresh_attendance_effective asks app.is_operational_day instead of re-deriving the day');
SELECT ok((SELECT prosrc LIKE '%is_operational_day%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'attendance_check_in'),
  'app.attendance_check_in blocks on the calendar, not only on Sunday');
SELECT ok((SELECT prosrc LIKE '%classify_checkin_time%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'attendance_check_in'),
  'app.attendance_check_in classifies through the shared helper');
SELECT ok((SELECT prosrc LIKE '%report_time_is_late%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'save_report'),
  'app.save_report derives is_late through the shared helper');
SELECT is((SELECT prosrc LIKE '%member_type%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'refresh_attendance_effective'), false,
  'the snapshot keeps the ROLE-SYNC rule: the expectation comes from user_roles, not member_type');

-- 10-19: the check-in boundary (cut-off 08:00, grace 08:15).
SELECT is((SELECT c.classification::text FROM app.classify_checkin_time(
           time '07:59:00', time '08:00:00', time '08:15:00') c), 'on_time',
  '07:59 is on time');
SELECT is((SELECT c.classification::text FROM app.classify_checkin_time(
           time '08:00:00', time '08:00:00', time '08:15:00') c), 'on_time',
  '08:00:00 exactly, on the cut-off minute, is still on time');
SELECT is((SELECT c.classification::text FROM app.classify_checkin_time(
           time '08:00:59', time '08:00:00', time '08:15:00') c), 'on_time',
  'the last second of the cut-off minute is on time (the +59 second tolerance)');
SELECT is((SELECT c.classification::text FROM app.classify_checkin_time(
           time '08:01:00', time '08:00:00', time '08:15:00') c), 'grace',
  '08:01 enters the grace window');
SELECT is((SELECT c.classification::text FROM app.classify_checkin_time(
           time '08:15:00', time '08:00:00', time '08:15:00') c), 'grace',
  '08:15 exactly, on the grace minute, is still grace');
SELECT is((SELECT c.classification::text FROM app.classify_checkin_time(
           time '08:15:59', time '08:00:00', time '08:15:00') c), 'grace',
  'the last second of the grace minute is still grace');
SELECT is((SELECT c.classification::text FROM app.classify_checkin_time(
           time '08:16:00', time '08:00:00', time '08:15:00') c), 'late',
  '08:16 is late');
SELECT is((SELECT c.minutes_after FROM app.classify_checkin_time(
           time '08:16:00', time '08:00:00', time '08:15:00') c), 16,
  'minutes_after_deadline counts from the cut-off, not from the grace limit');
SELECT is((SELECT c.minutes_after FROM app.classify_checkin_time(
           time '09:30:00', time '08:00:00', time '08:15:00') c), 90,
  'a late check-in two hours and a half after the cut-off reports 90 minutes');
SELECT is((SELECT c.minutes_after FROM app.classify_checkin_time(
           time '07:00:00', time '08:00:00', time '08:15:00') c), 0,
  'an early check-in never reports negative minutes');

-- 20-21: the day rule from the weekday alone.
SELECT is(app.is_operational_day(date '2026-11-22'), false,
  'a Sunday is non-operational without any calendar row');
SELECT is(app.is_operational_day(date '2026-11-23'), true,
  'an ordinary Monday is operational');

-- 22-24: the report deadline, which PERMISSIONS.md §3.4 states as "> 21.00 WIB".
SELECT is(app.report_time_is_late(time '20:59:59', time '21:00:00'), false,
  'one second before the deadline is on time');
SELECT is(app.report_time_is_late(time '21:00:00', time '21:00:00'), false,
  'exactly 21:00 is not past the deadline');
SELECT is(app.report_time_is_late(time '21:00:01', time '21:00:00'), true,
  'the first second past 21:00 WIB is late');

-- 25-26: a Sunday snapshot, correction and all — the calendar branch has to win. The approved
-- correction is inserted as service_role, and its trigger refreshes the date.
SET LOCAL ROLE service_role;
INSERT INTO public.attendance_corrections (user_id, attendance_date, requested_classification,
                                           reason, status, effective_classification, decided_at)
VALUES ('00000000-0000-0000-0000-000000000761', '2026-11-22', 'on_time',
        'Salah klasifikasi: hari Ahad', 'approved', 'on_time', now());
RESET ROLE;

SELECT is((SELECT status FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000761' AND attendance_date = '2026-11-22'),
  'non_operational',
  'an approved correction cannot turn a Sunday back into an attended day');
SELECT is((SELECT source_type FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000761' AND attendance_date = '2026-11-22'),
  'calendar',
  'the Sunday row is attributed to the calendar, not to the correction');

-- 27-30: an explicit closure behaves like a Sunday, and withdrawing it restores the duty.
-- Nothing here calls refresh_attendance_effective: only the new trigger can move these rows.
SET LOCAL ROLE service_role;
SELECT is(app.is_operational_day(date '2026-11-23'), true,
  'the closure is not in place yet, so the Monday is still operational');
INSERT INTO public.non_operational_dates (attendance_date, reason)
VALUES ('2026-11-23', 'Libur Idul Fitri (uji)');
SELECT is((SELECT status FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000761' AND attendance_date = '2026-11-23'),
  'non_operational',
  'adding a calendar closure refreshes that date immediately');
SELECT is((SELECT source_type FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000761' AND attendance_date = '2026-11-23'),
  'calendar',
  'the closure row is attributed to the calendar');
DELETE FROM public.non_operational_dates WHERE attendance_date = '2026-11-23';
SELECT is((SELECT status FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000761' AND attendance_date = '2026-11-23'),
  'no_checkin',
  'withdrawing the closure makes the operational Monday a duty again');
RESET ROLE;

-- 31-34: the repair itself. These rows are what the defect left behind: a Sunday snapshotted as
-- a missed check-in. The window is 2026-11-01..2026-11-30, so 2026-12-06 must stay untouched.
-- (On a freshly reset database attendance_effective starts empty, which is why the pre-fix rows
-- are inserted here rather than asserted as already present: the migration-time call repairs the
-- production rows, this block proves the function does it correctly.)
SET LOCAL ROLE service_role;
INSERT INTO public.attendance_effective (user_id, attendance_date, status, source_type)
VALUES
  ('00000000-0000-0000-0000-000000000762', '2026-11-15', 'no_checkin', 'attendance_record'),
  ('00000000-0000-0000-0000-000000000762', '2026-12-06', 'no_checkin', 'attendance_record'),
  ('00000000-0000-0000-0000-000000000762', '2026-11-30', 'no_checkin', 'attendance_record');
SELECT is(app.backfill_non_operational_effective(date '2026-11-01', date '2026-11-30'), 1,
  'the backfill repairs exactly the non-operational rows inside the window');
SELECT is((SELECT status || '/' || source_type FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000762' AND attendance_date = '2026-11-15'),
  'non_operational/calendar',
  'the repaired Sunday reads as a calendar closure, the same value the snapshot would produce');
SELECT is(app.backfill_non_operational_effective(date '2026-11-01', date '2026-11-30'), 0,
  'a second run changes nothing, so the backfill is safe to re-apply');
SELECT is((SELECT count(*)::int FROM public.attendance_effective
           WHERE user_id = '00000000-0000-0000-0000-000000000762'
             AND attendance_date IN ('2026-12-06', '2026-11-30') AND status = 'no_checkin'), 2,
  'rows outside the window and rows on an operational day are left alone');
RESET ROLE;

-- 35: none of this opens a write path. non_operational_dates keeps only a SELECT policy, so an
-- authenticated caller still cannot close a day for everyone.
SET LOCAL ROLE authenticated;
SELECT public.temporal_as('00000000-0000-0000-0000-000000000761');
SELECT throws_ok(
  $$INSERT INTO public.non_operational_dates (attendance_date, reason) VALUES ('2027-01-01', 'Ditutup sendiri')$$,
  '42501', NULL,
  'the fix must not widen grants: authenticated still cannot write the closure calendar'
);
RESET ROLE;

-- 36: the repair tool is operator/scheduler-only, like public.refresh_attendance_effective.
SELECT is(has_function_privilege('authenticated', 'public.backfill_non_operational_effective(date, date)', 'EXECUTE'), false,
  'the backfill wrapper is not callable by an authenticated member');

SELECT * FROM finish();
ROLLBACK;
