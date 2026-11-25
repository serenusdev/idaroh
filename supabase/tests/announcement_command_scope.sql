BEGIN;

SELECT plan(37);

-- ANN: PERMISSIONS.md §3.6 promises announcement.create/publish and announcement.archive at
-- scope `team` for a koordinator and `all` for pengurus/yayasan, filtered for readers by the
-- active audience. What exists today is one FOR SELECT policy (20261102000005:314) and no write
-- policy at all, while src/modules/schedules/actions.ts writes every announcement with the
-- service-role client — so auth.uid() is NULL inside the database, the audience the form picks
-- (member_type, derived from profiles.member_type) is never judged, deleteAnnouncementAction
-- archives any row by id without a scope check and without an actor_id, and the revision number
-- is counted before it is inserted, so two concurrent edits both claim 1.
--
-- After this migration:
--   * app.announcement_upsert() / app.announcement_archive() are the only writers, running on
--     the caller's session, locking the row, allocating the revision number in the same
--     statement and writing audit_logs (with actor_id) in the same transaction;
--   * app.can_write_announcement_audience() answers "may this session address an announcement
--     this way" and trg_announcements_audience_scope enforces it on the table, mirroring SCH-02
--     for agendas; member_type is refused for every tier (§2 rule 1);
--   * the naive wall-clock from <input type="datetime-local"> is resolved in Asia/Jakarta by
--     the database (§2 rule 5), and an edit that cannot express the stored audience inherits it
--     rather than widening to `all` (SCH-07 parity);
--   * authenticated keeps no direct write path: the table is INSERT/UPDATE/DELETE-revoked and
--     still has no write policy, so only these RPCs can write.
--
--   981 santri (member of Tim ANN A)   982 koordinator Tim ANN A (975)
--   983 pengurus                       984 yayasan
--   985 super_admin                    986 koordinator Tim ANN B (976)
--   987 pengurus on a pending account
--   990 published, scope all           991 draft, team 975
--   992 archived, team 975             993 published with a historical member_type audience
--
-- Disposable fixtures inside one rolled-back transaction; local/CI only.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000981', 'ann-santri@example.test'),
  ('00000000-0000-0000-0000-000000000982', 'ann-koord-a@example.test'),
  ('00000000-0000-0000-0000-000000000983', 'ann-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000984', 'ann-yayasan@example.test'),
  ('00000000-0000-0000-0000-000000000985', 'ann-super-admin@example.test'),
  ('00000000-0000-0000-0000-000000000986', 'ann-koord-b@example.test'),
  ('00000000-0000-0000-0000-000000000987', 'ann-pending-pengurus@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000981', 'ann-santri@example.test', 'Santri Penerima', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000982', 'ann-koord-a@example.test', 'Koordinator Tim A', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000983', 'ann-pengurus@example.test', 'Pengurus Pusat', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000984', 'ann-yayasan@example.test', 'Yayasan Pengawas', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000985', 'ann-super-admin@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000986', 'ann-koord-b@example.test', 'Koordinator Tim B', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000987', 'ann-pending-pengurus@example.test', 'Pengurus Menunggu', 'pending', 'pengurus');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000981', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000982', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000983', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000984', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000985', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000986', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000987', (SELECT id FROM public.roles WHERE key = 'pengurus'));

INSERT INTO public.teams (id, name, slug, status, archived_at)
VALUES
  ('00000000-0000-0000-0000-000000000975', 'Tim ANN A', 'ann-a', 'active', NULL),
  ('00000000-0000-0000-0000-000000000976', 'Tim ANN B', 'ann-b', 'active', NULL);

INSERT INTO public.team_members (team_id, user_id, team_role)
VALUES
  ('00000000-0000-0000-0000-000000000975', '00000000-0000-0000-0000-000000000982', 'coordinator'),
  ('00000000-0000-0000-0000-000000000975', '00000000-0000-0000-0000-000000000981', 'member'),
  ('00000000-0000-0000-0000-000000000976', '00000000-0000-0000-0000-000000000986', 'coordinator');

INSERT INTO public.announcements
  (id, title, body_markdown, priority, status, published_at, expires_at, pinned, author_id,
   team_id, target_audience_label, audience_config)
