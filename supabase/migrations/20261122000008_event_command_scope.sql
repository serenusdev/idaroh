-- Migration: 20261122000008_event_command_scope.sql
-- SCH-02: make the agenda audience tier (§3.6) a database rule, and give the
-- koordinator the schedule tier the same section already promises.
--
-- The audit line and PERMISSIONS.md §3.6 have claimed a "DB Constraint: Koordinator
-- dilarang membuat/mengubah agenda dengan audience = 'all'" since the matrix was
-- written. Nothing enforced it. Worse, no session-aware guard could have: every event
-- write is issued with the service role key (src/modules/schedules/actions.ts:378 and
-- :482), so auth.uid() is NULL inside the database, the only policies on events are
-- FOR SELECT (20261025000000:195-197), and createEventAction/updateEventAction did not
-- even call requireRole() — the sole gate lived in the admin page.
-- app.can_view_audience() is a read helper and cannot authorise a write.
--
-- After this migration:
--   * app.event_upsert() / app.event_cancel() are the only writers. They run on the
--     caller's session (createClient()), re-check auth.uid() + app.is_active_member()
--     + the §3.6 role tier, resolve the WIB wall-clock themselves (§2 rule 5), keep the
--     replaced row in event_revisions under a row lock, and write audit_logs in the
--     same transaction — so an agenda can no longer change without its ledger entry,
--     and without naming who changed it (deleteEventAction used to omit actor_id).
--   * app.can_write_event_audience() is the single answer to "may this session address
--     the agenda this way". Managers (§3.6 pengurus/yayasan/super_admin) may address
--     the whole pondok or any team; a koordinator only teams it actively coordinates
--     (team_members.team_role='coordinator', valid_to IS NULL, active team).
--     member_type audiences are refused for every tier: §2 rule 1 forbids deriving
--     access from profiles.member_type, and this closes the write half of the SCH-01
--     deferral note. The read path (app.can_view_audience, /jadwal, the ICS feed and
--     the notification outbox) is untouched, so already stored member_type audiences
--     keep rendering until a data decision is taken.
--   * trg_events_audience_scope enforces the same helper on INSERT/UPDATE of
--     audience_config for any write that carries a session, so the rule is a
--     constraint on the table and not only a branch inside one RPC. Service-role
--     writes carry no session and still bypass it — the remaining gap is closed per
--     caller as each one moves behind these RPCs, and is stated in §3.6.
-- Nothing here changes the announcement commands; those keep their own tier and their
-- own (still application-enforced) audience handling.

-- ---------------------------------------------------------------------------
-- 1. app.coordinator_team_keys: the team identities one user coordinates.
-- ---------------------------------------------------------------------------
-- events.team_id is a free-text column that has been fed the id, the slug and the name
-- of a team, so all three forms count as "my team" here.
CREATE OR REPLACE FUNCTION app.coordinator_team_keys(p_user uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT key), '{}')
  FROM (
    SELECT t.id::text AS key
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
     WHERE tm.user_id = p_user AND tm.team_role = 'coordinator'
       AND tm.valid_to IS NULL AND t.status = 'active' AND t.id IS NOT NULL
    UNION ALL
    SELECT t.slug
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
     WHERE tm.user_id = p_user AND tm.team_role = 'coordinator'
       AND tm.valid_to IS NULL AND t.status = 'active' AND t.slug IS NOT NULL
    UNION ALL
    SELECT t.name
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
     WHERE tm.user_id = p_user AND tm.team_role = 'coordinator'
       AND tm.valid_to IS NULL AND t.status = 'active' AND t.name IS NOT NULL
  ) owned;
$$;

