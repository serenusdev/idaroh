BEGIN;
DROP FUNCTION IF EXISTS public.refresh_gate_pass_overdue();
DROP FUNCTION IF EXISTS public.scan_gate_pass(text,text);
DROP FUNCTION IF EXISTS public.approve_gate_pass(uuid,boolean);
DROP FUNCTION IF EXISTS public.request_gate_pass(uuid,text,text,timestamptz);
DROP TABLE IF EXISTS public.gate_passes;
COMMIT;
NOTIFY pgrst, 'reload schema';
