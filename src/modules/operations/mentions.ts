/**
 * Extract @username handles from comment body text (TRC-23).
 * Returns an array of usernames (without the @ prefix).
 *
 * Pure helper — kept outside the "use server" actions module so it stays
 * synchronous; Next.js requires every value export of a "use server" file to be async.
 */
export function parseMentionUsernames(body: string): string[] {
  const matches = body.match(/@([A-Za-z0-9_.\-]{2,50})/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase())));
}