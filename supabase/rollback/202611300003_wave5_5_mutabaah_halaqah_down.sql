BEGIN;
DROP FUNCTION IF EXISTS public.save_halaqah_log(uuid, date, text, text, integer, integer, text, text, text);
DROP FUNCTION IF EXISTS public.save_mutabaah_log(uuid, jsonb);
DROP TABLE IF EXISTS public.halaqah_logs;
DROP TABLE IF EXISTS public.mutabaah_logs;
NOTIFY pgrst, 'reload schema';
COMMIT;
