-- OPS-12: existing and new users keep attendance reminders enabled by default.
-- Keep profile RLS and restricted column grants unchanged. Authenticated server
-- actions use the guarded service-role client for this caller-only preference.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS attendance_reminder_enabled boolean NOT NULL DEFAULT true;
