BEGIN;

SELECT plan(18);

-- SCH-09: PERMISSIONS.md §3.6 promises "validasi bentrok lokasi/waktu" for
-- schedule.event.create, and app.event_upsert() does check the location and the
-- interval — but only the two stored base rows. A weekly or daily agenda is one row
-- whose real footprint is up to 180 days of occurrences, so a series can be accepted
-- while its third Tuesday sits on top of another agenda in the same room, and the
-- operator only finds out when the day arrives.
--
-- After the fix both sides of the comparison are expanded over the horizon the
-- schedule surface itself renders, and the overlap rule still runs inside the one
-- transaction that writes the row.
--
--   981 pengurus (active)
--   990 weekly  'Aula Serbaguna'  2027-01-05 08:00-09:00Z  until 2027-04-01  (Tuesday)
--   991 weekly  'Lapangan Utara'  2027-01-06 07:00-08:00Z  open-ended       (Wednesday)
--   992 daily   'Serambi Barat'   2027-01-01 10:00-11:00Z  until 2027-01-31
--   993 one-off 'Ruang Timur'     2027-03-10 08:00-09:00Z  status cancelled
--   994 one-off 'Ruang Tengah'    2027-03-12 08:00-09:00Z  deleted_at set
--   995 one-off 'Aula Serbaguna'  2027-03-15 08:00-09:00Z  (Monday)
--   996 one-off 'Aula Barat'      2027-05-01 09:00-10:00Z
--   997 one-off 'Serambi Utara'   2028-02-09 07:30-08:30Z  (57 weeks after 991's base)
--
-- Disposable fixtures inside one rolled-back transaction; local/CI only.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT '00000000-0000-0000-0000-000000000981'::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'sch89-pengurus@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now();

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES ('00000000-0000-0000-0000-000000000981', 'sch89-pengurus@example.test', 'Pengurus Agenda Uji', 'active', 'pengurus');

INSERT INTO public.user_roles (user_id, role_id)
VALUES ('00000000-0000-0000-0000-000000000981', (SELECT id FROM public.roles WHERE key = 'pengurus'));

INSERT INTO public.events
  (id, title, description, starts_at, ends_at, location, category, status, team_id,
   audience_config, recurrence_rule, recurrence_until, organizer_id, created_by, deleted_at)
VALUES
  ('00000000-0000-0000-0000-000000000990', 'Kajian Rutin Selasa', 'Seri mingguan di aula.',
   '2027-01-05 08:00:00+00', '2027-01-05 09:00:00+00', 'Aula Serbaguna', 'keagamaan', 'scheduled', NULL,
   '{"scope":"all"}'::jsonb, 'weekly', '2027-04-01 09:00:00+00',
   '00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000981', NULL),
  ('00000000-0000-0000-0000-000000000991', 'Kajian Rutin Rabu', 'Seri mingguan tanpa tanggal akhir.',
   '2027-01-06 07:00:00+00', '2027-01-06 08:00:00+00', 'Lapangan Utara', 'keagamaan', 'scheduled', NULL,
   '{"scope":"all"}'::jsonb, 'weekly', NULL,
   '00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000981', NULL),
  ('00000000-0000-0000-0000-000000000992', 'Setoran Harian', 'Seri harian pagi.',
   '2027-01-01 10:00:00+00', '2027-01-01 11:00:00+00', 'Serambi Barat', 'keagamaan', 'scheduled', NULL,
   '{"scope":"all"}'::jsonb, 'daily', '2027-01-31 11:00:00+00',
   '00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000981', NULL),
  ('00000000-0000-0000-0000-000000000993', 'Rapat Libur', 'Sudah dibatalkan seluruhnya.',
   '2027-03-10 08:00:00+00', '2027-03-10 09:00:00+00', 'Ruang Timur', 'operasional', 'cancelled', NULL,
   '{"scope":"all"}'::jsonb, 'none', NULL,
   '00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000981', NULL),
  ('00000000-0000-0000-0000-000000000994', 'Agenda Arsip', 'Soft deleted.',
   '2027-03-12 08:00:00+00', '2027-03-12 09:00:00+00', 'Ruang Tengah', 'operasional', 'scheduled', NULL,
   '{"scope":"all"}'::jsonb, 'none', NULL,
   '00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000981', '2027-03-13 08:00:00+00'),
  ('00000000-0000-0000-0000-000000000995', 'Tadarus Khusus', 'One-off di aula yang sama.',
   '2027-03-15 08:00:00+00', '2027-03-15 09:00:00+00', 'Aula Serbaguna', 'keagamaan', 'scheduled', NULL,
   '{"scope":"all"}'::jsonb, 'none', NULL,
   '00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000981', NULL),
  ('00000000-0000-0000-0000-000000000996', 'Rapat Pengurus', 'Satu sesi saja.',
   '2027-05-01 09:00:00+00', '2027-05-01 10:00:00+00', 'Aula Barat', 'operasional', 'scheduled', NULL,
   '{"scope":"all"}'::jsonb, 'none', NULL,
   '00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000981', NULL),
  ('00000000-0000-0000-0000-000000000997', 'Kajian Jelang 2028', 'Jauh di luar horizon daftar.',
   '2028-02-09 07:30:00+00', '2028-02-09 08:30:00+00', 'Serambi Utara', 'keagamaan', 'scheduled', NULL,
   '{"scope":"all"}'::jsonb, 'none', NULL,
   '00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000981', NULL);

-- PostgreSQL has no temporary functions: this identity switcher lives only inside the
-- rolled-back transaction and is dropped again before finish().
CREATE FUNCTION public.sch89_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

-- 1-4: the recurrence arithmetic lives in the database, next to the rule it serves.
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'event_occurrence_spans'),
  'app.event_occurrence_spans() turns one recurring row into the days it actually occupies');
