-- =============================================================================
-- Migration: 20261114000005_task_reviewer_mention_username.sql
-- Batch B — TRC-22 + TRC-23
-- Adds `username` to profiles for @mention resolution in task comments.
-- `reviewer_id` already exists on tasks (20261101000005).
-- =============================================================================

BEGIN;

-- 1. Add username column to profiles (nullable, unique slug for @mention)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

-- Populate existing rows: lowercase full_name, spaces → underscores, strip non-alphanum/underscore
UPDATE public.profiles
SET username = lower(regexp_replace(regexp_replace(full_name, '[^A-Za-z0-9 _]', '', 'g'), '\s+', '_', 'g'))
WHERE username IS NULL;

-- Make username unique: rename every row after the first per username,
-- appending _N and skipping candidates that already exist.
DO $$
DECLARE
  r record;
  candidate text;
  n integer;
BEGIN
  FOR r IN
    SELECT id, username
    FROM (
      SELECT id, username,
             row_number() OVER (PARTITION BY username ORDER BY created_at, id) AS rn
      FROM public.profiles
      WHERE username IS NOT NULL
    ) ranked
    WHERE rn > 1
  LOOP
    n := 2;
    candidate := r.username || '_' || n;
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate) LOOP
      n := n + 1;
      candidate := r.username || '_' || n;
    END LOOP;
    UPDATE public.profiles SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- Add unique index after dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username)
  WHERE username IS NOT NULL;

COMMIT;
