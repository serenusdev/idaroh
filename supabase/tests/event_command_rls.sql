BEGIN;

SELECT plan(35);

-- SCH-02: PERMISSIONS.md §3.6 promises "DB Constraint: Koordinator dilarang
-- membuat/mengubah agenda dengan audience = 'all'". No such constraint exists —
-- the only policies on events are FOR SELECT, every event write is a service-role
-- write from the application, and app.can_view_audience (the read helper) is not a
-- write check. So the promise is unenforceable today, and the audience the admin
-- form writes is filtered by profiles.member_type, which §2 rule 1 forbids.
--
-- After this migration the event commands run on the caller's own session, one
-- helper decides which audience a role tier may write, a trigger refuses an
-- out-of-tier audience for any session write, and the WIB wall-clock the operator
-- typed is resolved by the database instead of the server's timezone.
--
--   961 santri               962 koordinator of team 950
--   963 pengurus              964 yayasan
--   965 super_admin           966 koordinator of team 951
--   967 pengurus on a pending account
--   950 Tim SCH A (active)    951 Tim SCH B (active)
--   970 all-audience event    971 team-950 event   972 weekly team-950 series
--
-- Disposable fixtures inside one rolled-back transaction; local/CI only.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000961', 'sch2-santri@example.test'),
  ('00000000-0000-0000-0000-000000000962', 'sch2-koord-a@example.test'),
  ('00000000-0000-0000-0000-000000000963', 'sch2-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000964', 'sch2-yayasan@example.test'),
  ('00000000-0000-0000-0000-000000000965', 'sch2-super-admin@example.test'),
  ('00000000-0000-0000-0000-000000000966', 'sch2-koord-b@example.test'),
  ('00000000-0000-0000-0000-000000000967', 'sch2-pending-pengurus@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000961', 'sch2-santri@example.test', 'Santri Undangan', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000962', 'sch2-koord-a@example.test', 'Koordinator Tim A', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000963', 'sch2-pengurus@example.test', 'Pengurus Pusat', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000964', 'sch2-yayasan@example.test', 'Yayasan Pengawas', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000965', 'sch2-super-admin@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000966', 'sch2-koord-b@example.test', 'Koordinator Tim B', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000967', 'sch2-pending-pengurus@example.test', 'Pengurus Menunggu', 'pending', 'pengurus');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000961', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000962', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000963', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000964', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000965', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000966', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000967', (SELECT id FROM public.roles WHERE key = 'pengurus'));

INSERT INTO public.teams (id, name, slug, status, archived_at)
VALUES
  ('00000000-0000-0000-0000-000000000950', 'Tim SCH A', 'sch-a', 'active', NULL),
  ('00000000-0000-0000-0000-000000000951', 'Tim SCH B', 'sch-b', 'active', NULL);

INSERT INTO public.team_members (team_id, user_id, team_role)
VALUES
  ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000962', 'coordinator'),
  ('00000000-0000-0000-0000-000000000951', '00000000-0000-0000-0000-000000000966', 'coordinator');

INSERT INTO public.events
  (id, title, description, starts_at, ends_at, location, category, status, team_id,
   audience_config, recurrence_rule, recurrence_until, organizer_id, created_by)
VALUES
  ('00000000-0000-0000-0000-000000000970', 'Rapim Pengurus', 'Agenda seluruh pondok.',
   '2027-01-10 03:00:00+00', '2027-01-10 04:00:00+00', 'Aula Utama', 'operasional', 'scheduled', NULL,
   '{"scope":"all"}'::jsonb, 'none', NULL,
   '00000000-0000-0000-0000-000000000963', '00000000-0000-0000-0000-000000000963'),
  ('00000000-0000-0000-0000-000000000971', 'Rapat Tim A', 'Hanya tim A.',
   '2027-02-01 06:00:00+00', '2027-02-01 07:00:00+00', 'Musala Kecil', 'teknologi', 'scheduled',
   '00000000-0000-0000-0000-000000000950',
   '{"scope":"team","teamIds":["00000000-0000-0000-0000-000000000950"]}'::jsonb, 'none', NULL,
   '00000000-0000-0000-0000-000000000962', '00000000-0000-0000-0000-000000000962'),
  ('00000000-0000-0000-0000-000000000972', 'Kajian Mingguan Tim A', 'Seri mingguan.',
   '2027-01-05 08:00:00+00', '2027-01-05 09:00:00+00', 'Serambi Timur', 'keagamaan', 'scheduled',
   '00000000-0000-0000-0000-000000000950',
   '{"scope":"team","teamIds":["00000000-0000-0000-0000-000000000950"]}'::jsonb, 'weekly',
   '2027-04-01 00:00:00+00',
   '00000000-0000-0000-0000-000000000962', '00000000-0000-0000-0000-000000000962');

