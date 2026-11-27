BEGIN;
DROP TABLE IF EXISTS public.stored_files;
COMMIT;
NOTIFY pgrst, 'reload schema';
