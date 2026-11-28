import { resolveIdentity } from './session';
import { UserProfile, UserRole } from './types';
import { hasAnyRole } from './role-utils';

export interface AuthGuardOptions {
  // Permit actions that must run before AAL2: logout, MFA enroll/challenge, recovery.
  allowAal1?: boolean;
}

/**
 * Ensures caller is logged in with an active, provisioned account.
 */
export async function requireAuthUser(options?: AuthGuardOptions): Promise<UserProfile> {
  const identity = await resolveIdentity();

  switch (identity.state) {
    case 'active':
      return identity.profile;
    case 'mfa_required':
    case 'mfa_error':
      if (options?.allowAal1) return identity.profile;
      throw new Error(
        identity.state === 'mfa_error'
          ? `UNAVAILABLE: Verifikasi MFA tidak dapat diselesaikan saat ini (kode ${identity.traceId}). Coba lagi.`
          : 'MFA_REQUIRED: Selesaikan verifikasi dua langkah (MFA) untuk mengakses fitur ini.'
      );
    case 'inactive':
      throw new Error(`FORBIDDEN: Status akun Anda adalah "${identity.status}". Silakan hubungi Administrator.`);
    case 'role_missing':
    case 'profile_missing':
      throw new Error('FORBIDDEN: Akun Anda belum memiliki peran aktif. Silakan hubungi Administrator.');
    case 'identity_error':
      throw new Error(`UNAVAILABLE: Identitas tidak dapat diverifikasi saat ini (kode ${identity.traceId}). Coba lagi.`);
    default:
      throw new Error('UNAUTHORIZED: Anda harus masuk (login) terlebih dahulu.');
  }
}

/**
 * Ensures caller possesses one of the authorized roles.
 */
export async function requireRole(allowedRoles: UserRole[], options?: AuthGuardOptions): Promise<UserProfile> {
  const user = await requireAuthUser(options);

  const hasRole = hasAnyRole(user, allowedRoles);

  if (!hasRole) {
    throw new Error(
      `FORBIDDEN: Anda tidak memiliki izin (${allowedRoles.join(', ')}). Peran Anda saat ini: ${user.role}.`
    );
  }

  return user;
}

/**
 * Robust timezone helper that calculates accurate Asia/Jakarta (WIB, UTC+7)
 * regardless of hosting server timezone (e.g. UTC on Vercel).
 */
export function getJakartaTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  const hours = parseInt(get('hour'), 10);
  const minutes = parseInt(get('minute'), 10);
  const seconds = parseInt(get('second'), 10);

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeFormatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} WIB`;
  const timeOnly = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return {
    dateStr,
    timeFormatted,
    timeOnly,
    hours,
    minutes,
    seconds,
    totalMinutes: hours * 60 + minutes,
    now,
  };
}

