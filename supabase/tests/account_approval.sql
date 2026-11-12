BEGIN;

SELECT plan(9);

-- Disposable fixtures: one super admin approver, two confirmed santri
-- applicants, rolled back at the end of the test transaction.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-admin@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-santri-1@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-santri-2@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES ('00000000-0000-0000-0000-000000000401', 'approval-admin@example.test', 'Approval Admin', 'active', 'super_admin');

INSERT INTO public.user_roles (user_id, role_id)
SELECT '00000000-0000-0000-0000-000000000401', id FROM public.roles WHERE key = 'super_admin';

INSERT INTO public.teams (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000421', 'Approval Test Team', 'approval-test-team');

INSERT INTO public.account_requests (id, full_name, email, phone_number, role_requested, team_requested, status, auth_user_id)
VALUES
  ('00000000-0000-0000-0000-000000000411', 'Approval Santri Satu', 'approval-santri-1@example.test', '0800000001', 'santri', 'Sentra Santri', 'pending', '00000000-0000-0000-0000-000000000411'),
  ('00000000-0000-0000-0000-000000000412', 'Approval Santri Dua', 'approval-santri-2@example.test', '0800000002', 'santri', 'Sentra Santri', 'pending', '00000000-0000-0000-0000-000000000412');

-- Call the RPC the way the server action does: PostgREST with the service
-- role key. PostgREST v10+ only sets request.jwt.claims; the legacy
-- request.jwt.claim.* settings are not available.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role","iss":"supabase"}', true);

SELECT is(
  public.approve_account_application(
    '00000000-0000-0000-0000-000000000411',
    '00000000-0000-0000-0000-000000000411',
    'santri',
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000421'
  ) ->> 'success',
  'true',
  'service role can approve the first santri application'
);

SELECT is(
  public.approve_account_application(
    '00000000-0000-0000-0000-000000000412',
    '00000000-0000-0000-0000-000000000412',
    'santri',
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000421'
  ) ->> 'success',
  'true',
  'service role can approve the second santri application'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.account_requests
   WHERE id IN ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412')
     AND status = 'approved'),
  2,
  'both applications move to approved'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles
   WHERE id IN ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412')
     AND status = 'active' AND member_type = 'santri'),
  2,
  'both santri get an active profile'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_roles ur
   JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id IN ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412')
     AND r.key = 'santri' AND ur.revoked_at IS NULL),
  2,
  'both santri get the santri role'
);

SELECT is(
  (SELECT team_name FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000411'),
  'Approval Test Team',
  'profile team name follows the team chosen by the approver'
);

SELECT is(
  (SELECT count(*)::int FROM public.team_members
   WHERE team_id = '00000000-0000-0000-0000-000000000421'
     AND user_id IN ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412')
     AND team_role = 'member' AND valid_to IS NULL),
  2,
  'both santri become active members of the chosen team'
);

-- A signed-in user that is not the approver must still be refused.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000413', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-santri-3@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
INSERT INTO public.account_requests (id, full_name, email, phone_number, role_requested, status, auth_user_id)
VALUES ('00000000-0000-0000-0000-000000000413', 'Approval Santri Tiga', 'approval-santri-3@example.test', '0800000003', 'santri', 'pending', '00000000-0000-0000-0000-000000000413');

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000411"}', true);
SELECT is(
  app.approve_account_application(
    '00000000-0000-0000-0000-000000000413',
    '00000000-0000-0000-0000-000000000413',
    'santri',
    '00000000-0000-0000-0000-000000000401',
    NULL
  ) ->> 'success',
  'false',
  'a caller that is neither service role nor the approver is refused'
);

SELECT is(
  (SELECT status::text FROM public.account_requests WHERE id = '00000000-0000-0000-0000-000000000413'),
  'pending',
  'a refused approval leaves the request pending'
);

SELECT * FROM finish();
ROLLBACK;
