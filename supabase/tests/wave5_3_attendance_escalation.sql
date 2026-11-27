BEGIN;
SELECT plan(15);

SELECT has_column('public','attendance_records','status','attendance status exists');
SELECT has_column('public','attendance_records','late_minutes','late minutes exists');
SELECT has_table('public','notification_dispatches','notification dispatch ledger exists');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relname = 'notification_dispatches'
    AND c.contype = 'u' AND c.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'user_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'dispatch_date'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'stage')
    ]::smallint[]
), 'dispatch uniqueness is composite');
SELECT has_function('public','check_in_attendance', ARRAY['jsonb'],'new check-in RPC exists');
SELECT has_function('public','attendance_today_status', ARRAY[]::text[],'server status RPC exists');
SELECT has_function('app','wave5_3_classify_time', ARRAY['time'],'deterministic WIB classifier exists');
SELECT is((app.wave5_3_classify_time(TIME '08:14:59')->>'status'), 'present', '08:14:59 is present');
SELECT is((app.wave5_3_classify_time(TIME '08:14:59')->>'late_minutes'), '0', '08:14:59 has zero late minutes');
SELECT is((app.wave5_3_classify_time(TIME '08:15:00')->>'status'), 'present', '08:15:00 is still present');
SELECT is((app.wave5_3_classify_time(TIME '08:15:00')->>'late_minutes'), '0', '08:15:00 has zero late minutes');
SELECT is((app.wave5_3_classify_time(TIME '08:15:01')->>'status'), 'late', '08:15:01 is late');
SELECT is((app.wave5_3_classify_time(TIME '08:15:01')->>'late_minutes'), '1', '08:15:01 counts one late minute');
SELECT ok(NOT has_table_privilege('anon','public.notification_dispatches','SELECT'), 'anon cannot read dispatch ledger');
SELECT ok(has_table_privilege('authenticated','public.notification_dispatches','SELECT'), 'authenticated access remains RLS-gated');

SELECT * FROM finish();
ROLLBACK;
