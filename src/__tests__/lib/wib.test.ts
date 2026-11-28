/**
 * Tes ini berjalan dengan TZ=UTC dan TZ=America/Los_Angeles (via env override),
 * tetapi fungsi wib.ts harus selalu menghasilkan waktu WIB (Asia/Jakarta / +07:00)
 * karena berbasis Intl.DateTimeFormat, bukan toISOString().
 */
import { describe, it, expect } from 'vitest';
import { wibDateString, parseWibLocal, formatWib, addDaysWib } from '@/lib/time/wib';

// WIB = UTC+7
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

describe('wibDateString', () => {
  it('menghasilkan format YYYY-MM-DD', () => {
    // Gunakan tanggal yang jelas di WIB
    const d = new Date('2026-11-28T10:00:00+07:00');
    expect(wibDateString(d)).toBe('2026-11-28');
  });

  it('lintas tengah malam: UTC 2026-11-27T17:00Z = WIB 2026-11-28T00:00', () => {
    const d = new Date('2026-11-27T17:00:00Z');
    expect(wibDateString(d)).toBe('2026-11-28');
  });

  it('lintas tengah malam sebaliknya: UTC 2026-11-28T16:59Z = WIB 2026-11-28T23:59', () => {
    const d = new Date('2026-11-28T16:59:00Z');
    expect(wibDateString(d)).toBe('2026-11-28');
  });

  it('lintas tengah malam: satu detik sebelum WIB masih hari sebelumnya', () => {
    // 2026-11-27T23:59:59+07:00 = 2026-11-27T16:59:59Z
    const d = new Date('2026-11-27T16:59:59Z');
    expect(wibDateString(d)).toBe('2026-11-27');
  });

  it('lintas tahun: 31 Des 23:59:59 WIB masih 31 Desember', () => {
    // 2026-12-31T23:59:59+07:00 = 2026-12-31T16:59:59Z
    const d = new Date('2026-12-31T16:59:59Z');
    expect(wibDateString(d)).toBe('2026-12-31');
  });

  it('lintas tahun: 1 Jan 00:00:00 WIB sudah 1 Januari', () => {
    // 2027-01-01T00:00:00+07:00 = 2026-12-31T17:00:00Z
    const d = new Date('2026-12-31T17:00:00Z');
    expect(wibDateString(d)).toBe('2027-01-01');
  });
});

describe('parseWibLocal', () => {
  it('parse "2026-11-28T16:30" sebagai WIB +07:00', () => {
    const d = parseWibLocal('2026-11-28T16:30');
    // 2026-11-28T16:30:00+07:00 = 2026-11-28T09:30:00Z
    expect(d.toISOString()).toBe('2026-11-28T09:30:00.000Z');
  });

  it('parse "2026-12-31T23:59" sebagai WIB +07:00', () => {
    const d = parseWibLocal('2026-12-31T23:59');
    // 2026-12-31T23:59:00+07:00 = 2026-12-31T16:59:00Z
    expect(d.toISOString()).toBe('2026-12-31T16:59:00.000Z');
  });

  it('lintas tahun: "2027-01-01T00:00"', () => {
    const d = parseWibLocal('2027-01-01T00:00');
    // 2027-01-01T00:00:00+07:00 = 2026-12-31T17:00:00Z
    expect(d.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('dengan detik "2026-11-28T16:30:45" → offset +07:00 tetap', () => {
    const d = parseWibLocal('2026-11-28T16:30:45');
    expect(d.toISOString()).toBe('2026-11-28T09:30:45.000Z');
  });
});

describe('formatWib', () => {
  it('menghasilkan string dengan sufiks " WIB"', () => {
    const d = new Date('2026-11-28T09:30:00Z'); // 16:30 WIB
    const result = formatWib(d);
    expect(result.endsWith(' WIB')).toBe(true);
  });

  it('menggunakan zona WIB terlepas dari TZ sistem', () => {
    // 2026-11-28T09:30:00Z = 16:30 WIB
    const d = new Date('2026-11-28T09:30:00Z');
    const result = formatWib(d, { timeStyle: 'short', dateStyle: undefined });
    // Jam di output harus 16.xx WIB, bukan 02.30 (PST) atau 09.30 (UTC)
    expect(result).toMatch(/16[.:]/);
  });

  it('menerima opts kustom', () => {
    const d = new Date('2026-11-28T09:30:00Z');
    const result = formatWib(d, { year: 'numeric', month: 'long', day: 'numeric' });
    // Harus mengandung "2026" dan " WIB"
    expect(result).toContain('2026');
    expect(result.endsWith(' WIB')).toBe(true);
  });
});

describe('addDaysWib', () => {
  it('tambah 1 hari normal', () => {
    const d = new Date('2026-11-28T09:30:00Z'); // 16:30 WIB
    const result = addDaysWib(d, 1);
    expect(wibDateString(result)).toBe('2026-11-29');
  });

  it('lintas tengah malam WIB: +1 hari dari 2026-11-28T23:00 WIB', () => {
    // 2026-11-28T23:00+07:00 = 2026-11-28T16:00Z
    const d = new Date('2026-11-28T16:00:00Z');
    const result = addDaysWib(d, 1);
    expect(wibDateString(result)).toBe('2026-11-29');
  });

  it('lintas tahun: 2026-12-31 + 1 = 2027-01-01', () => {
    // 2026-12-31T10:00+07:00 = 2026-12-31T03:00Z
    const d = new Date('2026-12-31T03:00:00Z');
    const result = addDaysWib(d, 1);
    expect(wibDateString(result)).toBe('2027-01-01');
  });

  it('kurangi hari (n negatif): 2026-11-28 - 1 = 2026-11-27', () => {
    const d = new Date('2026-11-28T03:00:00Z'); // 10:00 WIB
    const result = addDaysWib(d, -1);
    expect(wibDateString(result)).toBe('2026-11-27');
  });

  it('tambah 0 hari tidak mengubah hari WIB', () => {
    const d = new Date('2026-11-28T03:00:00Z');
    expect(wibDateString(addDaysWib(d, 0))).toBe('2026-11-28');
  });

  it('lintas bulan: 2026-11-30 + 1 = 2026-12-01', () => {
    const d = new Date('2026-11-30T03:00:00Z'); // 10:00 WIB
    const result = addDaysWib(d, 1);
    expect(wibDateString(result)).toBe('2026-12-01');
  });
});
