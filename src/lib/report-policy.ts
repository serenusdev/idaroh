import type { UserRole } from "@/lib/auth/types";

/**
 * PERMISSIONS.md §3.4 — the single source of truth for the report review queue.
 *
 * `report.review` is `— | assigned | assigned | — | —`: koordinator and pengurus hold it, and
 * REP-01 narrows each of them to the reviewees named by an active `reviewer_assignments` row.
 * `super_admin` and `yayasan` are `—`, and line 129 refuses `super_admin` the report content
 * outright, so no surface — page, sidebar, mobile sheet or beranda shortcut — may offer the queue
 * to a role that cannot open it (§2 rule 8).
 *
 * This module only answers the role question. app.review_report() and the RLS policies on
 * daily_reports resolve the assignment scope.
 */
export const REPORT_REVIEW_ROLES: readonly UserRole[] = ["pengurus", "koordinator"];

/** Explicit role pairing across every role the account holds; never a rank comparison (AGENTS.md). */
export function holdsReportReviewRole(
  user: { role: string; roles?: string[] } | null | undefined,
  roles: readonly UserRole[],
): boolean {
  if (!user) return false;
  const held = new Set<string>([user.role, ...(user.roles || [])]);
  return roles.some((role) => held.has(role));
}