VALUES
  ('00000000-0000-0000-0000-000000000990', 'Libur Nasional', 'Seluruh pondok diliburkan.',
   'important', 'published', '2026-11-01T02:00:00+00', NULL, true,
   '00000000-0000-0000-0000-000000000983', NULL, 'Semua Santri & Tim', '{"scope":"all"}'::jsonb),
  ('00000000-0000-0000-0000-000000000991', 'Draf Evaluasi Tim A', 'Belum terbit.',
   'normal', 'draft', NULL, NULL, false,
   '00000000-0000-0000-0000-000000000982', '00000000-0000-0000-0000-000000000975', 'Tim ANN A',
   '{"scope":"team","teamIds":["00000000-0000-0000-0000-000000000975"]}'::jsonb),
  ('00000000-0000-0000-0000-000000000992', 'Arsip Tim A', 'Sudah selesai.',
   'normal', 'archived', '2026-10-01T02:00:00+00', NULL, false,
   '00000000-0000-0000-0000-000000000983', '00000000-0000-0000-0000-000000000975', 'Tim ANN A',
   '{"scope":"team","teamIds":["00000000-0000-0000-0000-000000000975"]}'::jsonb),
  ('00000000-0000-0000-0000-000000000993', 'Pengumuman Kategori Lama', 'Ditulis sebelum §2 aturan 1.',
   'normal', 'published', '2026-11-02T02:00:00+00', NULL, false,
   '00000000-0000-0000-0000-000000000983', NULL, 'Santri saja',
   '{"scope":"member_type","memberTypes":["santri"]}'::jsonb);

-- PostgreSQL has no temporary functions: this identity switcher lives only inside the
-- rolled-back transaction.
CREATE FUNCTION public.ann_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

-- 1-5: the command surface exists and follows the RPC checklist (§2: SECURITY DEFINER with a
-- locked search_path that includes pg_temp, plus one helper that owns the audience answer).
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'announcement_upsert'),
  'app.announcement_upsert exists as the single create/update path for an announcement');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'announcement_archive'),
  'app.announcement_archive exists so archiving keeps its scope check and its actor');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'can_write_announcement_audience'),
  'one helper decides which audience a role tier may write for an announcement');
SELECT ok((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'announcement_upsert'),
  'app.announcement_upsert is SECURITY DEFINER');
SELECT ok((SELECT array_to_string(p.proconfig, ',') LIKE '%pg_temp%'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'announcement_upsert'),
  'app.announcement_upsert locks its search_path including pg_temp');

-- 6: §3.6 becomes a constraint on the table, not only a branch inside one RPC.
SELECT is((SELECT count(*)::int FROM pg_trigger tg
           JOIN pg_class c ON c.oid = tg.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_proc p ON p.oid = tg.tgfoid
           JOIN pg_namespace fn ON fn.oid = p.pronamespace
           WHERE n.nspname = 'public' AND c.relname = 'announcements'
             AND NOT tg.tgisinternal AND (tg.tgtype::int & 2) = 2
             AND fn.nspname = 'app' AND p.proname = 'enforce_announcement_audience_scope'), 1,
  'a BEFORE trigger enforces the audience tier on the announcements table itself');

-- 7-8: the fix must not widen grants. No write policy plus the revoked direct path means an
-- authenticated session reaches the table only through the RPCs.
SET LOCAL ROLE authenticated;
SELECT public.ann_as('00000000-0000-0000-0000-000000000983');
SELECT throws_ok(
  $$INSERT INTO public.announcements (title, body_markdown, author_id)
     VALUES ('Ditulis sendiri', 'Tanpa RPC', '00000000-0000-0000-0000-000000000983')$$,
  '42501', NULL, 'an authenticated session still cannot insert an announcement directly');
SELECT throws_ok(
  $$UPDATE public.announcements SET title = 'Diubah sendiri'
     WHERE id = '00000000-0000-0000-0000-000000000990'$$,
  '42501', NULL, 'an authenticated session still cannot edit an announcement directly');

