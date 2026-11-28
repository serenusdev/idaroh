import { describe, it, expect } from 'vitest';
import { hasRole, hasAnyRole, getRoleLabels, ROLE_LABELS } from '@/lib/auth/role-utils';
import type { UserProfile } from '@/lib/auth/types';

type UserStub = Pick<UserProfile, 'role' | 'roles'>;

function makeUser(roles: UserProfile['roles'], role?: UserProfile['role']): UserStub {
  return {
    role: role ?? (roles?.[0] ?? 'santri'),
    roles,
  };
}

describe('hasRole', () => {
  it('santri hanya memiliki role santri', () => {
    const u = makeUser(['santri']);
    expect(hasRole(u, 'santri')).toBe(true);
    expect(hasRole(u, 'pengurus')).toBe(false);
  });

  it('pengurus hanya memiliki role pengurus', () => {
    const u = makeUser(['pengurus']);
    expect(hasRole(u, 'pengurus')).toBe(true);
    expect(hasRole(u, 'santri')).toBe(false);
  });

  it('super_admin hanya memiliki role super_admin', () => {
    const u = makeUser(['super_admin']);
    expect(hasRole(u, 'super_admin')).toBe(true);
    expect(hasRole(u, 'pengurus')).toBe(false);
  });

  it('multi-role: super_admin + pengurus', () => {
    const u = makeUser(['super_admin', 'pengurus']);
    expect(hasRole(u, 'super_admin')).toBe(true);
    expect(hasRole(u, 'pengurus')).toBe(true);
    expect(hasRole(u, 'santri')).toBe(false);
  });

  it('roles kosong [] — fallback ke user.role', () => {
    const u: UserStub = { role: 'koordinator', roles: [] };
    // roles kosong → pakai [role]
    expect(hasRole(u, 'koordinator')).toBe(true);
    expect(hasRole(u, 'pengurus')).toBe(false);
  });

  it('roles undefined — fallback ke user.role', () => {
    const u: UserStub = { role: 'yayasan', roles: undefined };
    expect(hasRole(u, 'yayasan')).toBe(true);
    expect(hasRole(u, 'santri')).toBe(false);
  });
});

describe('hasAnyRole', () => {
  it('santri: hasAnyRole([santri, pengurus]) → true', () => {
    const u = makeUser(['santri']);
    expect(hasAnyRole(u, ['santri', 'pengurus'])).toBe(true);
  });

  it('santri: hasAnyRole([pengurus, super_admin]) → false', () => {
    const u = makeUser(['santri']);
    expect(hasAnyRole(u, ['pengurus', 'super_admin'])).toBe(false);
  });

  it('multi-role: super_admin + pengurus match mana saja', () => {
    const u = makeUser(['super_admin', 'pengurus']);
    expect(hasAnyRole(u, ['koordinator', 'pengurus'])).toBe(true);
    expect(hasAnyRole(u, ['santri', 'yayasan'])).toBe(false);
  });

  it('roles kosong → fallback ke user.role, lalu cek', () => {
    const u: UserStub = { role: 'koordinator', roles: [] };
    expect(hasAnyRole(u, ['koordinator'])).toBe(true);
    expect(hasAnyRole(u, ['santri'])).toBe(false);
  });

  it('roles undefined → fallback ke user.role, lalu cek', () => {
    const u: UserStub = { role: 'pengurus', roles: undefined };
    expect(hasAnyRole(u, ['pengurus'])).toBe(true);
    expect(hasAnyRole(u, ['santri'])).toBe(false);
  });

  it('keys kosong [] → selalu false', () => {
    const u = makeUser(['super_admin']);
    expect(hasAnyRole(u, [])).toBe(false);
  });
});

describe('getRoleLabels', () => {
  it('santri → ["Santri"]', () => {
    expect(getRoleLabels(makeUser(['santri']))).toEqual(['Santri']);
  });

  it('pengurus → ["Pengurus"]', () => {
    expect(getRoleLabels(makeUser(['pengurus']))).toEqual(['Pengurus']);
  });

  it('super_admin → ["Super Admin"]', () => {
    expect(getRoleLabels(makeUser(['super_admin']))).toEqual(['Super Admin']);
  });

  it('multi-role diurutkan dari prioritas tertinggi', () => {
    const u = makeUser(['santri', 'super_admin', 'pengurus']);
    const labels = getRoleLabels(u);
    // Super Admin (5) > Pengurus (3) > Santri (1)
    expect(labels).toEqual(['Super Admin', 'Pengurus', 'Santri']);
  });

  it('roles kosong → gunakan user.role sebagai label tunggal', () => {
    const u: UserStub = { role: 'koordinator', roles: [] };
    expect(getRoleLabels(u)).toEqual(['Koordinator']);
  });

  it('roles undefined → gunakan user.role sebagai label tunggal', () => {
    const u: UserStub = { role: 'yayasan', roles: undefined };
    expect(getRoleLabels(u)).toEqual(['Yayasan']);
  });
});

describe('ROLE_LABELS', () => {
  it('memuat semua 5 role dengan label yang benar', () => {
    expect(ROLE_LABELS.super_admin).toBe('Super Admin');
    expect(ROLE_LABELS.yayasan).toBe('Yayasan');
    expect(ROLE_LABELS.pengurus).toBe('Pengurus');
    expect(ROLE_LABELS.koordinator).toBe('Koordinator');
    expect(ROLE_LABELS.santri).toBe('Santri');
  });
});
