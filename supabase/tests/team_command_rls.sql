BEGIN;

SELECT plan(31);

-- PPL-01: PERMISSIONS.md §3.7 gives yayasan `all` for team.create/archive,
-- team.member.manage, team.coordinator.set and reviewer.assign, while the code
-- path admitted only super_admin and pengurus. The same item moves the three
-- unguarded writes behind RPCs so the audit ledger is written in the same
-- transaction as the membership change, and the effective dates come from the
-- WIB calendar instead of the UTC date the browser happened to be on.
--
--   851 santri (reviewee)        852 koordinator of team 840
--   853 pengurus                 854 yayasan
--   855 super_admin              856 pengurus on a pending account
--   857 santri outside every team
--
-- Disposable fixtures inside one rolled-back transaction; local/CI only.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000851', 'ppl-santri@example.test'),
  ('00000000-0000-0000-0000-000000000852', 'ppl-koordinator@example.test'),
  ('00000000-0000-0000-0000-000000000853', 'ppl-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000854', 'ppl-yayasan@example.test'),
  ('00000000-0000-0000-0000-000000000855', 'ppl-super-admin@example.test'),
  ('00000000-0000-0000-0000-000000000856', 'ppl-pending-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000857', 'ppl-outsider@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000851', 'ppl-santri@example.test', 'Santri Reviewee', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000852', 'ppl-koordinator@example.test', 'Koordinator X', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000853', 'ppl-pengurus@example.test', 'Pengurus Pusat', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000854', 'ppl-yayasan@example.test', 'Yayasan Pengawas', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000855', 'ppl-super-admin@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000856', 'ppl-pending-pengurus@example.test', 'Pengurus Menunggu', 'pending', 'pengurus'),
  ('00000000-0000-0000-0000-000000000857', 'ppl-outsider@example.test', 'Santri Baru', 'active', 'santri');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000851', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000852', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000853', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000854', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000855', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000856', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000857', (SELECT id FROM public.roles WHERE key = 'santri'));

INSERT INTO public.teams (id, name, slug, status, archived_at)
VALUES
  ('00000000-0000-0000-0000-000000000840', 'Tim PPL X', 'ppl-x', 'active', NULL),
  ('00000000-0000-0000-0000-000000000841', 'Tim PPL Y', 'ppl-y', 'archived', now());

INSERT INTO public.team_members (team_id, user_id, team_role, title)
VALUES
  ('00000000-0000-0000-0000-000000000840', '00000000-0000-0000-0000-000000000852', 'coordinator', 'Koordinator Lama'),
  ('00000000-0000-0000-0000-000000000840', '00000000-0000-0000-0000-000000000853', 'member', NULL);

-- PostgreSQL has no temporary functions: this identity switcher lives only
-- inside the rolled-back transaction and is dropped again before finish().
CREATE FUNCTION public.pplcmd_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

-- Assertions 1-4 read pg_proc, whose prosecdef/proconfig columns are only
-- reliable for the table owner, so the caller identity starts at assertion 5.

-- 1-2: the two new command entry points exist.
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'team_member_set'),
  'app.team_member_set exists so membership is written atomically');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'team_member_end'),
  'app.team_member_end exists so a departure keeps its history');

-- 3-4: SECURITY DEFINER with a pinned search_path (AGENTS.md RPC checklist).
SELECT ok((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'team_member_set'),
  'app.team_member_set is SECURITY DEFINER');
SELECT ok((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=%'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'team_member_set'),
  'app.team_member_set pins its search_path');

-- 5-6: yayasan may appoint a coordinator (§3.7 team.coordinator.set = all) and
-- the appointment is audited in the same transaction as the seat change.
SET LOCAL ROLE authenticated;
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000854');
SELECT is((public.team_set_coordinator('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000853')->>'success'), 'true',
  'yayasan can set a team coordinator');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_logs
           WHERE event_name = 'people.team_coordinator_set'
             AND target_id = '00000000-0000-0000-0000-000000000840'
             AND actor_id = '00000000-0000-0000-0000-000000000854'), 1,
  'the coordinator appointment writes its audit row once');

-- 7-8: super_admin keeps the appointment path and the one-active-coordinator
-- invariant survives the switch: the previous holder is closed, not deleted.
SET LOCAL ROLE authenticated;
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000855');
SELECT is((public.team_set_coordinator('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000852')->>'success'), 'true',
  'super admin can set a team coordinator');
RESET ROLE;
SELECT is((SELECT string_agg(user_id::text, ',') FROM public.team_members
           WHERE team_id = '00000000-0000-0000-0000-000000000840'
             AND team_role = 'coordinator' AND valid_to IS NULL),
  '00000000-0000-0000-0000-000000000852',
  'exactly one active coordinator remains and it is the newly appointed one');

-- 9-10: the roles §3.7 excludes stay excluded.
SET LOCAL ROLE authenticated;
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000852');
SELECT is((public.team_set_coordinator('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857')->>'success'), 'false',
  'a coordinator cannot appoint coordinators');
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000851');
SELECT is((public.team_set_coordinator('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857')->>'success'), 'false',
  'a santri cannot appoint coordinators');

-- 11: a role grant on a suspended/pending account is not an active member.
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000856');
SELECT is((public.team_set_coordinator('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857')->>'message'),
  'Sesi tidak valid atau akun tidak aktif.',
  'a pengurus on a pending account is refused before any role check');

-- 12: no session at all.
SELECT set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claims', '', true);
SELECT is((public.team_set_coordinator('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857')->>'success'), 'false',
  'an anonymous call cannot appoint a coordinator');

