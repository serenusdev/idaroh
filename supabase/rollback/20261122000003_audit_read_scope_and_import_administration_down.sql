-- Rollback for 20261122000003_audit_read_scope_and_import_administration.sql
-- Restores the pre-SEC-05 / pre-LIB-01 state exactly as shipped by
-- 20261102000015_notifications_audit_integrity.sql and
-- 20261103000001_resource_import_batches.sql.

BEGIN;

DROP POLICY IF EXISTS "Audit logs are viewable by yayasan and super admin" ON public.audit_logs;
CREATE POLICY "Audit logs are viewable by authorized administrators"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (app.is_active_member() AND app.has_any_role('super_admin', 'yayasan', 'pengurus'));

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
  IF auth.uid() IS NULL OR NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
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

DROP POLICY IF EXISTS "Super admin can view import batches" ON public.resource_import_batches;
CREATE POLICY "Resource admins can view import batches"
  ON public.resource_import_batches FOR SELECT TO authenticated
  USING (app.has_any_role('super_admin', 'yayasan', 'pengurus'));

COMMIT;

NOTIFY pgrst, 'reload schema';
