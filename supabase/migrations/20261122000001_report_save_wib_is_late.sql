-- Migration: 20261122000001_report_save_wib_is_late.sql
-- SEC-02: the database — not the client — owns the Jakarta operational date,
-- the is_late flag (PERMISSIONS.md §3.4, > 21.00 WIB / active policy deadline),
-- and the report write path.
--
-- Two production-verified defects are repaired here:
--   1. 20261114000001 replaced the thin public.save_report wrapper with a full
--      SECURITY INVOKER implementation. Since 20261102000020 revoked direct
--      authenticated writes on daily_reports/report_items, every user call to
--      this RPC fails with "permission denied" surfaced as {success:false}.
--   2. Both the app.* and the drifted public.* implementations accept the
--      client-supplied p_is_late value, so a caller can forge late/on-time
--      status. p_is_late is kept in the signature for API compatibility but is
--      ignored; is_late is computed from the Asia/Jakarta clock against the
--      active policy_settings.report_deadline_time and pinned on the first
--      submission (BR-REP-11), exactly like app.report_submit.
--
-- Report submissions (and only submissions) now also write an audit_logs row
-- in the same transaction (operator decision 2026-11-22; PERMISSIONS.md §2.6).

-- ---------------------------------------------------------------------------
-- 1. app.save_report: hardened implementation
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
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION app.save_report(uuid, date, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_report(uuid, date, text, boolean, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.save_report: restore the thin delegating wrapper that
--    20261114000001 had replaced with a divergent inline implementation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_report(
  p_user_id           uuid,
  p_report_date       date,
  p_submission_status text,
  p_is_late           boolean,
  p_items             jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app, pg_temp
AS $$
  SELECT app.save_report(p_user_id, p_report_date, p_submission_status, p_is_late, p_items);
$$;

REVOKE ALL ON FUNCTION public.save_report(uuid, date, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_report(uuid, date, text, boolean, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
