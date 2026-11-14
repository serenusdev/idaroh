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

-- Make username unique (deduplicate by appending row number where needed)
-- Step: assign unique usernames to any duplicates by appending _N
DO $$
DECLARE
  r record;
  n integer;
BEGIN
  FOR r IN
    SELECT username, array_agg(id ORDER BY created_at) AS ids
    FROM public.profiles
    WHERE username IS NOT NULL
    GROUP BY username
    HAVING count(*) > 1
  LOOP
    n := 2;
    FOREACH r.ids[n:] SLICE 0 IN ARRAY r.ids[2:] LOOP
      UPDATE public.profiles
      SET username = r.username || '_' || n
      WHERE id = r.ids[n];
      n := n + 1;
    END LOOP;
  END LOOP;
END $$;

-- Add unique index after dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username)
  WHERE username IS NOT NULL;

COMMIT;
