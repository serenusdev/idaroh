BEGIN;

SELECT plan(23);

-- SEC-02: save_report must compute the WIB operational date and is_late in the
-- database and ignore the client-supplied p_is_late flag. The public wrapper
-- must delegate to app.save_report (SECURITY DEFINER), which is the only role
-- path that can write daily_reports/report_items after 20261102000020 revoked
-- direct authenticated grants.
--
-- Disposable fixtures. The transaction is rolled back and must only be run on
-- a local/disposable Supabase database.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wib-santri-a@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wib-santri-b@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000601', 'wib-santri-a@example.test', 'WIB Santri A', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000602', 'wib-santri-b@example.test', 'WIB Santri B', 'active', 'santri');

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('00000000-0000-0000-0000-000000000601'::uuid),
  ('00000000-0000-0000-0000-000000000602'::uuid)
) AS u(id)
JOIN public.roles r ON r.key = 'santri';

-- Every save call below forges p_is_late in the OPPOSITE direction of the real
-- clock state, so a stored value equal to the forge proves the client won.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000601"}',
  true
);

CREATE TEMP TABLE draft_forged AS SELECT public.save_report(
  p_user_id => '00000000-0000-0000-0000-000000000601',
  p_report_date => ((now() AT TIME ZONE 'Asia/Jakarta')::date),
  p_submission_status => 'draft',
  p_is_late => true,
  p_items => '[{"categoryId":"keagamaan","title":"Setoran hafalan","description":"Menyetor satu halaman","resultProgress":"Lancar","obstacles":"","durationMinutes":45}]'::jsonb
) AS r;

-- The draft row is inspected before the submissions run. All three saves of
-- this santri share one daily_reports row (unique on user_id + report_date),
-- and a submitted save pins is_late from the WIB deadline, so reading the draft
-- afterwards would make this assertion depend on whether CI ran before or after
-- policy_settings.report_deadline_time.
RESET ROLE;
SELECT is((SELECT r->>'success' FROM draft_forged), 'true',
  'draft save succeeds through the public save_report wrapper');
SELECT is((SELECT d.is_late FROM public.daily_reports d JOIN draft_forged f ON d.id = (f.r->>'report_id')::uuid), false,
  'a forged client is_late=true never lands on a draft');
SELECT is((SELECT count(*)::int FROM public.report_items ri JOIN draft_forged f ON ri.report_id = (f.r->>'report_id')::uuid), 1,
  'draft items are persisted');
SELECT is((SELECT ri.duration_minutes FROM public.report_items ri JOIN draft_forged f ON ri.report_id = (f.r->>'report_id')::uuid), 45,
  'durationMinutes is parsed as an integer, not silently defaulted to 60');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000601"}',
  true
);

CREATE TEMP TABLE submit_forged AS SELECT public.save_report(
  p_user_id => '00000000-0000-0000-0000-000000000601',
  p_report_date => ((now() AT TIME ZONE 'Asia/Jakarta')::date),
  p_submission_status => 'submitted',
  p_is_late => ((now() AT TIME ZONE 'Asia/Jakarta')::time <= (
    SELECT report_deadline_time FROM public.policy_settings
    WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
  )),
  p_items => '[{"categoryId":"keagamaan","title":"Setoran hafalan","description":"Menyetor satu halaman","resultProgress":"Lancar","obstacles":"","durationMinutes":45}]'::jsonb
) AS r;

CREATE TEMP TABLE resubmit_forged AS SELECT public.save_report(
  p_user_id => '00000000-0000-0000-0000-000000000601',
  p_report_date => ((now() AT TIME ZONE 'Asia/Jakarta')::date),
  p_submission_status => 'submitted',
  p_is_late => ((now() AT TIME ZONE 'Asia/Jakarta')::time <= (
    SELECT report_deadline_time FROM public.policy_settings
    WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
  )),
  p_items => '[{"categoryId":"keagamaan","title":"Setoran hafalan revisi","description":"Menyetor satu halaman","resultProgress":"Lancar","obstacles":"","durationMinutes":45}]'::jsonb
) AS r;

CREATE TEMP TABLE stale_forged AS SELECT public.save_report(
  p_user_id => '00000000-0000-0000-0000-000000000601',
  p_report_date => ((now() AT TIME ZONE 'Asia/Jakarta')::date) - 1,
  p_submission_status => 'draft',
  p_is_late => false,
  p_items => '[{"categoryId":"keagamaan","title":"Tanggal basi","description":"Harus ditolak database","resultProgress":"","obstacles":"","durationMinutes":30}]'::jsonb
) AS r;

CREATE TEMP TABLE cross_user_forged AS SELECT public.save_report(
  p_user_id => '00000000-0000-0000-0000-000000000602',
  p_report_date => ((now() AT TIME ZONE 'Asia/Jakarta')::date),
  p_submission_status => 'draft',
  p_is_late => false,
  p_items => '[{"categoryId":"keagamaan","title":"Menyamar jadi santri lain","description":"Harus ditolak database","resultProgress":"","obstacles":"","durationMinutes":30}]'::jsonb
) AS r;

