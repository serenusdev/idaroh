-- Rollback for: 20261122000007_team_command_rpcs_and_resource_upsert.sql
-- Restores, verbatim, the pre-fix definitions of app.team_set_coordinator()
-- (20261102000005_audit_hardening.sql) and app.assign_reviewer()
-- (20261102000009_active_membership_constraints.sql), and removes the
-- app./public. team_member_set(), team_member_end() and resource_upsert() pair.
-- NOTE: this returns the system to the PPL-01 / LIB-03 finding state — yayasan
-- refused again, and a resource save split across four unguarded service-role
-- writes again — so it is for incident recovery only. Rows already written by
-- the new RPCs stay in the tables; the team_members history and the audit rows
-- they produced are not undone by this file.

BEGIN;

-- Guarded so the rollback can be replayed after a partial run.
DROP FUNCTION IF EXISTS public.resource_upsert(uuid, jsonb, text[], text);
DROP FUNCTION IF EXISTS app.resource_upsert(uuid, jsonb, text[], text);

DROP FUNCTION IF EXISTS public.team_member_end(uuid, uuid);
DROP FUNCTION IF EXISTS app.team_member_end(uuid, uuid);

DROP FUNCTION IF EXISTS public.team_member_set(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS app.team_member_set(uuid, uuid, text, text);

-- Pre-fix definition, restored verbatim.
CREATE OR REPLACE FUNCTION app.team_set_coordinator(p_team_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_now date := CURRENT_DATE;
  v_active_member public.team_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT app.has_any_role('super_admin', 'pengurus') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses mengatur koordinator.');
  END IF;
  UPDATE public.team_members
  SET valid_to = v_now, team_role = 'member'
  WHERE team_id = p_team_id AND team_role = 'coordinator' AND valid_to IS NULL;
  SELECT * INTO v_active_member
  FROM public.team_members
  WHERE team_id = p_team_id AND user_id = p_user_id AND valid_to IS NULL
  ORDER BY valid_from DESC, created_at DESC
  LIMIT 1;
  IF v_active_member.id IS NULL THEN
    INSERT INTO public.team_members (team_id, user_id, team_role, valid_from)
    VALUES (p_team_id, p_user_id, 'coordinator', v_now);
  ELSE
    UPDATE public.team_members SET team_role = 'coordinator' WHERE id = v_active_member.id;
  END IF;
  RETURN jsonb_build_object('success', true, 'message', 'Koordinator tim berhasil diperbarui secara atomik.');
END;
$$;

-- Pre-fix definition, restored verbatim.
CREATE OR REPLACE FUNCTION app.assign_reviewer(
  p_reviewee_id uuid,
  p_reviewer_id uuid,
  p_kind text DEFAULT 'report',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT app.has_any_role('super_admin', 'pengurus') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses menetapkan reviewer.');
  END IF;
  IF p_reviewee_id = p_reviewer_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anggota tidak dapat menjadi reviewer dirinya sendiri.');
  END IF;
  IF p_kind NOT IN ('report', 'attendance_correction', 'task') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Jenis reviewer tidak valid.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reviewee_id AND status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reviewer_id AND status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Reviewee dan reviewer harus merupakan akun aktif.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_reviewee_id::text || ':' || p_kind, 0));
  UPDATE public.reviewer_assignments
  SET valid_to = CURRENT_DATE
  WHERE reviewee_id = p_reviewee_id AND kind = p_kind AND valid_to IS NULL;
  INSERT INTO public.reviewer_assignments (reviewee_id, reviewer_id, kind, reason, valid_from)
  VALUES (p_reviewee_id, p_reviewer_id, p_kind, NULLIF(trim(p_reason), ''), CURRENT_DATE);
  RETURN jsonb_build_object('success', true, 'message', 'Reviewer berhasil ditetapkan secara atomik.');
END;
$$;

REVOKE ALL ON FUNCTION app.team_set_coordinator(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.team_set_coordinator(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION app.assign_reviewer(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assign_reviewer(uuid, uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
