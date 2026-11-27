BEGIN;
DROP FUNCTION IF EXISTS public.attendance_today_status();
DROP FUNCTION IF EXISTS public.check_in_attendance(jsonb);
DROP FUNCTION IF EXISTS app.wave5_3_classify_time(time);
DROP TABLE IF EXISTS public.notification_dispatches;
ALTER TABLE public.attendance_records
  DROP COLUMN IF EXISTS late_minutes,
  DROP COLUMN IF EXISTS status;
COMMIT;
NOTIFY pgrst, 'reload schema';
