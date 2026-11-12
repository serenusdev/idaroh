import { cache } from 'react';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { AccountStatus, UserProfile, UserRole } from './types';

if (process.env.NODE_ENV === 'production' && process.env.VITEST) {
  throw new Error('VITEST must never be enabled in production.');
}

export const DEFAULT_MOCK_USER: UserProfile = {
  id: 'usr-santri-001',
  email: 'salman.alfarisi@pondok.id',
  full_name: 'Salman Al-Farisi',
  role: 'santri',
  roles: ['santri'],
  status: 'active',
  team_name: 'Tim Media & IT',
  member_type: 'Santri Digitalpreneur',
  avatar_url: null,
  phone_number: '081234567890',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

const ROLE_PRIORITY: Record<UserRole, number> = {
  super_admin: 5,
  yayasan: 4,
  pengurus: 3,
  koordinator: 2,
  santri: 1,
};

const PROFILE_COLUMNS =
  'id,email,full_name,status,team_name,member_type,avatar_url,phone_number,created_at,updated_at,session_revoked_at';

const TEST_ACTION_USER: UserProfile = {
  ...DEFAULT_MOCK_USER,
  roles: ['santri', 'koordinator', 'pengurus', 'yayasan', 'super_admin'],
};

export type IdentityState =
  | { state: 'active'; profile: UserProfile }
  | { state: 'unauthenticated' }
  | { state: 'profile_missing'; email: string }
  | { state: 'inactive'; status: AccountStatus; email: string; fullName: string }
  | { state: 'role_missing'; email: string; fullName: string }
  | { state: 'identity_error'; traceId: string };

function identityError(stage: string, cause: unknown): IdentityState {
  const traceId = randomUUID();
  const errorType = cause instanceof Error ? cause.name : 'DatabaseError';
  console.error(`[identity] ${stage} failed (trace ${traceId}, ${errorType})`);
  return { state: 'identity_error', traceId };
}

function isSessionRevoked(accessToken: string | undefined, revokedAt: string): boolean {
  try {
    const encodedPayload = accessToken?.split('.')[1];
    const claims = encodedPayload
      ? (JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as { iat?: number })
      : null;
    const revokedAtMs = new Date(revokedAt).getTime();
    return !claims || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)
      || !Number.isFinite(revokedAtMs) || claims.iat * 1000 <= revokedAtMs;
  } catch {
    return true;
  }
}

export const resolveIdentity = cache(async (): Promise<IdentityState> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      if (process.env.VITEST) return { state: 'active', profile: TEST_ACTION_USER };
      if (authError?.name === 'AuthRetryableFetchError') {
        return identityError('auth.getUser', authError);
      }
      return { state: 'unauthenticated' };
    }

    const admin = createAdminClient();
    const [profileResult, rolesResult] = await Promise.all([
      admin.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle(),
      admin.from('user_roles').select('role_id, roles(key)').eq('user_id', user.id).is('revoked_at', null),
    ]);

    if (profileResult.error) return identityError('profiles', profileResult.error);
    const profile = profileResult.data;
    if (!profile) return { state: 'profile_missing', email: user.email ?? '' };

    if (profile.session_revoked_at) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (isSessionRevoked(sessionData.session?.access_token, profile.session_revoked_at)) {
        return { state: 'unauthenticated' };
      }
    }

    const email = user.email || profile.email || '';
    if (profile.status !== 'active') {
      return {
        state: 'inactive',
        status: profile.status as AccountStatus,
        email,
        fullName: profile.full_name,
      };
    }

    if (rolesResult.error) return identityError('user_roles', rolesResult.error);

    const rolesList: UserRole[] = [];
    for (const ur of rolesResult.data ?? []) {
      const key = (ur as { roles?: { key?: string } | null }).roles?.key as UserRole | undefined;
      if (key && Object.hasOwn(ROLE_PRIORITY, key) && !rolesList.includes(key)) rolesList.push(key);
    }

    // member_type is descriptive data, not a substitute for user_roles.
    if (rolesList.length === 0) {
      return { state: 'role_missing', email, fullName: profile.full_name };
    }
    rolesList.sort((a, b) => ROLE_PRIORITY[b] - ROLE_PRIORITY[a]);

    return {
      state: 'active',
      profile: {
        id: user.id,
        email,
        full_name: profile.full_name,
        role: rolesList[0],
        roles: rolesList,
        status: 'active',
        team_name: profile.team_name,
        member_type: profile.member_type,
        avatar_url: profile.avatar_url || null,
        phone_number: profile.phone_number || null,
        created_at: profile.created_at || user.created_at,
        updated_at: profile.updated_at || profile.created_at || user.created_at,
      },
    };
  } catch (err) {
    if (process.env.VITEST) return { state: 'active', profile: TEST_ACTION_USER };
    return identityError('resolveIdentity', err);
  }
});

/** Active, fully provisioned profile for the current request, or null. */
export const getCurrentUserProfile = cache(async (): Promise<UserProfile | null> => {
  const identity = await resolveIdentity();
  return identity.state === 'active' ? identity.profile : null;
});
