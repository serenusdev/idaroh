BEGIN;

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nis text UNIQUE NOT NULL CHECK (char_length(trim(nis)) >= 3),
  full_name text NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  gender text NOT NULL CHECK (gender IN ('L', 'P')),
  dorm_room text,
  halaqah_group text,
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  guardian_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academic_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,
  rubric_schema jsonb NOT NULL DEFAULT '{"tahfidz":{"min_juz":1,"grades":["Mumtaz","Jayyid Jiddan","Jayyid","Maqbul"]},"diniyah":{"subjects":[]},"adab":{"aspects":["Kemandirian","Kebersihan","Interaksi Sosial","Kedisiplinan Ibadah"]}}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.report_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  tahfidz_data jsonb NOT NULL DEFAULT '{"target_juz":0,"achieved_juz":0,"ziyadah":[],"murojaah":[],"tajwid_grade":"","notes":""}'::jsonb,
  diniyah_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  adab_scores jsonb NOT NULL DEFAULT '{"aspects":{},"musyrif_note":""}'::jsonb,
  attendance_summary jsonb NOT NULL DEFAULT '{"present":0,"late":0,"excused":0,"tasks_completed":0,"reports_submitted":0,"source":"manual"}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified','published')),
  verification_hash text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  gdrive_file_id text,
  published_at timestamptz,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, term_id)
);

