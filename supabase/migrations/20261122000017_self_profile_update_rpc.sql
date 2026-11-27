-- Migration: 20261122000017_self_profile_update_rpc.sql
-- PROF-SELF — the profile save on /settings/profile runs as the caller, not as the service role.
--
-- updateProfileAction resolved the session with requireAuthUser() and then wrote the row with
-- createAdminClient(). Under the service role auth.uid() is NULL, so the database could not see
-- who was writing: no row in audit_logs was ever produced for a self-service edit (open finding
-- SEC-10), the "own" scope from PERMISSIONS.md §3.7 was enforced only in TypeScript, and the
-- avatar_url provenance rule (F-12) was a claim made by the client.
--
-- 20261102000003:32 revoked table UPDATE from authenticated and then handed the same columns
-- straight back at :33, so an authenticated session could always rewrite its own profile
-- directly and leave no trace. This migration closes that path and gives it an RPC instead.

-- ---------------------------------------------------------------------------
-- 1. app.update_own_profile: own-row only, structurally
-- ---------------------------------------------------------------------------
-- There is deliberately no user-id parameter: the row this function can touch is auth.uid(), so
-- "own" cannot be forged the way a p_user_id argument could. Every tier keeps the same access
-- (§3.7 people.profile.update_self = own for S/K/P/Y/SA), so no role check belongs here — an
-- active member is the whole requirement, and app.is_active_member() supplies it.
CREATE OR REPLACE FUNCTION app.update_own_profile(
  p_full_name    text,
  p_phone_number text DEFAULT NULL,
  p_avatar_url   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_name       text := btrim(COALESCE(p_full_name, ''));
  v_phone      text := btrim(COALESCE(p_phone_number, ''));
  v_avatar     text;
  v_old_name   text;
  v_saved_name text;
  v_changed    text[] := '{}';
BEGIN
  IF v_uid IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;

  IF length(v_name) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nama lengkap wajib diisi.');
  END IF;
  IF length(v_name) > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nama lengkap maksimal 100 karakter.');
  END IF;
  IF length(v_phone) > 30 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nomor telepon maksimal 30 karakter.');
  END IF;

  -- NULL means "leave the stored value alone". Anything else has to point inside the caller's
  -- own storage folder, which is what uploadAvatarAction produced and what deleteAvatarAction
  -- already refuses to touch for another account (F-03/F-12).
  IF p_avatar_url IS NOT NULL THEN
    v_avatar := btrim(p_avatar_url);
    IF length(v_avatar) > 0
       AND (v_avatar LIKE '%..%'
            OR position('/storage/v1/object/public/avatars/' || v_uid::text || '/' IN v_avatar) = 0) THEN
      RETURN jsonb_build_object('success', false, 'message', 'URL avatar tidak valid atau bukan milik akun Anda.');
    END IF;
    IF length(v_avatar) = 0 THEN
      v_avatar := NULL;
    END IF;
  END IF;

  SELECT full_name INTO v_old_name FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Profil Anda tidak ditemukan.');
  END IF;

  UPDATE public.profiles
     SET full_name = v_name,
         phone_number = v_phone,
         avatar_url = CASE WHEN p_avatar_url IS NULL THEN avatar_url ELSE v_avatar END,
         updated_at = now()
   WHERE id = v_uid
  RETURNING profiles.full_name INTO v_saved_name;

  IF v_old_name IS DISTINCT FROM v_saved_name THEN
    v_changed := array_append(v_changed, 'nama');
  END IF;
  IF p_phone_number IS NOT NULL THEN
    v_changed := array_append(v_changed, 'nomor telepon');
  END IF;
  IF p_avatar_url IS NOT NULL THEN
    v_changed := array_append(v_changed, 'foto profil');
  END IF;

  -- SEC-10: the write and its audit row share this transaction, so a profile change is always
  -- attributable to the member who made it.
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    'iam.profile_updated',
    v_uid,
    COALESCE(v_saved_name, 'Anggota'),
    v_uid::text,
    COALESCE(v_saved_name, 'Anggota'),
    'Profil diri diperbarui melalui app.update_own_profile (' || array_to_string(v_changed, ', ') || ').'
  );

  RETURN jsonb_build_object('success', true, 'full_name', v_saved_name);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION app.update_own_profile(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.update_own_profile(text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. PostgREST wrapper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_full_name    text,
  p_phone_number text DEFAULT NULL,
  p_avatar_url   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT app.update_own_profile(p_full_name, p_phone_number, p_avatar_url);
$$;

REVOKE ALL ON FUNCTION public.update_own_profile(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, text) TO authenticated;

COMMENT ON FUNCTION app.update_own_profile(text, text, text)
  IS 'PROF-SELF: satu-satunya jalur tulis profil diri (§3.7 update_self = own). Tidak menerima user id; auth.uid() menentukan barisnya dan audit_logs ditulis pada transaksi yang sama.';

-- ---------------------------------------------------------------------------
-- 3. Close the direct path 20261102000003 left open
-- ---------------------------------------------------------------------------
-- Nothing in src/ updates profiles as the session client: every writer (iam, people,
-- notifications) resolves the caller first and writes with the service role, and the only
-- in-database writer, app.touch_presence(), is SECURITY DEFINER and so bypasses its own grants.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
REVOKE UPDATE (full_name, phone_number, avatar_url, notes, updated_at) ON public.profiles FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