-- 9-11: the role tier and the account state are judged before anything is written.
SELECT public.ann_as('00000000-0000-0000-0000-000000000981');
SELECT is((public.announcement_upsert(NULL,
         jsonb_build_object('title', 'Percobaan Santri', 'body_markdown', 'Isi',
                            'status', 'draft'), NULL)->>'message'),
  'Anda tidak memiliki izin mengelola pengumuman.',
  'a santri cannot author an announcement');
SELECT is((SELECT count(*)::int FROM public.announcements WHERE title = 'Percobaan Santri'), 0,
  'the refused write left no announcement row behind');
SELECT public.ann_as('00000000-0000-0000-0000-000000000987');
SELECT is((public.announcement_upsert(NULL,
         jsonb_build_object('title', 'Percobaan Tertunda', 'body_markdown', 'Isi',
                            'status', 'draft'), NULL)->>'message'),
  'Sesi tidak valid atau akun tidak aktif.',
  'a pengurus on a pending account is refused before any role check');

-- 12-14: a coordinator authors inside its own team, and the database — not the caller —
-- decides who wrote it, how it is pinned, and whether the ledger recorded it.
SELECT public.ann_as('00000000-0000-0000-0000-000000000982');
SELECT is((public.announcement_upsert(NULL,
         jsonb_build_object('title', 'Rapat Evaluasi Tim A', 'body_markdown', 'Bahasan mingguan.',
                            'priority', 'important', 'status', 'published', 'pinned', false,
                            'author_id', '00000000-0000-0000-0000-000000000985',
                            'team_id', '00000000-0000-0000-0000-000000000975',
                            'audience', jsonb_build_object('scope', 'team',
                              'teamIds', jsonb_build_array('00000000-0000-0000-0000-000000000975'))),
         NULL)->>'success'), 'true',
  'a coordinator may publish an announcement for the team it coordinates');
SELECT is((SELECT a.author_id || '/' || a.priority || '/' || a.pinned::text
             || '/' || (a.published_at IS NOT NULL)::text
           FROM public.announcements a WHERE a.title = 'Rapat Evaluasi Tim A'),
  '00000000-0000-0000-0000-000000000982/important/true/true',
  'the caller-supplied author_id and pinned are ignored: actor and pin come from the database');
SELECT is((SELECT count(*)::int FROM public.audit_logs l
           WHERE l.target_label = 'Rapat Evaluasi Tim A'
             AND l.event_name = 'announcement.published'
             AND l.actor_id = '00000000-0000-0000-0000-000000000982'), 1,
  'the publication and its announcement.published audit row commit together, naming the actor');

-- 15-17: the coordinator tier stops at its own team (§3.6 scope `team`).
SELECT is((public.announcement_upsert(NULL,
         jsonb_build_object('title', 'Broadcast Koordinator', 'body_markdown', 'Isi',
                            'status', 'draft', 'audience', jsonb_build_object('scope', 'all')),
         NULL)->>'success'), 'false',
  'a coordinator cannot address an announcement to the whole pondok');
SELECT is((public.announcement_upsert(NULL,
         jsonb_build_object('title', 'Silang Tim', 'body_markdown', 'Isi', 'status', 'draft',
                            'audience', jsonb_build_object('scope', 'team',
                              'teamIds', jsonb_build_array('00000000-0000-0000-0000-000000000976'))),
         NULL)->>'success'), 'false',
  'a coordinator cannot address another team it does not coordinate');
SELECT is((SELECT count(*)::int FROM public.announcements
           WHERE title IN ('Broadcast Koordinator', 'Silang Tim')), 0,
  'both refused writes left no rows behind');

-- 18-20: one rule for both tables — the announcement helper has to answer exactly like the
-- agenda helper SCH-02 shipped, or the same session could broadcast a pondok-wide agenda but
-- not a pondok-wide announcement. Pinned inside the coordinator session so the real tiers are
-- compared, not the no-session branch both helpers share.
SELECT is((SELECT app.can_write_announcement_audience('{"scope":"all"}'::jsonb, NULL, NULL)
             IS NOT DISTINCT FROM app.can_write_event_audience('{"scope":"all"}'::jsonb, NULL, NULL)
             AND NOT app.can_write_announcement_audience('{"scope":"all"}'::jsonb, NULL, NULL)), true,
  'a coordinator is refused scope all by both helpers');