REVOKE ALL ON FUNCTION app.coordinator_team_keys(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.coordinator_team_keys(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.can_write_event_audience: one helper for "may this audience be written".
-- ---------------------------------------------------------------------------
-- p_event_id is the agenda being edited (NULL for a new one); its stored team joins the
-- set of teams the audience has to stay inside, so a coordinator cannot re-point a
-- foreign agenda at its own team.
CREATE OR REPLACE FUNCTION app.can_write_event_audience(
  p_audience jsonb,
  p_team_id text,
  p_event_id uuid DEFAULT NULL
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
  -- Without a session this is a service-role write. The command RPCs are the ones that
  -- refuse a missing session for an operator; scheduled jobs and backfills must keep
  -- working while no policy exists for them.
  IF v_uid IS NULL THEN
    RETURN true;
  END IF;
  -- §2 rule 6: a SECURITY DEFINER helper checks the account is usable before it answers,
  -- so a pending or suspended session never receives a "yes" it could route around.
  IF NOT app.is_active_member() THEN
    RETURN false;
  END IF;

  -- A missing or blank scope is the stored default, never a NULL three-valued answer.
  v_scope := lower(NULLIF(trim(COALESCE(p_audience->>'scope', '')), ''));
  IF v_scope IS NULL THEN
    v_scope := 'all';
  END IF;
  -- §2 rule 1: an audience derived from profiles.member_type is not an authorable
  -- audience at all, whatever the tier.
  IF v_scope = 'member_type' THEN
    RETURN false;
  END IF;

  IF app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
    RETURN v_scope IN ('all', 'team', 'users', 'custom');
  END IF;

  -- Not a manager: only a coordinator of at least one active team may author, and only
  -- for those teams.
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

  -- Every team the agenda points at — the row's own team_id, each entry of
  -- audience.teamIds, and the stored team of the agenda being edited — has to belong to
  -- this coordinator.
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
      SELECT array_agg(DISTINCT trim(e.team_id))
      FROM public.events e
      WHERE e.id = p_event_id AND NULLIF(e.team_id, '') IS NOT NULL
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

REVOKE ALL ON FUNCTION app.can_write_event_audience(jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_write_event_audience(jsonb, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. trg_events_audience_scope: the constraint on the table itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.enforce_event_audience_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  -- Service-role callers carry no session; the command RPCs own that refusal.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT app.is_active_member() THEN
    RAISE EXCEPTION 'Sesi tidak valid atau akun tidak aktif.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_write_event_audience(
       NEW.audience_config,
       NEW.team_id,
       CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END
     ) THEN
    RAISE EXCEPTION 'Audiens agenda di luar izin peran Anda (PERMISSIONS.md §3.6).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.enforce_event_audience_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_events_audience_scope ON public.events;
CREATE TRIGGER trg_events_audience_scope BEFORE INSERT OR UPDATE OF audience_config ON public.events FOR EACH ROW EXECUTE FUNCTION app.enforce_event_audience_scope();

-- ---------------------------------------------------------------------------
-- 4. app.event_upsert: the only create/update path for an agenda.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.event_upsert(
  p_event_id uuid,
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
  v_description text;
  v_location text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_recurrence_until timestamptz;
  v_category text;
  v_status text;
  v_recurrence text;
  v_audience jsonb;
  v_team_id text;
  v_note text;
  v_existing public.events%ROWTYPE;
  v_manager boolean;
  v_is_new boolean := (p_event_id IS NULL);
  v_event_id uuid := p_event_id;
  v_revision int;
  v_conflict int;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  -- §3.6 schedule.event.create/update/delete for pengurus/yayasan/super_admin, plus the
  -- koordinator the same row grants with scope own.
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus', 'koordinator') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengelola agenda.');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Payload agenda tidak valid.');
  END IF;

  v_manager := app.has_any_role('super_admin', 'yayasan', 'pengurus');
  v_row := p_payload;

  -- The row is read (and locked) before anything is judged: an edit keeps the stored
  -- audience, recurrence and status when the payload leaves them out, and a coordinator
  -- is only allowed near an agenda that belongs to a team it runs.
  IF NOT v_is_new THEN
    SELECT * INTO v_existing FROM public.events WHERE id = p_event_id FOR UPDATE;
    IF NOT FOUND OR v_existing.deleted_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Agenda tidak ditemukan.');
    END IF;
    IF NOT v_manager AND NOT (
      v_existing.team_id IS NOT NULL AND v_existing.team_id = ANY (app.coordinator_team_keys(v_uid))
    ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Agenda ini berada di luar tim Anda.');
    END IF;
  END IF;

  v_title := NULLIF(trim(COALESCE(v_row->>'title', '')), '');
  IF v_title IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Judul agenda wajib diisi.');
  END IF;
  IF NULLIF(v_row->>'starts_at', '') IS NULL OR NULLIF(v_row->>'ends_at', '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Waktu mulai dan selesai wajib ditentukan.');
  END IF;

  -- The operator types a WIB wall-clock into <input type="datetime-local">, so the naive
  -- text is resolved by the database in Asia/Jakarta instead of by whichever timezone
  -- the server process happens to run in (§2 rule 5).
  BEGIN
    v_starts_at := (v_row->>'starts_at')::timestamp AT TIME ZONE 'Asia/Jakarta';
    v_ends_at := (v_row->>'ends_at')::timestamp AT TIME ZONE 'Asia/Jakarta';
    IF NULLIF(v_row->>'recurrence_until', '') IS NOT NULL THEN
      v_recurrence_until := (v_row->>'recurrence_until')::timestamp AT TIME ZONE 'Asia/Jakarta';
    END IF;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('success', false, 'message', 'Rentang waktu agenda tidak valid.');
  END;
  IF v_starts_at IS NULL OR v_ends_at IS NULL OR v_starts_at >= v_ends_at THEN
    RETURN jsonb_build_object('success', false, 'message', 'Rentang waktu agenda tidak valid.');
  END IF;

  -- An omitted recurrence only means "keep what is stored" for an edit; the old form
  -- defaulted a new agenda to none.
  v_recurrence := NULLIF(trim(COALESCE(v_row->>'recurrence_rule', '')), '');
  IF v_recurrence IS NULL THEN
    v_recurrence := COALESCE(v_existing.recurrence_rule, 'none');
  ELSE
    v_recurrence := lower(v_recurrence);
    IF v_recurrence NOT IN ('none', 'daily', 'weekly') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Aturan pengulangan agenda tidak valid.');
    END IF;
  END IF;
  IF NOT (v_row ? 'recurrence_until') THEN
    v_recurrence_until := v_existing.recurrence_until;
  END IF;

  v_description := NULLIF(trim(COALESCE(v_row->>'description', '')), '');
  v_location := NULLIF(trim(COALESCE(v_row->>'location', '')), '');
  -- The column is NOT NULL and the old form defaulted it; keep that default in one place.
  IF v_location IS NULL THEN
    v_location := 'Lab Utama Pondok';
  END IF;
  IF char_length(v_title) > 160
     OR char_length(COALESCE(v_description, '')) > 5000
     OR char_length(v_location) > 240 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Judul, deskripsi, atau lokasi melebihi batas yang diizinkan.');
  END IF;

  v_category := lower(trim(COALESCE(NULLIF(v_row->>'category', ''), 'umum')));
  IF v_category NOT IN ('teknologi', 'keagamaan', 'operasional', 'umum') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kategori agenda tidak dikenali.');
  END IF;

  v_status := lower(trim(COALESCE(NULLIF(v_row->>'status', ''), v_existing.status, 'scheduled')));
  IF v_status NOT IN ('scheduled', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status agenda tidak valid.');
  END IF;

  v_team_id := NULLIF(trim(COALESCE(v_row->>'team_id', '')), '');
  IF v_team_id IS NULL THEN
    v_team_id := NULLIF(v_existing.team_id, '');
  END IF;
  v_audience := COALESCE(v_row->'audience', NULLIF(v_existing.audience_config, 'null'::jsonb),
                         jsonb_build_object('scope', 'all'));

  IF COALESCE(v_audience->>'scope', 'all') = 'member_type' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Audiens berbasis kategori anggota tidak diizinkan; pilih tim atau seluruh pondok.');
  END IF;
  IF NOT app.can_write_event_audience(v_audience, v_team_id, CASE WHEN v_is_new THEN NULL ELSE v_event_id END) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Koordinator hanya dapat menandai agenda untuk timnya sendiri.');
  END IF;

  v_note := NULLIF(trim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Catatan perubahan maksimal 300 karakter.');
  END IF;

  -- The same overlap rule the application used to evaluate over the REST API, now inside
  -- the transaction that writes the row.
  SELECT count(*) INTO v_conflict
    FROM public.events e
   WHERE e.deleted_at IS NULL
     AND e.status = 'scheduled'
     AND e.location = v_location
     AND e.id IS DISTINCT FROM v_event_id
     AND e.starts_at < v_ends_at
     AND e.ends_at > v_starts_at;
  IF v_conflict > 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bentrok: sudah ada agenda di lokasi dan waktu tersebut.');
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;

  IF v_is_new THEN
    INSERT INTO public.events (
        title, description, starts_at, ends_at, location, category, status,
        organizer_id, created_by, team_id, audience_config,
        recurrence_rule, recurrence_until, created_at, updated_at
      )
    VALUES (
        v_title, v_description, v_starts_at, v_ends_at, v_location, v_category, v_status,
        v_uid, v_uid, v_team_id, v_audience,
        v_recurrence, v_recurrence_until, timezone('utc'::text, now()), timezone('utc'::text, now())
      )
    RETURNING id INTO v_event_id;
  ELSE
    -- The snapshot is the row being replaced, taken under the lock above, and the number
    -- is allocated in the same statement: the old path counted, then inserted, so two
    -- concurrent edits both wrote revision_no 1 and the unique key broke one of them.
    INSERT INTO public.event_revisions (event_id, revision_no, snapshot, changed_by, created_at)
    VALUES (
        v_event_id,
        (SELECT COALESCE(max(revision_no), 0) + 1 FROM public.event_revisions WHERE event_id = v_event_id),
        to_jsonb(v_existing),
        v_uid,
        timezone('utc'::text, now())
      )
    RETURNING revision_no INTO v_revision;

    UPDATE public.events SET
        title = v_title,
        description = COALESCE(v_description, ''),
        starts_at = v_starts_at,
        ends_at = v_ends_at,
        location = v_location,
        location_changed = (v_existing.location IS DISTINCT FROM v_location),
        previous_location = CASE
          WHEN v_existing.location IS DISTINCT FROM v_location THEN v_existing.location
          ELSE COALESCE(v_existing.previous_location, v_existing.location)
        END,
        category = v_category,
        status = v_status,
        team_id = v_team_id,
        audience_config = v_audience,
        recurrence_rule = v_recurrence,
        recurrence_until = v_recurrence_until,
        updated_at = timezone('utc'::text, now())
     WHERE id = v_event_id;
  END IF;

  -- Same transaction as the agenda change (AGENTS.md: every SECURITY DEFINER RPC writes
  -- audit_logs alongside its mutation).
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
      CASE WHEN v_is_new THEN 'event.created' ELSE 'event.updated' END,
      v_uid,
      COALESCE(v_actor_name, v_uid::text),
      v_event_id::text,
      v_title,
      format(
        '%s: %s (%s) di %s.%s',
        CASE WHEN v_is_new THEN 'Agenda dibuat' ELSE 'Agenda diperbarui' END,
        v_title,
        v_category,
        v_location,
        CASE WHEN v_note IS NULL THEN '' ELSE ' Catatan: ' || v_note END
      )
    );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'revision_no', v_revision,
    -- Whether the audience has to be told: decided from the locked row, so the caller
    -- does not have to re-derive the instant it just wrote.
    'schedule_changed', v_is_new OR (
      v_existing.starts_at IS DISTINCT FROM v_starts_at
      OR v_existing.ends_at IS DISTINCT FROM v_ends_at
      OR v_existing.location IS DISTINCT FROM v_location
    ),
    'message', CASE WHEN v_is_new
      THEN format('Agenda "%s" berhasil ditambahkan ke jadwal.', v_title)
      ELSE 'Agenda berhasil diperbarui dan revisi sebelumnya disimpan.'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION app.event_upsert(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_upsert(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.event_cancel: cancel and delete both keep their actor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.event_cancel(
  p_event_id uuid,
  p_status text DEFAULT 'cancelled',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.events%ROWTYPE;
  v_state text;
  v_reason text;
  v_actor_name text;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus', 'koordinator') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengelola agenda.');
  END IF;

  v_state := lower(trim(COALESCE(NULLIF(p_status, ''), 'cancelled')));
  IF v_state NOT IN ('cancelled', 'deleted') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status penghapusan agenda tidak valid.');
  END IF;

  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 300 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Alasan pembatalan maksimal 300 karakter.');
  END IF;

  SELECT * INTO v_existing FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_existing.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Agenda tidak ditemukan.');
  END IF;
  IF v_existing.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Agenda seluruhnya sudah dibatalkan.');
  END IF;
  -- A coordinator only decides for its own teams (§3.6 scope own).
  IF NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') AND NOT (
    v_existing.team_id IS NOT NULL AND v_existing.team_id = ANY (app.coordinator_team_keys(v_uid))
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Agenda ini berada di luar tim Anda.');
  END IF;

  UPDATE public.events SET
      status = 'cancelled',
      deleted_at = CASE WHEN v_state = 'deleted' THEN timezone('utc'::text, now()) ELSE deleted_at END,
      updated_at = timezone('utc'::text, now())
    WHERE id = p_event_id;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
      CASE WHEN v_state = 'deleted' THEN 'event.deleted' ELSE 'event.cancelled' END,
      v_uid,
      COALESCE(v_actor_name, v_uid::text),
      p_event_id::text,
      v_existing.title,
      format(
        '%s.%s',
        CASE WHEN v_state = 'deleted' THEN 'Agenda dihapus' ELSE 'Agenda dibatalkan' END,
        COALESCE(' Alasan: ' || v_reason, '')
      )
    );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'message', CASE WHEN v_state = 'deleted'
      THEN 'Agenda berhasil dihapus.'
      ELSE format('Agenda "%s" berhasil dibatalkan.', v_existing.title)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION app.event_cancel(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_cancel(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. PostgREST wrappers, mirroring the app./public. pair used by every other command
-- RPC in this schema. The trigger function stays internal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coordinator_team_keys()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, app
AS $$
  SELECT app.coordinator_team_keys(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_write_event_audience(
  p_audience jsonb,
  p_team_id text,
  p_event_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, app
AS $$
  SELECT app.can_write_event_audience(p_audience, p_team_id, p_event_id);
$$;

CREATE OR REPLACE FUNCTION public.event_upsert(
  p_event_id uuid,
  p_payload jsonb,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app
AS $$
  SELECT app.event_upsert(p_event_id, p_payload, p_note);
$$;

CREATE OR REPLACE FUNCTION public.event_cancel(
  p_event_id uuid,
  p_status text DEFAULT 'cancelled',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app
AS $$
  SELECT app.event_cancel(p_event_id, p_status, p_reason);
$$;

REVOKE ALL ON FUNCTION public.coordinator_team_keys() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_event_audience(jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_upsert(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_cancel(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coordinator_team_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_event_audience(jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_upsert(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_cancel(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
