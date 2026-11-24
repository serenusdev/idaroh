-- Migration: 20261122000007_team_command_rpcs_and_resource_upsert.sql
-- Scope: PPL-01 (PERMISSIONS.md §3.7 team/reviewer tier) and LIB-03 / LIB-08
-- (§3.2 atomic resource save).
--
-- PPL-01. §3.7 grants yayasan `all` for team.member.manage,
-- team.coordinator.set and reviewer.assign, but both the server actions and the
-- RPC guards below stopped at super_admin + pengurus, so yayasan was refused
-- twice. The same two actions also wrote team_members through the service-role
-- client, which meant the audit row was a separate best-effort insert after the
-- mutation and the effective dates came from the browser's UTC calendar. Both
-- membership writes now have their own command RPC, matching the pattern every
-- other write in this schema follows.
--
-- LIB-03 / LIB-08. A resource save was four unguarded service-role writes: the
-- row, a delete/insert pair for the tags, a read of the highest revision number
-- and the revision insert. A failure in the middle left the row changed with a
-- stale or emptied tag set, two concurrent saves could append the same
-- revision_no, and nothing was audited. app.resource_upsert() owns the whole
-- sequence in one transaction, on the caller's own session.
--
-- Idempotent by construction: every statement is a CREATE OR REPLACE, a guarded
-- grant, or a re-creation of an existing object.

