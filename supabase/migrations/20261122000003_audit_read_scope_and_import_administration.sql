-- SEC-05 / LIB-01 — audit-log readers and library imports must match
-- PERMISSIONS.md §3.8 (`admin.audit.read`) and §3.2 (`library.import.run`).
--
-- §3.8: `admin.audit.read` is yayasan/super_admin and is written as
--   "Ditolak untuk pengurus (baik di Server Action maupun RLS audit_logs)".
--   The shipped RLS policy and app.verify_audit_chain() both still listed
--   'pengurus', so the denial existed only in prose.
-- §3.2: `library.import.run` is exclusive to super_admin. The batch log written
--   by an import is part of that administrative surface, so its SELECT policy
--   follows the same role as the action that fills it.

-- 1. audit_logs: yayasan + super_admin only ------------------------------
DROP POLICY IF EXISTS "Audit logs are viewable by authorized administrators" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit logs are viewable by yayasan and super admin" ON public.audit_logs;

CREATE POLICY "Audit logs are viewable by yayasan and super admin"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (
    app.is_active_member()
    AND app.has_any_role('super_admin', 'yayasan')
  );

-- 2. app.verify_audit_chain(): same reader set as the table it walks ------
-- The RPC is SECURITY DEFINER, so it reads audit_logs as the owner and the
-- policy above never applies to it. Its own guard is the enforcement point.
CREATE OR REPLACE FUNCTION app.verify_audit_chain()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, app, pg_temp
STABLE
AS $$
DECLARE
  v_row record;
  v_previous text := 'GENESIS';
  v_expected text;
  v_canonical text;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT app.has_any_role('super_admin', 'yayasan') THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Tidak memiliki akses memverifikasi audit chain.');
  END IF;
  FOR v_row IN
    SELECT * FROM public.audit_logs ORDER BY created_at ASC, id ASC
  LOOP
    v_canonical := concat_ws('|',
      v_previous,
      v_row.id::text,
      v_row.created_at::text,
      COALESCE(v_row.actor_id::text, ''),
      COALESCE(v_row.event_name, ''),
      COALESCE(v_row.actor_name, ''),
      COALESCE(v_row.target_id, ''),
      COALESCE(v_row.target_label, ''),
      COALESCE(v_row.action_detail, ''),
      COALESCE(v_row.payload::text, '{}')
    );
    v_expected := 'sha256:' || encode(extensions.digest(v_canonical, 'sha256'), 'hex');
    IF v_row.previous_hash IS DISTINCT FROM v_previous OR v_row.hash IS DISTINCT FROM v_expected THEN
      RETURN jsonb_build_object('valid', false, 'checked', v_count, 'failed_id', v_row.id, 'message', 'Audit chain tidak valid.');
    END IF;
    v_previous := v_row.hash;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('valid', true, 'checked', v_count, 'message', 'Audit chain valid.');
END;
$$;
REVOKE ALL ON FUNCTION app.verify_audit_chain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_audit_chain() TO authenticated;

-- public.verify_audit_chain() (20261105000004) is SECURITY INVOKER and only
-- forwards to app's implementation, so it inherits the narrowed guard.

-- 3. resource_import_batches: the import log follows the import permission
DROP POLICY IF EXISTS "Resource admins can view import batches" ON public.resource_import_batches;
DROP POLICY IF EXISTS "Super admin can view import batches" ON public.resource_import_batches;

CREATE POLICY "Super admin can view import batches"
  ON public.resource_import_batches FOR SELECT TO authenticated
  USING (app.is_active_member() AND app.has_role('super_admin'));

REVOKE INSERT, UPDATE, DELETE ON public.resource_import_batches FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
