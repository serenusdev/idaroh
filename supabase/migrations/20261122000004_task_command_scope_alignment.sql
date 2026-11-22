-- Migration: 20261122000004_task_command_scope_alignment.sql
-- SEC-04 + TASK-01: align the Tasks & Projects command surface with
-- PERMISSIONS.md §3.5 and the locked decision D4.
--
-- Current state: app.can_access_task, the projects SELECT policy, the
-- attachment DELETE policy and app.task_transition all short-circuit on
-- app.has_any_role('super_admin', 'yayasan', 'pengurus'). §3.5 marks every
-- Tasks/Projects row `—` for super_admin, so that branch handed the platform
-- administrator read, transition and delete rights over santri work. The same
-- branch made yayasan a daily operator, which D4 denies: yayasan keeps
-- task.cancel/reopen and loses task.update_status/task.review. Coordinator was
-- the mirror image: team read scope but no team transition right at all.
--
-- After this migration:
--   * task.read / project.read: santri own+assigned+organization, koordinator
--     team, pengurus and yayasan all, super_admin none.
--   * task.update_status: creator or active assignee, koordinator of the task
--     team (new), pengurus all. Yayasan is limited to cancel/reopen (D4).
--   * task.review: the designated reviewer only, and never the author nor an
--     active assignee of that task (self-review ban), and never yayasan.
--   * status writes travel exclusively through app.task_transition: the direct
--     authenticated UPDATE policy on tasks is dropped, and the trigger's
--     reviewer override keeps pengurus only.
--   * every accepted transition writes audit_logs in the same transaction
--     (TSK-05/TSK-07), so a status change can no longer commit without its
--     ledger row.
-- Signatures and the public wrappers from 20261105000004 are unchanged.

-- ---------------------------------------------------------------------------
-- 1. app.can_access_task: super_admin loses the blanket elevated branch.
-- ---------------------------------------------------------------------------
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
        OR app.has_any_role('yayasan', 'pengurus')
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

-- ---------------------------------------------------------------------------
-- 2. RLS: project.read (§3.5) and the attachment delete companion rule.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;
CREATE POLICY "Users can view accessible projects"
  ON public.projects FOR SELECT TO authenticated
  USING (
    app.is_active_member() AND (
      owner_id = auth.uid() OR created_by = auth.uid() OR
      app.has_any_role('yayasan', 'pengurus') OR
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
  USING ((uploaded_by = auth.uid() OR app.has_role('pengurus')) AND app.can_access_task(task_id));

-- Status changes belong to app.task_transition: it owns the permission matrix,
-- the task_status_history row and the audit event. Nothing in the application
-- writes tasks.status through the REST layer, so the row policy is dropped
-- instead of duplicating the matrix in SQL. Detail writes keep flowing through
-- the server actions, which run as the service role.
DROP POLICY IF EXISTS "Task participants can update tasks" ON public.tasks;

-- ---------------------------------------------------------------------------
-- 3. Trigger: the reviewer override keeps pengurus (§3.5 task.review).
-- ---------------------------------------------------------------------------
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
      (auth.uid() IS NOT NULL AND (OLD.reviewer_id = auth.uid() OR app.has_role('pengurus')))
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

-- ---------------------------------------------------------------------------
-- 4. app.task_transition: the §3.5 authority matrix plus the audit ledger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.task_transition(p_task_id uuid, p_new_status text, p_user_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_now timestamptz := now();
  v_is_creator boolean;
  v_is_assignee boolean;
  v_is_team_member boolean;
  v_is_reviewer boolean;
  v_may_cancel boolean;
  v_cancel_or_reopen boolean;
  v_allowed boolean;
  v_actor_name text;
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

  SELECT v_task.created_by = auth.uid() INTO v_is_creator;
  SELECT EXISTS (
    SELECT 1 FROM public.task_assignees ta
    WHERE ta.task_id = p_task_id AND ta.user_id = auth.uid() AND ta.unassigned_at IS NULL
  ) INTO v_is_assignee;
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams team ON team.id = tm.team_id
    WHERE tm.user_id = auth.uid()
      AND tm.valid_to IS NULL
      AND (v_task.team_id = team.id::text OR v_task.team_id = team.slug OR v_task.team_id = team.name)
  ) INTO v_is_team_member;
  SELECT v_task.reviewer_id = auth.uid() INTO v_is_reviewer;

  -- §3.5 task.cancel/reopen: koordinator team, pengurus and yayasan all.
  v_cancel_or_reopen := p_new_status = 'cancelled'
    OR (v_task.status = 'cancelled' AND p_new_status IN ('todo', 'in_progress'));
  v_may_cancel := app.has_any_role('pengurus', 'yayasan')
    OR (app.has_role('koordinator') AND v_is_team_member);

  IF v_cancel_or_reopen THEN
    -- D4 keeps supervision and cancellation together for yayasan, while the
    -- work transitions below stay out of its reach.
    v_allowed := v_may_cancel;
  ELSE
    -- §3.5 task.update_status: assignee/own, koordinator team, pengurus all.
    v_allowed := v_is_creator OR v_is_assignee
      OR app.has_role('pengurus')
      OR (app.has_role('koordinator') AND v_is_team_member);
  END IF;
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses untuk mengubah tugas ini.');
  END IF;

  -- §3.5 task.review: the designated reviewer, never the author or an active
  -- assignee of the same task, and only with koordinator/pengurus authority.
  IF p_new_status = 'done' AND v_task.requires_review THEN
    IF v_task.status <> 'in_review' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tugas ini memerlukan review sebelum selesai.');
    END IF;
    IF NOT v_is_reviewer THEN
      RETURN jsonb_build_object('success', false, 'message', 'Hanya reviewer yang dapat menyetujui tugas ini.');
    END IF;
    IF v_is_creator OR v_is_assignee THEN
      RETURN jsonb_build_object('success', false, 'message', 'Reviewer tidak dapat menyetujui tugasnya sendiri.');
    END IF;
    IF NOT (app.has_role('pengurus') OR (app.has_role('koordinator') AND v_is_team_member)) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Reviewer tidak memiliki wewenang atas tugas ini.');
    END IF;
  END IF;

  IF v_task.status = p_new_status THEN
    RETURN jsonb_build_object('success', true, 'new_status', p_new_status, 'message', 'Status tugas sudah sesuai.');
  END IF;

  UPDATE public.tasks
    SET status = p_new_status,
        completed_at = CASE WHEN p_new_status = 'done' THEN v_now ELSE NULL END,
        updated_at = v_now
    WHERE id = p_task_id;
  INSERT INTO public.task_status_history (task_id, from_status, to_status, changed_by, changed_at, note)
  VALUES (p_task_id, v_task.status, p_new_status, auth.uid(), v_now, p_note);

  -- Same transaction as the mutation, so a status change can never commit
  -- without its ledger row (TSK-05/TSK-07).
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'task.status_changed',
    auth.uid(),
    COALESCE(v_actor_name, auth.uid()::text),
    p_task_id::text,
    v_task.title,
    format('Status tugas berubah dari %s menjadi %s.', v_task.status, p_new_status)
  );

  RETURN jsonb_build_object('success', true, 'new_status', p_new_status, 'message', 'Status tugas berhasil diperbarui.');
END;
$$;

REVOKE ALL ON FUNCTION app.task_transition(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.task_transition(uuid, text, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
