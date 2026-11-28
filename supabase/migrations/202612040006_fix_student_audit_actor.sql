BEGIN;

CREATE OR REPLACE FUNCTION app.ensure_student_for_profile(p_profile_id uuid)
RETURNS public.students
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_profile public.profiles;
  v_student public.students;
  v_actor_name text := COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'system');
BEGIN
  IF auth.uid() IS NOT NULL AND NOT app.is_active_member() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_profile_id FOR SHARE;
  IF v_profile.id IS NULL OR v_profile.status NOT IN ('active', 'approved')
     OR NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = p_profile_id AND ur.revoked_at IS NULL AND r.key = 'santri'
     ) THEN
    RETURN NULL;
  END IF;

  IF char_length(btrim(COALESCE(v_profile.full_name, ''))) < 2 THEN
    INSERT INTO public.audit_logs(event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
    VALUES ('student.provision_skipped', auth.uid(), v_actor_name, p_profile_id::text, 'student', 'Nama profil terlalu pendek', jsonb_build_object('profile_id', p_profile_id));
    RETURN NULL;
  END IF;

  INSERT INTO public.students(full_name, profile_id, created_via)
  VALUES (btrim(v_profile.full_name), p_profile_id, 'account_approval')
  ON CONFLICT (profile_id) DO NOTHING
  RETURNING * INTO v_student;

  IF v_student.id IS NOT NULL THEN
    INSERT INTO public.audit_logs(event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
    VALUES ('student.provisioned', auth.uid(), v_actor_name, v_student.id::text, v_student.nis, 'Master santri dibuat otomatis', jsonb_build_object('profile_id', p_profile_id, 'created_via', 'account_approval'));
  ELSE
    SELECT * INTO v_student FROM public.students WHERE profile_id = p_profile_id;
  END IF;
  RETURN v_student;
END;
$$;

REVOKE ALL ON FUNCTION app.ensure_student_for_profile(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
