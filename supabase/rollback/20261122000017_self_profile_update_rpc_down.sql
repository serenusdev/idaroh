-- Rollback for 20261122000017_self_profile_update_rpc.sql
-- Drops the self-service RPC and hands the column-level UPDATE grant from 20261102000003:33
-- back to authenticated, restoring the pre-migration shape where the profile save runs through
-- the service-role client in src/modules/iam/actions.ts.
DROP FUNCTION IF EXISTS public.update_own_profile(text, text, text);
DROP FUNCTION IF EXISTS app.update_own_profile(text, text, text);

GRANT UPDATE (full_name, phone_number, avatar_url, notes, updated_at)
  ON public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
