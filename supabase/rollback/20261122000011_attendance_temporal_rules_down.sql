-- Rollback for 20261122000011_attendance_temporal_rules.sql
-- Restores the pre-image of every function it rewrote, byte-for-byte from the migrations that
-- defined them, and drops the four objects the migration added.
--
-- Deliberate: the data repair is NOT reverted. Rows this migration set to 'non_operational'
-- because the date is a Sunday or a calendar closure stay as they are — rewriting them back to
-- 'no_checkin' would recreate a reported defect, and the snapshot is regenerable anyway through
-- public.refresh_attendance_effective(date).
--
-- Consequence of running this file: app.refresh_attendance_effective loses the Sunday clause
-- again (the 20261114000007 behaviour), app.attendance_check_in blocks Sunday but no longer
-- respects non_operational_dates, and adding a closure stops refreshing the snapshot.

BEGIN;

DROP TRIGGER IF EXISTS trg_refresh_attendance_after_calendar ON public.non_operational_dates;
DROP FUNCTION IF EXISTS app.refresh_attendance_after_calendar();
DROP FUNCTION IF EXISTS public.backfill_non_operational_effective(date, date);
DROP FUNCTION IF EXISTS app.backfill_non_operational_effective(date, date);

-- app.attendance_check_in as created by 20261102000013_active_rpc_scope_hardening.sql:24-91.
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
  IF EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Jakarta')) = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'ATT_NON_OPERATIONAL_DAY', 'message', 'Hari Ahad/Minggu adalah hari non-operasional presensi.');
  END IF;

  SELECT * INTO v_policy
  FROM public.policy_settings
  WHERE status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ATT_POLICY_UNAVAILABLE', 'message', 'Kebijakan presensi aktif belum tersedia.');
  END IF;

  IF v_time <= v_policy.attendance_cutoff_time + interval '59 seconds' THEN
    v_classification := 'on_time';
  ELSIF v_time <= v_policy.attendance_grace_cutoff_time + interval '59 seconds' THEN
    v_classification := 'grace';
  ELSE
    v_classification := 'late';
    v_minutes_after := GREATEST(0, floor(EXTRACT(EPOCH FROM (v_time - v_policy.attendance_cutoff_time)) / 60));
  END IF;

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

-- app.refresh_attendance_effective as created by 20261122000010_role_sync_ustadz_and_matrix.sql:148-235.
CREATE OR REPLACE FUNCTION app.refresh_attendance_effective(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tanggal snapshot wajib diisi.');
  END IF;

  INSERT INTO public.attendance_effective (
    user_id, attendance_date, status, source_type, source_id, policy_version_id, generated_at
  )
  SELECT
    p.id,
    p_date,
    CASE
      WHEN nod.attendance_date IS NOT NULL THEN 'non_operational'
      WHEN COALESCE(df.attendance_required, role_expect.attendance_required) = false THEN 'not_required'
      WHEN corr.id IS NOT NULL THEN corr.final_classification
      WHEN exc.id IS NOT NULL THEN exc.type
      WHEN ar.id IS NOT NULL THEN ar.classification::text
      ELSE 'no_checkin'
    END,
    CASE
      WHEN nod.attendance_date IS NOT NULL THEN 'calendar'
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
  LEFT JOIN public.non_operational_dates nod ON nod.attendance_date = p_date
  LEFT JOIN LATERAL (
    -- EXISTS, not a filtered row: an account with no attended-role grant has to answer
    -- false rather than NULL, otherwise it falls through to `no_checkin` and every
    -- administrator appears absent in the operational layer.
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
    -- effective_classification is text and requested_classification is the
    -- attendance_classification_type enum: uncast, the whole statement fails to parse, so every
    -- insert into attendance_records — which fires this through trg_refresh_attendance_after_record
    -- — errored with "COALESCE types text and attendance_classification_type cannot be matched".
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

-- app.save_report as created by 20261122000002_report_rls_review_scope.sql:450-615.
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
  v_is_late := v_now_wib::time > v_deadline;

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

DROP FUNCTION IF EXISTS app.report_time_is_late(time, time);
DROP FUNCTION IF EXISTS app.classify_checkin_time(time, time, time);
DROP FUNCTION IF EXISTS app.is_operational_day(date);

COMMIT;

NOTIFY pgrst, 'reload schema';
