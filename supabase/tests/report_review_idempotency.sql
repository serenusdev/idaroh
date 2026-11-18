BEGIN;

SELECT plan(28);

-- Disposable fixtures. The transaction is rolled back and must only be run on
-- a local/disposable Supabase database after the new migration is applied.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-owner@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reviewer@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-owner-without-profile@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000501', 'review-owner@example.test', 'Review Owner', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000502', 'reviewer@example.test', 'Review Admin', 'active', 'super_admin');

INSERT INTO public.user_roles (user_id, role_id)
SELECT '00000000-0000-0000-0000-000000000502', id
FROM public.roles
WHERE key = 'super_admin';

INSERT INTO public.daily_reports (
  id, user_id, report_date, submission_status, review_status, revision_no
)
VALUES (
  '00000000-0000-0000-0000-000000000503',
  '00000000-0000-0000-0000-000000000501',
  DATE '2026-11-18',
  'submitted',
  'not_reviewed',
  1
);
INSERT INTO public.daily_reports (
  id, user_id, report_date, submission_status, review_status, revision_no
)
VALUES (
  '00000000-0000-0000-0000-000000000505',
  '00000000-0000-0000-0000-000000000504',
  DATE '2026-11-19',
  'submitted',
  'not_reviewed',
  1
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000502"}',
  true
);

CREATE TEMP TABLE review_command_fixture AS
SELECT public.review_report(
  '00000000-0000-0000-0000-000000000503',
  1,
  'revision_required',
  'Mohon tambahkan rincian progres.',
  'review-command-1'
) AS result;

SELECT is((SELECT result->>'success' FROM review_command_fixture), 'true', 'first command creates a decision');
SELECT ok(((SELECT result FROM review_command_fixture)->>'review_id') IS NOT NULL, 'first command returns review_id');
SELECT is(
  (public.review_report(
    '00000000-0000-0000-0000-000000000503',
    1,
    'revision_required',
    'Mohon tambahkan rincian progres.',
    'review-command-1'
  )->>'idempotent'),
  'true',
  'same command is returned as an idempotent retry'
);
SELECT is(
  (public.review_report(
    '00000000-0000-0000-0000-000000000503',
    1,
    'revision_required',
    'Mohon tambahkan rincian progres.',
    'review-command-1'
  )->>'review_id'),
  (SELECT result->>'review_id' FROM review_command_fixture),
  'retry returns the original review ID'
);
SELECT is(
  (public.review_report(
    '00000000-0000-0000-0000-000000000503',
    1,
    'revision_required',
    'payload berbeda',
    'review-command-1'
  )->>'code'),
  'IDEMPOTENCY_CONFLICT',
  'same key with a different payload is rejected'
);

SELECT is(
  (public.review_report(
    '00000000-0000-0000-0000-000000000503',
    1,
    'approved',
    '',
    'review-command-2'
  )->>'success'),
  'true',
  'a distinct command may create another decision for the same revision'
);

SELECT is(
  (public.review_report(
    '00000000-0000-0000-0000-000000000505',
    1,
    'approved',
    '',
    'review-command-missing-recipient'
  )->>'code'),
  'NOTIFICATION_RECIPIENT_UNAVAILABLE',
  'missing recipient fails closed'
);

