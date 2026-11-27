BEGIN;
SELECT plan(18);

SELECT has_table('public', 'mutabaah_logs', 'mutabaah_logs tersedia');
SELECT has_table('public', 'halaqah_logs', 'halaqah_logs tersedia');
SELECT has_column('public', 'mutabaah_logs', 'student_id', 'mutabaah mengikat student_id');
SELECT has_column('public', 'mutabaah_logs', 'log_date', 'mutabaah memiliki log_date');
SELECT has_column('public', 'mutabaah_logs', 'checklist', 'mutabaah memiliki checklist JSONB');
SELECT has_column('public', 'mutabaah_logs', 'recorded_by', 'mutabaah memiliki recorded_by');
SELECT has_column('public', 'halaqah_logs', 'student_id', 'halaqah mengikat student_id');
SELECT has_column('public', 'halaqah_logs', 'entry_type', 'halaqah memiliki entry_type');
SELECT has_column('public', 'halaqah_logs', 'ustadz_id', 'halaqah memiliki ustadz_id');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mutabaah_logs'::regclass), 'mutabaah RLS aktif');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.halaqah_logs'::regclass), 'halaqah RLS aktif');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.mutabaah_logs'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (student_id, log_date)'
), 'mutabaah unik per santri dan hari');
SELECT has_function('public', 'save_mutabaah_log', ARRAY['uuid', 'jsonb'], 'RPC mutabaah tersedia');
SELECT has_function('public', 'save_halaqah_log', ARRAY['uuid', 'date', 'text', 'text', 'integer', 'integer', 'text', 'text', 'text'], 'RPC halaqah tersedia');

SELECT ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('mutabaah_logs', 'halaqah_logs') AND grantee = 'anon'), 'anon tidak memiliki grant tabel');
SELECT ok(NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges WHERE routine_schema = 'public' AND routine_name IN ('save_mutabaah_log', 'save_halaqah_log') AND grantee = 'anon'), 'anon tidak memiliki grant RPC');
SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mutabaah_logs' AND policyname = 'mutabaah_read_scope'), 'mutabaah memiliki policy scope');
SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'halaqah_logs' AND policyname = 'halaqah_read_scope'), 'halaqah memiliki policy scope');

SELECT * FROM finish();
ROLLBACK;