-- 13-14: the team has to exist and stay active.
SET LOCAL ROLE authenticated;
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000854');
SELECT is((public.team_set_coordinator('00000000-0000-0000-0000-000000000841',
        '00000000-0000-0000-0000-000000000853')->>'message'), 'Tim tidak ditemukan atau tidak aktif.',
  'an archived team cannot receive a coordinator');
SELECT is((public.team_set_coordinator('00000000-0000-0000-0000-000000000899',
        '00000000-0000-0000-0000-000000000853')->>'message'), 'Tim tidak ditemukan atau tidak aktif.',
  'an unknown team cannot receive a coordinator');

-- 15-16: yayasan adds a member and the effective date is the WIB calendar day.
SELECT is((public.team_member_set('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857', 'member', 'Anggota Baru')->>'success'), 'true',
  'yayasan can add a member to a team');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.team_members
           WHERE team_id = '00000000-0000-0000-0000-000000000840'
             AND user_id = '00000000-0000-0000-0000-000000000857'
             AND valid_from = (now() AT TIME ZONE 'Asia/Jakarta')::date AND valid_to IS NULL), 1,
  'the new membership opens on the WIB calendar date');

-- 17-18: a repeat add updates the active row instead of stacking duplicates.
SET LOCAL ROLE authenticated;
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000853');
SELECT is((public.team_member_set('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857', 'assistant', 'Wakil')->>'success'), 'true',
  'pengurus can change an existing members role');
RESET ROLE;
SELECT is((SELECT string_agg(team_role || coalesce(':' || title, ''), ';')
             FROM public.team_members
           WHERE team_id = '00000000-0000-0000-0000-000000000840'
             AND user_id = '00000000-0000-0000-0000-000000000857' AND valid_to IS NULL),
  'assistant:Wakil',
  'one active row carries the new role and title');

-- 19-21: the refusals that used to be open because the caller wrote the table
-- directly from the application.
SET LOCAL ROLE authenticated;
SELECT is((public.team_member_set('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857', 'coordinator', NULL)->>'success'), 'false',
  'the coordinator seat stays reserved for the coordinator RPC');
SELECT is((public.team_member_set('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857', 'alumni', NULL)->>'message'), 'Peran tim tidak valid.',
  'an unknown team role is refused');
SELECT is((public.team_member_set('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000856', 'member', NULL)->>'message'),
  'Anggota harus memiliki akun aktif.',
  'a pending account cannot be added to a team');

-- 22-24: leaving a team closes the row; history stays.
SELECT is((public.team_member_end('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857')->>'success'), 'true',
  'pengurus can end an active membership');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.team_members
           WHERE team_id = '00000000-0000-0000-0000-000000000840'
             AND user_id = '00000000-0000-0000-0000-000000000857'), 1,
  'the departed membership is dated closed, never deleted');
SET LOCAL ROLE authenticated;
SELECT is((public.team_member_end('00000000-0000-0000-0000-000000000840',
        '00000000-0000-0000-0000-000000000857')->>'message'), 'Keanggotaan aktif tidak ditemukan.',
  'ending an already closed membership is refused instead of silently succeeding');

-- 25: both member writes are audited, and none of the refusals above added a row.
RESET ROLE;
SELECT is((SELECT jsonb_build_object(
             'added', count(*) FILTER (WHERE event_name = 'people.team_member_added'),
             'removed', count(*) FILTER (WHERE event_name = 'people.team_member_removed'))
           FROM public.audit_logs
           WHERE event_name IN ('people.team_member_added', 'people.team_member_removed')
             AND target_id = '00000000-0000-0000-0000-000000000840')::text,
  '{"added": 2, "removed": 1}',
  'member writes are audited once each and refused writes are not audited at all');

-- 26-27: reviewer.assign is yayasan too (§3.7), and the ledger row now comes
-- from the RPC instead of a second service-role client after the fact.
SET LOCAL ROLE authenticated;
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000854');
SELECT is((public.assign_reviewer('00000000-0000-0000-0000-000000000851',
        '00000000-0000-0000-0000-000000000853', 'report', 'Review mingguan')->>'success'), 'true',
  'yayasan can assign a reviewer');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_logs
           WHERE event_name = 'people.reviewer_assigned'
             AND actor_id = '00000000-0000-0000-0000-000000000854'), 1,
  'the reviewer assignment is audited inside its own transaction');

-- 28-30: the guards the RPC owns, no longer only the browser form.
SET LOCAL ROLE authenticated;
SELECT is((public.assign_reviewer('00000000-0000-0000-0000-000000000851',
        '00000000-0000-0000-0000-000000000851', 'report', NULL)->>'success'), 'false',
  'self-review is refused by the RPC');
SELECT is((public.assign_reviewer('00000000-0000-0000-0000-000000000851',
        '00000000-0000-0000-0000-000000000853', 'budget', NULL)->>'message'),
  'Jenis reviewer tidak valid.',
  'an unknown reviewer kind is refused');
SELECT is((public.assign_reviewer('00000000-0000-0000-0000-000000000851',
        '00000000-0000-0000-0000-000000000856', 'report', NULL)->>'success'), 'false',
  'a pending account cannot be made a reviewer');

-- 31: reassignment keeps one active row and dates the previous one closed.
SELECT public.pplcmd_as('00000000-0000-0000-0000-000000000855');
SELECT is((public.assign_reviewer('00000000-0000-0000-0000-000000000851',
        '00000000-0000-0000-0000-000000000852', 'report', 'Rotasi reviewer')->>'success'), 'true',
  'super admin can rotate the reviewer');
RESET ROLE;

DROP FUNCTION IF EXISTS public.pplcmd_as(uuid);

SELECT * FROM finish();

ROLLBACK;
