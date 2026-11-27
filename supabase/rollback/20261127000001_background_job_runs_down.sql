-- Rollback 20261127000001_background_job_runs.sql
-- Drops the background-job ledger and the email backoff column added by JOB-01.
-- The outbox tables themselves (notification_push_outbox, email_outbox) are untouched:
-- reverting this migration only removes the durable job claims, so every step falls back
-- to the single /api/cron/notifications request path.

BEGIN;

DROP FUNCTION IF EXISTS public.complete_background_job(text, uuid, boolean, text, integer);
DROP FUNCTION IF EXISTS public.claim_background_job(text, integer, integer);

DROP INDEX IF EXISTS public.idx_email_outbox_due;
ALTER TABLE public.email_outbox DROP COLUMN IF EXISTS next_attempt_at;

DROP INDEX IF EXISTS public.idx_background_job_runs_due;
DROP TABLE IF EXISTS public.background_job_runs;

COMMIT;

NOTIFY pgrst, 'reload schema';
