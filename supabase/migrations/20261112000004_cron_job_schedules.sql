-- Admin-editable cron schedules. Deployment keeps only a fixed heartbeat tick;
-- this table decides when each job actually runs.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cron_job_schedules (
  job_key text PRIMARY KEY,
  label text NOT NULL,
  time_wib text NOT NULL CHECK (time_wib ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days_of_week smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT cron_job_schedules_days_valid
    CHECK (cardinality(days_of_week) > 0 AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);

ALTER TABLE public.cron_job_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_job_schedules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cron_job_schedules TO service_role;

INSERT INTO public.cron_job_schedules (job_key, label, time_wib, days_of_week) VALUES
  ('attendance_reminder', 'Pengingat presensi pagi', '07:30', '{1,2,3,4,5,6}'),
  ('report_reminder', 'Pengingat laporan harian', '21:00', '{1,2,3,4,5,6}'),
  ('backup_manifest', 'Manifest database harian', '00:30', '{0,1,2,3,4,5,6}')
ON CONFLICT (job_key) DO NOTHING;

COMMIT;