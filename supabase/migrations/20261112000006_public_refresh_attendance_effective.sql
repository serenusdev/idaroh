-- Migration: 20261112000006_public_refresh_attendance_effective
-- Purpose: The cron notifications endpoint calls
--          supabase.rpc("refresh_attendance_effective") with the service role,
--          but only app.refresh_attendance_effective existed. PostgREST only
--          exposes the public schema, so add the thin wrapper here.

CREATE OR REPLACE FUNCTION public.refresh_attendance_effective(p_date date)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.refresh_attendance_effective(p_date);
$$;

REVOKE ALL ON FUNCTION public.refresh_attendance_effective(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_attendance_effective(date) TO service_role;