SELECT is((SELECT app.can_write_announcement_audience('{"scope":"member_type","memberTypes":["santri"]}'::jsonb, NULL, NULL)
             IS NOT DISTINCT FROM app.can_write_event_audience('{"scope":"member_type","memberTypes":["santri"]}'::jsonb, NULL, NULL)
             AND NOT app.can_write_announcement_audience('{"scope":"member_type","memberTypes":["santri"]}'::jsonb, NULL, NULL)), true,
  'both helpers refuse a member_type audience identically');
SELECT is((SELECT app.can_write_announcement_audience(
             jsonb_build_object('scope', 'team', 'teamIds', jsonb_build_array('00000000-0000-0000-0000-000000000975')),
             '00000000-0000-0000-0000-000000000975', NULL)
             IS NOT DISTINCT FROM app.can_write_event_audience(
             jsonb_build_object('scope', 'team', 'teamIds', jsonb_build_array('00000000-0000-0000-0000-000000000975')),
             '00000000-0000-0000-0000-000000000975', NULL)
             AND app.can_write_announcement_audience(
             jsonb_build_object('scope', 'team', 'teamIds', jsonb_build_array('00000000-0000-0000-0000-000000000975')),
             '00000000-0000-0000-0000-000000000975', NULL)), true,
  'both helpers approve the team this coordinator actually runs');
RESET ROLE;

-- 21-22: the manager tier may broadcast, and may not do it through profiles.member_type either
-- (§2 rule 1: the column is descriptive, never an authorization tier).
SET LOCAL ROLE authenticated;
SELECT public.ann_as('00000000-0000-0000-0000-000000000983');
SELECT is((public.announcement_upsert(NULL,
         jsonb_build_object('title', 'Pengumuman Pengurus', 'body_markdown', 'Isi',
                            'status', 'published', 'audience', jsonb_build_object('scope', 'all')),
         NULL)->>'success'), 'true',
  'pengurus may broadcast an announcement to the whole pondok');
SELECT is((public.announcement_upsert(NULL,
         jsonb_build_object('title', 'Hanya Santri', 'body_markdown', 'Isi', 'status', 'published',
                            'audience', jsonb_build_object('scope', 'member_type',
                              'memberTypes', jsonb_build_array('santri'))),
         NULL)->>'success'), 'false',
  'an audience derived from profiles.member_type is refused for a manager too (§2 rule 1)');
RESET ROLE;

-- 23-27: the edit rules. The row is read under a lock, an absent audience keeps the stored
-- one, an archived row is frozen, and the revision number can no longer be raced.
SET LOCAL ROLE authenticated;
SELECT public.ann_as('00000000-0000-0000-0000-000000000982');
SELECT is((public.announcement_upsert('00000000-0000-0000-0000-000000000991',
         jsonb_build_object('title', 'Draf Evaluasi Tim A (diedit)', 'body_markdown', 'Revisi dua.'),
         NULL)->>'success'), 'true',
  'a coordinator may edit a draft that belongs to its own team');
SELECT is((SELECT a.audience_config->>'scope' FROM public.announcements a
           WHERE a.id = '00000000-0000-0000-0000-000000000991'), 'team',
  'an edit that sends no audience inherits the stored team audience instead of widening to all');
SELECT is((SELECT count(*)::int FROM public.announcement_revisions r
           WHERE r.announcement_id = '00000000-0000-0000-0000-000000000991'), 1,
  'the replaced row is kept in announcement_revisions');
SELECT is((public.announcement_upsert('00000000-0000-0000-0000-000000000992',
         jsonb_build_object('title', 'Arsip Diedit', 'body_markdown', 'Isi'), NULL)->>'success'), 'false',
  'an archived announcement is frozen');
SELECT public.ann_as('00000000-0000-0000-0000-000000000984');
SELECT is((public.announcement_upsert('00000000-0000-0000-0000-000000000991',
         jsonb_build_object('title', 'Draf Evaluasi Tim A (diedit lagi)',
                            'body_markdown', 'Revisi tiga.',
                            'expires_at', '2027-01-10T08:30'), NULL)->>'revision_no')::int, 2,
  'the revision number is allocated by the database, so concurrent edits cannot both claim 1');

