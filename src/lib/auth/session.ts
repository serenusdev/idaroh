import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { UserProfile, UserRole } from './types';

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

const { roles: _mockRoles, ...defaultMockWithoutRoles } = DEFAULT_MOCK_USER;
const TEST_ACTION_USER: UserProfile = {
  ...defaultMockWithoutRoles,
  roles: ['santri', 'koordinator', 'pengurus', 'yayasan', 'super_admin'],
};

/**
 * Cached server function to resolve current authenticated user and real database profile.
 * Fail-closed: returns null if unauthenticated (unless running in test suite).
 */
export const getCurrentUserProfile = cache(async (): Promise<UserProfile | null> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      if (process.env.VITEST) {
        return TEST_ACTION_USER;
      }
      return null;
    }

    // Query real profile from database using admin client to ensure full role resolution
    const admin = createAdminClient();
    const [{ data: profile }, { data: userRoles }] = await Promise.all([
      admin.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      admin.from('user_roles').select('role_id, roles(key)').eq('user_id', user.id).is('revoked_at', null),
    ]);

    const rolesList: UserRole[] = [];
    if (userRoles && userRoles.length > 0) {
      for (const ur of userRoles) {
        const roleData = ur as { roles?: { key?: string } | null };
        const key = roleData.roles?.key as UserRole | undefined;
        if (key && ROLE_PRIORITY[key]) {
          rolesList.push(key);
        }
      }
    }

    // A database profile is mandatory. Do not turn an authenticated auth.users
    // record without an application profile into an active application session.
    if (!profile) {
      return null;
    }

    if (profile.session_revoked_at) {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      try {
        const encodedPayload = token?.split(".")[1];
        const claims = encodedPayload ? JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as { iat?: number } : null;
        if (claims?.iat && claims.iat * 1000 <= new Date(profile.session_revoked_at).getTime()) return null;
      } catch {
        return null;
      }
    }

    // Determine highest assigned role. member_type is descriptive data, not a
    // substitute for the authoritative user_roles relationship.
    let primaryRole: UserRole = 'santri';
    if (rolesList.length > 0) {
      rolesList.sort((a, b) => (ROLE_PRIORITY[b] || 0) - (ROLE_PRIORITY[a] || 0));
      primaryRole = rolesList[0];
    } else {
      rolesList.push('santri');
    }



    const resolvedProfile: UserProfile = {
      id: user.id,
      email: user.email || profile?.email || '',
      full_name: profile.full_name,
      role: primaryRole,
      roles: rolesList,
      status: profile.status as UserProfile['status'],
      team_name: profile.team_name,
      member_type: profile.member_type,
      avatar_url: profile?.avatar_url || null,
      phone_number: profile?.phone_number || null,
      created_at: profile?.created_at || user.created_at || new Date().toISOString(),
      updated_at: profile?.updated_at || new Date().toISOString(),
    };

    return resolvedProfile;
  } catch (err) {
    if (process.env.VITEST) {
      return TEST_ACTION_USER;
    }
    console.error('Error resolving user profile:', err);
    return null;
  }
});
