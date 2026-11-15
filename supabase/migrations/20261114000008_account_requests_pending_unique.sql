-- OPS-02: enforce "at most one pending account request per email" at the DB layer.
-- The application guard (maybeSingle on email+status) can race under concurrent
-- submissions; a partial unique index makes the invariant atomic. Approved or
-- rejected rows leave the index, so a fresh application is allowed afterwards.
--
-- OPERATOR PREREQUISITE: resolve any existing duplicate pending emails before
-- applying, otherwise CREATE UNIQUE INDEX fails. Inspect with:
--   SELECT lower(email), count(*) FROM public.account_requests
--   WHERE status = 'pending' GROUP BY lower(email) HAVING count(*) > 1;
-- This migration only adds an index; it never deletes or mutates existing rows.

CREATE UNIQUE INDEX IF NOT EXISTS account_requests_one_pending_per_email
  ON public.account_requests (lower(email))
  WHERE status = 'pending';