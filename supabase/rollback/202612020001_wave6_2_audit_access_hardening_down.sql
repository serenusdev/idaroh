BEGIN;
REVOKE ALL ON public.audit_logs, public.export_logs FROM PUBLIC, anon;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT INSERT ON public.export_logs TO authenticated;
GRANT ALL ON public.audit_logs, public.export_logs TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
