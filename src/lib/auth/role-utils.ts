import type { UserProfile, UserRole } from './types';

/** Urutan tampilan (descending priority → index kecil = prioritas tinggi). */
const ROLE_DISPLAY_ORDER: Record<UserRole, number> = {
  super_admin: 5,
  yayasan: 4,
  pengurus: 3,
  koordinator: 2,
  santri: 1,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  yayasan: 'Yayasan',
  pengurus: 'Pengurus',
  koordinator: 'Koordinator',
  santri: 'Santri',
};

/** Ambil semua role dari UserProfile — aman jika `roles` undefined atau kosong. */
function resolveRoles(user: Pick<UserProfile, 'role' | 'roles'>): UserRole[] {
  return user.roles && user.roles.length > 0 ? user.roles : [user.role];
}

/** Cek apakah user memiliki satu role tertentu. */
export function hasRole(
  user: Pick<UserProfile, 'role' | 'roles'>,
  key: UserRole,
): boolean {
  return resolveRoles(user).includes(key);
}

/** Cek apakah user memiliki setidaknya satu dari beberapa role. */
export function hasAnyRole(
  user: Pick<UserProfile, 'role' | 'roles'>,
  keys: UserRole[],
): boolean {
  const roles = resolveRoles(user);
  return keys.some((k) => roles.includes(k));
}

/**
 * Kembalikan label tampilan semua role user, diurutkan dari prioritas tertinggi ke terendah.
 * Contoh: ['Super Admin', 'Pengurus']
 */
export function getRoleLabels(
  user: Pick<UserProfile, 'role' | 'roles'>,
): string[] {
  return resolveRoles(user)
    .slice()
    .sort((a, b) => ROLE_DISPLAY_ORDER[b] - ROLE_DISPLAY_ORDER[a])
    .map((r) => ROLE_LABELS[r] ?? r);
}
