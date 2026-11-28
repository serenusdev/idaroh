BEGIN;
DROP FUNCTION IF EXISTS public.create_academic_term(text,text,date,date);
COMMIT;
NOTIFY pgrst, 'reload schema';
