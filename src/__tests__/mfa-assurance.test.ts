import { describe, it, expect } from 'vitest';
import { computeMfaState, mfaEvidenceFromFactors } from '@/lib/auth/mfa-assurance';
import { mfaStateFromUser } from '@/lib/supabase/assurance';

const verifiedTotp = { status: 'verified', factor_type: 'totp' };
const unverifiedTotp = { status: 'unverified', factor_type: 'totp' };

function makeToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

describe('computeMfaState — super_admin', () => {
  it('requires enrollment when no factor exists (aal1)', () => {
    const state = computeMfaState({ roles: ['super_admin'], factors: [], currentLevel: 'aal1' });
    expect(state.requirement).toBe('needs_enroll');
    expect(state.hasVerifiedFactor).toBe(false);
    expect(state.nextLevel).toBe('aal1');
  });

  it('requires enrollment when the only factor is unverified', () => {
    const state = computeMfaState({ roles: ['super_admin'], factors: [unverifiedTotp], currentLevel: 'aal1' });
    expect(state.requirement).toBe('needs_enroll');
    expect(state.hasVerifiedFactor).toBe(false);
  });

  it('requires challenge when a verified factor exists but session is aal1', () => {
    const state = computeMfaState({ roles: ['super_admin'], factors: [verifiedTotp], currentLevel: 'aal1' });
    expect(state.requirement).toBe('needs_challenge');
    expect(state.hasVerifiedFactor).toBe(true);
    expect(state.nextLevel).toBe('aal2');
  });

  it('is ok when verified factor and session already aal2', () => {
    const state = computeMfaState({ roles: ['super_admin'], factors: [verifiedTotp], currentLevel: 'aal2' });
    expect(state.requirement).toBe('ok');
    expect(state.nextLevel).toBe('aal2');
  });

  it('fails closed (mfa_error) on provider error', () => {
    const state = computeMfaState({ roles: ['super_admin'], factors: null, currentLevel: null, providerError: true });
    expect(state.requirement).toBe('mfa_error');
  });

  it('requires challenge when currentLevel is unknown but a verified factor exists', () => {
    const state = computeMfaState({ roles: ['super_admin'], factors: [verifiedTotp], currentLevel: null });
    expect(state.requirement).toBe('needs_challenge');
  });
});

describe('computeMfaState — non-super_admin', () => {
  it('is ok without a factor (MFA optional)', () => {
    const state = computeMfaState({ roles: ['santri'], factors: [], currentLevel: 'aal1' });
    expect(state.requirement).toBe('ok');
    expect(state.isSuperAdmin).toBe(false);
  });

  it('requires challenge when a verified factor exists but session is aal1', () => {
    const state = computeMfaState({ roles: ['pengurus'], factors: [verifiedTotp], currentLevel: 'aal1' });
    expect(state.requirement).toBe('needs_challenge');
  });

  it('is ok when verified factor and session aal2', () => {
    const state = computeMfaState({ roles: ['yayasan'], factors: [verifiedTotp], currentLevel: 'aal2' });
    expect(state.requirement).toBe('ok');
  });

  it('degrades to ok on provider error (must not lock out optional-MFA roles)', () => {
    const state = computeMfaState({ roles: ['santri'], factors: null, currentLevel: null, providerError: true });
    expect(state.requirement).toBe('ok');
  });
});

describe('computeMfaState — roles and factor edge cases', () => {
  it('treats a user holding super_admin among multiple roles as super_admin', () => {
    const state = computeMfaState({ roles: ['santri', 'super_admin'], factors: [], currentLevel: 'aal1' });
    expect(state.isSuperAdmin).toBe(true);
    expect(state.requirement).toBe('needs_enroll');
  });

  it('counts any verified factor type (recovery_code) toward aal2', () => {
    const state = computeMfaState({
      roles: ['super_admin'],
      factors: [{ status: 'verified', factor_type: 'recovery_code' }],
      currentLevel: 'aal1',
    });
    expect(state.hasVerifiedFactor).toBe(true);
    expect(state.requirement).toBe('needs_challenge');
  });

  it('handles null/undefined factors as no verified factor', () => {
    expect(computeMfaState({ roles: ['santri'], factors: null, currentLevel: 'aal1' }).hasVerifiedFactor).toBe(false);
    expect(computeMfaState({ roles: ['santri'], factors: undefined, currentLevel: 'aal1' }).hasVerifiedFactor).toBe(false);
  });
});

describe('mfaStateFromUser — JWT aal decoding', () => {
  it('reads aal2 from the access token and returns ok for a verified super_admin', () => {
    const state = mfaStateFromUser({ factors: [verifiedTotp] }, makeToken({ aal: 'aal2' }), ['super_admin']);
    expect(state.currentLevel).toBe('aal2');
    expect(state.requirement).toBe('ok');
  });

  it('reads aal1 from the access token and requires challenge', () => {
    const state = mfaStateFromUser({ factors: [verifiedTotp] }, makeToken({ aal: 'aal1' }), ['super_admin']);
    expect(state.currentLevel).toBe('aal1');
    expect(state.requirement).toBe('needs_challenge');
  });

  it('treats a malformed token as unknown currentLevel', () => {
    const state = mfaStateFromUser({ factors: [verifiedTotp] }, 'not-a-jwt', ['super_admin']);
    expect(state.currentLevel).toBeNull();
    expect(state.requirement).toBe('needs_challenge');
  });

  it('treats a token without an aal claim as unknown currentLevel', () => {
    const state = mfaStateFromUser({ factors: [verifiedTotp] }, makeToken({ sub: 'x' }), ['super_admin']);
    expect(state.currentLevel).toBeNull();
  });

  it('fails closed for super_admin when the user is unavailable', () => {
    const state = mfaStateFromUser(null, makeToken({ aal: 'aal2' }), ['super_admin']);
    expect(state.requirement).toBe('mfa_error');
  });

  it('is ok for a non-super_admin without factors even with an aal1 token', () => {
    const state = mfaStateFromUser({ factors: [] }, makeToken({ aal: 'aal1' }), ['santri']);
    expect(state.requirement).toBe('ok');
  });
});

describe('mfaEvidenceFromFactors — bukti MFA untuk admin', () => {
  it('returns none when there are no factors', () => {
    expect(mfaEvidenceFromFactors([])).toBe('none');
  });

  it('treats null/undefined factors as none', () => {
    expect(mfaEvidenceFromFactors(null)).toBe('none');
    expect(mfaEvidenceFromFactors(undefined)).toBe('none');
  });

  it('returns unverified when only an unverified factor exists', () => {
    expect(mfaEvidenceFromFactors([unverifiedTotp])).toBe('unverified');
  });

  it('returns verified when a TOTP factor is verified', () => {
    expect(mfaEvidenceFromFactors([verifiedTotp])).toBe('verified');
  });

  it('counts any verified factor type (recovery_code) as verified', () => {
    expect(mfaEvidenceFromFactors([{ status: 'verified', factor_type: 'recovery_code' }])).toBe('verified');
  });

  it('returns verified when a verified factor exists alongside an unverified one', () => {
    expect(mfaEvidenceFromFactors([unverifiedTotp, verifiedTotp])).toBe('verified');
  });
});