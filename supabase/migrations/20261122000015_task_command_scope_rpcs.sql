-- Migration: 20261122000015_task_command_scope_rpcs.sql
-- TSK-02: Align Tasks & Projects write surface with PERMISSIONS.md §3.5 + D4.
-- Reverses the old 20261122000004 comment ("Detail writes keep flowing through
-- the server actions, which run as the service role"): all task/project/checklist
-- writes now flow through session-scoped SECURITY DEFINER RPCs and direct
-- INSERT/UPDATE/DELETE grants on tasks, projects, task_checklist_items are
-- revoked from anon and authenticated.

-- ---------------------------------------------------------------------------
-- 1. Team coordinator scope helper (WIB operational date)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.is_team_coordinator_for(
  p_team_key text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, pg_temp
STABLE
AS $$
  SELECT COALESCE(length(trim(COALESCE(p_team_key, ''))) > 0, false) AND EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams team ON team.id = tm.team_id
    WHERE tm.user_id = p_user_id
      AND tm.team_role = 'coordinator'
      AND tm.valid_from <= (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND (tm.valid_to IS NULL OR tm.valid_to >= (now() AT TIME ZONE 'Asia/Jakarta')::date)
      AND team.status = 'active'
      AND (
        p_team_key = team.id::text
        OR p_team_key = team.slug
        OR p_team_key = team.name
      )
  );
$$;

REVOKE ALL ON FUNCTION app.is_team_coordinator_for(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_team_coordinator_for(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.create_task: exclude super_admin (SA = —), enforce §3.5 scope, audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.create_task(
  p_title text,
  p_description text DEFAULT '',
  p_priority text DEFAULT 'normal',
  p_requires_review boolean DEFAULT false,
  p_project_id uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_visibility text DEFAULT 'team',
  p_assignee_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task_id uuid;
  v_project_team text;
  v_actor_name text;
  v_assignees uuid[] := ARRAY(SELECT DISTINCT unnest(COALESCE(p_assignee_ids, '{}'::uuid[])));
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('santri', 'koordinator', 'pengurus', 'yayasan') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peran Anda tidak memiliki akses membuat tugas.');
  END IF;
  IF length(trim(COALESCE(p_title, ''))) NOT BETWEEN 1 AND 200 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Judul tugas wajib diisi dan maksimal 200 karakter.');
  END IF;
  IF length(COALESCE(p_description, '')) > 5000 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Deskripsi tugas maksimal 5.000 karakter.');
  END IF;
  IF p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Prioritas tugas tidak valid.');
  END IF;
  IF p_visibility NOT IN ('private', 'team', 'organization') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Visibilitas tugas tidak valid.');
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT team_id INTO v_project_team
    FROM public.projects
    WHERE id = p_project_id AND status <> 'archived' AND archived_at IS NULL;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Proyek tugas tidak ditemukan atau sudah diarsipkan.');
    END IF;
    IF NOT app.has_any_role('pengurus', 'yayasan') THEN
      IF NOT (app.has_role('koordinator') AND v_project_team IS NOT NULL AND app.is_team_coordinator_for(v_project_team, v_uid)) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin membuat tugas pada proyek ini.');
      END IF;
    END IF;
  END IF;

  IF p_visibility <> 'private' AND NOT app.has_any_role('koordinator', 'pengurus', 'yayasan') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Santri hanya dapat membuat tugas pribadi.');
  END IF;

  IF COALESCE(array_length(v_assignees, 1), 0) > 0 THEN
    IF NOT app.has_any_role('koordinator', 'pengurus', 'yayasan') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin menugaskan anggota lain.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(v_assignees) AS ids(id)
      LEFT JOIN public.profiles p ON p.id = ids.id
      WHERE p.id IS NULL OR p.status <> 'active'
    ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Salah satu penanggung jawab tidak aktif atau tidak ditemukan.');
    END IF;
  END IF;

  INSERT INTO public.tasks (
    project_id, team_id, title, description, priority, status, requires_review,
    due_date, visibility, created_by
  ) VALUES (
    p_project_id, v_project_team, trim(p_title), COALESCE(p_description, ''), p_priority,
    'todo', COALESCE(p_requires_review, false), p_due_date, p_visibility, v_uid
  ) RETURNING id INTO v_task_id;

  IF COALESCE(array_length(v_assignees, 1), 0) > 0 THEN
    INSERT INTO public.task_assignees (task_id, user_id, assigned_by)
    SELECT v_task_id, ids.id, v_uid
    FROM unnest(v_assignees) AS ids(id);
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES ('task.created', v_uid, COALESCE(v_actor_name, 'Anggota'), v_task_id::text, trim(p_title), 'Tugas dibuat melalui app.create_task.');

  RETURN jsonb_build_object('success', true, 'task_id', v_task_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION app.create_task(text, text, text, boolean, uuid, date, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_task(text, text, text, boolean, uuid, date, text, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.task_update & app.task_archive
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.task_update(
  p_task_id uuid,
  p_title text,
  p_description text DEFAULT '',
  p_priority text DEFAULT 'normal',
  p_requires_review boolean DEFAULT false,
  p_project_id uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_visibility text DEFAULT 'team'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('santri', 'koordinator', 'pengurus', 'yayasan') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peran Anda tidak memiliki akses mengubah tugas.');
  END IF;
  IF length(trim(COALESCE(p_title, ''))) NOT BETWEEN 1 AND 200 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Judul tugas wajib diisi dan maksimal 200 karakter.');
  END IF;
  IF p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Prioritas tugas tidak valid.');
  END IF;
  IF p_visibility NOT IN ('private', 'team', 'organization') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Visibilitas tugas tidak valid.');
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tugas tidak ditemukan.');
  END IF;

  IF NOT (
    app.has_any_role('pengurus', 'yayasan')
    OR v_task.created_by = v_uid
    OR (app.has_role('koordinator') AND v_task.team_id IS NOT NULL AND app.is_team_coordinator_for(v_task.team_id, v_uid))
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengubah tugas ini.');
  END IF;

  UPDATE public.tasks
  SET title = trim(p_title),
      description = COALESCE(p_description, ''),
      project_id = p_project_id,
      priority = p_priority,
      requires_review = COALESCE(p_requires_review, false),
      due_date = p_due_date,
      visibility = p_visibility,
      updated_at = now()
  WHERE id = p_task_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES ('task.updated', v_uid, COALESCE(v_actor_name, 'Anggota'), p_task_id::text, trim(p_title), 'Detail tugas diperbarui.');

  RETURN jsonb_build_object('success', true, 'task_id', p_task_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.task_archive(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('santri', 'koordinator', 'pengurus', 'yayasan') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peran Anda tidak memiliki akses mengarsipkan tugas.');
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tugas tidak ditemukan.');
  END IF;

  IF NOT (
    app.has_any_role('pengurus', 'yayasan')
    OR v_task.created_by = v_uid
    OR (app.has_role('koordinator') AND v_task.team_id IS NOT NULL AND app.is_team_coordinator_for(v_task.team_id, v_uid))
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengarsipkan tugas ini.');
  END IF;

  UPDATE public.tasks SET deleted_at = now(), updated_at = now() WHERE id = p_task_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES ('task.archived', v_uid, COALESCE(v_actor_name, 'Anggota'), p_task_id::text, v_task.title, 'Tugas diarsipkan secara soft-delete.');

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. app.task_assign_reviewer & app.task_checklist_mutate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.task_assign_reviewer(
  p_task_id uuid,
  p_reviewer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_reviewer_name text;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('santri', 'koordinator', 'pengurus', 'yayasan') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peran Anda tidak memiliki akses menetapkan reviewer.');
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tugas tidak ditemukan.');
  END IF;

  IF NOT (
    app.has_any_role('pengurus', 'yayasan')
    OR v_task.created_by = v_uid
    OR (app.has_role('koordinator') AND v_task.team_id IS NOT NULL AND app.is_team_coordinator_for(v_task.team_id, v_uid))
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin menetapkan reviewer tugas ini.');
  END IF;

  SELECT full_name INTO v_reviewer_name FROM public.profiles WHERE id = p_reviewer_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Reviewer tidak ditemukan atau tidak aktif.');
  END IF;

  UPDATE public.tasks SET reviewer_id = p_reviewer_id, updated_at = now() WHERE id = p_task_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES ('task.reviewer_assigned', v_uid, COALESCE(v_actor_name, 'Anggota'), p_task_id::text, v_task.title, 'Reviewer ditetapkan: ' || v_reviewer_name);

  RETURN jsonb_build_object('success', true, 'reviewer_name', v_reviewer_name);
END;
$$;

CREATE OR REPLACE FUNCTION app.task_checklist_mutate(
  p_task_id uuid,
  p_action text,
  p_checklist_id uuid DEFAULT NULL,
  p_text text DEFAULT NULL,
  p_done boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item_id uuid;
  v_next_sort integer;
  v_actor_name text;
  v_event_name text;
  v_detail text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('santri', 'koordinator', 'pengurus', 'yayasan') OR NOT app.can_access_task(p_task_id, v_uid) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses ke checklist tugas ini.');
  END IF;

  IF p_action = 'add' THEN
    IF length(trim(COALESCE(p_text, ''))) = 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Teks checklist wajib diisi.');
    END IF;
    SELECT COALESCE(max(sort_order), 0) + 1 INTO v_next_sort FROM public.task_checklist_items WHERE task_id = p_task_id;
    INSERT INTO public.task_checklist_items (task_id, text, sort_order)
    VALUES (p_task_id, trim(p_text), v_next_sort)
    RETURNING id INTO v_item_id;
    v_event_name := 'task.checklist_created';
    v_detail := 'Item checklist ditambahkan.';
  ELSIF p_action = 'toggle' THEN
    UPDATE public.task_checklist_items SET done = COALESCE(p_done, false)
    WHERE id = p_checklist_id AND task_id = p_task_id
    RETURNING id INTO v_item_id;
    IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Item checklist tidak ditemukan.');
    END IF;
    v_event_name := 'task.checklist_toggled';
    v_detail := CASE WHEN COALESCE(p_done, false) THEN 'Checklist ditandai selesai.' ELSE 'Checklist ditandai belum selesai.' END;
  ELSIF p_action = 'update' THEN
    IF length(trim(COALESCE(p_text, ''))) = 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Teks checklist wajib diisi.');
    END IF;
    UPDATE public.task_checklist_items SET text = trim(p_text)
    WHERE id = p_checklist_id AND task_id = p_task_id
    RETURNING id INTO v_item_id;
    IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Checklist tidak ditemukan.');
    END IF;
    v_event_name := 'task.checklist_updated';
    v_detail := 'Item checklist diperbarui.';
  ELSIF p_action = 'delete' THEN
    DELETE FROM public.task_checklist_items
    WHERE id = p_checklist_id AND task_id = p_task_id
    RETURNING id INTO v_item_id;
    IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Checklist tidak ditemukan.');
    END IF;
    v_event_name := 'task.checklist_deleted';
    v_detail := 'Item checklist dihapus.';
  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'Aksi checklist tidak valid.');
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (v_event_name, v_uid, COALESCE(v_actor_name, 'Anggota'), p_task_id::text, COALESCE(v_item_id::text, p_task_id::text), v_detail);

  RETURN jsonb_build_object('success', true, 'item_id', v_item_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. app.project_upsert & app.project_archive
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.project_upsert(
  p_project_id uuid DEFAULT NULL,
  p_name text DEFAULT '',
  p_description text DEFAULT NULL,
  p_team_id text DEFAULT NULL,
  p_status text DEFAULT 'planned'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_proj public.projects%ROWTYPE;
  v_project_id uuid;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('koordinator', 'pengurus', 'yayasan') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Hanya koordinator, pengurus, atau yayasan yang dapat mengelola proyek.');
  END IF;
  IF length(trim(COALESCE(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nama proyek wajib diisi dan maksimal 120 karakter.');
  END IF;

  IF NOT app.has_any_role('pengurus', 'yayasan') THEN
    IF p_team_id IS NULL OR NOT app.is_team_coordinator_for(p_team_id, v_uid) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Koordinator hanya dapat mengelola proyek milik timnya sendiri.');
    END IF;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  IF p_project_id IS NULL THEN
    INSERT INTO public.projects (name, description, team_id, status, owner_id, created_by)
    VALUES (trim(p_name), NULLIF(trim(COALESCE(p_description, '')), ''), NULLIF(trim(COALESCE(p_team_id, '')), ''), COALESCE(p_status, 'planned'), v_uid, v_uid)
    RETURNING id INTO v_project_id;

    INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
    VALUES ('task.project_created', v_uid, COALESCE(v_actor_name, 'Anggota'), v_project_id::text, trim(p_name), 'Proyek operasional dibuat.');
  ELSE
    SELECT * INTO v_proj FROM public.projects WHERE id = p_project_id AND archived_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Proyek tidak ditemukan.');
    END IF;
    IF NOT app.has_any_role('pengurus', 'yayasan') THEN
      IF v_proj.team_id IS NULL OR NOT app.is_team_coordinator_for(v_proj.team_id, v_uid) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses mengubah proyek ini.');
      END IF;
    END IF;
    UPDATE public.projects
    SET name = trim(p_name),
        description = NULLIF(trim(COALESCE(p_description, '')), ''),
        team_id = NULLIF(trim(COALESCE(p_team_id, '')), ''),
        status = COALESCE(p_status, 'active'),
        updated_at = now()
    WHERE id = p_project_id;
    v_project_id := p_project_id;

    INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
    VALUES ('task.project_updated', v_uid, COALESCE(v_actor_name, 'Anggota'), v_project_id::text, trim(p_name), 'Detail proyek diperbarui.');
  END IF;

  RETURN jsonb_build_object('success', true, 'project_id', v_project_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.project_archive(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_proj public.projects%ROWTYPE;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('koordinator', 'pengurus', 'yayasan') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses mengarsipkan proyek.');
  END IF;

  SELECT * INTO v_proj FROM public.projects WHERE id = p_project_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Proyek tidak ditemukan.');
  END IF;
  IF NOT app.has_any_role('pengurus', 'yayasan') THEN
    IF v_proj.team_id IS NULL OR NOT app.is_team_coordinator_for(v_proj.team_id, v_uid) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses mengarsipkan proyek ini.');
    END IF;
  END IF;

  UPDATE public.projects SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = p_project_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES ('task.project_archived', v_uid, COALESCE(v_actor_name, 'Anggota'), p_project_id::text, v_proj.name, 'Proyek diarsipkan tanpa menghapus task dan riwayat.');

  RETURN jsonb_build_object('success', true, 'name', v_proj.name);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Public wrappers + revoke direct writes on tasks/projects/checklist
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.task_update(
  p_task_id uuid, p_title text, p_description text DEFAULT '', p_priority text DEFAULT 'normal',
  p_requires_review boolean DEFAULT false, p_project_id uuid DEFAULT NULL, p_due_date date DEFAULT NULL, p_visibility text DEFAULT 'team'
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT app.task_update(p_task_id, p_title, p_description, p_priority, p_requires_review, p_project_id, p_due_date, p_visibility);
$$;

CREATE OR REPLACE FUNCTION public.task_archive(p_task_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT app.task_archive(p_task_id);
$$;

CREATE OR REPLACE FUNCTION public.task_assign_reviewer(p_task_id uuid, p_reviewer_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT app.task_assign_reviewer(p_task_id, p_reviewer_id);
$$;

CREATE OR REPLACE FUNCTION public.task_checklist_mutate(
  p_task_id uuid, p_action text, p_checklist_id uuid DEFAULT NULL, p_text text DEFAULT NULL, p_done boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT app.task_checklist_mutate(p_task_id, p_action, p_checklist_id, p_text, p_done);
$$;

CREATE OR REPLACE FUNCTION public.project_upsert(
  p_project_id uuid DEFAULT NULL, p_name text DEFAULT '', p_description text DEFAULT NULL, p_team_id text DEFAULT NULL, p_status text DEFAULT 'planned'
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT app.project_upsert(p_project_id, p_name, p_description, p_team_id, p_status);
$$;

CREATE OR REPLACE FUNCTION public.project_archive(p_project_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT app.project_archive(p_project_id);
$$;

DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'app.task_update(uuid,text,text,text,boolean,uuid,date,text)',
    'public.task_update(uuid,text,text,text,boolean,uuid,date,text)',
    'app.task_archive(uuid)',
    'public.task_archive(uuid)',
    'app.task_assign_reviewer(uuid,uuid)',
    'public.task_assign_reviewer(uuid,uuid)',
    'app.task_checklist_mutate(uuid,text,uuid,text,boolean)',
    'public.task_checklist_mutate(uuid,text,uuid,text,boolean)',
    'app.project_upsert(uuid,text,text,text,text)',
    'public.project_upsert(uuid,text,text,text,text)',
    'app.project_archive(uuid)',
    'public.project_archive(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.tasks FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.projects FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.task_checklist_items FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
