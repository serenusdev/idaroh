BEGIN;

DROP TRIGGER IF EXISTS trg_ensure_student_after_role ON public.user_roles;
DROP TRIGGER IF EXISTS trg_ensure_student_after_profile_status ON public.profiles;
DROP TRIGGER IF EXISTS trg_students_assign_nis ON public.students;
DROP TRIGGER IF EXISTS trg_students_nis_immutable ON public.students;
DROP POLICY IF EXISTS students_self_select ON public.students;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE gender IS NULL) THEN
    ALTER TABLE public.students ALTER COLUMN gender SET NOT NULL;
  END IF;
END;
$$;

DELETE FROM public.students s
WHERE s.created_via = 'migration_202612040001_backfill'
  AND NOT EXISTS (SELECT 1 FROM public.mutabaah_logs m WHERE m.student_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.halaqah_logs h WHERE h.student_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.gate_passes g WHERE g.student_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.report_cards r WHERE r.student_id = s.id);

DROP FUNCTION IF EXISTS app.ensure_student_after_role();
DROP FUNCTION IF EXISTS app.ensure_student_after_profile_status();
DROP FUNCTION IF EXISTS app.ensure_student_for_profile(uuid);
DROP FUNCTION IF EXISTS app.students_assign_nis();
DROP FUNCTION IF EXISTS app.students_nis_immutable();
DROP FUNCTION IF EXISTS app.next_student_number();
ALTER TABLE public.students DROP COLUMN IF EXISTS created_via;
DROP TABLE IF EXISTS public.student_number_counters;

COMMIT;
NOTIFY pgrst, 'reload schema';
