BEGIN;
SELECT plan(9);

SELECT has_table('public','stored_files','stored_files exists');
SELECT col_is_pk('public','stored_files','id','stored_files has primary key');
SELECT col_is_unique('public','stored_files','gdrive_file_id','Drive id is unique');
SELECT policies_are('public','stored_files', ARRAY['stored_files_select','stored_files_insert','stored_files_update','stored_files_delete']);
SELECT ok(NOT has_table_privilege('anon','public.stored_files','SELECT'), 'anon cannot read file metadata directly');
SELECT ok(has_table_privilege('authenticated','public.stored_files','SELECT'), 'authenticated can pass through RLS for allowed files');
SELECT ok(has_table_privilege('authenticated','public.stored_files','INSERT'), 'authenticated has only RLS-gated insert capability');
SELECT ok(has_table_privilege('authenticated','public.stored_files','UPDATE'), 'authenticated update remains policy-gated');
SELECT ok(has_table_privilege('authenticated','public.stored_files','DELETE'), 'authenticated delete remains policy-gated');

SELECT * FROM finish();
ROLLBACK;
