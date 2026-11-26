BEGIN;

SELECT plan(19);

-- PROF-SELF — PERMISSIONS.md §3.7 `people.profile.update_self` = `own` for every tier
-- (S/K/P/Y/SA), and §2 rule 3 ("jangan percaya nilai dari client untuk hal yang menentukan
-- integritas"). Before this migration the self-service save ran as the service role:
-- `updateProfileAction` called createAdminClient() and wrote profiles directly, so the
-- database never saw the caller (auth.uid() is NULL under the service role), no audit_logs row
-- was written (open finding SEC-10), and the `authenticated` column grant from
-- 20261102000003:34 let any session rewrite its own row without leaving a trace.
--
-- After this migration:
--   * app.update_own_profile() is the only self-write path. It takes no user id at all — the
--     row it can touch is auth.uid() — so "own" is structural, not a comparison;
--   * the account has to be an active member (app.is_active_member()) before anything is read
--     or written, and an avatar_url is only accepted when it points inside the caller's own
--     storage folder, which the client used to assert and the database did not;
--   * audit_logs is written in the same transaction, so a name change is attributable;
--   * `authenticated` loses UPDATE on profiles again (20261102000003 revoked the table grant
--     and immediately re-granted it column-wise, which undid the hardening), so the direct
--     write path is closed rather than merely unused.
--
--   931 santri aktif (owner)          932 santri aktif lain
--   933 pending                       934 super_admin aktif
--
--   Disposable fixtures inside one rolled-back transaction; local/CI only.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000931', 'self-owner@example.test'),
  ('00000000-0000-0000-0000-000000000932', 'self-other@example.test'),
  ('00000000-0000-0000-0000-000000000933', 'self-pending@example.test'),
  ('00000000-0000-0000-0000-000000000934', 'self-super-admin@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type, phone_number, avatar_url)
VALUES
  ('00000000-0000-0000-0000-000000000931', 'self-owner@example.test', 'Pemilik Lama', 'active', 'santri', '0811111111111', NULL),
  ('00000000-0000-0000-0000-000000000932', 'self-other@example.test', 'Tetangga Lama', 'active', 'santri', NULL, NULL),
  ('00000000-0000-0000-0000-000000000933', 'self-pending@example.test', 'Menunggu Persetujuan', 'pending', 'santri', NULL, NULL),
  ('00000000-0000-0000-0000-000000000934', 'self-super-admin@example.test', 'Admin Utama', 'active', 'pengurus', NULL, NULL);

INSERT INTO public.user_roles (user_id, role_id)
VALUES ('00000000-0000-0000-0000-000000000934', (SELECT id FROM public.roles WHERE key = 'super_admin'));

-- PostgreSQL has no temporary functions: this identity switcher lives only inside the
-- rolled-back transaction.
CREATE FUNCTION public.self_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

-- 1-5: the surface exists and follows the RPC checklist (§2: SECURITY DEFINER, a locked
-- search_path containing pg_temp, and a public wrapper so PostgREST can reach it).
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'update_own_profile'),
  'app.update_own_profile exists as the single self-service profile writer');
SELECT ok((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'update_own_profile'),
  'app.update_own_profile is SECURITY DEFINER');
SELECT ok((SELECT array_to_string(p.proconfig, ',') LIKE '%pg_temp%'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'update_own_profile'),
  'app.update_own_profile locks its search_path including pg_temp');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'update_own_profile'),
  'public.update_own_profile exposes the RPC to PostgREST for the session client');
-- "own" has to be structural: a target id in the signature is a target id someone can forge.
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'update_own_profile'
             AND p.proargnames && array['p_user_id','p_target_user_id','p_id']), 0,
  'app.update_own_profile takes no user id, so it cannot be aimed at another account');

-- 6: the direct path that the service-role action used to lean on is gone. 20261102000003
-- revoked table UPDATE and re-granted it column-wise, so the hardening was cosmetic.
SET LOCAL ROLE authenticated;
SELECT public.self_as('00000000-0000-0000-0000-000000000931');
SELECT throws_ok(
  $$UPDATE public.profiles SET full_name = 'Diubah Sendiri'
     WHERE id = '00000000-0000-0000-0000-000000000931'$$,
  '42501', NULL, 'an authenticated session can no longer rewrite its own profile row directly');

