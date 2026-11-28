/**
 * Pemetaan kode RPC (string polos tanpa awalan) ke pesan Bahasa Indonesia.
 * RPC melempar kode sebagai pesan Error, misal: raise exception 'UNAUTHORIZED'
 */
const RPC_CODE_MAP: Record<string, string> = {
  UNAUTHORIZED: 'Anda belum masuk atau sesi telah berakhir.',
  FORBIDDEN: 'Anda tidak memiliki izin untuk tindakan ini.',
  DUE_BACK_MUST_BE_FUTURE: 'Tanggal kembali harus di masa mendatang.',
  GATE_PASS_NOT_PENDING: 'Surat izin tidak dalam status menunggu.',
  GATE_PASS_NOT_FOUND: 'Surat izin tidak ditemukan.',
  GATE_PASS_SCAN_NOT_ALLOWED: 'Pemindaian surat izin tidak diizinkan saat ini.',
  GATE_PASS_EXPIRED: 'Surat izin telah kedaluwarsa.',
  INVALID_GATE_DIRECTION: 'Arah gerbang tidak valid.',
  NIS_IMMUTABLE: 'NIS tidak dapat diubah setelah ditetapkan.',
  TERM_OVERLAP: 'Rentang semester tumpang tindih dengan semester yang sudah ada.',
  LOG_DATE_OUT_OF_RANGE: 'Tanggal log di luar rentang semester yang aktif.',
};

const FRIENDLY_PATTERNS: Array<[RegExp, string]> = [
  [/duplicate key|unique constraint|already exists|already registered/i, "Data sudah ada. Periksa kembali isian Anda."],
  [/row-level security|permission denied|not authorized|insufficient privilege|access denied/i, "Anda tidak memiliki akses untuk tindakan ini."],
  [/jwt|token is expired|invalid token|refresh token|session expired/i, "Sesi Anda telah berakhir. Silakan masuk kembali."],
  [/foreign key/i, "Data terkait tidak ditemukan atau masih digunakan."],
  [/fetch failed|network|ECONNRESET|ENOTFOUND|ETIMEDOUT|timeout|socket hang up/i, "Koneksi ke server bermasalah. Silakan coba lagi."],
  [/invalid input syntax|malformed|invalid .* format/i, "Format data tidak valid. Periksa kembali isian Anda."],
  [/totp|mfa|authenticator|verification code/i, "Kode MFA tidak valid atau kedaluwarsa."],
  [/null value|not-null constraint/i, "Ada kolom wajib yang belum diisi."],
];

const TECHNICAL_MARKER =
  /constraint|relation|column|schema|supabase|postgres|\bsql\b|jwt|row-level|permission denied|duplicate key|foreign key|null value|invalid input syntax|fetch failed|ECONNRESET|ENOTFOUND|timeout|TypeError|ReferenceError|SyntaxError|stack trace/i;

// App-authored guard failures are already actionable Indonesian; preserve them verbatim
// so MFA_REQUIRED is not mistaken for an invalid TOTP code by the patterns below.
const GUARD_PREFIX = /^(UNAUTHORIZED|FORBIDDEN|UNAVAILABLE|MFA_REQUIRED):/;

function readableErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";

  const record = error as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const nestedMessage = readableErrorMessage(nested);
    if (nestedMessage) return nestedMessage;
  }
  for (const key of ["message", "details", "hint", "code"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return "";
}

/**
 * Ubah `err` menjadi string pesan yang dapat dibaca — TIDAK PERNAH mengembalikan "[object Object]".
 * Urutan resolusi:
 *   1. Kode RPC polos (pemetaan eksplisit ke Bahasa Indonesia)
 *   2. Pesan di GUARD_PREFIX (sudah Bahasa Indonesia)
 *   3. Pola FRIENDLY_PATTERNS
 *   4. Pesan asli jika tidak teknis
 *   5. Fallback generik
 */
export function errorToMessage(err: unknown): string {
  if (err === null || err === undefined) return 'Terjadi kesalahan. Silakan coba lagi.';

  const raw = readableErrorMessage(err).trim();
  if (!raw) return 'Terjadi kesalahan. Silakan coba lagi.';

  // 1. Cek kode RPC polos.
  if (Object.prototype.hasOwnProperty.call(RPC_CODE_MAP, raw)) {
    return RPC_CODE_MAP[raw];
  }

  // 2. Pesan guard sudah Bahasa Indonesia — teruskan verbatim.
  if (GUARD_PREFIX.test(raw)) return raw;

  // 3. Pola friendly.
  for (const [pattern, message] of FRIENDLY_PATTERNS) {
    if (pattern.test(raw)) return message;
  }

  // 4. Jika tidak teknis, kembalikan pesan asli.
  if (!TECHNICAL_MARKER.test(raw)) return raw;

  // 5. Fallback generik.
  return 'Terjadi kesalahan. Silakan coba lagi.';
}

export function friendlyActionError(error: unknown, fallback: string): string {
  if (error === null || error === undefined) {
    console.error("[action-error]", fallback);
    return fallback;
  }
  const raw = readableErrorMessage(error).trim();
  console.error("[action-error]", raw);
  if (!raw) return fallback;
  if (GUARD_PREFIX.test(raw)) return raw;
  for (const [pattern, message] of FRIENDLY_PATTERNS) {
    if (pattern.test(raw)) return message;
  }
  if (TECHNICAL_MARKER.test(raw)) return fallback;
  return raw;
}