SELECT is((SELECT p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'event_occurrence_spans'), 's',
  'the occurrence expander is STABLE so the overlap query can call it per candidate row');
SELECT ok((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=%'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'event_occurrence_spans'),
  'the occurrence expander pins its search_path');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'event_slot_taken'),
  'app.event_slot_taken() owns the overlap question the agenda writer asks');

SET LOCAL ROLE authenticated;
SELECT public.sch89_as('00000000-0000-0000-0000-000000000981');

-- 5: the rule that already works must keep working (both base windows are on 2027-01-05).
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Rapat Darurat', 'starts_at', '2027-01-05T15:30', 'ends_at', '2027-01-05T16:30',
    'location', 'Aula Serbaguna', 'category', 'operasional'), NULL)->>'message'),
  'Bentrok: sudah ada agenda di lokasi dan waktu tersebut.',
  'an agenda on top of a series'' first occurrence is still refused');

-- 6: SCH-09 core — 990 occupies 2027-02-16 (42 days after its base), but its stored
-- interval only covers January.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Rapat Enam Minggu Kemudian', 'starts_at', '2027-02-16T15:30', 'ends_at', '2027-02-16T16:30',
    'location', 'Aula Serbaguna', 'category', 'operasional'), NULL)->>'message'),
  'Bentrok: sudah ada agenda di lokasi dan waktu tersebut.',
  'a one-off colliding with a later weekly occurrence of another series is refused');

-- 7: the same for a daily series, which repeats every day until 2027-01-31.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Ujian Setoran', 'starts_at', '2027-01-20T17:30', 'ends_at', '2027-01-20T18:30',
    'location', 'Serambi Barat', 'category', 'keagamaan'), NULL)->>'message'),
  'Bentrok: sudah ada agenda di lokasi dan waktu tersebut.',
  'a one-off colliding with day 20 of a daily series is refused');

-- 8: the day between two weekly occurrences is genuinely free.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Rapat Hari Berikutnya', 'starts_at', '2027-02-17T15:30', 'ends_at', '2027-02-17T16:30',
    'location', 'Aula Serbaguna', 'category', 'operasional'), NULL)->>'success'), 'true',
  'the day between two weekly occurrences stays bookable');

-- 9: 990 stops repeating on 2027-04-01, so the same weekday four weeks later is free.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Rapat Setelah Seri Berakhir', 'starts_at', '2027-04-13T15:30', 'ends_at', '2027-04-13T16:30',
    'location', 'Aula Serbaguna', 'category', 'operasional'), NULL)->>'success'), 'true',
  'recurrence_until caps how far a series blocks a room');

-- 10: another room at the same instant is not a conflict.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Rapat di Musala', 'starts_at', '2027-02-16T15:30', 'ends_at', '2027-02-16T16:30',
    'location', 'Musala Kecil', 'category', 'operasional'), NULL)->>'success'), 'true',
  'the overlap rule stays scoped to the location');