-- 7-8: the account state is judged before anything is written. The identity still points at the
-- active owner from the privilege probe above, so it has to move to the pending fixture here —
-- otherwise the RPC succeeds and this test asserts a row away that it just wrote itself.
SET LOCAL ROLE authenticated;
SELECT public.self_as('00000000-0000-0000-0000-000000000933');
SELECT is((public.update_own_profile('Nama Baru', '0822222222222', NULL)->>'message'),
  'Sesi tidak valid atau akun tidak aktif.',
  'a pending account cannot use the self-service profile RPC');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.profiles WHERE full_name = 'Nama Baru'), 0,
  'the refused write left no profile row behind');

-- 10-13: the happy path writes the columns the caller owns, nothing else.
SET LOCAL ROLE authenticated;
SELECT public.self_as('00000000-0000-0000-0000-000000000931');
SELECT is((SELECT (public.update_own_profile('  Pemilik Baru  ', ' 0822222222222 ', NULL))->>'success'),
  'true', 'an active member can save their own profile through the RPC');
RESET ROLE;
SELECT is((SELECT full_name FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000931'),
  'Pemilik Baru', 'the stored name is trimmed by the database, not by the client');
SELECT is((SELECT phone_number FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000931'),
  '0822222222222', 'the stored phone number is trimmed by the database too');
SELECT is((SELECT status::text FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000931'),
  'active', 'the self-service RPC never touches status');

-- 14-15: SEC-10 — the change is attributable inside the same transaction.
SELECT is((SELECT count(*)::int FROM public.audit_logs l
           WHERE l.event_name = 'iam.profile_updated'
             AND l.actor_id = '00000000-0000-0000-0000-000000000931'
             AND l.target_id = '00000000-0000-0000-0000-000000000931'), 1,
  'app.update_own_profile writes exactly one audit_logs row for the caller');
SELECT ok((SELECT count(*)::int FROM public.audit_logs l
           WHERE l.event_name = 'iam.profile_updated' AND l.actor_id IS NULL) = 0,
  'the audit row always carries an actor_id, unlike an unattributed service-role write');

-- 16-18: avatar_url provenance. The client has always claimed this check; the database now
-- performs it, so a request that skips the action cannot smuggle a foreign URL.
SET LOCAL ROLE authenticated;
SELECT public.self_as('00000000-0000-0000-0000-000000000931');
SELECT is((SELECT (public.update_own_profile('Pemilik Baru', '0822222222222',
             'https://tracker.example.com/pixel.png'))->>'success'),
  'false', 'an avatar_url outside the caller''s storage folder is refused by the database');
-- pgTAP's is() does not treat two NULLs as equal, so an absent value is asserted with ok().
SELECT ok((SELECT avatar_url FROM public.profiles
           WHERE id = '00000000-0000-0000-0000-000000000931') IS NULL,
  'the refused avatar left the stored value untouched');
SELECT is((SELECT (public.update_own_profile('Pemilik Baru', '0822222222222',
             '/storage/v1/object/public/avatars/00000000-0000-0000-0000-000000000931/1700000000.png'))
           ->>'success'),
  'true', 'an avatar inside the caller''s own folder is accepted');
RESET ROLE;

-- 19: an empty name is refused, matching the guard the action applies before it calls.
SET LOCAL ROLE authenticated;
SELECT public.self_as('00000000-0000-0000-0000-000000000931');
SELECT is((SELECT (public.update_own_profile('   ', '0822222222222', NULL))->>'success'),
  'false', 'a blank name is refused by the RPC as well as by the action');
RESET ROLE;

-- 20: §3.7 gives every tier `own`, including super_admin, so the RPC must not gate on role.
SET LOCAL ROLE authenticated;
SELECT public.self_as('00000000-0000-0000-0000-000000000934');
SELECT is((SELECT (public.update_own_profile('Admin Utama Baru', NULL, NULL))->>'success'),
  'true', 'super_admin keeps the same own-scope self-service path as every other role');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