-- Audit and durable push events are part of the same transaction.
SELECT public.review_report(
  '00000000-0000-0000-0000-000000000503',
  1,
  'revision_required',
  'Mohon tambahkan rincian progres.',
  'review-command-1'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
   WHERE target_id = '00000000-0000-0000-0000-000000000503'
     AND event_name IN ('report.review_revision_required', 'report.review_approved')),
  2,
  'every persisted decision has exactly one audit record after retries'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
   WHERE target_id = '00000000-0000-0000-0000-000000000503'
     AND actor_id = '00000000-0000-0000-0000-000000000502'),
  2,
  'audit records use the authenticated actor, not a client-supplied identity'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
   WHERE target_id = '00000000-0000-0000-0000-000000000503'
     AND event_name = 'report.review_revision_required'),
  1,
  'audit event semantics match the decision type'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE user_id = '00000000-0000-0000-0000-000000000501'
     AND reference_id IN (
       SELECT review_id::text FROM public.report_review_idempotency
       WHERE report_id = '00000000-0000-0000-0000-000000000503'
     )),
  2,
  'each decision persists one durable notification event keyed by review ID'
);
SELECT is(
  (SELECT count(DISTINCT notification_type)::int FROM public.notifications
   WHERE user_id = '00000000-0000-0000-0000-000000000501'
     AND reference_id IN (
       SELECT review_id::text FROM public.report_review_idempotency
       WHERE report_id = '00000000-0000-0000-0000-000000000503'
     )),
  2,
  'notification types follow the decision (approved / revision_required)'
);
SELECT is(
  (SELECT count(*)::int FROM public.notification_push_outbox o
   JOIN public.notifications n ON n.id = o.notification_id
   WHERE n.user_id = '00000000-0000-0000-0000-000000000501'
     AND n.reference_id IN (
       SELECT review_id::text FROM public.report_review_idempotency
       WHERE report_id = '00000000-0000-0000-0000-000000000503'
     )),
  2,
  'the push outbox enqueue trigger commits with each decision'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.report_reviews
   WHERE report_id = '00000000-0000-0000-0000-000000000503' AND revision_no = 1),
  2,
  'multiple decisions for one report revision are preserved'
);
SELECT is(
  (SELECT count(DISTINCT id)::int FROM public.report_reviews
   WHERE report_id = '00000000-0000-0000-0000-000000000503' AND revision_no = 1),
  2,
  'each decision has a distinct stable review ID'
);
SELECT is(
  (SELECT count(*)::int FROM public.report_review_idempotency
   WHERE report_id = '00000000-0000-0000-0000-000000000503'),
  2,
  'each command has its own idempotency record'
);
SELECT is(
  (SELECT count(*)::int FROM public.email_outbox
   WHERE reference_type = 'report_review_email'
     AND reference_id IN (
       SELECT review_id::text FROM public.report_review_idempotency
       WHERE report_id = '00000000-0000-0000-0000-000000000503'
     )),
  2,
  'each persisted decision has one canonical email event'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.report_reviews'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%UNIQUE%report_id%revision_no%'
  ),
  'no report/revision uniqueness constraint collapses decisions'
);
SELECT is(
  (SELECT count(*)::int FROM public.report_review_idempotency
   WHERE review_id IS NOT NULL AND status = 'completed'),
  2,
  'completed commands retain their review results'
);
SELECT is(
  (SELECT count(*)::int FROM public.report_reviews
   WHERE report_id = '00000000-0000-0000-0000-000000000505'),
  0,
  'missing recipient leaves no review decision behind'
);
SELECT is(
  (SELECT count(*)::int FROM public.report_review_idempotency
   WHERE report_id = '00000000-0000-0000-0000-000000000505'),
  0,
  'missing recipient leaves no idempotency record behind'
);

-- Audit insertion failure must roll back the whole review command.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'audit-drill-owner@example.test', 'not-a-password',
  now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES ('00000000-0000-0000-0000-000000000506', 'audit-drill-owner@example.test', 'Audit Drill Owner', 'active', 'santri');
INSERT INTO public.daily_reports (id, user_id, report_date, submission_status, review_status, revision_no)
VALUES ('00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000506',
  DATE '2026-11-20', 'submitted', 'not_reviewed', 1);

CREATE FUNCTION public.tg_fail_audit_drill()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_id = '00000000-0000-0000-0000-000000000507' THEN
    RAISE EXCEPTION 'AUDIT_DRILL_FAILURE';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_fail_audit_drill
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_fail_audit_drill();

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000502"}',
  true
);
SELECT is(
  (public.review_report(
    '00000000-0000-0000-0000-000000000507',
    1,
    'approved',
    '',
    'review-command-audit-failure'
  )->>'success'),
  'false',
  'audit insertion failure fails the whole command'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.report_reviews
   WHERE report_id = '00000000-0000-0000-0000-000000000507'),
  0,
  'audit failure rolls back the review decision'
);
SELECT is(
  (SELECT count(*)::int FROM public.report_review_idempotency
   WHERE report_id = '00000000-0000-0000-0000-000000000507'),
  0,
  'audit failure rolls back the idempotency record'
);
SELECT is(
  (SELECT count(*)::int FROM public.email_outbox
   WHERE recipient = 'audit-drill-owner@example.test'),
  0,
  'audit failure rolls back the email outbox event'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE user_id = '00000000-0000-0000-0000-000000000506'),
  0,
  'audit failure rolls back the durable push event'
);

DROP TRIGGER trg_fail_audit_drill ON public.audit_logs;
DROP FUNCTION public.tg_fail_audit_drill();

-- Grants: the idempotency ledger and the RPC stay locked down.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000502"}',
  true
);
SELECT throws_ok(
  'SELECT * FROM public.report_review_idempotency',
  '42501', NULL,
  'authenticated cannot read the idempotency ledger directly'
);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.review_report(
    '00000000-0000-0000-0000-000000000503', 1, 'approved', '', 'anon-key'
  )$$,
  '42501', NULL,
  'anon cannot execute the review RPC'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
