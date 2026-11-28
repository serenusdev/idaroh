BEGIN;

CREATE TABLE IF NOT EXISTS public.student_number_counters (
  year integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 9999),
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
);
ALTER TABLE public.student_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_number_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.student_number_counters TO service_role;

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS created_via text;
ALTER TABLE public.students ALTER COLUMN gender DROP NOT NULL;

CREATE OR REPLACE FUNCTION app.next_student_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Jakarta'))::integer;
  v_seq integer;
  v_nis text;
BEGIN
  LOOP
    INSERT INTO public.student_number_counters AS c (year, last_seq)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_seq = c.last_seq + 1
    RETURNING c.last_seq INTO v_seq;
    v_nis := 'IDH-' || v_year::text || '-' || lpad(v_seq::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.students WHERE nis = v_nis);
  END LOOP;
  RETURN v_nis;
END;
$$;

CREATE OR REPLACE FUNCTION app.students_assign_nis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  IF NEW.nis IS NULL OR btrim(NEW.nis) = '' THEN
    NEW.nis := app.next_student_number();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.students_nis_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  IF NEW.nis IS DISTINCT FROM OLD.nis THEN
    RAISE EXCEPTION 'NIS_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_assign_nis ON public.students;
CREATE TRIGGER trg_students_assign_nis
BEFORE INSERT ON public.students
FOR EACH ROW EXECUTE FUNCTION app.students_assign_nis();

DROP TRIGGER IF EXISTS trg_students_nis_immutable ON public.students;
CREATE TRIGGER trg_students_nis_immutable
BEFORE UPDATE OF nis ON public.students
FOR EACH ROW EXECUTE FUNCTION app.students_nis_immutable();

CREATE OR REPLACE FUNCTION app.ensure_student_for_profile(p_profile_id uuid)
RETURNS public.students
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_profile public.profiles;
  v_student public.students;
BEGIN
  -- This private helper is also called by approval triggers running through the
  -- service-role RPC path, where auth.uid() may be NULL. Direct session callers
  -- are still fail-closed when an identity is present.
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
    INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
    VALUES ('student.provision_skipped', auth.uid(), p_profile_id::text, 'student', 'Nama profil terlalu pendek', jsonb_build_object('profile_id', p_profile_id));
    RETURN NULL;
  END IF;

  INSERT INTO public.students(full_name, profile_id, created_via)
  VALUES (btrim(v_profile.full_name), p_profile_id, 'account_approval')
  ON CONFLICT (profile_id) DO NOTHING
  RETURNING * INTO v_student;

  IF v_student.id IS NOT NULL THEN
    INSERT INTO public.audit_logs(event_name, actor_id, target_id, target_label, action_detail, payload)
    VALUES ('student.provisioned', auth.uid(), v_student.id::text, v_student.nis, 'Master santri dibuat otomatis', jsonb_build_object('profile_id', p_profile_id, 'created_via', 'account_approval'));
  ELSE
    SELECT * INTO v_student FROM public.students WHERE profile_id = p_profile_id;
  END IF;
  RETURN v_student;
END;
$$;

CREATE OR REPLACE FUNCTION app.ensure_student_after_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  IF NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM public.roles WHERE id = NEW.role_id AND key = 'santri') THEN
    PERFORM app.ensure_student_for_profile(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.ensure_student_after_profile_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('active', 'approved') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM app.ensure_student_for_profile(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_student_after_role ON public.user_roles;
CREATE TRIGGER trg_ensure_student_after_role
AFTER INSERT OR UPDATE OF revoked_at ON public.user_roles
FOR EACH ROW WHEN (NEW.revoked_at IS NULL)
EXECUTE FUNCTION app.ensure_student_after_role();

DROP TRIGGER IF EXISTS trg_ensure_student_after_profile_status ON public.profiles;
CREATE TRIGGER trg_ensure_student_after_profile_status
AFTER UPDATE OF status ON public.profiles
FOR EACH ROW WHEN (NEW.status IN ('active', 'approved') AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION app.ensure_student_after_profile_status();

DROP POLICY IF EXISTS students_self_select ON public.students;
CREATE POLICY students_self_select ON public.students FOR SELECT TO authenticated
USING (app.is_active_member() AND profile_id = auth.uid());

INSERT INTO public.students(full_name, profile_id, created_via)
SELECT btrim(p.full_name), p.id, 'migration_202612040001_backfill'
FROM public.profiles p
WHERE p.status IN ('active', 'approved')
  AND char_length(btrim(COALESCE(p.full_name, ''))) >= 2
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p.id AND ur.revoked_at IS NULL AND r.key = 'santri'
  )
  AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.profile_id = p.id)
ORDER BY p.created_at, p.id
ON CONFLICT (profile_id) DO NOTHING;

REVOKE ALL ON FUNCTION app.next_student_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.ensure_student_for_profile(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
