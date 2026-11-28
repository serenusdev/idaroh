BEGIN;
DROP FUNCTION IF EXISTS public.save_mutabaah_log_for_date(uuid, date, jsonb);
COMMIT;
NOTIFY pgrst, 'reload schema';
