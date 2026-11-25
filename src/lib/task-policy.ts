import type { UserRole } from "@/lib/auth/types";

/**
 * PERMISSIONS.md §3.5 + decision D4 — the single source of truth for the
 * Tasks & Projects command surface.
 *
 * `super_admin` holds no task or project permission at all, so it appears in
 * none of these lists. Yayasan supervises and may cancel or reopen, but D4
 * keeps it out of the daily transitions and out of review. Koordinator rights
 * are team-scoped: this module only says whether a role may hold the
 * permission, app.can_access_task and app.task_transition resolve the scope.
 */
export const TASK_OVERSIGHT_ROLES: readonly UserRole[] = ["pengurus", "yayasan"];
export const TASK_REVIEW_ROLES: readonly UserRole[] = ["koordinator", "pengurus"];
export const TASK_PROJECT_ROLES: readonly UserRole[] = ["koordinator", "pengurus", "yayasan"];
export const TASK_READ_ROLES: readonly UserRole[] = ["santri", "koordinator", "pengurus", "yayasan"];

/** Explicit role pairing; never a rank comparison (AGENTS.md). */
export function holdsTaskRole(
  user: { role: string; roles?: string[] },
  roles: readonly UserRole[],
): boolean {
  const held = new Set<string>([user.role, ...(user.roles || [])]);
  return roles.some((role) => held.has(role));
}
