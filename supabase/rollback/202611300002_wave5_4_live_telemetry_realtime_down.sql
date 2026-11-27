-- Publication membership is intentionally retained on rollback: removing it can disrupt
-- previously deployed realtime consumers. Identity settings are harmless and reversible.
ALTER TABLE public.attendance_records REPLICA IDENTITY DEFAULT;
ALTER TABLE public.daily_reports REPLICA IDENTITY DEFAULT;
ALTER TABLE public.tasks REPLICA IDENTITY DEFAULT;
NOTIFY pgrst, 'reload schema';
