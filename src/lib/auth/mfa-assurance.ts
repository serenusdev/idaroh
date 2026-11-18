export type MfaRequirement = 'ok' | 'needs_enroll' | 'needs_challenge' | 'mfa_error';

export interface MfaFactorLike {
  status?: string | null;
  factor_type?: string | null;
}

export interface MfaStateInput {
  roles: readonly string[];
  factors: readonly MfaFactorLike[] | null | undefined;
  currentLevel: string | null;
  providerError?: boolean;
}

export interface MfaState {
  currentLevel: string | null;
  nextLevel: string | null;
  hasVerifiedFactor: boolean;
  isSuperAdmin: boolean;
  requirement: MfaRequirement;
}

/**
 * Pure AAL/MFA decision. Mirrors auth-js _getAuthenticatorAssuranceLevel:
 * nextLevel is aal2 when any factor is verified, regardless of the JWT's current aal.
 */
export function computeMfaState(input: MfaStateInput): MfaState {
  const isSuperAdmin = input.roles.includes('super_admin');
  const factors = input.factors ?? [];
  const hasVerifiedFactor = factors.some((factor) => factor.status === 'verified');
  const currentLevel = input.currentLevel;
  const nextLevel = hasVerifiedFactor ? 'aal2' : currentLevel;

  let requirement: MfaRequirement;
  if (input.providerError) {
    // D2 fail-closed for super_admin; MFA is optional for other roles so a provider
    // error must not lock them out of an otherwise active session.
    requirement = isSuperAdmin ? 'mfa_error' : 'ok';
  } else if (hasVerifiedFactor) {
    requirement = currentLevel === 'aal2' ? 'ok' : 'needs_challenge';
  } else {
    requirement = isSuperAdmin ? 'needs_enroll' : 'ok';
  }

  return { currentLevel, nextLevel, hasVerifiedFactor, isSuperAdmin, requirement };
}

export type MfaEvidence = 'none' | 'unverified' | 'verified';

/**
 * Admin-facing proof of MFA enrollment for ANY user. Distinct from computeMfaState:
 * a verified factor proves enrollment, not that the user's live session is aal2 —
 * another user's current assurance level is not observable by an admin.
 */
export function mfaEvidenceFromFactors(factors: readonly MfaFactorLike[] | null | undefined): MfaEvidence {
  const all = factors ?? [];
  if (all.some((factor) => factor.status === 'verified')) return 'verified';
  return all.length > 0 ? 'unverified' : 'none';
}

// atob (not Buffer) so this runs in Edge middleware; getUser() already validated the token.
export function decodeAalClaim(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const claims = JSON.parse(atob(padded)) as { aal?: unknown };
    return typeof claims.aal === 'string' ? claims.aal : null;
  } catch {
    return null;
  }
}