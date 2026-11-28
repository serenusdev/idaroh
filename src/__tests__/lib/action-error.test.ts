import { describe, it, expect, vi, afterEach } from 'vitest';
import { errorToMessage } from '@/lib/action-error';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Verifikasi bahwa output tidak pernah "[object Object]". */
function neverObjectObject(msg: string) {
  expect(msg).not.toBe('[object Object]');
  expect(msg).not.toContain('[object Object]');
}

describe('errorToMessage — tidak pernah mengembalikan "[object Object]"', () => {
  it('Error biasa → pesan aslinya', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('Terjadi kesalahan pada server.'));
    expect(msg).toBe('Terjadi kesalahan pada server.');
    neverObjectObject(msg);
  });

  it('string biasa → dikembalikan langsung', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage('Pesan error langsung');
    expect(msg).toBe('Pesan error langsung');
    neverObjectObject(msg);
  });

  it('objek {message} → ambil message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage({ message: 'Validasi gagal.' });
    expect(msg).toBe('Validasi gagal.');
    neverObjectObject(msg);
  });

  it('objek {error:{message}} → ambil nested message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage({ error: { message: 'Sesi tidak valid.' } });
    expect(msg).toBe('Sesi tidak valid.');
    neverObjectObject(msg);
  });

  it('PostgrestError-like {code, message, details, hint} → pesan friendly', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pgErr = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_email_key"',
      details: 'Key (email)=(test@test.com) already exists.',
      hint: null,
    };
    const msg = errorToMessage(pgErr);
    expect(msg).toBe('Data sudah ada. Periksa kembali isian Anda.');
    neverObjectObject(msg);
  });

  it('ZodError-like {issues, message} → ambil message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const zodErr = {
      message: 'Invalid input: expected string, received number',
      issues: [{ path: ['name'], message: 'Required' }],
    };
    // Pesan Zod tidak memicu TECHNICAL_MARKER → dikembalikan verbatim
    const msg = errorToMessage(zodErr);
    neverObjectObject(msg);
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('null → fallback generik', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(null);
    expect(msg).toBe('Terjadi kesalahan. Silakan coba lagi.');
    neverObjectObject(msg);
  });

  it('undefined → fallback generik', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(undefined);
    expect(msg).toBe('Terjadi kesalahan. Silakan coba lagi.');
    neverObjectObject(msg);
  });

  it('objek tanpa field dikenal → fallback generik', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage({ foo: 'bar', baz: 42 });
    // Tidak ada message/details/hint/code → raw kosong → fallback
    expect(msg).toBe('Terjadi kesalahan. Silakan coba lagi.');
    neverObjectObject(msg);
  });

  it('kode RPC UNAUTHORIZED → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('UNAUTHORIZED'));
    expect(msg).toBe('Anda belum masuk atau sesi telah berakhir.');
    neverObjectObject(msg);
  });

  it('kode RPC FORBIDDEN → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('FORBIDDEN'));
    expect(msg).toBe('Anda tidak memiliki izin untuk tindakan ini.');
    neverObjectObject(msg);
  });

  it('kode RPC DUE_BACK_MUST_BE_FUTURE → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('DUE_BACK_MUST_BE_FUTURE'));
    expect(msg).toBe('Tanggal kembali harus di masa mendatang.');
    neverObjectObject(msg);
  });

  it('kode RPC GATE_PASS_NOT_PENDING → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('GATE_PASS_NOT_PENDING'));
    expect(msg).toBe('Surat izin tidak dalam status menunggu.');
    neverObjectObject(msg);
  });

  it('kode RPC GATE_PASS_NOT_FOUND → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('GATE_PASS_NOT_FOUND'));
    expect(msg).toBe('Surat izin tidak ditemukan.');
    neverObjectObject(msg);
  });

  it('kode RPC GATE_PASS_SCAN_NOT_ALLOWED → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('GATE_PASS_SCAN_NOT_ALLOWED'));
    expect(msg).toBe('Pemindaian surat izin tidak diizinkan saat ini.');
    neverObjectObject(msg);
  });

  it('kode RPC GATE_PASS_EXPIRED → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('GATE_PASS_EXPIRED'));
    expect(msg).toBe('Surat izin telah kedaluwarsa.');
    neverObjectObject(msg);
  });

  it('kode RPC INVALID_GATE_DIRECTION → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('INVALID_GATE_DIRECTION'));
    expect(msg).toBe('Arah gerbang tidak valid.');
    neverObjectObject(msg);
  });

  it('kode RPC NIS_IMMUTABLE → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('NIS_IMMUTABLE'));
    expect(msg).toBe('NIS tidak dapat diubah setelah ditetapkan.');
    neverObjectObject(msg);
  });

  it('kode RPC TERM_OVERLAP → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('TERM_OVERLAP'));
    expect(msg).toBe('Rentang semester tumpang tindih dengan semester yang sudah ada.');
    neverObjectObject(msg);
  });

  it('kode RPC LOG_DATE_OUT_OF_RANGE → pesan Indonesia', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(new Error('LOG_DATE_OUT_OF_RANGE'));
    expect(msg).toBe('Tanggal log di luar rentang semester yang aktif.');
    neverObjectObject(msg);
  });

  it('kode RPC sebagai string langsung', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage('GATE_PASS_NOT_FOUND');
    expect(msg).toBe('Surat izin tidak ditemukan.');
    neverObjectObject(msg);
  });

  it('angka → fallback generik', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errorToMessage(42 as unknown);
    // angka bukan string/Error/objek → raw kosong → fallback
    expect(msg).toBe('Terjadi kesalahan. Silakan coba lagi.');
    neverObjectObject(msg);
  });
});
