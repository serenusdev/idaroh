import type { UserRole } from "@/lib/auth/types";

/**
 * PERMISSIONS.md §3.6 — the single source of truth for the agenda command surface.
 *
 * A koordinator may create, update and cancel an agenda, but only one addressed to a
 * team it actively coordinates: app.can_write_event_audience() decides that per row.
 * These lists only decide which menu entry and which page shell the UI renders, so a
 * role never sees a link the database would refuse (§2 rule 8).
 *
 * The manager tier is also the tier §3.6 gives the announcement broadcasts and the
 * per-day cancel added by SCH-01 to, so a page can reuse one flag for all three.
 */
export const AGENDA_MANAGER_ROLES: readonly UserRole[] = [
  "super_admin",
  "yayasan",
  "pengurus",
];
export const AGENDA_WRITE_ROLES: readonly UserRole[] = [
  ...AGENDA_MANAGER_ROLES,
  "koordinator",
];

/** Explicit role pairing; never a rank comparison (AGENTS.md). */
export function holdsScheduleRole(
  user: { role: string; roles?: string[] },
  roles: readonly UserRole[],
): boolean {
  const held = new Set<string>([user.role, ...(user.roles || [])]);
  return roles.some((role) => held.has(role));
}