-- PostgreSQL has no temporary functions: this identity switcher lives only
-- inside the rolled-back transaction and is dropped again before finish().
CREATE FUNCTION public.sch2_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

-- 1-5: the command surface exists and follows the RPC checklist.
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'event_upsert'),
  'app.event_upsert exists as the single create/update path for an agenda');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'event_cancel'),
  'app.event_cancel exists so cancel and delete keep their ledger row');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'can_write_event_audience'),
  'one helper decides which audience a role tier may write');
SELECT ok((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'event_upsert'),
  'app.event_upsert is SECURITY DEFINER');
SELECT ok((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=%'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'event_upsert'),
  'app.event_upsert pins its search_path');

-- 6: the §3.6 constraint is a real database object, not a comment.
SELECT ok((SELECT count(*)::int FROM pg_trigger tg
           JOIN pg_class c ON c.oid = tg.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_proc p ON p.oid = tg.tgfoid
           JOIN pg_namespace fn ON fn.oid = p.pronamespace
           WHERE n.nspname = 'public' AND c.relname = 'events'
             AND NOT tg.tgisinternal AND (tg.tgtype::int & 2) = 2
             AND fn.nspname = 'app' AND p.proname = 'enforce_event_audience_scope'), 1,
  'a BEFORE trigger enforces the audience tier on the events table itself');

-- 7-9: a tier outside §3.6, and a role grant on a pending account.
SET LOCAL ROLE authenticated;
SELECT public.sch2_as('00000000-0000-0000-0000-000000000961');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Percobaan Santri', 'starts_at', '2027-05-01T08:00',
                            'ends_at', '2027-05-01T09:00', 'location', 'Aula Utama'),
         NULL)->>'message'), 'Anda tidak memiliki izin mengelola agenda.',
  'a santri cannot author an agenda');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.events WHERE title = 'Percobaan Santri'), 0,
  'the refused write left no agenda row');
SET LOCAL ROLE authenticated;
SELECT public.sch2_as('00000000-0000-0000-0000-000000000967');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Percobaan Tertunda', 'starts_at', '2027-05-01T08:00',
                            'ends_at', '2027-05-01T09:00', 'location', 'Aula Utama'),
         NULL)->>'message'), 'Sesi tidak valid atau akun tidak aktif.',
  'a pengurus on a pending account is refused before any role check');

-- 10-14: a coordinator may author for its own team, and the wall-clock it typed is
-- read as Asia/Jakarta rather than as the server timezone.
SELECT public.sch2_as('00000000-0000-0000-0000-000000000962');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Sidak Kamar Tim A', 'description', 'Patroli tim.',
                            'starts_at', '2027-03-04T08:00', 'ends_at', '2027-03-04T09:30',
                            'location', 'Asrama Baitullah', 'category', 'operasional',
                            'audience', jsonb_build_object('scope', 'team', 'teamIds',
                              ARRAY['00000000-0000-0000-0000-000000000950'])),
         'Patroli malam')->>'success'), 'true',
  'a coordinator can save an agenda addressed to its own team');
RESET ROLE;
SELECT is((SELECT created_by = organizer_id
             AND created_by = '00000000-0000-0000-0000-000000000962'
           FROM public.events WHERE title = 'Sidak Kamar Tim A'), true,
  'the stored row names the acting coordinator, not the service role');
SELECT is((SELECT audience_config->>'scope' || '/' ||
                  (jsonb_array_length(audience_config->'teamIds'))::text
           FROM public.events WHERE title = 'Sidak Kamar Tim A'), 'team/1',
  'the saved audience stays a single-team audience');