CREATE TABLE IF NOT EXISTS public.batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('REPORT_CARD_BATCH_PDF','REPORT_RAW_IMPORT')),
  term_id uuid REFERENCES public.academic_terms(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  total_items integer NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  processed_items integer NOT NULL DEFAULT 0 CHECK (processed_items >= 0),
  failed_items integer NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
  zip_gdrive_file_id text,
  error_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.students, public.academic_terms, public.report_cards, public.batch_jobs FROM PUBLIC, anon;
GRANT SELECT ON public.students, public.academic_terms, public.report_cards, public.batch_jobs TO authenticated;
GRANT ALL ON public.students, public.academic_terms, public.report_cards, public.batch_jobs TO service_role;

DROP POLICY IF EXISTS students_admin_select ON public.students;
CREATE POLICY students_admin_select ON public.students FOR SELECT TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus','super_admin'));
DROP POLICY IF EXISTS students_admin_write ON public.students;
CREATE POLICY students_admin_write ON public.students FOR ALL TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus','super_admin'))
  WITH CHECK (app.is_active_member() AND app.has_any_role('pengurus','super_admin'));

DROP POLICY IF EXISTS academic_terms_admin_select ON public.academic_terms;
CREATE POLICY academic_terms_admin_select ON public.academic_terms FOR SELECT TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus','super_admin'));
DROP POLICY IF EXISTS academic_terms_admin_write ON public.academic_terms;
CREATE POLICY academic_terms_admin_write ON public.academic_terms FOR ALL TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus','super_admin'))
  WITH CHECK (app.is_active_member() AND app.has_any_role('pengurus','super_admin'));

DROP POLICY IF EXISTS report_cards_admin_all ON public.report_cards;
CREATE POLICY report_cards_admin_all ON public.report_cards FOR ALL TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus','super_admin'))
  WITH CHECK (app.is_active_member() AND app.has_any_role('pengurus','super_admin'));
DROP POLICY IF EXISTS report_cards_student_published ON public.report_cards;
CREATE POLICY report_cards_student_published ON public.report_cards FOR SELECT TO authenticated
  USING (status = 'published' AND EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = report_cards.student_id AND s.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS batch_jobs_admin_all ON public.batch_jobs;
CREATE POLICY batch_jobs_admin_all ON public.batch_jobs FOR ALL TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus','super_admin'))
  WITH CHECK (app.is_active_member() AND app.has_any_role('pengurus','super_admin'));

CREATE OR REPLACE FUNCTION public.upsert_wave5_report_card(
  p_student_id uuid, p_term_id uuid, p_tahfidz_data jsonb, p_diniyah_scores jsonb,
  p_adab_scores jsonb, p_attendance_summary jsonb, p_status text DEFAULT 'draft'
) RETURNS public.report_cards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_row public.report_cards;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: academic report-card permission required';
  END IF;
  IF p_status NOT IN ('draft','verified','published') THEN RAISE EXCEPTION 'Invalid report-card status'; END IF;
  INSERT INTO public.report_cards (student_id, term_id, tahfidz_data, diniyah_scores, adab_scores, attendance_summary, status, updated_by, published_at)
  VALUES (p_student_id, p_term_id, COALESCE(p_tahfidz_data,'{}'), COALESCE(p_diniyah_scores,'[]'), COALESCE(p_adab_scores,'{}'), COALESCE(p_attendance_summary,'{}'), p_status, auth.uid(), CASE WHEN p_status='published' THEN now() ELSE NULL END)
  ON CONFLICT (student_id, term_id) DO UPDATE SET tahfidz_data=EXCLUDED.tahfidz_data, diniyah_scores=EXCLUDED.diniyah_scores, adab_scores=EXCLUDED.adab_scores, attendance_summary=EXCLUDED.attendance_summary, status=EXCLUDED.status, updated_by=auth.uid(), updated_at=now(), published_at=CASE WHEN EXCLUDED.status='published' THEN COALESCE(public.report_cards.published_at,now()) ELSE public.report_cards.published_at END
  RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(event_name,actor_id,actor_name,target_id,target_label,action_detail,payload)
  SELECT 'academic.report_card_saved', auth.uid(), p.full_name, v_row.id::text, 'report_card', 'Rapor santri disimpan', jsonb_build_object('student_id',p_student_id,'term_id',p_term_id,'status',p_status)
  FROM public.profiles p WHERE p.id=auth.uid();
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.upsert_wave5_report_card(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_wave5_report_card(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_term_activity_to_report_cards(p_term_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() OR NOT app.has_any_role('pengurus','super_admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  INSERT INTO public.report_cards(student_id,term_id,attendance_summary,updated_by)
  SELECT s.id,p_term_id,jsonb_build_object('present',COUNT(*) FILTER (WHERE ar.classification IN ('on_time','grace')),'late',COUNT(*) FILTER (WHERE ar.classification='late'),'excused',COUNT(*) FILTER (WHERE ar.classification IN ('excused','sick')),'tasks_completed',COALESCE((SELECT COUNT(*) FROM public.tasks t WHERE t.created_by=s.profile_id AND t.status='done' AND t.completed_at::date BETWEEN at.start_date AND at.end_date),0),'reports_submitted',COALESCE((SELECT COUNT(*) FROM public.daily_reports d WHERE d.user_id=s.profile_id AND d.report_date BETWEEN at.start_date AND at.end_date AND d.submission_status='submitted'),0),'source','auto_idaroh'),auth.uid()
  FROM public.students s JOIN public.academic_terms at ON at.id=p_term_id LEFT JOIN public.attendance_records ar ON ar.user_id=s.profile_id AND ar.attendance_date BETWEEN at.start_date AND at.end_date
  WHERE s.profile_id IS NOT NULL GROUP BY s.id,at.start_date,at.end_date
  ON CONFLICT(student_id,term_id) DO UPDATE SET attendance_summary=EXCLUDED.attendance_summary,updated_by=auth.uid(),updated_at=now();
  GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.sync_term_activity_to_report_cards(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_term_activity_to_report_cards(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_report_card_public(p_hash text)
RETURNS TABLE(is_valid boolean, masked_student_name text, nis_suffix text, term_name text, published_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE AS $$
  SELECT true, left(s.full_name,1) || '***', right(s.nis,4), t.name, r.published_at
  FROM public.report_cards r JOIN public.students s ON s.id=r.student_id JOIN public.academic_terms t ON t.id=r.term_id
  WHERE r.verification_hash=p_hash AND r.status='published' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.verify_report_card_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_report_card_public(text) TO anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
