BEGIN;
SELECT plan(13);

SELECT has_table('public','students','students exists');
SELECT has_table('public','academic_terms','academic_terms exists');
SELECT has_table('public','report_cards','report_cards exists');
SELECT has_table('public','batch_jobs','batch_jobs exists');
SELECT policies_are('public','students', ARRAY['students_admin_select','students_admin_write','students_self_select']);
SELECT policies_are('public','academic_terms', ARRAY['academic_terms_admin_select','academic_terms_admin_write']);
SELECT policies_are('public','report_cards', ARRAY['report_cards_admin_all','report_cards_student_published']);
SELECT policies_are('public','batch_jobs', ARRAY['batch_jobs_admin_all']);
SELECT has_function('public','verify_report_card_public', ARRAY['text'],'public verification RPC exists');
SELECT ok(has_function_privilege('anon', 'public.verify_report_card_public(text)', 'EXECUTE'), 'anonymous can call only the public verification RPC');
SELECT ok(has_function_privilege('authenticated', 'public.verify_report_card_public(text)', 'EXECUTE'), 'authenticated can call the public verification RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.upsert_wave5_report_card(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text)', 'EXECUTE'), 'anonymous cannot mutate report cards');
SELECT ok(NOT has_function_privilege('anon', 'public.sync_term_activity_to_report_cards(uuid)', 'EXECUTE'), 'anonymous cannot sync activity');

SELECT * FROM finish();
ROLLBACK;
