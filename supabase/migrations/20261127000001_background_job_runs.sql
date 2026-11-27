-- JOB-01: a durable ledger for the background steps that today only run inside one
-- long cron HTTP request. The outbox tables stay the queue of record; this table only
-- holds one row per named job so a claim, a lease and a failure history survive the
-- request that made them. Service-role internals: no client can read or write it, and
-- every mutation goes through the two fenced RPCs below.
--
-- Replay-safe (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS): production may already
-- carry these objects from out-of-band application.

BEGIN;

CREATE TABLE IF NOT EXISTS public.background_job_runs (
  job_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'completed', 'failed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_started_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'running') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_background_job_runs_due
  ON public.background_job_runs(next_attempt_at) WHERE status <> 'running';

ALTER TABLE public.background_job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.background_job_runs FROM PUBLIC, anon, authenticated;
-- Read-only for the service role: the ledger only changes shape through the RPCs.
GRANT SELECT, UPDATE ON public.background_job_runs TO service_role;

-- The email queue retries on the same backoff the push queue already had. Before this
-- column a failing row was retried on every tick, so a provider outage burned all five
-- attempts within a few minutes and then went to 'failed' permanently.
ALTER TABLE public.email_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_email_outbox_due
  ON public.email_outbox(next_attempt_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.claim_background_job(
  p_job_key text,
  p_lease_seconds integer DEFAULT 60,
  p_max_attempts integer DEFAULT 5
)
RETURNS TABLE (job_key text, lease_token uuid, attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_job_key IS NULL OR p_job_key !~ '^[a-z0-9][a-z0-9-]{0,63}$' THEN
    RAISE EXCEPTION 'Invalid background job key';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 900 THEN
    RAISE EXCEPTION 'Background job lease window out of range';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Background job attempt limit out of range';
  END IF;

  INSERT INTO public.background_job_runs (job_key, max_attempts)
  VALUES (p_job_key, p_max_attempts)
  ON CONFLICT (job_key) DO NOTHING;

  RETURN QUERY
  WITH picked AS (
    SELECT r.job_key AS picked_key
    FROM public.background_job_runs r
    WHERE r.job_key = p_job_key
      AND r.next_attempt_at <= now()
      -- A crashed runner must not strand the job: an expired lease is claimable again.
      AND (r.status <> 'running' OR (r.status = 'running' AND r.lease_until <= now()))
    ORDER BY r.next_attempt_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.background_job_runs r SET
    status = 'running',
    attempt_count = r.attempt_count + 1,
    lease_token = v_token,
    lease_until = now() + make_interval(secs => p_lease_seconds),
    last_started_at = now(),
    updated_at = now()
  FROM picked p
  WHERE r.job_key = p.picked_key
  RETURNING r.job_key, r.lease_token, r.attempt_count;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_background_job(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_background_job(text, integer, integer) TO service_role;

-- Fenced by the lease token, like the push outbox: a worker that lost its lease can
-- never overwrite the state a newer runner owns. Returns the resulting status so the
-- caller can report dead_letter rather than a retryable failure.
CREATE OR REPLACE FUNCTION public.complete_background_job(
  p_job_key text,
  p_lease_token uuid,
  p_ok boolean,
  p_error text DEFAULT NULL,
  p_max_attempts integer DEFAULT 5
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_lease_token IS NULL THEN
    RAISE EXCEPTION 'Background job lease token required';
  END IF;

  UPDATE public.background_job_runs r SET
    status = CASE
      WHEN p_ok THEN 'completed'
      WHEN r.attempt_count >= LEAST(r.max_attempts, p_max_attempts) THEN 'dead_letter'
      ELSE 'failed'
    END,
    attempt_count = CASE WHEN p_ok THEN 0 ELSE r.attempt_count END,
    consecutive_failures = CASE WHEN p_ok THEN 0 ELSE r.consecutive_failures + 1 END,
    -- A dead-lettered job still gets retried, just slowly: the ledger is a job runner,
    -- not a message, and a permanent stop would silently end delivery.
    next_attempt_at = CASE WHEN p_ok THEN now()
      ELSE now() + make_interval(secs => LEAST(3600, 30 * power(2, GREATEST(r.attempt_count - 1, 0))::integer))
    END,
    last_error = CASE WHEN p_ok THEN NULL ELSE left(NULLIF(trim(COALESCE(p_error, '')), ''), 200) END,
    last_success_at = CASE WHEN p_ok THEN now() ELSE r.last_success_at END,
    lease_token = NULL,
    lease_until = NULL,
    updated_at = now()
  WHERE r.job_key = p_job_key AND r.status = 'running'
    AND r.lease_token = p_lease_token AND r.lease_until > now()
  RETURNING r.status INTO v_status;

  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_background_job(text, uuid, boolean, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_background_job(text, uuid, boolean, text, integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
