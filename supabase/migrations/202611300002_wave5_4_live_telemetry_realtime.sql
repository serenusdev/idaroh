-- Wave 5.4: make the source tables observable by authenticated dashboard clients.
-- No data or permission broadening is introduced here; Realtime still evaluates table RLS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance_records') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'daily_reports') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_reports;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tasks') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
    END IF;
  END IF;
END
$$;

ALTER TABLE public.attendance_records REPLICA IDENTITY FULL;
ALTER TABLE public.daily_reports REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