-- 28-29: a future publication time stays a draft, and the naive wall-clock is read as WIB
-- instead of whichever timezone the Node process runs in (§2 rule 5).
SELECT is((public.announcement_upsert(NULL,
         jsonb_build_object('title', 'Terbit Mendatang', 'body_markdown', 'Isi',
                            'status', 'published', 'scheduled_for', '2030-01-01T09:00'),
         NULL)->>'success'), 'false',
  'an announcement scheduled into the future has to stay a draft');
SELECT is((SELECT a.expires_at AT TIME ZONE 'Asia/Jakarta' FROM public.announcements a
           WHERE a.id = '00000000-0000-0000-0000-000000000991')::text, '2027-01-10 08:30:00',
  'the naive datetime-local text is resolved in Asia/Jakarta by the database');

-- 30: owning the row does not grant a wider audience.
SELECT public.ann_as('00000000-0000-0000-0000-000000000982');
SELECT is((public.announcement_upsert('00000000-0000-0000-0000-000000000991',
         jsonb_build_object('title', 'Draf Evaluasi Tim A', 'body_markdown', 'Lebar.',
                            'audience', jsonb_build_object('scope', 'all')), NULL)->>'success'), 'false',
  'an edit cannot widen a team announcement to the whole pondok from a coordinator session');
RESET ROLE;

-- 31-34: archive is scoped, keeps its actor, and stamps the closure in the database.
SET LOCAL ROLE authenticated;
SELECT public.ann_as('00000000-0000-0000-0000-000000000986');
SELECT is((public.announcement_archive('00000000-0000-0000-0000-000000000990', 'Rapihkan')::jsonb->>'success'), 'false',
  'a coordinator cannot archive a pondok-wide announcement');
SELECT is((SELECT status FROM public.announcements WHERE id = '00000000-0000-0000-0000-000000000990'),
  'published', 'the refused archive left the announcement published');
SELECT public.ann_as('00000000-0000-0000-0000-000000000982');
SELECT is((public.announcement_archive('00000000-0000-0000-0000-000000000991', 'Sudah dievaluasi')::jsonb->>'success'), 'true',
  'a coordinator may archive the announcement of its own team');
SELECT is((SELECT count(*)::int FROM public.audit_logs l
           WHERE l.target_id = '00000000-0000-0000-0000-000000000991'
             AND l.actor_id = '00000000-0000-0000-0000-000000000982'
             AND l.event_name = 'announcement.deleted'), 1,
  'the archive audit row carries the actor_id the old update never wrote');
RESET ROLE;

-- 35: publication still fans out through the existing trigger, so moving the write onto the
-- session did not quietly drop audience delivery.
SELECT is((SELECT count(*)::int FROM public.notifications n
           JOIN public.announcements a ON a.id::text = n.reference_id
           WHERE a.title = 'Rapat Evaluasi Tim A' AND n.notification_type = 'ANNOUNCEMENT_PUBLISHED'), 2,
  'a team-scoped publication reaches exactly the two active members of that team');

-- 36-37: the read half of §3.6 stays with RLS — which is what lets getAnnouncementsAction drop
-- its own TypeScript copy of the audience rule — and a historical member_type row is still
-- readable (no backfill was ordered; only the write path is closed).
SELECT is((SELECT app.can_view_audience(
             (SELECT audience_config FROM public.announcements WHERE id = '00000000-0000-0000-0000-000000000990'),
             NULL, '00000000-0000-0000-0000-000000000981')), true,
  'the live SELECT policy still answers audience visibility for a santri');
SELECT is((SELECT app.can_view_audience(
             (SELECT audience_config FROM public.announcements WHERE id = '00000000-0000-0000-0000-000000000993'),
             NULL, '00000000-0000-0000-0000-000000000981')), true,
  'a pre-fix member_type announcement keeps its readers instead of vanishing');

SELECT * FROM finish();
ROLLBACK;
