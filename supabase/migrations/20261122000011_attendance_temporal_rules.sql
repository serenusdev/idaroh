-- TEMPORAL — PERMISSIONS.md §3.3 (`attendance.checkin` "diblokir pada hari libur/Ahad sesuai
-- kalender"), §3.4 (`is_late > 21.00 WIB`) and §2 rule 5 (integrity values computed in the DB).
-- Gelombang 3, item 1 (operator instruction 2026-11-25).
--
-- Four gaps, all of them the same shape: an operational-day rule that lives in one place gets
-- rewritten and silently loses the rule, and the surviving arithmetic cannot be tested because it
-- is welded to now().
--
--   1. 20261102000012 added "Ahad selalu non-operasional" (EXTRACT(DOW FROM p_date) = 0 ->
--      'non_operational' / 'calendar') to app.refresh_attendance_effective(). 20261114000007
--      rewrote that function for the correction layer and dropped the clause. Every Sunday
--      without a hand-written non_operational_dates row has been snapshotted as 'no_checkin'
--      since — the santri who correctly stayed home on Sunday is reported as missing attendance,
--      and their own history page ("Belum Presensi") says the same.
--   2. app.attendance_check_in (20261102000013) blocks Sunday by EXTRACT(DOW) but never looks at
--      non_operational_dates, so a calendar closure blocks nobody, while §3.3 describes the gate
--      as "hari libur/Ahad sesuai kalender".
--   3. Nothing refreshes the snapshot when a closure is added or withdrawn, and the cron calls
--      refresh_attendance_effective for today only, so a wrong historical row is permanent.
--   4. The cut-off arithmetic (08:00 + 59 detik, 08:15 + 59 detik) and the deadline comparison
--      were inline in two SECURITY DEFINER bodies, so no test could put a clock on 08:00:59
--      versus 08:01:00 or on 21:00:00 versus 21:00:01.
--
-- After this migration app.is_operational_day(date) answers the day question for both the gate
-- and the snapshot, app.classify_checkin_time / app.report_time_is_late hold the arithmetic,
-- a trigger on non_operational_dates keeps the snapshot in step with the calendar, and
-- app.backfill_non_operational_effective(from, to) repairs the rows the defect already wrote.
--
-- Rollback: supabase/rollback/20261122000011_attendance_temporal_rules_down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. One answer for "is anybody expected to be here on this date".
--    Sunday is inherent to the rule, a closure is data; both are non-operational, and this is
--    the only place either is read from.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.is_operational_day(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  SELECT p_date IS NOT NULL
    AND EXTRACT(DOW FROM p_date) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM public.non_operational_dates nod WHERE nod.attendance_date = p_date
    )
$$;

COMMENT ON FUNCTION app.is_operational_day(date)
  IS '§3.3: a date is operational unless it is a Sunday or listed in non_operational_dates. Shared by the check-in gate and the effective-attendance snapshot.';

REVOKE ALL ON FUNCTION app.is_operational_day(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_operational_day(date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The boundary arithmetic, extracted verbatim from 20261102000013:49-56 and from
--    20261122000002 (the is_late line of app.save_report). Pure functions of the times the
--    caller already read from the server clock, so the minutes around a cut-off are testable.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.classify_checkin_time(
  p_time time,
  p_cutoff time,
  p_grace time
)
RETURNS TABLE(classification public.attendance_classification_type, minutes_after integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  SELECT
    CASE
      WHEN p_time <= p_cutoff + interval '59 seconds' THEN 'on_time'
      WHEN p_time <= p_grace + interval '59 seconds' THEN 'grace'
      ELSE 'late'
    END::public.attendance_classification_type,
    CASE
      WHEN p_time > p_grace + interval '59 seconds'
        THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (p_time - p_cutoff)) / 60)::integer)
      ELSE 0
    END;
$$;

COMMENT ON FUNCTION app.classify_checkin_time(time, time, time)
  IS '§3.3 BR-ATT-03/05: on_time up to the cut-off minute inclusive (+59 seconds), grace up to the grace minute inclusive, late after that; minutes_after is measured from the cut-off and never negative.';

REVOKE ALL ON FUNCTION app.classify_checkin_time(time, time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.classify_checkin_time(time, time, time) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app.report_time_is_late(p_now time, p_deadline time)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  SELECT p_now > p_deadline
$$;

COMMENT ON FUNCTION app.report_time_is_late(time, time)
  IS '§3.4: a report is late only past the active policy deadline (21:00 WIB baseline); the deadline minute itself is still on time.';

REVOKE ALL ON FUNCTION app.report_time_is_late(time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.report_time_is_late(time, time) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The check-in gate: verbatim 20261102000013:24-91 with two substitutions — the bare Sunday
--    test becomes the shared day rule (so calendar closures block too) and the inline minutes
--    ladder becomes the shared classifier.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.attendance_check_in(
  p_user_id uuid,
  p_client_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_date date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_time time := (now() AT TIME ZONE 'Asia/Jakarta')::time;
  v_policy public.policy_settings%ROWTYPE;
  v_record public.attendance_records%ROWTYPE;
  v_classification public.attendance_classification_type;
  v_minutes_after integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.is_operational_day(v_date) THEN
    RETURN jsonb_build_object('success', false, 'code', 'ATT_NON_OPERATIONAL_DAY', 'message', 'Hari Ahad/Minggu atau hari kalender adalah hari non-operasional presensi.');
  END IF;

  SELECT * INTO v_policy
  FROM public.policy_settings
  WHERE status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ATT_POLICY_UNAVAILABLE', 'message', 'Kebijakan presensi aktif belum tersedia.');
  END IF;

  SELECT c.classification, c.minutes_after
    INTO v_classification, v_minutes_after
  FROM app.classify_checkin_time(
    v_time, v_policy.attendance_cutoff_time, v_policy.attendance_grace_cutoff_time
  ) c;

  INSERT INTO public.attendance_records (
    user_id, attendance_date, checked_in_at, classification,
    minutes_after_deadline, policy_version_id, client_meta
  ) VALUES (
    p_user_id, v_date, v_now, v_classification, v_minutes_after,
    v_policy.id::text, COALESCE(p_client_meta, '{}'::jsonb)
  )
  ON CONFLICT (user_id, attendance_date) DO NOTHING
  RETURNING * INTO v_record;

  IF v_record.id IS NULL THEN
    SELECT * INTO v_record FROM public.attendance_records
    WHERE user_id = p_user_id AND attendance_date = v_date;
    RETURN jsonb_build_object(
      'success', true, 'already_checked_in', true, 'id', v_record.id,
      'classification', v_record.classification, 'checked_in_at', v_record.checked_in_at,
      'message', 'Anda sudah melakukan presensi hari ini.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'already_checked_in', false, 'id', v_record.id,
    'classification', v_record.classification, 'checked_in_at', v_record.checked_in_at,
    'message', 'Presensi mandiri berhasil dicatat tervalidasi jam server.'
  );
END;
$$;

REVOKE ALL ON FUNCTION app.attendance_check_in(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.attendance_check_in(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The snapshot: 20261122000010 body with the Sunday clause restored through the shared day
--    rule. The role-based expectation from ROLE-SYNC and the text/enum cast that makes the
--    statement parseable stay exactly as they were; the now-redundant join on
--    non_operational_dates is what app.is_operational_day reads instead.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.refresh_attendance_effective(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_count integer;
  v_operational boolean;
BEGIN
  IF p_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tanggal snapshot wajib diisi.');
  END IF;

  -- Read once: the branch has to agree with itself in both CASE expressions.
  v_operational := app.is_operational_day(p_date);

  INSERT INTO public.attendance_effective (
    user_id, attendance_date, status, source_type, source_id, policy_version_id, generated_at
  )
  SELECT
    p.id,
    p_date,
    CASE
      WHEN NOT v_operational THEN 'non_operational'
      WHEN COALESCE(df.attendance_required, role_expect.attendance_required) = false THEN 'not_required'
      WHEN corr.id IS NOT NULL THEN corr.final_classification
      WHEN exc.id IS NOT NULL THEN exc.type
      WHEN ar.id IS NOT NULL THEN ar.classification::text
      ELSE 'no_checkin'
    END,
    CASE
      WHEN NOT v_operational THEN 'calendar'
      WHEN COALESCE(df.attendance_required, role_expect.attendance_required) = false THEN 'duty_flag'
      WHEN corr.id IS NOT NULL THEN 'correction'
      WHEN exc.id IS NOT NULL THEN 'exception'
      WHEN ar.id IS NOT NULL THEN 'attendance_record'
      ELSE 'attendance_record'
    END,
    COALESCE(corr.id, exc.id, ar.id),
    ar.policy_version_id,
    now()
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = p.id
        AND ur.revoked_at IS NULL
        AND r.key IN ('santri', 'koordinator')
    ) AS attendance_required
  ) role_expect ON true
  LEFT JOIN LATERAL (
    SELECT f.attendance_required
    FROM public.attendance_duty_flags f
    WHERE f.user_id = p.id AND f.date_from <= p_date AND (f.date_to IS NULL OR f.date_to >= p_date)
    ORDER BY f.created_at DESC LIMIT 1
  ) df ON true
  LEFT JOIN LATERAL (
    SELECT c.id, COALESCE(c.effective_classification, c.requested_classification::text) AS final_classification
    FROM public.attendance_corrections c
    WHERE c.user_id = p.id AND c.attendance_date = p_date AND c.status = 'approved'
    ORDER BY c.decided_at DESC NULLS LAST LIMIT 1
  ) corr ON true
  LEFT JOIN LATERAL (
    SELECT e.id, e.type
    FROM public.attendance_exceptions e
    WHERE e.user_id = p.id AND e.date_from <= p_date AND e.date_to >= p_date AND e.status = 'approved'
    ORDER BY e.decided_at DESC NULLS LAST LIMIT 1
  ) exc ON true
  LEFT JOIN public.attendance_records ar ON ar.user_id = p.id AND ar.attendance_date = p_date
  WHERE p.status = 'active'
  ON CONFLICT (user_id, attendance_date) DO UPDATE SET
    status = EXCLUDED.status,
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    policy_version_id = EXCLUDED.policy_version_id,
    generated_at = EXCLUDED.generated_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'attendance_date', p_date, 'rows', v_count);
END;
$$;

REVOKE ALL ON FUNCTION app.refresh_attendance_effective(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.refresh_attendance_effective(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.save_report: 20261122000002:450-617 copied verbatim except the is_late line, which now
--    asks app.report_time_is_late. The copy is deliberate — CREATE OR REPLACE needs a whole body,
--    and a hand-typed paraphrase of a production write path is exactly how 20261114000007 lost the
--    Sunday clause in the first place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.save_report(
  p_user_id           uuid,
  p_report_date       date,
  p_submission_status text,
  p_is_late           boolean,
  p_items             jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_report      public.daily_reports%ROWTYPE;
  v_existing    public.daily_reports%ROWTYPE;
  v_now         timestamptz := now();
  v_now_wib     timestamp := (v_now AT TIME ZONE 'Asia/Jakarta');
  v_today_wib   date := (v_now AT TIME ZONE 'Asia/Jakarta')::date;
  v_deadline    time;
  v_is_late     boolean;
  v_item        jsonb;
  v_index       integer := 0;
  v_category_id uuid;
  v_snapshot    jsonb;
  v_duration    integer;
  v_category_key text;
  v_actor_name  text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses ke laporan ini.');
  END IF;
  IF p_submission_status NOT IN ('draft', 'submitted') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status laporan tidak valid.');
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan wajib memiliki minimal 1 item.');
  END IF;

  -- Integrity values are computed here, never taken from the caller.
  IF p_report_date IS DISTINCT FROM v_today_wib THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan harian hanya untuk tanggal operasional hari ini (WIB).');
  END IF;

  SELECT report_deadline_time INTO v_deadline
  FROM public.policy_settings
  WHERE status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;
  v_deadline := COALESCE(v_deadline, time '21:00:00');
  v_is_late := app.report_time_is_late(v_now_wib::time, v_deadline);

  SELECT * INTO v_existing
  FROM public.daily_reports
  WHERE user_id = p_user_id AND report_date = p_report_date
  FOR UPDATE;

  IF FOUND AND v_existing.review_status = 'approved' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Laporan yang sudah disetujui tidak dapat diubah.');
  END IF;

  IF FOUND THEN
    SELECT jsonb_agg(to_jsonb(ri) ORDER BY ri.sort_order) INTO v_snapshot
    FROM public.report_items ri
    WHERE ri.report_id = v_existing.id;
    IF v_snapshot IS NOT NULL THEN
      INSERT INTO public.report_revisions (report_id, revision_no, snapshot_items, submitted_at, submitted_by)
      VALUES (v_existing.id, v_existing.revision_no, v_snapshot, v_now, p_user_id);
    END IF;
  END IF;

  INSERT INTO public.daily_reports (
    user_id, report_date, submission_status, is_late,
    first_submitted_at, last_submitted_at, review_status, updated_at
  ) VALUES (
    p_user_id, p_report_date, p_submission_status,
    CASE WHEN p_submission_status = 'submitted' THEN v_is_late ELSE false END,
    CASE WHEN p_submission_status = 'submitted' THEN v_now ELSE NULL END,
    CASE WHEN p_submission_status = 'submitted' THEN v_now ELSE NULL END,
    'not_reviewed', v_now
  )
  ON CONFLICT (user_id, report_date) DO UPDATE SET
    submission_status = EXCLUDED.submission_status,
    -- is_late is fixed on the first submission (BR-REP-11) and always from the
    -- database clock; EXCLUDED.is_late / p_is_late never reach the column.
    is_late = CASE
      WHEN public.daily_reports.first_submitted_at IS NULL
           AND EXCLUDED.submission_status = 'submitted'
      THEN v_is_late
      ELSE public.daily_reports.is_late
    END,
    first_submitted_at = COALESCE(public.daily_reports.first_submitted_at, EXCLUDED.first_submitted_at),
    last_submitted_at = CASE WHEN EXCLUDED.submission_status = 'submitted'
                             THEN EXCLUDED.last_submitted_at
                             ELSE public.daily_reports.last_submitted_at END,
    review_status = CASE WHEN EXCLUDED.submission_status = 'submitted'
                         THEN 'not_reviewed' ELSE public.daily_reports.review_status END,
    revision_no = CASE WHEN EXCLUDED.submission_status = 'submitted'
                       THEN public.daily_reports.revision_no + 1
                       ELSE public.daily_reports.revision_no END,
    updated_at = v_now
  RETURNING * INTO v_report;

  DELETE FROM public.report_items WHERE report_id = v_report.id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_index := v_index + 1;
    v_category_id := NULL;
    v_category_key := NULLIF(trim(v_item->>'categoryId'), '');
    IF v_category_key IS NOT NULL THEN
      IF v_category_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        SELECT id INTO v_category_id FROM public.report_categories WHERE id = v_category_key::uuid;
      ELSE
        SELECT id INTO v_category_id FROM public.report_categories WHERE slug = v_category_key AND is_active = true;
      END IF;
    END IF;
    -- Single-backslash class: 20261102000006 shipped the double-backslash form
    -- inside dollar quoting, which never matched and silently defaulted every
    -- duration to 60.
    v_duration := CASE
      WHEN COALESCE(v_item->>'durationMinutes', '') ~ '^\d+$' THEN (v_item->>'durationMinutes')::integer
      ELSE 60
    END;
    INSERT INTO public.report_items (
      report_id, category_id, title, description, result_progress,
      obstacles, duration_minutes, sort_order
    ) VALUES (
      v_report.id,
      v_category_id,
      COALESCE(NULLIF(v_item->>'title', ''), 'Aktivitas ' || v_index),
      COALESCE(v_item->>'description', ''),
      NULLIF(v_item->>'resultProgress', ''),
      NULLIF(v_item->>'obstacles', ''),
      v_duration,
      v_index
    );
  END LOOP;

  IF p_submission_status = 'submitted' THEN
    SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = p_user_id;
    INSERT INTO public.audit_logs (
      event_name, actor_id, actor_name, target_id, target_label, action_detail
    ) VALUES (
      'report.submitted',
      p_user_id,
      COALESCE(v_actor_name, p_user_id::text),
      v_report.id::text,
      format('Laporan Santri (%s)', v_report.id),
      format('Laporan harian dikirim (revision %s, %s).', v_report.revision_no,
             CASE WHEN v_report.is_late THEN 'terlambat' ELSE 'tepat waktu' END)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'report_id', v_report.id,
    'revision_no', v_report.revision_no,
    'is_late', v_report.is_late
  );
EXCEPTION WHEN OTHERS THEN
  -- Raw SQLERRM must never reach the client (operator note, 2026-11-22); it
  -- stays in the database log for operators instead.
  RAISE WARNING 'app.save_report failed (user %, SQLSTATE %): %', p_user_id, SQLSTATE, SQLERRM;
  RETURN jsonb_build_object('success', false, 'message', 'Penyimpanan laporan gagal diproses. Silakan coba lagi.');
END;
$$;


REVOKE ALL ON FUNCTION app.save_report(uuid, date, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_report(uuid, date, text, boolean, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. The calendar keeps the snapshot in step. Before this, adding a closure changed nothing until
--    the cron happened to refresh that same date — which it never does, because it only refreshes
--    today. Both directions matter: withdrawing a closure has to bring the duty back.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.refresh_attendance_after_calendar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM app.refresh_attendance_effective(NEW.attendance_date);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM app.refresh_attendance_effective(OLD.attendance_date);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_attendance_after_calendar ON public.non_operational_dates;
CREATE TRIGGER trg_refresh_attendance_after_calendar
  AFTER INSERT OR UPDATE OR DELETE ON public.non_operational_dates
  FOR EACH ROW EXECUTE FUNCTION app.refresh_attendance_after_calendar();

-- ---------------------------------------------------------------------------
-- 7. Repair what the defect already wrote. Idempotent (already-correct rows are not matched) and
--    range-bounded, so an operator can run it once over the whole table or a single month.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.backfill_non_operational_effective(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Rentang backfill non-operasional tidak valid: %..%', p_from, p_to;
  END IF;

  UPDATE public.attendance_effective ae
     SET status = 'non_operational',
         source_type = 'calendar',
         source_id = NULL,
         generated_at = now()
   WHERE ae.attendance_date BETWEEN p_from AND p_to
     AND NOT app.is_operational_day(ae.attendance_date)
     AND (ae.status <> 'non_operational' OR ae.source_type <> 'calendar');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION app.backfill_non_operational_effective(date, date)
  IS 'Repairs attendance_effective rows snapshotted between 20261114000007 and this migration: a Sunday or a closed day must read non_operational/calendar. Idempotent, bounded by date range, service_role only.';

REVOKE ALL ON FUNCTION app.backfill_non_operational_effective(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.backfill_non_operational_effective(date, date) TO service_role;

DROP FUNCTION IF EXISTS public.backfill_non_operational_effective(date, date);
CREATE OR REPLACE FUNCTION public.backfill_non_operational_effective(p_from date, p_to date)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.backfill_non_operational_effective(p_from, p_to);
$$;

REVOKE ALL ON FUNCTION public.backfill_non_operational_effective(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_non_operational_effective(date, date) TO service_role;

-- One pass over whatever is already in the table. On a fresh database the range is empty and the
-- call is skipped; on production this is what repairs the historical Sundays at release time.
DO $$
DECLARE
  v_from date;
  v_to date;
BEGIN
  SELECT min(attendance_date), max(attendance_date) INTO v_from, v_to FROM public.attendance_effective;
  IF v_from IS NOT NULL THEN
    RAISE NOTICE 'attendance_effective backfill %..%: % rows repaired',
      v_from, v_to, app.backfill_non_operational_effective(v_from, v_to);
  END IF;
END
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
