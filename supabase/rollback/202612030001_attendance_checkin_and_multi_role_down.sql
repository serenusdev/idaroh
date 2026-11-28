BEGIN;

DROP FUNCTION IF EXISTS public.admin_set_user_roles(uuid, uuid, text[], text);
DROP FUNCTION IF EXISTS app.admin_set_user_roles(uuid, uuid, text[], text);

-- Restore the pre-remediation Wave 5.3 function body. This is intentionally the exact prior
-- implementation so rollback does not silently retain the corrected behavior.
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
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success',false,'code','UNAUTHORIZED','message','Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.is_operational_day(v_today_wib) THEN
    RETURN jsonb_build_object('success',false,'code','ATT_NON_OPERATIONAL_DAY','message','Hari ini bukan hari operasional presensi.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_records WHERE user_id = v_uid AND attendance_date = v_today_wib) THEN
    RETURN jsonb_build_object('success',false,'code','ALREADY_CHECKED_IN_TODAY','already_checked_in',true,'message','ALREADY_CHECKED_IN_TODAY');
  END IF;
  SELECT entry.value->>'classification', entry.value->>'status', (entry.value->>'late_minutes')::integer
    INTO v_classification, v_status, v_late_minutes
  FROM jsonb_each(app.wave5_3_classify_time(v_now_wib::time)) AS entry(key, value);
  INSERT INTO public.attendance_records (user_id, attendance_date, checked_in_at, classification, status, late_minutes, minutes_after_deadline, policy_version_id, client_meta)
  VALUES (v_uid, v_today_wib, now(), v_classification, v_status, v_late_minutes, v_late_minutes, 'wave5.3-08:15-wib', COALESCE(p_client_meta, '{}'::jsonb))
  ON CONFLICT (user_id, attendance_date) DO NOTHING
  RETURNING * INTO v_record;
  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','ALREADY_CHECKED_IN_TODAY','already_checked_in',true,'message','ALREADY_CHECKED_IN_TODAY');
  END IF;
  SELECT full_name INTO v_profile_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs(event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
  VALUES ('attendance.checked_in', v_uid, COALESCE(v_profile_name,'Unknown'), v_record.id::text, 'attendance_record', 'Presensi dicatat oleh RPC WIB Modul 5.3', jsonb_build_object('attendance_date',v_today_wib,'status',v_status,'late_minutes',v_late_minutes));
  RETURN jsonb_build_object('success',true,'code','CHECKED_IN','already_checked_in',false,'id',v_record.id,'status',v_status,'classification',v_classification,'late_minutes',v_late_minutes,'checked_in_at',v_record.checked_in_at,'message','Presensi berhasil dicatat berdasarkan jam server WIB.');
END;
$$;
REVOKE ALL ON FUNCTION public.check_in_attendance(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_attendance(jsonb) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
