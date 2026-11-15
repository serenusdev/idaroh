/**
 * Masks a phone number by hiding middle digits, handling +62, dashes, spaces,
 * and short numbers robustly (SEC-03).
 * Examples: "081234567890" → "0812-••••-7890"
 *           "+6281234567890" → "+628••••••7890"
 *           "0812-3456-7890" → "0812-••••-7890"
 * Falls back to full masking if the number is too short to identify safely.
 *
 * Pure helper — kept outside the "use server" actions module so it stays
 * synchronous; Next.js requires every value export of a "use server" file to be async.
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone || typeof phone !== "string") return "-";
  // Strip all non-digit chars except leading + for normalization
  const hasPlus = phone.startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) {
    // Too short to mask safely — show first 2 and mask rest
    return digits.slice(0, 2) + "••••";
  }
  // Show first 4 digits and last 4 digits, mask the middle
  const prefix = (hasPlus ? "+" : "") + digits.slice(0, 4);
  const suffix = digits.slice(-4);
  const middleLen = digits.length - 8;
  const middle = middleLen > 0 ? "•".repeat(middleLen) : "••";
  return `${prefix}-${middle}-${suffix}`;
}