BEGIN;

SELECT plan(34);

-- SCH-01: a recurring agenda needs a per-day cancellation that the write path can
-- address and the read paths honour. PERMISSIONS.md §3 keeps that decision at the
-- schedule.event.update tier (pengurus/yayasan/super_admin), so the assertions
-- below measure three things: the exception table and its privileges, the manager
-- tier of app.event_occurrence_set(), and the series arithmetic that decides
-- whether a date is an occurrence at all.
--
--   b021 weekly  from CURRENT_DATE+2, no end      (fixture exception on +16)
--   b022 daily   from CURRENT_DATE,     until +10
--   b023 none    (single event, must use the series cancel)
--   b024 weekly  but the whole series already cancelled
--   b025 weekly  but soft-deleted
--   b026 daily   from CURRENT_DATE+30,  until +40  (window probe)

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000b11', 'sch-santri@example.test'),
  ('00000000-0000-0000-0000-000000000b12', 'sch-koordinator@example.test'),
  ('00000000-0000-0000-0000-000000000b13', 'sch-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000b14', 'sch-yayasan@example.test'),
  ('00000000-0000-0000-0000-000000000b15', 'sch-super-admin@example.test'),
  ('00000000-0000-0000-0000-000000000b16', 'sch-suspended-pengurus@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000b11', 'sch-santri@example.test', 'Santri Uji', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000b12', 'sch-koordinator@example.test', 'Koordinator Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000b13', 'sch-pengurus@example.test', 'Pengurus Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000b14', 'sch-yayasan@example.test', 'Yayasan Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000b15', 'sch-super-admin@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  -- b016 keeps a live pengurus grant so the only thing refusing it is the
  -- account-status check inside the RPC.
  ('00000000-0000-0000-0000-000000000b16', 'sch-suspended-pengurus@example.test', 'Pengurus Nonaktif', 'suspended', 'pengurus');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000b11', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000b12', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000b13', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000b14', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000b15', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000b16', (SELECT id FROM public.roles WHERE key = 'pengurus'));

