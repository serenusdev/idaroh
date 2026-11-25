-- Migration: 20261122000009_recurring_conflict_and_ics.sql
-- SCH-09: validate an agenda collision against the days a series actually occupies.
--
-- Current state: app.event_upsert() (20261122000008) checks the overlap rule with
--   AND e.starts_at < v_ends_at AND e.ends_at > v_starts_at
-- which compares two stored intervals. For a weekly or daily agenda those intervals are
-- only its first day, while the schedule surface, the calendar feed and the attendance
-- guard all treat the row as up to 180 days of occurrences (expandEventRows() and
-- event_occurrence_exceptions). So a one-off can be booked straight onto the third
-- Tuesday of a kajian in the same room, and the two agendas only meet when the operator
-- opens that week.
--
-- After this migration:
--   * app.event_occurrence_spans() is the single place the day arithmetic of a series
--     lives in SQL: base WIB date, whole-day step (daily 1, weekly 7), capped by the
--     row's own recurrence_until. Asia/Jakarta has no daylight saving, so shifting the
--     stored instant by whole days keeps the wall-clock the operator typed — the same
--     rule expandEventRows() applies in TypeScript.
--   * app.event_slot_taken() asks the overlap question for both sides: the incoming
--     agenda is expanded over its own footprint (recurrence_until, else the 180 days the
--     schedule renders) and each live candidate in the same location is expanded over
--     those days.
--   * app.event_upsert() asks that question instead of comparing two intervals. Its
--     message, tier checks, revision write and audit row are unchanged.
--
-- Deliberate limits, reported rather than hidden:
--   * An open-ended series is validated for the 180 days a client can see, not for every
--     week it might run. Beyond that horizon the room stays unreserved in the check even
--     though the series will occupy it.
--   * A day freed by app.event_occurrence_set() (SCH-01) still reserves its slot, because
--     the same RPC can restore that very day and would then create a double booking.
--   * An agenda whose interval crosses midnight is compared as its base day only.

-- ---------------------------------------------------------------------------
-- 1. Which days a recurring row occupies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.event_occurrence_spans(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_recurrence text,
  p_recurrence_until timestamptz,
  p_from date,
  p_to date
)
RETURNS TABLE (
  occurrence_date date,
  occ_starts_at timestamptz,
  occ_ends_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_base_date date := (p_starts_at AT TIME ZONE 'Asia/Jakarta')::date;
  v_step int;
  v_first date;
  v_last date;
  v_day date;
BEGIN
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_to IS NULL THEN
    RETURN;
  END IF;

  v_step := CASE p_recurrence
    WHEN 'daily' THEN 1
    WHEN 'weekly' THEN 7
    ELSE 0
  END;

  -- 'none', and a rule this application does not expand, is exactly its stored row.
  IF v_step = 0 THEN
    IF v_base_date BETWEEN p_from AND p_to THEN
      occurrence_date := v_base_date;
      occ_starts_at := p_starts_at;
      occ_ends_at := p_ends_at;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  v_first := GREATEST(p_from, v_base_date);
  v_last := LEAST(p_to, COALESCE((NULLIF(p_recurrence_until, 'infinity') AT TIME ZONE 'Asia/Jakarta')::date, p_to));
  IF v_first > v_last THEN
    RETURN;
  END IF;

  -- Only offsets that are whole multiples of the step are occurrences of this series, so
  -- a weekly agenda keeps the weekday its base was created on.
  v_day := v_base_date + (((v_first - v_base_date + v_step - 1) / v_step) * v_step);
  WHILE v_day <= v_last LOOP
    occurrence_date := v_day;
    occ_starts_at := p_starts_at + ((v_day - v_base_date) * interval '1 day');
    occ_ends_at := p_ends_at + ((v_day - v_base_date) * interval '1 day');
    RETURN NEXT;
    v_day := v_day + v_step;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION app.event_occurrence_spans(timestamptz, timestamptz, text, timestamptz, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_occurrence_spans(timestamptz, timestamptz, text, timestamptz, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The overlap question, asked over occurrences instead of stored intervals.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.event_slot_taken(
  p_event_id uuid,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_recurrence text,
  p_recurrence_until timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  WITH incoming AS (
    SELECT spans.occurrence_date, spans.occ_starts_at, spans.occ_ends_at
      FROM app.event_occurrence_spans(
             p_starts_at,
             p_ends_at,
             p_recurrence,
             p_recurrence_until,
             (p_starts_at AT TIME ZONE 'Asia/Jakarta')::date,
             LEAST(
               COALESCE(
                 (NULLIF(p_recurrence_until, 'infinity') AT TIME ZONE 'Asia/Jakarta')::date,
                 (p_starts_at AT TIME ZONE 'Asia/Jakarta')::date + 180
               ),
               (p_starts_at AT TIME ZONE 'Asia/Jakarta')::date + 180
             )
           ) spans
  )
  SELECT EXISTS (
    SELECT 1
      FROM public.events candidate
     WHERE candidate.deleted_at IS NULL
       AND candidate.status = 'scheduled'
       AND candidate.location = p_location
       AND candidate.id IS DISTINCT FROM p_event_id
       AND EXISTS (
             SELECT 1
               FROM incoming
               -- LATERAL is written out: the expander is asked about a day that only the
               -- incoming row of this iteration knows.
               CROSS JOIN LATERAL app.event_occurrence_spans(
                      candidate.starts_at,
                      candidate.ends_at,
                      candidate.recurrence_rule,
                      candidate.recurrence_until,
                      incoming.occurrence_date,
                      incoming.occurrence_date
                    ) occ
              WHERE occ.occurrence_date = incoming.occurrence_date
                AND occ.occ_starts_at < incoming.occ_ends_at
                AND occ.occ_ends_at > incoming.occ_starts_at
           )
  );
$$;

REVOKE ALL ON FUNCTION app.event_slot_taken(uuid, text, timestamptz, timestamptz, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_slot_taken(uuid, text, timestamptz, timestamptz, text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.event_upsert with the collision check delegated to section 2.
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

  -- SCH-09: the same overlap rule as 20261122000008, but asked of the days each agenda
  -- occupies rather than of the two stored intervals. The message is unchanged because the
  -- schedule form, its tests and the operator's muscle memory all key on it.
  IF app.event_slot_taken(
       v_event_id, v_location, v_starts_at, v_ends_at, v_recurrence, v_recurrence_until
     ) THEN
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

NOTIFY pgrst, 'reload schema';
