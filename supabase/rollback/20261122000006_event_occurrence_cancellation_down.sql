-- Rollback: 20261122000006_event_occurrence_cancellation_down.sql
-- Removes the SCH-01 per-occurrence cancellation surface and leaves the
-- whole-series status column exactly as it was before the migration: nothing in
-- this migration wrote to events.status, so no data repair is needed on the way
-- back. The exception rows themselves are the only state, and they are dropped
-- with the table.
--
-- Guarded with IF EXISTS throughout so a rollback interrupted halfway can be
-- replayed without an "does not exist" error.

BEGIN;

DROP POLICY IF EXISTS "Schedule managers can read occurrence exceptions" ON public.event_occurrence_exceptions;

DROP FUNCTION IF EXISTS public.event_occurrence_set(uuid, date, boolean, text);
DROP FUNCTION IF EXISTS app.event_occurrence_set(uuid, date, boolean, text);
DROP FUNCTION IF EXISTS app.is_event_occurrence_cancelled(uuid, date);

DROP TABLE IF EXISTS public.event_occurrence_exceptions;

NOTIFY pgrst, 'reload schema';

COMMIT;
