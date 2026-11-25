-- ANN — the announcement command runs on the caller session (PERMISSIONS.md §3.6)
--
-- Gelombang 3 Item 2 Cabang 2. Before this file the announcements table carried a single
-- FOR SELECT policy (20261102000005:314) and no write policy at all, while
-- src/modules/schedules/actions.ts performed every announcement write with the service-role
-- client. Consequences, all verified rather than inferred:
--
--   * auth.uid() was NULL for the whole write, so no database-side rule could judge the
--     audience the form had chosen — the only audience check lived in filterByAudience(), a
--     TypeScript copy of app.can_view_audience() applied after the service-role read;
--   * the two pickers built {"scope":"member_type","memberTypes":[...]} from
--     profiles.member_type, which §2 rule 1 forbids as an authorization tier;
--   * deleteAnnouncementAction archived any row by id with no scope check and wrote its audit
--     row without actor_id, in a separate statement from the update;
--   * updateAnnouncementAction counted announcement_revisions and then inserted, so two
--     concurrent editors both claimed revision_no 1 and the unique key broke one of them; the
--     row it read for that decision was read without a lock (TOCTOU);
--   * scheduled_for / expires_at went through new Date(...) in the server process, so the
--     wall-clock an operator typed into <input type="datetime-local"> was interpreted in
--     whatever timezone the runtime happened to use (§2 rule 5).
--
-- This follows the SCH-02 precedent (20261122000008) rather than inventing a second pattern:
-- one command RPC pair on the caller session, the audience tier also enforced by a BEFORE
-- trigger on the table itself, and the direct write path revoked from anon/authenticated.
-- The read half is left to RLS: the SELECT policy already answers audience visibility, which
-- is what lets the announcements feed stop filtering rows in JavaScript.
--
-- Nothing here changes the agenda commands, the admin listing read (drafts and archived
-- history stay service-role reads) or the publication fan-out trigger from 20261112000003 —
-- an announcement written through these RPCs still enqueues exactly the same inbox rows.
--
-- Forward-only and idempotent: production may already carry parts of this from out-of-band
-- application, so every object is replaced rather than created, and the replay from migration
-- 001 in a fresh database produces the same result.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. app.can_write_announcement_audience: one helper for "may this audience be written".
-- ---------------------------------------------------------------------------
-- Deliberately the same tier arithmetic as app.can_write_event_audience(): a session must not
-- be able to broadcast a pondok-wide agenda while being refused a pondok-wide announcement.
-- supabase/tests/announcement_command_scope.sql pins the two answers against each other.
--
-- p_announcement_id is the row being edited; its stored team and stored audience teams join the
-- set the audience has to stay inside, so a coordinator cannot re-point a foreign announcement
-- at its own team. announcements.team_id is free text that has been fed an id, a slug and a
-- name, so all three forms count as "my team" here, exactly as for events.
CREATE OR REPLACE FUNCTION app.can_write_announcement_audience(
  p_audience jsonb,
  p_team_id text,
  p_announcement_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_keys text[];
  v_wanted text[];
  v_team text;
  v_checked boolean := false;
BEGIN
  -- Without a session this is a service-role write. The command RPCs are the ones that refuse
  -- a missing session for an operator; scheduled jobs (the reminder route) keep working.
  IF v_uid IS NULL THEN
    RETURN true;
  END IF;
  -- §2 rule 6: check the account is usable before answering, so a pending or suspended session
  -- never receives a "yes" it could route around.
  IF NOT app.is_active_member() THEN
    RETURN false;
  END IF;

  -- A missing or blank scope is the stored default, never a NULL three-valued answer.
  v_scope := lower(trim(COALESCE(p_audience->>'scope', '')));
  IF v_scope = '' THEN
    v_scope := 'all';
  END IF;
  -- §2 rule 1: an audience derived from profiles.member_type is not an authorable audience.
  IF v_scope = 'member_type' THEN
    RETURN false;
  END IF;

  IF app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
    RETURN v_scope IN ('all', 'team', 'users', 'custom');
  END IF;

  -- Not a manager: only a coordinator of at least one active team may author, and only for
  -- those teams.
  IF NOT app.has_any_role('koordinator') THEN
    RETURN false;
  END IF;
  IF v_scope <> 'team' THEN
    RETURN false;
  END IF;

  v_keys := app.coordinator_team_keys(v_uid);
  IF coalesce(array_length(v_keys, 1), 0) = 0 THEN
    RETURN false;
  END IF;

  v_wanted := COALESCE((
      SELECT array_agg(DISTINCT trim(v))
      FROM unnest(ARRAY[NULLIF(trim(COALESCE(p_team_id, '')), '')]) AS t(v)
      WHERE NULLIF(trim(v), '') IS NOT NULL
    ), '{}') || COALESCE((
      SELECT array_agg(DISTINCT trim(v))
      FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(p_audience->'teamIds') = 'array'
                  THEN p_audience->'teamIds' ELSE '[]'::jsonb END
           ) AS t(v)
      WHERE NULLIF(trim(v), '') IS NOT NULL
    ), '{}') || COALESCE((
      -- The stored announcement participates twice: the free-text team column and the team
      -- list inside its own audience, because the write path historically left team_id empty.
      SELECT array_agg(DISTINCT trim(v))
      FROM (
        SELECT NULLIF(trim(a.team_id), '') AS v
          FROM public.announcements a
         WHERE a.id = p_announcement_id AND NULLIF(trim(a.team_id), '') IS NOT NULL
        UNION ALL
        SELECT trim(tv)
          FROM public.announcements a
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(a.audience_config->'teamIds') = 'array'
                 THEN a.audience_config->'teamIds' ELSE '[]'::jsonb END
          ) AS t(tv)
         WHERE a.id = p_announcement_id AND NULLIF(trim(tv), '') IS NOT NULL
      ) stored
      WHERE NULLIF(trim(v), '') IS NOT NULL
    ), '{}');

  IF coalesce(array_length(v_wanted, 1), 0) = 0 THEN
    RETURN false;
  END IF;

  FOREACH v_team IN ARRAY v_wanted LOOP
    IF NULLIF(v_team, '') IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT (v_team = ANY (v_keys)) THEN
      RETURN false;
    END IF;
    v_checked := true;
  END LOOP;
  RETURN v_checked;
