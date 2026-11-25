-- Rollback for: 20261122000004_task_command_scope_alignment.sql
-- Restores, verbatim: app.can_access_task as shipped by
-- 20261105000001_audit_followup_batch_scope.sql, the projects SELECT,
-- attachment DELETE and tasks UPDATE policies from
-- 20261102000005_audit_hardening.sql, public.validate_task_transition() from
-- 20261102000016_integrity_guardrails.sql, and app.task_transition from
-- 20261102000005_audit_hardening.sql (elevated bypass, no audit ledger).
-- NOTE: this returns the system to the SEC-04/TASK-01 finding state and is
-- only for incident recovery, not for normal operation.

BEGIN;

CREATE OR REPLACE FUNCTION app.can_access_task(p_task_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, pg_temp
STABLE
AS $$
  SELECT app.is_active_member() AND EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.deleted_at IS NULL
      AND (
        t.created_by = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.task_assignees ta
          WHERE ta.task_id = t.id AND ta.user_id = p_user_id AND ta.unassigned_at IS NULL
        )
        OR app.has_any_role('super_admin', 'yayasan', 'pengurus')
        OR (t.visibility = 'organization' AND app.has_any_role('koordinator', 'santri'))
        OR (
          t.visibility = 'team' AND EXISTS (
            SELECT 1
            FROM public.team_members tm
            JOIN public.teams team ON team.id = tm.team_id
            WHERE tm.user_id = p_user_id
              AND tm.valid_to IS NULL
              AND (t.team_id = team.id::text OR t.team_id = team.slug OR t.team_id = team.name)
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION app.can_access_task(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_access_task(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;
CREATE POLICY "Users can view accessible projects"
  ON public.projects FOR SELECT TO authenticated
  USING (
    app.is_active_member() AND (
      owner_id = auth.uid() OR created_by = auth.uid() OR
      app.has_any_role('super_admin', 'yayasan', 'pengurus') OR
      EXISTS (
        SELECT 1 FROM public.team_members tm JOIN public.teams team ON team.id = tm.team_id
        WHERE tm.user_id = auth.uid() AND tm.valid_to IS NULL
          AND (projects.team_id = team.id::text OR projects.team_id = team.slug OR projects.team_id = team.name)
      )
    )
  );

DROP POLICY IF EXISTS "Attachment owners can delete accessible attachments" ON public.task_attachments;
CREATE POLICY "Attachment owners can delete accessible attachments"
  ON public.task_attachments FOR DELETE TO authenticated
  USING ((uploaded_by = auth.uid() OR app.has_any_role('super_admin', 'pengurus')) AND app.can_access_task(task_id));

CREATE POLICY "Task participants can update tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (app.can_access_task(id))
  WITH CHECK (app.can_access_task(id));

CREATE OR REPLACE FUNCTION public.validate_task_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  IF OLD.requires_review AND NOT NEW.requires_review AND OLD.status <> 'todo' THEN
    RAISE EXCEPTION 'Klausul review tidak dapat dihapus setelah tugas mulai dikerjakan.';
  END IF;

  IF NEW.status = 'done' AND OLD.requires_review AND NOT (
    OLD.status = 'in_review'
    AND (
      (auth.uid() IS NOT NULL AND (OLD.reviewer_id = auth.uid() OR app.has_any_role('super_admin', 'yayasan', 'pengurus')))
      OR (auth.uid() IS NULL AND current_user IN ('postgres', 'service_role'))
    )
  ) THEN
    RAISE EXCEPTION 'Tugas wajib review hanya dapat diselesaikan oleh reviewer atau administrator.';
  END IF;

  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) NOT IN (
    ('todo', 'in_progress'), ('todo', 'cancelled'),
    ('in_progress', 'todo'), ('in_progress', 'in_review'), ('in_progress', 'done'), ('in_progress', 'cancelled'),
    ('in_review', 'in_progress'), ('in_review', 'done'), ('in_review', 'cancelled'),
    ('done', 'in_progress'), ('cancelled', 'todo')
  ) AND NOT (OLD.status = 'todo' AND NEW.status = 'done' AND NEW.requires_review = false) THEN
    RAISE EXCEPTION 'Transisi tugas % ke % tidak diizinkan.', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.task_transition(p_task_id uuid, p_new_status text, p_user_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_now timestamptz := now();
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF p_new_status NOT IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status tugas tidak valid.');
  END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT app.can_access_task(p_task_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tugas tidak ditemukan atau tidak dapat diakses.');
  END IF;
  v_allowed := v_task.created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.task_assignees ta WHERE ta.task_id = p_task_id AND ta.user_id = auth.uid() AND ta.unassigned_at IS NULL)
    OR app.has_any_role('super_admin', 'yayasan', 'pengurus');
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses untuk mengubah tugas ini.');
  END IF;
  IF v_task.requires_review AND v_task.status = 'in_review' AND p_new_status = 'done'
     AND NOT (v_task.reviewer_id = auth.uid() OR app.has_any_role('super_admin', 'yayasan', 'pengurus')) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Hanya reviewer yang dapat menyetujui tugas ini.');
  END IF;
  IF p_new_status = 'done' AND v_task.requires_review AND v_task.status <> 'in_review' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tugas ini memerlukan review sebelum selesai.');
  END IF;
  IF v_task.status = p_new_status THEN
    RETURN jsonb_build_object('success', true, 'new_status', p_new_status, 'message', 'Status tugas sudah sesuai.');
  END IF;
  UPDATE public.tasks SET status = p_new_status, completed_at = CASE WHEN p_new_status = 'done' THEN v_now ELSE NULL END, updated_at = v_now WHERE id = p_task_id;
  INSERT INTO public.task_status_history (task_id, from_status, to_status, changed_by, changed_at, note)
  VALUES (p_task_id, v_task.status, p_new_status, auth.uid(), v_now, p_note);
  RETURN jsonb_build_object('success', true, 'new_status', p_new_status, 'message', 'Status tugas berhasil diperbarui.');
END;
$$;

REVOKE ALL ON FUNCTION app.task_transition(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.task_transition(uuid, text, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
