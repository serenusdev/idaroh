BEGIN;

ALTER TABLE public.backup_runs
  DROP CONSTRAINT IF EXISTS backup_runs_status_check;

-- Previous completed runs only counted database rows, including storage/restore requests.
UPDATE public.backup_runs
SET status = 'manifest_only'
WHERE status = 'completed';

-- This placeholder is not a backup artifact, regardless of the run status.
UPDATE public.backup_runs
SET artifact_ref = NULL
WHERE artifact_ref = 'Supabase PITR / provider backup';

ALTER TABLE public.backup_runs
  ADD CONSTRAINT backup_runs_status_check
  CHECK (status IN ('started', 'manifest_only', 'backup_verified', 'restore_verified', 'failed'));

COMMIT;