END;
$$;

REVOKE ALL ON FUNCTION app.can_write_announcement_audience(jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_write_announcement_audience(jsonb, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. trg_announcements_audience_scope: the constraint on the table itself.
-- ---------------------------------------------------------------------------
-- Without this, §3.6 would only be a branch inside one RPC: a future insert path, a backfill
-- or a grant restored by mistake would write an out-of-tier audience again with nothing to
-- notice. The trigger covers every tier, so it holds for the definition-owner writes the
-- command RPCs make too.
CREATE OR REPLACE FUNCTION app.enforce_announcement_audience_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  -- Service-role callers carry no session; the command RPCs own that refusal, and the
  -- notification route must keep reading and enqueuing without one.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT app.is_active_member() THEN
    RAISE EXCEPTION 'Sesi tidak valid atau akun tidak aktif.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_write_announcement_audience(
       NEW.audience_config,
       NEW.team_id,
       CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END
     ) THEN
    RAISE EXCEPTION 'Audiens pengumuman di luar izin peran Anda (PERMISSIONS.md §3.6).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.enforce_announcement_audience_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_announcements_audience_scope ON public.announcements;
CREATE TRIGGER trg_announcements_audience_scope BEFORE INSERT OR UPDATE OF audience_config ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION app.enforce_announcement_audience_scope();

-- ---------------------------------------------------------------------------
-- 3. app.announcement_upsert: the only create/update path for an announcement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.announcement_upsert(
  p_announcement_id uuid,
  p_payload jsonb,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_title text;
  v_body text;
  v_label text;
  v_priority text;
  v_status text;
  v_audience jsonb;
  v_team_id text;
  v_scheduled_for timestamptz;
  v_expires_at timestamptz;
  v_published_at timestamptz;
  v_note text;
  v_existing public.announcements%ROWTYPE;
  v_keys text[];
  v_manager boolean;
  v_is_new boolean := (p_announcement_id IS NULL);
  v_announcement_id uuid := p_announcement_id;
  v_revision int;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  -- §3.6 announcement.create/publish for pengurus/yayasan/super_admin at scope all, plus the
  -- koordinator the same row grants with scope team. Which announcement and which audience a
  -- caller may write is decided below, never by this list.
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus', 'koordinator') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengelola pengumuman.');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Payload pengumuman tidak valid.');
  END IF;

  v_manager := app.has_any_role('super_admin', 'yayasan', 'pengurus');
  v_keys := app.coordinator_team_keys(v_uid);
  v_row := p_payload;

  -- The row is read (and locked) before anything is judged: an edit keeps the stored audience,
  -- label and expiry when the payload leaves them out, and a coordinator is only allowed near
  -- an announcement that belongs to a team it runs.
  IF NOT v_is_new THEN
    SELECT * INTO v_existing FROM public.announcements WHERE id = p_announcement_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Pengumuman tidak ditemukan.');
    END IF;
    IF v_existing.status = 'archived' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Pengumuman yang sudah diarsipkan tidak dapat diubah.');
    END IF;
    IF NOT v_manager AND NOT (
      (NULLIF(trim(COALESCE(v_existing.team_id, '')), '') IS NOT NULL
        AND NULLIF(trim(v_existing.team_id), '') = ANY (v_keys))
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(v_existing.audience_config->'teamIds') = 'array'
                      THEN v_existing.audience_config->'teamIds' ELSE '[]'::jsonb END
               ) AS t(tv)
         WHERE NULLIF(trim(tv), '') = ANY (v_keys)
      )
    ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Pengumuman ini berada di luar tim Anda.');
    END IF;
  END IF;

  v_title := NULLIF(trim(COALESCE(v_row->>'title', '')), '');
  IF v_title IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Judul pengumuman wajib diisi.');
  END IF;
  v_body := NULLIF(trim(COALESCE(v_row->>'body_markdown', '')), '');
  IF v_body IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Isi pengumuman wajib diisi.');
  END IF;
  IF char_length(v_title) > 160 OR char_length(v_body) > 20000 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Judul atau isi pengumuman terlalu panjang.');
  END IF;

  v_priority := lower(trim(COALESCE(NULLIF(v_row->>'priority', ''), v_existing.priority, 'normal')));
  IF v_priority NOT IN ('normal', 'important') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Prioritas pengumuman tidak valid.');
  END IF;

  v_status := lower(trim(COALESCE(NULLIF(v_row->>'status', ''), v_existing.status, 'published')));
  IF v_status NOT IN ('draft', 'published') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status pengumuman tidak valid.');
  END IF;

  -- §2 rule 8: the same column keeps the display label, so an edit that omits it keeps the
  -- stored one instead of resetting it to the seed default.
  v_label := NULLIF(trim(COALESCE(v_row->>'target_audience_label', '')), '');
  IF v_label IS NULL THEN
    v_label := COALESCE(NULLIF(v_existing.target_audience_label, ''), 'Semua Santri & Tim');
  END IF;
  IF char_length(v_label) > 120 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Label audiens maksimal 120 karakter.');
  END IF;

  v_team_id := NULLIF(trim(COALESCE(v_row->>'team_id', '')), '');
  IF v_team_id IS NULL THEN
    v_team_id := NULLIF(trim(COALESCE(v_existing.team_id, '')), '');
  END IF;
  -- Absent means "keep what is stored"; an explicit key replaces it. Defaulting a stored
  -- team audience to {"scope":"all"} because the picker could not express it would widen the
  -- reach of an announcement the caller never asked to re-address (SCH-07 parity).
  v_audience := COALESCE(v_row->'audience', NULLIF(v_existing.audience_config, 'null'::jsonb),
                         jsonb_build_object('scope', 'all'));

  IF COALESCE(v_audience->>'scope', 'all') = 'member_type' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Audiens berbasis kategori anggota tidak diizinkan; pilih tim atau seluruh pondok.');
  END IF;
  IF NOT app.can_write_announcement_audience(
       v_audience, v_team_id, CASE WHEN v_is_new THEN NULL ELSE v_announcement_id END
     ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Koordinator hanya dapat menerbitkan pengumuman untuk timnya sendiri.');
  END IF;

  -- The operator types a WIB wall-clock into <input type="datetime-local">, so the naive text
  -- is resolved by the database in Asia/Jakarta instead of by whichever timezone the Node
  -- process happens to run in (§2 rule 5). Key presence, not an empty string, is what clears.
  IF v_row ? 'scheduled_for' THEN
    BEGIN
      v_scheduled_for := NULLIF(trim(COALESCE(v_row->>'scheduled_for', '')), '')::timestamp
        AT TIME ZONE 'Asia/Jakarta';
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('success', false, 'message', 'Waktu terbit terjadwal tidak valid.');
    END;
  ELSE
    v_scheduled_for := v_existing.scheduled_for;
  END IF;
  IF v_row ? 'expires_at' THEN
    BEGIN
      v_expires_at := NULLIF(trim(COALESCE(v_row->>'expires_at', '')), '')::timestamp
        AT TIME ZONE 'Asia/Jakarta';
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('success', false, 'message', 'Waktu kedaluwarsa tidak valid.');
    END;
  ELSE
    v_expires_at := v_existing.expires_at;
  END IF;
  IF v_expires_at IS NOT NULL AND v_scheduled_for IS NOT NULL AND v_expires_at <= v_scheduled_for THEN
    RETURN jsonb_build_object('success', false, 'message', 'Waktu kedaluwarsa harus setelah waktu terbit terjadwal.');
  END IF;
  -- The old create path silently stored a future publication as a draft while the edit path
  -- refused it. One rule now, and it is the honest one: a caller who asked to publish a future
  -- instant has to say "draft" instead.
  IF v_status = 'published' AND v_scheduled_for IS NOT NULL AND v_scheduled_for > now() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengumuman dengan waktu terbit mendatang harus tetap draft.');
  END IF;

  v_note := NULLIF(trim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Catatan perubahan maksimal 300 karakter.');
  END IF;

  -- pinned was never an independent choice in the form: both write paths derived it from the
  -- priority, so the derived value is computed here rather than accepted from the caller.
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  IF v_is_new THEN
    v_published_at := CASE WHEN v_status = 'published' THEN timezone('utc'::text, now()) ELSE NULL END;
    INSERT INTO public.announcements (
        title, body_markdown, priority, status, published_at, expires_at, pinned,
        author_id, team_id, target_audience_label, scheduled_for, audience_config,
        created_at, updated_at
      )
    VALUES (
        v_title, v_body, v_priority, v_status, v_published_at, v_expires_at,
        (v_priority = 'important'), v_uid, v_team_id, v_label, v_scheduled_for, v_audience,
        timezone('utc'::text, now()), timezone('utc'::text, now())
      )
    RETURNING id INTO v_announcement_id;
  ELSE
    -- The snapshot is the row being replaced, taken under the lock above, and the number is
    -- allocated in the same statement: the old path counted, then inserted, so two concurrent
    -- editors both wrote revision_no 1 and the unique key broke one of them.
    INSERT INTO public.announcement_revisions (announcement_id, revision_no, snapshot, changed_by, created_at)
    VALUES (
        v_announcement_id,
        (SELECT COALESCE(max(revision_no), 0) + 1
           FROM public.announcement_revisions WHERE announcement_id = v_announcement_id),
        to_jsonb(v_existing),
        v_uid,
        timezone('utc'::text, now())
      )
    RETURNING revision_no INTO v_revision;

    v_published_at := CASE
      WHEN v_status = 'published' THEN COALESCE(v_existing.published_at, timezone('utc'::text, now()))
      ELSE NULL
    END;

    UPDATE public.announcements SET
        title = v_title,
        body_markdown = v_body,
        priority = v_priority,
        status = v_status,
        published_at = v_published_at,
        expires_at = v_expires_at,
        pinned = (v_priority = 'important'),
        author_id = COALESCE(v_existing.author_id, v_uid),
        team_id = v_team_id,
        target_audience_label = v_label,
        scheduled_for = v_scheduled_for,
        audience_config = v_audience,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_announcement_id;
  END IF;

  -- Same transaction as the announcement change (AGENTS.md: every SECURITY DEFINER RPC writes
  -- audit_logs alongside its mutation), and with the actor_id the old audit insert never set.
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
      CASE WHEN v_is_new AND v_status = 'published' THEN 'announcement.published'
           WHEN v_is_new THEN 'announcement.created'
           ELSE 'announcement.updated' END,
      v_uid,
      COALESCE(v_actor_name, v_uid::text),
      v_announcement_id::text,
      v_title,
      format(
        '%s: %s untuk %s.%s',
        CASE WHEN v_is_new AND v_status = 'published' THEN 'Pengumuman diterbitkan'
             WHEN v_is_new THEN 'Draft pengumuman dibuat'
             ELSE 'Pengumuman diperbarui' END,
        v_title,
        v_label,
        CASE WHEN v_note IS NULL THEN '' ELSE ' Catatan: ' || v_note END
      )
    );

  RETURN jsonb_build_object(
    'success', true,
    'announcement_id', v_announcement_id,
    'revision_no', v_revision,
    'status', v_status,
    -- Decided from the locked row, so the caller does not re-read what it just wrote to know
    -- whether the audience has to be told about a change instead of a first publication.
    'was_published', (NOT v_is_new AND v_existing.status = 'published'),
    'audience_config', v_audience,
    'message', CASE
      WHEN v_is_new AND v_status = 'published'
        THEN format('Pengumuman "%s" berhasil diterbitkan untuk %s.', v_title, v_label)
      WHEN v_is_new AND v_scheduled_for IS NOT NULL
        THEN format('Pengumuman "%s" disimpan sebagai draft dan dijadwalkan.', v_title)
      WHEN v_is_new THEN format('Pengumuman "%s" disimpan sebagai draft.', v_title)
      WHEN v_status = 'published' THEN 'Pengumuman berhasil diperbarui dan diterbitkan.'
      ELSE 'Draft pengumuman berhasil diperbarui.'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION app.announcement_upsert(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.announcement_upsert(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.announcement_archive: the delete the feed offers, with its scope check and actor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.announcement_archive(
  p_announcement_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.announcements%ROWTYPE;
  v_keys text[];
  v_reason text;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus', 'koordinator') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengelola pengumuman.');
  END IF;

  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 300 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Alasan penghapusan maksimal 300 karakter.');
  END IF;

  IF p_announcement_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengumuman tidak ditemukan.');
  END IF;
  SELECT * INTO v_existing FROM public.announcements WHERE id = p_announcement_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengumuman tidak ditemukan.');
  END IF;
  IF v_existing.status = 'archived' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengumuman sudah diarsipkan.');
  END IF;

  -- The old update filtered only on id: any session that reached it — and, because it ran with
  -- the service-role key, every session that did — could archive a pondok-wide notice or a
  -- foreign team's announcement. A coordinator now only decides for its own teams (§3.6).
  v_keys := app.coordinator_team_keys(v_uid);
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') AND NOT (
    (NULLIF(trim(COALESCE(v_existing.team_id, '')), '') IS NOT NULL
      AND NULLIF(trim(v_existing.team_id), '') = ANY (v_keys))
    OR EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(v_existing.audience_config->'teamIds') = 'array'
                    THEN v_existing.audience_config->'teamIds' ELSE '[]'::jsonb END
        ) AS t(tv)
      WHERE NULLIF(trim(tv), '') = ANY (v_keys)
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengumuman ini berada di luar tim Anda.');
  END IF;

  UPDATE public.announcements SET
      status = 'archived',
      archived_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
    WHERE id = p_announcement_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
      'announcement.deleted',
      v_uid,
      COALESCE(v_actor_name, v_uid::text),
      p_announcement_id::text,
      v_existing.title,
      format('Pengumuman diarsipkan.%s', COALESCE(' Alasan: ' || v_reason, ''))
    );

  RETURN jsonb_build_object(
    'success', true,
    'announcement_id', p_announcement_id,
    'message', 'Pengumuman berhasil dihapus.'
  );
END;
$$;

REVOKE ALL ON FUNCTION app.announcement_archive(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.announcement_archive(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. PostgREST wrappers, mirroring the app./public. pair used by every other command RPC in
--    this schema. The trigger function stays internal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_announcement_audience(
  p_audience jsonb,
  p_team_id text DEFAULT NULL,
  p_announcement_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.can_write_announcement_audience(p_audience, p_team_id, p_announcement_id);
$$;

CREATE OR REPLACE FUNCTION public.announcement_upsert(
  p_announcement_id uuid,
  p_payload jsonb,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.announcement_upsert(p_announcement_id, p_payload, p_note);
$$;

CREATE OR REPLACE FUNCTION public.announcement_archive(
  p_announcement_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.announcement_archive(p_announcement_id, p_reason);
$$;

REVOKE ALL ON FUNCTION public.can_write_announcement_audience(jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.announcement_upsert(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.announcement_archive(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_announcement_audience(jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.announcement_upsert(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.announcement_archive(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Close the direct write path the service-role client used. RLS already refused these
--    statements (no write policy exists on the table); the revoke is what stops the grant
--    being relied on again by a future path, and 42501 is the error the pgTAP suite pins.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.announcements FROM anon, authenticated;

-- The migration must not leave the command surface half-installed: if a definition failed to
-- apply (a role key missing, an unrelated rename), fail loudly here instead of shipping a
-- closed write path with no replacement. Read receipts need no RPC — announcement_reads already
-- has an INSERT/UPDATE policy of auth.uid() = user_id (20261101000006:73).
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(sig) INTO v_missing
  FROM unnest(ARRAY[
    'app.announcement_upsert(uuid,jsonb,text)',
    'app.announcement_archive(uuid,text)',
    'app.can_write_announcement_audience(jsonb,text,uuid)',
    'public.announcement_upsert(uuid,jsonb,text)',
    'public.announcement_archive(uuid,text)'
  ]) AS sig
  WHERE to_regprocedure(sig) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Announcement command surface incomplete, missing: %', array_to_string(v_missing, ', ');
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
