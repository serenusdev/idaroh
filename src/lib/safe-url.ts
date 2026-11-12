/**
 * Returns a same-origin relative path for in-app navigation, or null when the
 * value could navigate off-site (absolute URLs, protocol-relative, javascript:).
 */
export function toSafeInternalPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  try {
    const base = "https://internal.invalid";
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
