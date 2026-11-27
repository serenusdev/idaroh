BEGIN;

CREATE TABLE IF NOT EXISTS public.stored_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gdrive_file_id text UNIQUE NOT NULL,
  folder_category text NOT NULL CHECK (folder_category IN ('avatars','reports','resources','raw-imports','rapor')),
  original_name text NOT NULL CHECK (char_length(trim(original_name)) > 0),
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  visibility text NOT NULL DEFAULT 'private_sensitive' CHECK (visibility IN ('public_cached','private_sensitive')),
  owner_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  related_student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stored_files_visibility ON public.stored_files(visibility);
CREATE INDEX IF NOT EXISTS idx_stored_files_owner ON public.stored_files(owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_stored_files_student ON public.stored_files(related_student_id);

ALTER TABLE public.stored_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stored_files FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.stored_files TO authenticated;
GRANT ALL ON public.stored_files TO service_role;

DROP POLICY IF EXISTS stored_files_select ON public.stored_files;
CREATE POLICY stored_files_select ON public.stored_files FOR SELECT TO authenticated
  USING (
    app.is_active_member() AND (
      visibility = 'public_cached'
      OR owner_profile_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = stored_files.related_student_id
          AND s.guardian_profile_id = auth.uid()
      )
      OR app.has_any_role('pengurus','super_admin')
    )
  );

DROP POLICY IF EXISTS stored_files_insert ON public.stored_files;
CREATE POLICY stored_files_insert ON public.stored_files FOR INSERT TO authenticated
  WITH CHECK (
    app.is_active_member()
    AND app.has_any_role('pengurus','super_admin')
    AND (owner_profile_id IS NULL OR owner_profile_id = auth.uid() OR app.has_any_role('super_admin'))
  );

DROP POLICY IF EXISTS stored_files_update ON public.stored_files;
CREATE POLICY stored_files_update ON public.stored_files FOR UPDATE TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus','super_admin'))
  WITH CHECK (app.is_active_member() AND app.has_any_role('pengurus','super_admin'));

DROP POLICY IF EXISTS stored_files_delete ON public.stored_files;
CREATE POLICY stored_files_delete ON public.stored_files FOR DELETE TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus','super_admin'));

COMMIT;
NOTIFY pgrst, 'reload schema';
