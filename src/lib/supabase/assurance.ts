import { createClient } from '@/lib/supabase/server';
import { computeMfaState, decodeAalClaim, type MfaFactorLike, type MfaState } from '@/lib/auth/mfa-assurance';
import type { UserRole } from '@/lib/auth/types';

/**
 * Build MFA state from an already-fetched auth user + access token, so callers that
 * have run getUser() (session resolveIdentity, middleware) avoid a second network call.
 */
export function mfaStateFromUser(
  user: { factors?: MfaFactorLike[] | null } | null,
  accessToken: string | null | undefined,
  roles: readonly UserRole[]
): MfaState {
  if (!user) {
    return computeMfaState({ roles, factors: null, currentLevel: null, providerError: true });
  }
  return computeMfaState({
    roles,
    factors: user.factors ?? null,
    currentLevel: decodeAalClaim(accessToken),
  });
}

/** Standalone reader for callers without an existing getUser() result. */
export async function readMfaState(roles: readonly UserRole[]): Promise<MfaState> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return computeMfaState({ roles, factors: null, currentLevel: null, providerError: true });
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return mfaStateFromUser(user, session?.access_token, roles);
}