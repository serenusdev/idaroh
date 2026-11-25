-- CRON-DAY (Gelombang 3, catatan TEMPORAL §7 yang disetujui operator 2026-11-25).
--
-- 20261122000011 put the day rule in app.is_operational_day(date): a day is operational unless it
-- is Sunday or the pondok calendar marks it closed. That function lives in the private "app"
-- schema, so PostgREST cannot expose it and the notification cron has never been able to ask.
--
-- Today the reminder audience comes from the snapshot layer, which hides closed days only while
-- refresh_attendance_effective succeeds; the route's fallback derives the audience from
-- attendance_records instead, and the admin weekday picker (src/app/(app)/admin/cron/page.tsx:12)
-- offers Sunday as a selectable day. Either case can send "Batas waktu presensi pagi hampir
-- ditutup" on a day nobody is expected to attend.
--
-- This wrapper exposes the single existing answer to the cron. It deliberately contains no date
-- arithmetic of its own: duplicating the rule here is exactly how the previous Sunday defect
-- drifted away from the snapshot layer.
--
-- Grants stay narrow. The reminder list belongs to the delivery job; letting an authenticated
-- account enumerate which dates the pondok considers non-operational through the API would turn an
-- operational detail into a readable list.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_operational_day(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.is_operational_day(p_date);
$$;

REVOKE ALL ON FUNCTION public.is_operational_day(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_operational_day(date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_operational_day(date) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