-- starts_at is built through Asia/Jakarta so the WIB calendar date the function
-- derives is exactly the date this test passes as an occurrence.
INSERT INTO public.events (id, title, description, starts_at, ends_at, location, category, status, organizer_id, created_by, recurrence_rule, recurrence_until, deleted_at)
VALUES
  ('00000000-0000-0000-0000-000000000b21', 'Kajian Kitab Weekly', 'Mingguan, tanpa batas akhir.',
   (((CURRENT_DATE + 2)::timestamp + interval '19 hours') AT TIME ZONE 'Asia/Jakarta'),
   (((CURRENT_DATE + 2)::timestamp + interval '20 hours') AT TIME ZONE 'Asia/Jakarta'),
   'Musalla Utama', 'keagamaan', 'scheduled',
   '00000000-0000-0000-0000-000000000b13', '00000000-0000-0000-0000-000000000b13', 'weekly', NULL, NULL),
  ('00000000-0000-0000-0000-000000000b22', 'Setoran Harian', 'Harian sampai sepuluh hari.',
   (((CURRENT_DATE)::timestamp + interval '15 hours') AT TIME ZONE 'Asia/Jakarta'),
   (((CURRENT_DATE)::timestamp + interval '16 hours') AT TIME ZONE 'Asia/Jakarta'),
   'Ruang Taujih', 'keagamaan', 'scheduled',
   '00000000-0000-0000-0000-000000000b13', '00000000-0000-0000-0000-000000000b13', 'daily',
   (((CURRENT_DATE + 10)::timestamp + interval '23 hours') AT TIME ZONE 'Asia/Jakarta'), NULL),
  ('00000000-0000-0000-0000-000000000b23', 'Rapat Koordinasi', 'Sekali jalan.',
   (((CURRENT_DATE + 4)::timestamp + interval '13 hours') AT TIME ZONE 'Asia/Jakarta'),
   (((CURRENT_DATE + 4)::timestamp + interval '14 hours') AT TIME ZONE 'Asia/Jakarta'),
   'Ruang Rapat', 'operasional', 'scheduled',
   '00000000-0000-0000-0000-000000000b13', '00000000-0000-0000-0000-000000000b13', 'none', NULL, NULL),
  ('00000000-0000-0000-0000-000000000b24', 'Libur Panjang', 'Seluruh seri dibatalkan.',
   (((CURRENT_DATE + 6)::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Jakarta'),
   (((CURRENT_DATE + 6)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Jakarta'),
   'Aula', 'umum', 'cancelled',
   '00000000-0000-0000-0000-000000000b13', '00000000-0000-0000-0000-000000000b13', 'weekly', NULL, NULL),
  ('00000000-0000-0000-0000-000000000b25', 'Agenda Terhapus', 'Soft deleted, tidak boleh tersentuh.',
   (((CURRENT_DATE + 8)::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Jakarta'),
   (((CURRENT_DATE + 8)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Jakarta'),
   'Aula', 'umum', 'scheduled',
   '00000000-0000-0000-0000-000000000b13', '00000000-0000-0000-0000-000000000b13', 'weekly', NULL,
   ((CURRENT_DATE - 1)::timestamp AT TIME ZONE 'Asia/Jakarta')),
  ('00000000-0000-0000-0000-000000000b26', 'Ujian Lisan', 'Jendela khusus tiga puluh hari lagi.',
   (((CURRENT_DATE + 30)::timestamp + interval '8 hours') AT TIME ZONE 'Asia/Jakarta'),
   (((CURRENT_DATE + 30)::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Jakarta'),
   'Ruang Ujian', 'umum', 'scheduled',
   '00000000-0000-0000-0000-000000000b13', '00000000-0000-0000-0000-000000000b13', 'daily',
   (((CURRENT_DATE + 40)::timestamp + interval '23 hours') AT TIME ZONE 'Asia/Jakarta'), NULL);

-- One pre-existing exception so the read policies have something to return.
INSERT INTO public.event_occurrence_exceptions (event_id, occurrence_date, cancelled_by, reason)
VALUES ('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 16,
        '00000000-0000-0000-0000-000000000b15', 'Libur nasional.');

-- PostgreSQL has no temporary functions: the switch helper is a plain function
-- inside this rolled-back transaction, dropped again before finish().
CREATE FUNCTION public.schocc_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

-- 1-4: who may read the exception book, and what raw DML may do.
SET LOCAL ROLE authenticated;

SELECT public.schocc_as('00000000-0000-0000-0000-000000000b11');
SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 0,
  'a santri reads no exceptions, only experiences the missing day');

SELECT public.schocc_as('00000000-0000-0000-0000-000000000b13');
SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 1,
  'pengurus reads the exceptions it is allowed to manage (§3 schedule.event.update)');

SELECT public.schocc_as('00000000-0000-0000-0000-000000000b15');
SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 1,
  'super_admin reads them through the same tier, not through rank');

-- the table is unwritable without the RPC.
SELECT throws_ok(
  $$INSERT INTO public.event_occurrence_exceptions (event_id, occurrence_date)
    VALUES ('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 9)$$,
  '42501', NULL,
  'even a manager cannot write an exception row directly');

-- 5-16: the guard and the series arithmetic. Every one of these must refuse
-- without leaving a row behind. The two counting assertions run as pengurus,
-- because under the read policy a santri sees none of these rows at all.
SELECT public.schocc_as('00000000-0000-0000-0000-000000000b13');
SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 1,
  'nothing has been cancelled yet besides the fixture');

SELECT public.schocc_as('00000000-0000-0000-0000-000000000b11');
SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 9)->>'success'), 'false',
  'santri is refused by the occurrence RPC');

SELECT public.schocc_as('00000000-0000-0000-0000-000000000b13');
SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 1,
  'a refused call writes no exception');

SELECT public.schocc_as('00000000-0000-0000-0000-000000000b16');
SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 9)->>'success'), 'false',
  'a suspended account is refused even while its pengurus grant is still live');

SELECT public.schocc_as('00000000-0000-0000-0000-000000000b12');
SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 9)->>'success'), 'false',
  'koordinator is outside the §3 schedule.event.update tier for cancellations');

