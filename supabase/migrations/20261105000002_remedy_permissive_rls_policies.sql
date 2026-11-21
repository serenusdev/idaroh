-- Migration: 20261105000002_remedy_permissive_rls_policies.sql
-- Description: Remedy permissive USING (true) policies on teams, team_members, reviewer_assignments, policy_settings (Audit Finding F-06).
-- Enforces active membership verification and revokes unauthorized anon access.

-- 1. Revoke public/anon access on these core organizational tables
REVOKE ALL ON TABLE public.teams FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.team_members FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.reviewer_assignments FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.policy_settings FROM anon, PUBLIC;

-- 2. Drop legacy unconstrained policies
DROP POLICY IF EXISTS "Teams are readable by authenticated users" ON public.teams;
DROP POLICY IF EXISTS "Team members are viewable by authenticated users" ON public.team_members;
DROP POLICY IF EXISTS "Reviewer assignments are readable by authenticated users" ON public.reviewer_assignments;
DROP POLICY IF EXISTS "Policy settings are readable by authenticated users" ON public.policy_settings;

-- 3. Recreate policies constrained by active member status
--    (drop-if-exists keeps replay safe on databases where these were already
--    applied manually out-of-band)
DROP POLICY IF EXISTS "Teams are readable by active members" ON public.teams;
CREATE POLICY "Teams are readable by active members"
  ON public.teams FOR SELECT
  TO authenticated
  USING (app.is_active_member());

DROP POLICY IF EXISTS "Team members are viewable by active members" ON public.team_members;
CREATE POLICY "Team members are viewable by active members"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (app.is_active_member());

DROP POLICY IF EXISTS "Reviewer assignments are readable by active members" ON public.reviewer_assignments;
CREATE POLICY "Reviewer assignments are readable by active members"
  ON public.reviewer_assignments FOR SELECT
  TO authenticated
  USING (app.is_active_member());

DROP POLICY IF EXISTS "Policy settings are readable by active members" ON public.policy_settings;
CREATE POLICY "Policy settings are readable by active members"
  ON public.policy_settings FOR SELECT
  TO authenticated
  USING (app.is_active_member());

-- 4. Grant explicit SELECT privileges only to authenticated users
GRANT SELECT ON TABLE public.teams TO authenticated;
GRANT SELECT ON TABLE public.team_members TO authenticated;
GRANT SELECT ON TABLE public.reviewer_assignments TO authenticated;
GRANT SELECT ON TABLE public.policy_settings TO authenticated;