SELECT is((SELECT to_char(starts_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI')
             || ' > ' ||
             to_char(ends_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI')
           FROM public.events WHERE title = 'Sidak Kamar Tim A'),
  '2027-03-04 08:00 > 2027-03-04 09:30',
  'the naive wall-clock is resolved in WIB no matter the session timezone');
SELECT is((SELECT count(*)::int FROM public.audit_logs
           WHERE event_name = 'event.created'
             AND actor_id = '00000000-0000-0000-0000-000000000962'
             AND target_id = (SELECT id::text FROM public.events
                              WHERE title = 'Sidak Kamar Tim A')), 1,
  'the agenda write is audited once, in its own transaction');

-- 15-19: the audience refusals §3.6 promises, and no residue from them.
SET LOCAL ROLE authenticated;
SELECT public.sch2_as('00000000-0000-0000-0000-000000000962');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Laporan Tahunan', 'starts_at', '2027-06-01T08:00',
                            'ends_at', '2027-06-01T09:00', 'location', 'Aula Utama',
                            'audience', '{"scope":"all"}'::jsonb),
         NULL)->>'message'), 'Koordinator hanya dapat menandai agenda untuk timnya sendiri.',
  'a coordinator cannot address the whole pondok');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Rapat Tim B', 'starts_at', '2027-06-02T08:00',
                            'ends_at', '2027-06-02T09:00', 'location', 'Aula Utama',
                            'audience', jsonb_build_object('scope', 'team', 'teamIds',
                              ARRAY['00000000-0000-0000-0000-000000000951'])),
         NULL)->>'message'), 'Koordinator hanya dapat menandai agenda untuk timnya sendiri.',
  'a coordinator cannot address another team');
-- The trigger has to hold on its own, not only inside the RPC. RLS still denies
-- an authenticated UPDATE on events, so the write is issued as the table owner
-- while the session identity stays the coordinator's.
RESET ROLE;
SELECT throws_ok($$
  UPDATE public.events
     SET audience_config = '{"scope":"all"}'::jsonb
   WHERE id = '00000000-0000-0000-0000-000000000971'$$,
  '42501', 'Audiens agenda di luar izin peran Anda (PERMISSIONS.md §3.6).',
  'the trigger, not only the RPC, refuses a coordinator widening its audience');
SET LOCAL ROLE authenticated;
SELECT public.sch2_as('00000000-0000-0000-0000-000000000963');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Untuk Santri Saja', 'starts_at', '2027-06-03T08:00',
                            'ends_at', '2027-06-03T09:00', 'location', 'Aula Utama',
                            'audience', '{"scope":"member_type","memberTypes":["santri"]}'::jsonb),
         NULL)->>'message'),
  'Audiens berbasis kategori anggota tidak diizinkan; pilih tim atau seluruh pondok.',
  'no tier may write a member_type audience, because §2 rule 1 forbids the filter');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.events
           WHERE title IN ('Laporan Tahunan', 'Rapat Tim B', 'Untuk Santri Saja')), 0,
  'none of the refused audiences reached the table');

-- 20-25: the manager tier keeps its wider audience, and the validations the
-- service-role path performed in JavaScript run before anything is written.
SET LOCAL ROLE authenticated;
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Wisuda Tahfidz', 'description', 'Seluruh pondok.',
                            'starts_at', '2027-07-01T13:00', 'ends_at', '2027-07-01T15:00',
                            'location', 'Lapangan Utama', 'category', 'keagamaan',
                            'audience', '{"scope":"all"}'::jsonb),
         'Undangan wali santri')->>'success'), 'true',
  'pengurus can address the whole pondok');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Kategori Asing', 'starts_at', '2027-07-02T08:00',
                            'ends_at', '2027-07-02T09:00', 'location', 'Aula Utama',
                            'category', 'libur'),
         NULL)->>'message'), 'Kategori agenda tidak dikenali.',
  'an unknown agenda category is refused by name');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Waktu Terbalik', 'starts_at', '2027-07-03T10:00',
                            'ends_at', '2027-07-03T09:00', 'location', 'Aula Utama'),
         NULL)->>'message'), 'Rentang waktu agenda tidak valid.',
  'an inverted time range is refused before the table check can fire');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', repeat('x', 161), 'starts_at', '2027-07-04T08:00',
                            'ends_at', '2027-07-04T09:00', 'location', 'Aula Utama'),
         NULL)->>'message'), 'Judul, deskripsi, atau lokasi melebihi batas yang diizinkan.',
  'an over-long title is refused instead of reaching the column');
