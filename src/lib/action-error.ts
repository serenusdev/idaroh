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

export function friendlyActionError(error: unknown, fallback: string): string {
  if (error === null || error === undefined) {
    console.error("[action-error]", fallback);
    return fallback;
  }
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  console.error("[action-error]", raw);
  if (!raw) return fallback;
  if (GUARD_PREFIX.test(raw)) return raw;
  for (const [pattern, message] of FRIENDLY_PATTERNS) {
    if (pattern.test(raw)) return message;
  }
  if (TECHNICAL_MARKER.test(raw)) return fallback;
  return raw;
}