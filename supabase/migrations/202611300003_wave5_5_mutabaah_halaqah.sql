BEGIN;

CREATE TABLE IF NOT EXISTS public.mutabaah_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT (timezone('Asia/Jakarta', now()))::date,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, log_date)
);

CREATE TABLE IF NOT EXISTS public.halaqah_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_date date NOT NULL DEFAULT (timezone('Asia/Jakarta', now()))::date,
  entry_type text NOT NULL CHECK (entry_type IN ('ziyadah', 'murojaah')),
  surah_name text NOT NULL CHECK (char_length(trim(surah_name)) BETWEEN 1 AND 120),
  ayah_from integer NOT NULL CHECK (ayah_from > 0),
  ayah_to integer NOT NULL CHECK (ayah_to >= ayah_from),
  quality_grade text NOT NULL CHECK (quality_grade IN ('mumtaz', 'jayyid_jiddan', 'jayyid', 'maqbul', 'needs_review')),
  tajwid_errors text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  ustadz_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mutabaah_logs_date_idx ON public.mutabaah_logs(log_date DESC);
CREATE INDEX IF NOT EXISTS halaqah_logs_student_date_idx ON public.halaqah_logs(student_id, session_date DESC);

ALTER TABLE public.mutabaah_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.halaqah_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mutabaah_logs, public.halaqah_logs FROM PUBLIC, anon;
GRANT SELECT ON public.mutabaah_logs, public.halaqah_logs TO authenticated;
GRANT ALL ON public.mutabaah_logs, public.halaqah_logs TO service_role;

DROP POLICY IF EXISTS mutabaah_read_scope ON public.mutabaah_logs;
CREATE POLICY mutabaah_read_scope ON public.mutabaah_logs FOR SELECT TO authenticated
  USING (
    app.is_active_member() AND (
      app.has_any_role('pengurus', 'super_admin') OR
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = mutabaah_logs.student_id AND s.profile_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS mutabaah_write_scope ON public.mutabaah_logs;
CREATE POLICY mutabaah_write_scope ON public.mutabaah_logs FOR ALL TO authenticated
  USING (
    app.is_active_member() AND (
      app.has_any_role('pengurus', 'super_admin') OR
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = mutabaah_logs.student_id AND s.profile_id = auth.uid())
    )
  )
  WITH CHECK (
    app.is_active_member() AND recorded_by = auth.uid() AND (
      app.has_any_role('pengurus', 'super_admin') OR
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = mutabaah_logs.student_id AND s.profile_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS halaqah_read_scope ON public.halaqah_logs;
CREATE POLICY halaqah_read_scope ON public.halaqah_logs FOR SELECT TO authenticated
  USING (
    app.is_active_member() AND (
      app.has_any_role('pengurus', 'super_admin') OR
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = halaqah_logs.student_id AND s.profile_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS halaqah_write_scope ON public.halaqah_logs;
CREATE POLICY halaqah_write_scope ON public.halaqah_logs FOR ALL TO authenticated
  USING (
    app.is_active_member() AND (
      app.has_any_role('pengurus', 'super_admin') OR
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = halaqah_logs.student_id AND s.profile_id = auth.uid())
    )
  )
  WITH CHECK (
    app.is_active_member() AND (
      app.has_any_role('pengurus', 'super_admin') OR
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = halaqah_logs.student_id AND s.profile_id = auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.save_mutabaah_log(p_student_id uuid, p_checklist jsonb)
RETURNS public.mutabaah_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_row public.mutabaah_logs; v_today date := (timezone('Asia/Jakarta', now()))::date;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF NOT app.has_any_role('pengurus', 'super_admin') AND NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND profile_id = auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  INSERT INTO public.mutabaah_logs(student_id, log_date, checklist, recorded_by)
  VALUES (p_student_id, v_today, COALESCE(p_checklist, '{}'::jsonb), auth.uid())
  ON CONFLICT (student_id, log_date) DO UPDATE SET checklist = EXCLUDED.checklist, recorded_by = auth.uid(), updated_at = now()
  RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
  SELECT 'mutabaah.log_saved', auth.uid(), full_name, v_row.id::text, 'mutabaah_log', 'Log mutabaah disimpan', jsonb_build_object('student_id', p_student_id, 'log_date', v_today)
  FROM public.profiles WHERE id = auth.uid();
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.save_halaqah_log(
  p_student_id uuid, p_session_date date, p_entry_type text, p_surah_name text,
  p_ayah_from integer, p_ayah_to integer, p_quality_grade text,
  p_tajwid_errors text DEFAULT '', p_notes text DEFAULT ''
) RETURNS public.halaqah_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_row public.halaqah_logs; v_ustadz_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF NOT app.has_any_role('pengurus', 'super_admin') AND NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND profile_id = auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_entry_type NOT IN ('ziyadah', 'murojaah') OR p_quality_grade NOT IN ('mumtaz', 'jayyid_jiddan', 'jayyid', 'maqbul', 'needs_review') THEN RAISE EXCEPTION 'INVALID_HALAQAH_VALUE'; END IF;
  v_ustadz_id := CASE WHEN app.has_any_role('pengurus', 'super_admin') THEN auth.uid() ELSE NULL END;
  INSERT INTO public.halaqah_logs(student_id, session_date, entry_type, surah_name, ayah_from, ayah_to, quality_grade, tajwid_errors, notes, ustadz_id)
  VALUES (p_student_id, p_session_date, p_entry_type, trim(p_surah_name), p_ayah_from, p_ayah_to, p_quality_grade, COALESCE(p_tajwid_errors, ''), COALESCE(p_notes, ''), v_ustadz_id)
  RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
  SELECT 'halaqah.log_saved', auth.uid(), full_name, v_row.id::text, 'halaqah_log', 'Setoran halaqah dicatat', jsonb_build_object('student_id', p_student_id, 'entry_type', p_entry_type, 'session_date', p_session_date)
  FROM public.profiles WHERE id = auth.uid();
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.save_mutabaah_log(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_halaqah_log(uuid, date, text, text, integer, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_mutabaah_log(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_halaqah_log(uuid, date, text, text, integer, integer, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
