-- Rollback: 20261122000014_announcement_command_scope_down.sql
-- ANN undone. No announcement row is touched: the command RPCs, the audience helper and the
-- announcements trigger are dropped and the direct write path is handed back, so announcement
-- writes go back to being service-role writes validated only by the application layer — the
-- state this migration was meant to end. Re-deploy the pre-migration application build together
-- with this file: the current build calls announcement_upsert()/announcement_archive(), which do
-- not exist afterwards, and reads the feed through RLS, which still has no write policy.
--
-- Run order matters: the SELECT-only grant stays (20261102000005's policy is untouched), and the
-- revokes below only restore the privileges the migration removed.
BEGIN;

DROP TRIGGER IF EXISTS trg_announcements_audience_scope ON public.announcements;

DROP FUNCTION IF EXISTS public.announcement_archive(uuid, text);
DROP FUNCTION IF EXISTS app.announcement_archive(uuid, text);
DROP FUNCTION IF EXISTS public.announcement_upsert(uuid, jsonb, text);
DROP FUNCTION IF EXISTS app.announcement_upsert(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.can_write_announcement_audience(jsonb, text, uuid);
DROP FUNCTION IF EXISTS app.can_write_announcement_audience(jsonb, text, uuid);
-- The trigger body has no PostgREST wrapper, so only the app. schema holds it.
DROP FUNCTION IF EXISTS app.enforce_announcement_audience_scope();

-- Restore the write path the pre-migration application used. anon is deliberately left out: it
-- carried the default privilege but no code ever wrote an announcement unauthenticated, and a
-- rollback should not hand back a door nobody walked through. RLS still decides — the table has
-- a FOR SELECT policy only, so these privileges stay inert until a write policy appears.
GRANT INSERT, UPDATE, DELETE ON public.announcements TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