-- Ledger and row inspection run as the privileged test role (the audit ledger
-- is service-only by design, like report_review_idempotency.sql).
RESET ROLE;

SELECT is((SELECT r->>'success' FROM submit_forged), 'true',
  'submission succeeds through the public save_report wrapper');
SELECT ok((SELECT r->>'is_late' FROM submit_forged) IN ('true', 'false'),
  'the RPC response reports the database-computed is_late');
SELECT is((SELECT d.is_late FROM public.daily_reports d JOIN submit_forged f ON d.id = (f.r->>'report_id')::uuid),
  (SELECT (now() AT TIME ZONE 'Asia/Jakarta')::time > report_deadline_time
   FROM public.policy_settings WHERE status = 'active' ORDER BY created_at DESC LIMIT 1),
  'stored is_late comes from the WIB deadline, the opposite of the forged p_is_late');
SELECT ok((SELECT d.first_submitted_at FROM public.daily_reports d JOIN submit_forged f ON d.id = (f.r->>'report_id')::uuid) IS NOT NULL,
  'first submission records first_submitted_at');
SELECT is((SELECT d.revision_no FROM public.daily_reports d JOIN resubmit_forged f ON d.id = (f.r->>'report_id')::uuid), 3,
  'each submission advances revision_no (draft 1, submit 2, resubmit 3)');
SELECT is((SELECT r->>'success' FROM resubmit_forged), 'true',
  'resubmission succeeds through the wrapper');
SELECT is((SELECT (r->>'is_late')::boolean FROM resubmit_forged),
  (SELECT d.is_late FROM public.daily_reports d JOIN resubmit_forged f ON d.id = (f.r->>'report_id')::uuid),
  'is_late stays pinned to the first submission and the response echoes the stored value');
SELECT is((SELECT count(*)::int FROM public.report_revisions rr JOIN resubmit_forged f ON rr.report_id = (f.r->>'report_id')::uuid), 2,
  'the item snapshot of each superseded revision is kept');
SELECT is((SELECT count(*)::int FROM public.report_revisions rr JOIN resubmit_forged f ON rr.report_id = (f.r->>'report_id')::uuid
   WHERE rr.submitted_by = '00000000-0000-0000-0000-000000000601'), 2,
  'snapshots are attributed to the authenticated author');
SELECT is((SELECT count(*)::int FROM public.audit_logs a JOIN resubmit_forged f ON a.target_id = (f.r->>'report_id')
   WHERE a.event_name LIKE 'report.%'), 2,
  'only the two submissions write audit events; the draft save writes none');
SELECT is((SELECT count(*)::int FROM public.audit_logs a JOIN resubmit_forged f ON a.target_id = (f.r->>'report_id')
   WHERE a.event_name = 'report.submitted'), 2,
  'each submission writes exactly one report.submitted audit event');
SELECT is((SELECT count(*)::int FROM public.audit_logs a JOIN resubmit_forged f ON a.target_id = (f.r->>'report_id')
   WHERE a.actor_id = '00000000-0000-0000-0000-000000000601'), 2,
  'audit actor is the authenticated submitter, not a client-supplied identity');
SELECT is((SELECT r->>'success' FROM stale_forged), 'false',
  'the database rejects a report date other than today in Asia/Jakarta');
SELECT is((SELECT count(*)::int FROM public.daily_reports
   WHERE user_id = '00000000-0000-0000-0000-000000000601'
     AND report_date = ((now() AT TIME ZONE 'Asia/Jakarta')::date) - 1), 0,
  'a rejected stale-dated call stores no row');
SELECT is((SELECT r->>'success' FROM cross_user_forged), 'false',
  'the database rejects saving as another user');
SELECT is((SELECT count(*)::int FROM public.daily_reports
   WHERE user_id = '00000000-0000-0000-0000-000000000602'), 0,
  'a rejected cross-user call stores nothing for the victim');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000601"}',
  true
);
SELECT throws_ok(
  $$INSERT INTO public.daily_reports (user_id, report_date, submission_status)
    VALUES ('00000000-0000-0000-0000-000000000601', CURRENT_DATE, 'draft')$$,
  '42501', NULL,
  'the fix must not widen grants: authenticated still cannot write daily_reports directly'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  $$SELECT public.save_report(
    '00000000-0000-0000-0000-000000000601'::uuid, CURRENT_DATE, 'draft', false, '[]'::jsonb
  )$$,
  '42501', NULL,
  'anon cannot execute the save RPC'
);
RESET ROLE;

SELECT is((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'save_report'), true,
  'app.save_report stays SECURITY DEFINER');

SELECT * FROM finish();
ROLLBACK;