-- ---------------------------------------------------------------------------
-- 1. PPL-01 — team coordinator, membership and reviewer commands
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.team_set_coordinator(p_team_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  -- The seat dates are calendar days in the pesantren's own timezone, not the
  -- UTC day the application server happened to be in.
  v_now date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_team_name text;
  v_member_name text;
  v_actor_name text;
  v_active_member public.team_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  -- §3.7 team.coordinator.set = pengurus, yayasan, super_admin.
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses mengatur koordinator.');
  END IF;

  SELECT name INTO v_team_name FROM public.teams
  WHERE id = p_team_id AND status = 'active';
  IF v_team_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tim tidak ditemukan atau tidak aktif.');
  END IF;
  SELECT full_name INTO v_member_name FROM public.profiles
  WHERE id = p_user_id AND status = 'active';
  IF v_member_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anggota harus memiliki akun aktif.');
  END IF;

  -- Coordinator assignment must not reopen historical membership rows.
  UPDATE public.team_members
  SET valid_to = v_now, team_role = 'member'
  WHERE team_id = p_team_id AND team_role = 'coordinator' AND valid_to IS NULL;

  SELECT * INTO v_active_member
  FROM public.team_members
  WHERE team_id = p_team_id AND user_id = p_user_id AND valid_to IS NULL
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1;
  IF v_active_member.id IS NULL THEN
    INSERT INTO public.team_members (team_id, user_id, team_role, valid_from)
    VALUES (p_team_id, p_user_id, 'coordinator', v_now);
  ELSE
    UPDATE public.team_members SET team_role = 'coordinator' WHERE id = v_active_member.id;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'people.team_coordinator_set',
    auth.uid(),
    COALESCE(v_actor_name, auth.uid()::text),
    p_team_id::text,
    v_team_name,
    format('%s ditetapkan sebagai koordinator tim %s.', v_member_name, v_team_name)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Koordinator tim berhasil diperbarui secara atomik.');
END;
$$;

CREATE OR REPLACE FUNCTION app.team_member_set(
  p_team_id uuid,
  p_user_id uuid,
  p_team_role text DEFAULT 'member',
  p_title text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_now date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_role text := lower(btrim(coalesce(p_team_role, 'member')));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_team_name text;
  v_member_name text;
  v_actor_name text;
  v_active public.team_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  -- §3.7 team.member.manage = pengurus, yayasan, super_admin (koordinator only
  -- for its own team, which is a separate decision and not opened here).
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses mengelola anggota tim.');
  END IF;
  IF v_role NOT IN ('member', 'assistant', 'coordinator') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peran tim tidak valid.');
  END IF;
  -- idx_one_active_coordinator_per_team makes the coordinator seat a
  -- two-statement change; only app.team_set_coordinator may drive it.
  IF v_role = 'coordinator' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Penetapan koordinator memakai jalur khusus.');
  END IF;

  SELECT name INTO v_team_name FROM public.teams
  WHERE id = p_team_id AND status = 'active';
  IF v_team_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tim tidak ditemukan atau tidak aktif.');
  END IF;
  SELECT full_name INTO v_member_name FROM public.profiles
  WHERE id = p_user_id AND status = 'active';
  IF v_member_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anggota harus memiliki akun aktif.');
  END IF;

  SELECT * INTO v_active
  FROM public.team_members
  WHERE team_id = p_team_id AND user_id = p_user_id AND valid_to IS NULL
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.team_members (team_id, user_id, team_role, title, valid_from)
    VALUES (p_team_id, p_user_id, v_role, v_title, v_now)
    RETURNING id INTO v_active.id;
  ELSE
    UPDATE public.team_members
    SET team_role = v_role, title = v_title
    WHERE id = v_active.id;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'people.team_member_added',
    auth.uid(),
    COALESCE(v_actor_name, auth.uid()::text),
    p_team_id::text,
    v_team_name,
    format('%s dikelola sebagai %s di tim %s.', v_member_name, v_role, v_team_name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'member_id', v_active.id,
    'message', 'Anggota tim berhasil disimpan secara atomik.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.team_member_end(p_team_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_now date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_team_name text;
  v_member_name text;
  v_actor_name text;
  v_row public.team_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses mengelola anggota tim.');
  END IF;

  SELECT name INTO v_team_name FROM public.teams WHERE id = p_team_id;
  IF v_team_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tim tidak ditemukan atau tidak aktif.');
  END IF;
  SELECT full_name INTO v_member_name FROM public.profiles WHERE id = p_user_id;

  -- History is closed with a date, never deleted (BR-PPL-04).
  SELECT * INTO v_row
  FROM public.team_members
  WHERE team_id = p_team_id AND user_id = p_user_id AND valid_to IS NULL
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Keanggotaan aktif tidak ditemukan.');
  END IF;
  UPDATE public.team_members SET valid_to = v_now WHERE id = v_row.id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'people.team_member_removed',
    auth.uid(),
    COALESCE(v_actor_name, auth.uid()::text),
    p_team_id::text,
    v_team_name,
    format('Keanggotaan %s di tim %s diakhiri per %s tanpa menghapus riwayat.',
           COALESCE(v_member_name, p_user_id::text), v_team_name, v_now)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Keanggotaan tim diakhiri; riwayat tetap tersimpan.');
END;
$$;

CREATE OR REPLACE FUNCTION app.assign_reviewer(
  p_reviewee_id uuid,
  p_reviewer_id uuid,
  p_kind text DEFAULT 'report',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_now date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_reviewee_name text;
  v_reviewer_name text;
  v_actor_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  -- §3.7 reviewer.assign = pengurus, yayasan, super_admin.
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses menetapkan reviewer.');
  END IF;
  IF p_reviewee_id = p_reviewer_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anggota tidak dapat menjadi reviewer dirinya sendiri.');
  END IF;
  IF p_kind NOT IN ('report', 'attendance_correction', 'task') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Jenis reviewer tidak valid.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reviewee_id AND status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reviewer_id AND status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Reviewee dan reviewer harus merupakan akun aktif.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_reviewee_id::text || ':' || p_kind, 0));
  UPDATE public.reviewer_assignments
  SET valid_to = v_now
  WHERE reviewee_id = p_reviewee_id AND kind = p_kind AND valid_to IS NULL;

  INSERT INTO public.reviewer_assignments (reviewee_id, reviewer_id, kind, reason, valid_from)
  VALUES (p_reviewee_id, p_reviewer_id, p_kind, nullif(btrim(coalesce(p_reason, '')), ''), v_now);

  -- The application used to write this row from a second client after the RPC
  -- returned, so a failed insert left the assignment live and unlogged.
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  SELECT full_name INTO v_reviewee_name FROM public.profiles WHERE id = p_reviewee_id;
  SELECT full_name INTO v_reviewer_name FROM public.profiles WHERE id = p_reviewer_id;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'people.reviewer_assigned',
    auth.uid(),
    COALESCE(v_actor_name, auth.uid()::text),
    p_reviewee_id::text,
    COALESCE(v_reviewee_name, p_reviewee_id::text),
    format('Reviewer %s untuk %s: %s. Alasan: %s.',
           p_kind,
           COALESCE(v_reviewee_name, p_reviewee_id::text),
           COALESCE(v_reviewer_name, p_reviewer_id::text),
           coalesce(nullif(btrim(coalesce(p_reason, '')), ''), '-'))
  );

  RETURN jsonb_build_object('success', true, 'message', 'Reviewer berhasil ditetapkan secara atomik.');
END;
$$;

REVOKE ALL ON FUNCTION app.team_member_set(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.team_member_end(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.team_member_set(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.team_member_end(uuid, uuid) TO authenticated;
-- The two redefined functions keep the grants they already have; restated so a
-- replay onto a drifted database cannot lose them.
GRANT EXECUTE ON FUNCTION app.team_set_coordinator(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.assign_reviewer(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_member_set(
  p_team_id uuid,
  p_user_id uuid,
  p_team_role text DEFAULT 'member',
  p_title text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.team_member_set(p_team_id, p_user_id, p_team_role, p_title);
$$;

CREATE OR REPLACE FUNCTION public.team_member_end(
  p_team_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.team_member_end(p_team_id, p_user_id);
$$;

REVOKE ALL ON FUNCTION public.team_member_set(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_member_set(uuid, uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.team_member_end(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_member_end(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. LIB-03 / LIB-08 — one atomic resource save
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.resource_upsert(
  p_resource_id uuid,
  p_row jsonb,
  p_tag_names text[],
  p_change_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_name text := btrim(coalesce(v_row->>'name', ''));
  v_slug text := lower(btrim(coalesce(v_row->>'slug', '')));
  v_description text := btrim(coalesce(v_row->>'description', ''));
  v_legacy text := nullif(btrim(coalesce(v_row->>'legacy_record_id', '')), '');
  v_category_text text := nullif(btrim(coalesce(v_row->>'category_id', '')), '');
  v_category uuid;
  v_official_url text := nullif(btrim(coalesce(v_row->>'official_url', '')), '');
  v_access_setup text := nullif(btrim(coalesce(v_row->>'access_setup', '')), '');
  v_how_to_use text := nullif(btrim(coalesce(v_row->>'how_to_use', '')), '');
  v_workflow_examples text := nullif(btrim(coalesce(v_row->>'workflow_examples', '')), '');
  v_limitations text := nullif(btrim(coalesce(v_row->>'limitations_cautions', '')), '');
  v_official_sources text := nullif(btrim(coalesce(v_row->>'official_sources', '')), '');
  v_documentation_status text := coalesce(nullif(btrim(coalesce(v_row->>'documentation_status', '')), ''), 'unknown');
  v_visibility text := coalesce(nullif(btrim(coalesce(v_row->>'visibility', '')), ''), 'internal');
  v_status text := coalesce(nullif(btrim(coalesce(v_row->>'status', '')), ''), 'published');
  v_note text := coalesce(nullif(btrim(coalesce(p_change_note, '')), ''), 'Pembaruan Resource Library');
  v_tags jsonb;
  v_actor_name text;
  v_id uuid;
  v_snapshot jsonb;
  v_revision integer;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  -- §3.2 library.resource.create/update = pengurus, yayasan, super_admin.
  -- D7 (koordinator team/own authoring) stays a separate decision.
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses menyimpan resource.');
  END IF;

  IF v_name = '' OR v_slug = '' OR v_description = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nama, slug, dan deskripsi wajib diisi.');
  END IF;
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Slug resource tidak valid.');
  END IF;
  -- Enum labels are checked against the catalog instead of cast, so a bad value
  -- answers with a message rather than a raw database error.
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'resource_visibility_type' AND e.enumlabel = v_visibility) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Visibilitas resource tidak valid.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'resource_status_type' AND e.enumlabel = v_status) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status resource tidak valid.');
  END IF;
  IF v_category_text IS NOT NULL THEN
    IF v_category_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('success', false, 'message', 'category_id resource tidak valid.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.resource_categories c WHERE c.id = v_category_text::uuid) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Kategori resource tidak ditemukan.');
    END IF;
    v_category := v_category_text::uuid;
  END IF;

  -- Both columns are UNIQUE; refusing here keeps the caller from seeing a
  -- constraint name and keeps the transaction from aborting halfway.
  IF EXISTS (SELECT 1 FROM public.resources r
             WHERE r.slug = v_slug AND (p_resource_id IS NULL OR r.id <> p_resource_id)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Slug resource sudah dipakai resource lain.');
  END IF;
  IF v_legacy IS NOT NULL AND EXISTS (SELECT 1 FROM public.resources r
             WHERE r.legacy_record_id = v_legacy AND (p_resource_id IS NULL OR r.id <> p_resource_id)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'legacy_record_id resource sudah dipakai.');
  END IF;

  IF p_resource_id IS NULL THEN
    INSERT INTO public.resources (
      legacy_record_id, name, slug, description, category_id, official_url,
      access_setup, how_to_use, workflow_examples, limitations_cautions,
      official_sources, documentation_status, visibility, status,
      created_by, updated_by, created_at, updated_at, archived_at
    )
    VALUES (
      v_legacy, v_name, v_slug, v_description, v_category, v_official_url,
      v_access_setup, v_how_to_use, v_workflow_examples, v_limitations,
      v_official_sources, v_documentation_status,
      v_visibility::public.resource_visibility_type,
      v_status::public.resource_status_type,
      auth.uid(), auth.uid(), v_now, v_now,
      CASE WHEN v_status = 'archived' THEN v_now ELSE NULL END
    )
    RETURNING id INTO v_id;
  ELSE
    -- The row lock serialises concurrent saves of the same resource, which is
    -- what makes the revision_no below unique per resource.
    IF NOT EXISTS (SELECT 1 FROM public.resources WHERE id = p_resource_id FOR UPDATE) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Resource tidak ditemukan.');
    END IF;
    UPDATE public.resources SET
      legacy_record_id = v_legacy,
      name = v_name,
      slug = v_slug,
      description = v_description,
      category_id = v_category,
      official_url = v_official_url,
      access_setup = v_access_setup,
      how_to_use = v_how_to_use,
      workflow_examples = v_workflow_examples,
      limitations_cautions = v_limitations,
      official_sources = v_official_sources,
      documentation_status = v_documentation_status,
      visibility = v_visibility::public.resource_visibility_type,
      status = v_status::public.resource_status_type,
      updated_by = auth.uid(),
      updated_at = v_now,
      archived_at = CASE WHEN v_status = 'archived' THEN v_now ELSE NULL END
    WHERE id = p_resource_id;
    v_id := p_resource_id;
  END IF;

  SELECT to_jsonb(r) INTO v_snapshot FROM public.resources r WHERE r.id = v_id;

  -- The tag book is replaced wholly: the normalisation the application used to
  -- do in JavaScript happens here so the write and the links cannot disagree.
  SELECT jsonb_agg(jsonb_build_object('slug', slug, 'name', name) ORDER BY slug) INTO v_tags
  FROM (
    SELECT btrim(regexp_replace(lower(btrim(t)), '[^a-z0-9]+', '-', 'g'), '-') AS slug,
           min(lower(btrim(t))) AS name
    FROM unnest(coalesce(p_tag_names, '{}'::text[])) AS t
    WHERE btrim(t) <> ''
    GROUP BY 1
    HAVING btrim(regexp_replace(lower(btrim(t)), '[^a-z0-9]+', '-', 'g'), '-') <> ''
    ORDER BY 1
    LIMIT 20
  ) norm;

  DELETE FROM public.resource_tags WHERE resource_id = v_id;
  IF v_tags IS NOT NULL THEN
    INSERT INTO public.tags (name, slug)
    SELECT x.name, x.slug
    FROM jsonb_to_recordset(v_tags) AS x(slug text, name text)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

    INSERT INTO public.resource_tags (resource_id, tag_id)
    SELECT v_id, t.id
    FROM jsonb_to_recordset(v_tags) AS x(slug text, name text)
    JOIN public.tags t ON t.slug = x.slug
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT COALESCE(max(revision_no), 0) + 1 INTO v_revision
  FROM public.resource_revisions
  WHERE resource_id = v_id;
  INSERT INTO public.resource_revisions (resource_id, revision_no, snapshot, changed_by, change_note, changed_at)
  VALUES (v_id, v_revision, v_snapshot, auth.uid(), v_note, v_now);

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'library.resource_saved',
    auth.uid(),
    COALESCE(v_actor_name, auth.uid()::text),
    v_id::text,
    v_name,
    format('%s resource %s sebagai revisi %s (%s).',
           CASE WHEN p_resource_id IS NULL THEN 'Membuat' ELSE 'Memperbarui' END,
           v_slug, v_revision, v_note)
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'revision_no', v_revision,
    'message', CASE WHEN p_resource_id IS NULL
      THEN 'Resource berhasil dibuat.' ELSE 'Resource berhasil diperbarui.' END
  );
END;
$$;

REVOKE ALL ON FUNCTION app.resource_upsert(uuid, jsonb, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resource_upsert(uuid, jsonb, text[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resource_upsert(
  p_resource_id uuid,
  p_row jsonb,
  p_tag_names text[],
  p_change_note text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.resource_upsert(p_resource_id, p_row, p_tag_names, p_change_note);
$$;

REVOKE ALL ON FUNCTION public.resource_upsert(uuid, jsonb, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resource_upsert(uuid, jsonb, text[], text) TO authenticated;

NOTIFY pgrst, 'reload schema';
