-- Rollback: 20261122000008_event_command_scope_down.sql
-- SCH-02 undone. No agenda row is touched: the command RPCs, the audience helper and
-- the events trigger are dropped, so event writes go back to being service-role writes
-- validated only by the application layer (the state this migration was meant to end).
BEGIN;

DROP TRIGGER IF EXISTS trg_events_audience_scope ON public.events;

DROP FUNCTION IF EXISTS public.event_cancel(uuid, text, text);
DROP FUNCTION IF EXISTS app.event_cancel(uuid, text, text);
DROP FUNCTION IF EXISTS public.event_upsert(uuid, jsonb, text);
DROP FUNCTION IF EXISTS app.event_upsert(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.can_write_event_audience(jsonb, text, uuid);
DROP FUNCTION IF EXISTS app.can_write_event_audience(jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.coordinator_team_keys();
DROP FUNCTION IF EXISTS app.coordinator_team_keys(uuid);
DROP FUNCTION IF EXISTS app.enforce_event_audience_scope();

NOTIFY pgrst, 'reload schema';

COMMIT;
