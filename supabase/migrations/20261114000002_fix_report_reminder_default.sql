-- TRC-07: Change report_reminder default time from 21:00 to 19:30.
-- PRD-04 REP-014 requires the reminder to arrive BEFORE the 21:00 deadline,
-- not at the deadline itself. 19:30 matches the PRD example.
-- Uses ON CONFLICT DO UPDATE so the row is updated whether or not the seed
-- migration (20261112000004) has already run.

BEGIN;

INSERT INTO public.cron_job_schedules (job_key, label, time_wib, days_of_week)
VALUES ('report_reminder', 'Pengingat laporan harian', '19:30', '{1,2,3,4,5,6}')
ON CONFLICT (job_key) DO UPDATE
  SET time_wib   = '19:30',
      updated_at = now();

COMMIT;
