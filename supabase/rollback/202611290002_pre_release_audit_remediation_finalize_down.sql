BEGIN;

ALTER TABLE public.stored_files
  DROP CONSTRAINT IF EXISTS stored_files_folder_category_check;

ALTER TABLE public.stored_files
  ADD CONSTRAINT stored_files_folder_category_check
  CHECK (folder_category IN ('avatars','reports','resources','raw-imports','rapor'));

NOTIFY pgrst, 'reload schema';
COMMIT;