-- 11-12: only a live agenda reserves a slot.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Ruang Timur Dipakai', 'starts_at', '2027-03-10T15:30', 'ends_at', '2027-03-10T16:30',
    'location', 'Ruang Timur', 'category', 'operasional'), NULL)->>'success'), 'true',
  'a fully cancelled agenda does not block its room');
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Ruang Tengah Dipakai', 'starts_at', '2027-03-12T15:30', 'ends_at', '2027-03-12T16:30',
    'location', 'Ruang Tengah', 'category', 'operasional'), NULL)->>'success'), 'true',
  'a soft-deleted agenda does not block its room');

-- 13: editing a series must not collide with its own other days.
SELECT is((public.event_upsert('00000000-0000-0000-0000-000000000990', jsonb_build_object(
    'title', 'Kajian Rutin Selasa (durasi dipangkas)', 'starts_at', '2027-01-05T15:30',
    'ends_at', '2027-01-05T16:15', 'location', 'Aula Serbaguna', 'category', 'keagamaan',
    'recurrence_rule', 'weekly', 'recurrence_until', '2027-04-01T16:00'), NULL)->>'success'), 'true',
  'editing a recurring agenda does not collide with itself');

-- 14: back-to-back is allowed, only real overlap is not.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Sebelum Rapat Pengurus', 'starts_at', '2027-05-01T15:00', 'ends_at', '2027-05-01T16:00',
    'location', 'Aula Barat', 'category', 'operasional'), NULL)->>'success'), 'true',
  'an agenda that ends exactly when the next one starts is not a conflict');

-- 15: the existing series is expanded over the window it is asked about rather than
-- truncated to the incoming row's horizon. 2027-07-28 is 203 days = 29 weeks after 991.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Laga Uji Lapangan', 'starts_at', '2027-07-28T14:30', 'ends_at', '2027-07-28T15:30',
    'location', 'Lapangan Utara', 'category', 'operasional'), NULL)->>'message'),
  'Bentrok: sudah ada agenda di lokasi dan waktu tersebut.',
  'a one-off far into an open-ended weekly series is still refused');

-- 16: the incoming side stops at the same 180 days the schedule list renders, which is
-- the reported boundary of this fix.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Seri Menuju 2028', 'starts_at', '2027-01-06T14:00', 'ends_at', '2027-01-06T15:00',
    'location', 'Serambi Utara', 'category', 'keagamaan', 'recurrence_rule', 'weekly'), NULL)->>'success'), 'true',
  'conflict validation for an open-ended series covers the 180 days the schedule shows');

-- 17: the incoming row has to be expanded too; 995 sits on the third Monday of this
-- new series, not on its base day.
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Seri Tadarus Senin', 'starts_at', '2027-03-01T15:00', 'ends_at', '2027-03-01T16:00',
    'location', 'Aula Serbaguna', 'category', 'keagamaan', 'recurrence_rule', 'weekly',
    'recurrence_until', '2027-06-30T16:00'), NULL)->>'message'),
  'Bentrok: sudah ada agenda di lokasi dan waktu tersebut.',
  'creating a weekly series that lands on an existing one-off is refused');

-- 18: a day freed by SCH-01 keeps its reservation, because app.event_occurrence_set()
-- can restore that very day and the room would then be double-booked.
RESET ROLE;
INSERT INTO public.event_occurrence_exceptions (event_id, occurrence_date, cancelled_by, reason)
VALUES ('00000000-0000-0000-0000-000000000990', '2027-02-16',
        '00000000-0000-0000-0000-000000000981', 'Libur lokal');
SET LOCAL ROLE authenticated;
SELECT is((public.event_upsert(NULL, jsonb_build_object(
    'title', 'Rapat Hari Yang Dibatalkan', 'starts_at', '2027-02-16T15:30', 'ends_at', '2027-02-16T16:30',
    'location', 'Aula Serbaguna', 'category', 'operasional'), NULL)->>'message'),
  'Bentrok: sudah ada agenda di lokasi dan waktu tersebut.',
  'a per-occurrence cancellation does not hand the room slot to another agenda');

RESET ROLE;
DROP FUNCTION public.sch89_as(uuid);

SELECT * FROM finish();

ROLLBACK;
