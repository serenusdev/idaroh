BEGIN;

-- The Wave 5.3 classifier returns one JSON object. The previous implementation iterated over
-- that object's properties with jsonb_each(), then tried to read classification from each scalar
-- value. That left v_classification NULL and caused the insert/refresh trigger to abort, which
-- surfaced to the client as an unreadable object error.
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
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  IF NOT app.is_operational_day(v_today_wib) THEN
    RETURN jsonb_build_object('success', false, 'code', 'ATT_NON_OPERATIONAL_DAY', 'message', 'Hari ini bukan hari operasional presensi.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_records WHERE user_id = v_uid AND attendance_date = v_today_wib) THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_CHECKED_IN_TODAY', 'already_checked_in', true, 'message', 'ALREADY_CHECKED_IN_TODAY');
  END IF;

  v_classification := (app.wave5_3_classify_time(v_now_wib::time)->>'classification')::public.attendance_classification_type;
  v_status := app.wave5_3_classify_time(v_now_wib::time)->>'status';
  v_late_minutes := (app.wave5_3_classify_time(v_now_wib::time)->>'late_minutes')::integer;

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
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_CHECKED_IN_TODAY', 'already_checked_in', true, 'message', 'ALREADY_CHECKED_IN_TODAY');
  END IF;

  SELECT full_name INTO v_profile_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_logs(event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
  VALUES ('attendance.checked_in', v_uid, COALESCE(v_profile_name, 'Unknown'), v_record.id::text, 'attendance_record', 'Presensi dicatat oleh RPC WIB Modul 5.3', jsonb_build_object('attendance_date', v_today_wib, 'status', v_status, 'late_minutes', v_late_minutes));

  RETURN jsonb_build_object('success', true, 'code', 'CHECKED_IN', 'already_checked_in', false, 'id', v_record.id, 'status', v_status, 'classification', v_classification, 'late_minutes', v_late_minutes, 'checked_in_at', v_record.checked_in_at, 'message', 'Presensi berhasil dicatat berdasarkan jam server WIB.');
END;
$$;
REVOKE ALL ON FUNCTION public.check_in_attendance(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_attendance(jsonb) TO authenticated;

-- Keep role administration explicit: a super_admin may preserve its own protected role while
-- adding an operational role to the same account, but the registration queue can never mint a
-- new super_admin. The existing active role set is replaced atomically and audited.
CREATE OR REPLACE FUNCTION app.admin_set_user_roles(
  p_target_user_id uuid,
  p_admin_id uuid,
  p_role_keys text[],
  p_member_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_keys text[];
  v_key text;
  v_role_id uuid;
  v_actor_name text;
  v_now timestamptz := now();
  v_target_is_super boolean;
  v_other_super_admin integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id AND r.key = 'super_admin'
    JOIN public.profiles p ON p.id = ur.user_id AND p.status = 'active'
    WHERE ur.user_id = p_admin_id AND ur.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pemanggil bukan super_admin aktif.');
  END IF;
  IF p_role_keys IS NULL OR cardinality(p_role_keys) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Minimal satu peran wajib dipertahankan.');
  END IF;

  SELECT array_agg(DISTINCT lower(trim(k)) ORDER BY lower(trim(k)))
    INTO v_keys
  FROM unnest(p_role_keys) AS input(k)
  WHERE trim(k) <> '';
  IF v_keys IS NULL OR cardinality(v_keys) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Daftar peran tidak valid.');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) AS requested(key) WHERE requested.key NOT IN ('super_admin', 'yayasan', 'pengurus', 'koordinator', 'santri')) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Terdapat peran yang tidak dikenal.');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id AND r.key = 'super_admin'
    WHERE ur.user_id = p_target_user_id AND ur.revoked_at IS NULL
  ) INTO v_target_is_super;

  IF 'super_admin' = ANY(v_keys) AND NOT v_target_is_super THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peran super_admin tidak dapat ditambahkan dari jalur ini.');
  END IF;
  IF v_target_is_super AND NOT ('super_admin' = ANY(v_keys)) THEN
    SELECT count(*) INTO v_other_super_admin
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id AND r.key = 'super_admin'
    JOIN public.profiles p ON p.id = ur.user_id AND p.status = 'active'
    WHERE ur.revoked_at IS NULL AND ur.user_id <> p_target_user_id;
    IF v_other_super_admin = 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Harus tetap ada minimal satu super_admin aktif.');
    END IF;
  END IF;
  IF p_member_type IS NOT NULL AND p_member_type NOT IN ('santri', 'ustadz', 'pengurus', 'yayasan', 'lainnya') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kategori anggota tidak valid.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_user_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengguna tidak ditemukan.');
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = p_admin_id;
  UPDATE public.user_roles ur
  SET revoked_at = v_now, revoked_by = p_admin_id, reason = 'Role set diperbarui oleh administrator'
  FROM public.roles r
  WHERE ur.user_id = p_target_user_id AND ur.role_id = r.id AND ur.revoked_at IS NULL AND NOT (r.key = ANY(v_keys));

  FOREACH v_key IN ARRAY v_keys LOOP
    SELECT id INTO v_role_id FROM public.roles WHERE key = v_key;
    UPDATE public.user_roles
    SET revoked_at = NULL, revoked_by = NULL, reason = NULL, granted_by = p_admin_id
    WHERE user_id = p_target_user_id AND role_id = v_role_id;
    IF NOT FOUND THEN
      INSERT INTO public.user_roles (user_id, role_id, granted_by)
      VALUES (p_target_user_id, v_role_id, p_admin_id);
    END IF;
  END LOOP;

  UPDATE public.profiles
  SET member_type = COALESCE(p_member_type, member_type), updated_at = v_now
  WHERE id = p_target_user_id;
  INSERT INTO public.audit_logs(event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
  VALUES ('iam.roles_replaced', p_admin_id, COALESCE(v_actor_name, p_admin_id::text), p_target_user_id::text, 'Role pengguna', 'Set role aktif diperbarui.', jsonb_build_object('roles', v_keys));

  RETURN jsonb_build_object('success', true, 'message', 'Role pengguna berhasil diperbarui.', 'roles', to_jsonb(v_keys));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_roles(
  p_target_user_id uuid,
  p_admin_id uuid,
  p_role_keys text[],
  p_member_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp
AS $$
  SELECT app.admin_set_user_roles(p_target_user_id, p_admin_id, p_role_keys, p_member_type);
$$;
REVOKE ALL ON FUNCTION app.admin_set_user_roles(uuid, uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.admin_set_user_roles(uuid, uuid, text[], text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_user_roles(uuid, uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_roles(uuid, uuid, text[], text) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