SELECT is((public.event_upsert(NULL,
         jsonb_build_object('title', 'Tumpang Tindih', 'starts_at', '2027-01-10T09:30',
                            'ends_at', '2027-01-10T10:30', 'location', 'Aula Utama'),
         NULL)->>'message'), 'Bentrok: sudah ada agenda di lokasi dan waktu tersebut.',
  'the conflict rule is checked in the same transaction as the write');
SELECT is((public.event_upsert('00000000-0000-0000-0000-000000000999',
         jsonb_build_object('title', 'Entitas', 'starts_at', '2027-07-05T08:00',
                            'ends_at', '2027-07-05T09:00', 'location', 'Aula Utama'),
         NULL)->>'message'), 'Agenda tidak ditemukan.',
  'an unknown agenda id cannot be silently turned into a new row');

-- 26-30: an edit is one transaction that keeps the previous row as a revision.
SELECT public.sch2_as('00000000-0000-0000-0000-000000000962');
SELECT is((public.event_upsert('00000000-0000-0000-0000-000000000970',
         jsonb_build_object('title', 'Direkayasa', 'starts_at', '2027-08-01T08:00',
                            'ends_at', '2027-08-01T09:00', 'location', 'Aula Utama'),
         NULL)->>'message'), 'Agenda ini berada di luar tim Anda.',
  'a coordinator cannot edit an agenda addressed outside its teams');
SELECT is((public.event_upsert('00000000-0000-0000-0000-000000000971',
         jsonb_build_object('title', 'Rapat Tim A Ditunda', 'description', 'Pindah jadwal.',
                            'starts_at', '2027-02-01T14:00', 'ends_at', '2027-02-01T15:00',
                            'location', 'Musala Kecil', 'category', 'teknologi'),
         'Revisi jadwal tim')->>'revision_no'), '1',
  'the first edit appends revision 1 under a row lock');
RESET ROLE;
SELECT is((SELECT snapshot->>'title' FROM public.event_revisions er
           JOIN public.events e ON e.id = er.event_id
           WHERE e.title = 'Rapat Tim A Ditunda' AND er.revision_no = 1),
  'Rapat Tim A',
  'revision 1 still describes the row that was replaced');
SET LOCAL ROLE authenticated;
SELECT is((public.event_upsert('00000000-0000-0000-0000-000000000971',
         jsonb_build_object('title', 'Rapat Tim A Ditunda', 'description', 'Pindah ruang.',
                            'starts_at', '2027-02-01T15:00', 'ends_at', '2027-02-01T16:00',
                            'location', 'Ruang Serbaguna', 'category', 'teknologi'),
         NULL)->>'revision_no'), '2',
  'the second edit appends revision 2 instead of racing the first');
RESET ROLE;
SELECT is((SELECT audience_config->>'scope'
           FROM public.events WHERE id = '00000000-0000-0000-0000-000000000971'), 'team',
  'an edit that omits the audience keeps the stored audience instead of defaulting to all');

-- 31-35: cancel and delete both carry their actor, which the old delete path lost.
SET LOCAL ROLE authenticated;
SELECT is((public.event_cancel('00000000-0000-0000-0000-000000000971', 'cancelled',
        'Pembicara berhalangan')->>'success'), 'true',
  'a coordinator can cancel an agenda of its own team');
SELECT is((public.event_cancel('00000000-0000-0000-0000-000000000971', 'cancelled',
        'Dua kali')->>'message'), 'Agenda seluruhnya sudah dibatalkan.',
  'an already cancelled agenda is refused instead of re-audited');
SELECT public.sch2_as('00000000-0000-0000-0000-000000000966');
SELECT is((public.event_cancel('00000000-0000-0000-0000-000000000972', 'cancelled',
        'Ambil alih tim lain')->>'success'), 'false',
  'a coordinator of another team cannot cancel this series');
SELECT public.sch2_as('00000000-0000-0000-0000-000000000963');
SELECT is((public.event_cancel('00000000-0000-0000-0000-000000000972', 'deleted',
        NULL)->>'success'), 'true',
  'pengurus can delete a team agenda through the same command');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_logs
           WHERE event_name = 'event.deleted'
             AND target_id = '00000000-0000-0000-0000-000000000972'
             AND actor_id = '00000000-0000-0000-0000-000000000963'), 1,
  'the delete ledger row carries its actor, which the service-role path omitted');

DROP FUNCTION IF EXISTS public.sch2_as(uuid);

SELECT * FROM finish();

ROLLBACK;
