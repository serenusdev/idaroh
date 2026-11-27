BEGIN;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'present'
    CHECK (status IN ('present','late')),
  ADD COLUMN IF NOT EXISTS late_minutes integer NOT NULL DEFAULT 0
    CHECK (late_minutes >= 0);

UPDATE public.attendance_records
SET status = CASE WHEN classification = 'late' THEN 'late' ELSE 'present' END,
    late_minutes = CASE WHEN classification = 'late' THEN GREATEST(1, minutes_after_deadline) ELSE 0 END
WHERE status = 'present' AND (classification = 'late' OR late_minutes <> 0);

CREATE INDEX IF NOT EXISTS idx_attendance_records_status_date
  ON public.attendance_records(attendance_date, status);

CREATE TABLE IF NOT EXISTS public.notification_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dispatch_date date NOT NULL,
  stage text NOT NULL CHECK (stage IN ('0730_morning','0805_near_limit','0816_late_alert')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dispatch_date, stage)
);

ALTER TABLE public.notification_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_dispatches FROM PUBLIC, anon;
GRANT SELECT ON public.notification_dispatches TO authenticated;
GRANT ALL ON public.notification_dispatches TO service_role;

DROP POLICY IF EXISTS notification_dispatches_select_own ON public.notification_dispatches;
CREATE POLICY notification_dispatches_select_own ON public.notification_dispatches
  FOR SELECT TO authenticated
  USING (app.is_active_member() AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION app.wave5_3_classify_time(p_time time)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, app, pg_temp
AS $$
  SELECT CASE WHEN p_time <= TIME '08:15:00' THEN
    jsonb_build_object('status','present','classification','on_time','late_minutes',0)
  ELSE
    jsonb_build_object(
      'status','late',
      'classification','late',
      'late_minutes',GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p_time - TIME '08:15:00')) / 60)::integer)
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.wave5_3_classify_time(time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.wave5_3_classify_time(time) TO service_role;

CREATE OR REPLACE FUNCTION public.check_in_attendance(p_client_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now_wib timestamp := (now() AT TIME ZONE 'Asia/Jakarta');
  v_today_wib date := v_now_wib::date;
  v_classification public.attendance_classification_type;
  v_status text;
  v_late_minutes integer;
  v_record public.attendance_records%ROWTYPE;
  v_profile_name text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success',false,'code','UNAUTHORIZED','message','Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.is_operational_day(v_today_wib) THEN
    RETURN jsonb_build_object('success',false,'code','ATT_NON_OPERATIONAL_DAY','message','Hari ini bukan hari operasional presensi.');
  END IF;

  -- The unique key is the final concurrency fence; the pre-check supplies the explicit contract code.
  IF EXISTS (SELECT 1 FROM public.attendance_records WHERE user_id = v_uid AND attendance_date = v_today_wib) THEN
    RETURN jsonb_build_object('success',false,'code','ALREADY_CHECKED_IN_TODAY','already_checked_in',true,'message','ALREADY_CHECKED_IN_TODAY');
  END IF;

  SELECT entry.value->>'classification', entry.value->>'status', (entry.value->>'late_minutes')::integer
    INTO v_classification, v_status, v_late_minutes
  FROM jsonb_each(app.wave5_3_classify_time(v_now_wib::time)) AS entry(key, value);

  INSERT INTO public.attendance_records (
    user_id, attendance_date, checked_in_at, classification, status, late_minutes,
    minutes_after_deadline, policy_version_id, client_meta
  ) VALUES (
    v_uid, v_today_wib, now(), v_classification, v_status, v_late_minutes,
    v_late_minutes, 'wave5.3-08:15-wib', COALESCE(p_client_meta, '{}'::jsonb)
  )
  ON CONFLICT (user_id, attendance_date) DO NOTHING
  RETURNING * INTO v_record;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','ALREADY_CHECKED_IN_TODAY','already_checked_in',true,'message','ALREADY_CHECKED_IN_TODAY');
  END IF;

  SELECT full_name INTO v_profile_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs(event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
  VALUES ('attendance.checked_in', v_uid, COALESCE(v_profile_name,'Unknown'), v_record.id::text, 'attendance_record', 'Presensi dicatat oleh RPC WIB Modul 5.3', jsonb_build_object('attendance_date',v_today_wib,'status',v_status,'late_minutes',v_late_minutes));

  v_result := jsonb_build_object('success',true,'code','CHECKED_IN','already_checked_in',false,'id',v_record.id,'status',v_status,'classification',v_classification,'late_minutes',v_late_minutes,'checked_in_at',v_record.checked_in_at,'message','Presensi berhasil dicatat berdasarkan jam server WIB.');
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.check_in_attendance(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_attendance(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.attendance_today_status()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now_wib timestamp := (now() AT TIME ZONE 'Asia/Jakarta');
  v_record public.attendance_records%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT * INTO v_record FROM public.attendance_records WHERE user_id = v_uid AND attendance_date = v_now_wib::date;
  RETURN jsonb_build_object(
    'today_wib', v_now_wib::date,
    'time_wib', to_char(v_now_wib::time, 'HH24:MI:SS'),
    'checked_in', v_record.id IS NOT NULL,
    'status', v_record.status,
    'classification', v_record.classification,
    'late_minutes', COALESCE(v_record.late_minutes,0),
    'late_window', v_now_wib::time > TIME '08:15:00',
    'checked_in_at', v_record.checked_in_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_today_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_today_status() TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