SELECT public.schocc_as('00000000-0000-0000-0000-000000000b13');
SELECT ok(COALESCE((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 10)->>'message'), '')
          LIKE '%pengulangan mingguan%',
  'a date the weekly rule never produces is refused, not silently accepted');

SELECT ok(COALESCE((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 1)->>'message'), '')
          LIKE '%rentang pengulangan%',
  'a date before the series starts is refused');

SELECT ok(COALESCE((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 200)->>'message'), '')
          LIKE '%rentang pengulangan%',
  'a date past the 180-day horizon the schedule renders is refused');

SELECT ok(COALESCE((public.event_occurrence_set('00000000-0000-0000-0000-000000000b23', CURRENT_DATE + 4)->>'message'), '')
          LIKE '%agenda berulang%',
  'a single event must use the whole-series cancel instead');

SELECT ok(COALESCE((public.event_occurrence_set('00000000-0000-0000-0000-000000000b24', CURRENT_DATE + 6)->>'message'), '')
          LIKE '%sudah dibatalkan%',
  'an already cancelled series is not edited day by day');

SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b25', CURRENT_DATE + 8)->>'success'), 'false',
  'a soft-deleted agenda cannot be given exceptions');

SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 100, true,
        repeat('a', 301))->>'success'), 'false',
  'an over-long reason is refused rather than truncated away');

-- 17-34: the accepted writes, their idempotency and their ledger.
SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 9)->>'success'), 'true',
  'pengurus cancels one Thursday of a weekly series');

SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 2,
  'the exception is recorded for that date alone');

SELECT is(app.is_event_occurrence_cancelled('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 9)::text, 'true',
  'app.is_event_occurrence_cancelled reports the day the schedule must drop');

SELECT is(app.is_event_occurrence_cancelled('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 16)::text, 'true',
  'the predicate also sees the pre-existing exception');

SELECT is(app.is_event_occurrence_cancelled('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 2)::text, 'false',
  'the first occurrence of the series is untouched');

SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 9)->>'success'), 'true',
  'cancelling the same occurrence twice is not an error');

SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 2,
  'and it does not stack a second row for that date');

SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b22', CURRENT_DATE + 5, true, 'Ustadz berhalangan')->>'success'), 'true',
  'a daily series can lose one day inside its recurrence_until');

SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b26', CURRENT_DATE + 41)->>'success'), 'false',
  'a day past recurrence_until is refused even inside the 180-day horizon');

SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b26', CURRENT_DATE + 37)->>'success'), 'true',
  'the same day one step earlier is inside that window');

SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 4,
  'three cancellations plus the fixture row are recorded');

SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 9, false)->>'success'), 'true',
  'a misclick can be undone: the same RPC restores an occurrence');

SELECT is((SELECT count(*)::int FROM public.event_occurrence_exceptions), 3,
  'restoring removes the exception instead of flagging it');

SELECT is((public.event_occurrence_set('00000000-0000-0000-0000-000000000b21', CURRENT_DATE + 2, false)->>'success'), 'true',
  'restoring an occurrence that was never cancelled answers without an error');

SELECT is((SELECT status FROM public.events WHERE id = '00000000-0000-0000-0000-000000000b21'), 'scheduled',
  'a single cancelled occurrence never touches the whole-series status');

-- audit_logs is readable only to yayasan/super_admin (§3.8), so this read is
-- deliberately privileged and runs as the table owner.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE event_name = 'event.occurrence_cancelled'), 3,
  'every accepted cancellation wrote its ledger row');

SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE event_name = 'event.occurrence_restored'), 1,
  'the no-op restore added no ledger row, only the real one did');

SELECT is((SELECT count(*)::int FROM public.audit_logs
           WHERE event_name = 'event.occurrence_cancelled' AND action_detail LIKE '%Ustadz berhalangan%'), 1,
  'the reason travels into audit_logs next to the date');

DROP FUNCTION public.schocc_as(uuid);

SELECT * FROM finish();
ROLLBACK;
