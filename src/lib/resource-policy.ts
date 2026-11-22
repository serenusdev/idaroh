import type { UserRole } from "@/lib/auth/types";

// PERMISSIONS.md §3.2 with decision D6 behind it: an `internal` resource is
// readable by every active member, but a `restricted` one opens only for the
// roles and teams named in resource_visibility_rules. That makes the rules
// table the single authority, so no role — super_admin included — may keep a
// blanket elevated branch, and a grant must be matched against every active
// role of the caller rather than the primary one alone.
//
// The database decides. app.can_view_resource() is the policy predicate, and
// the Server Actions ask the caller-scoped session which restricted rows that
// policy returns, then narrow the richer admin-client read to that id set.
export const RESOURCE_RULE_MANAGER_ROLES: readonly UserRole[] = ["pengurus", "yayasan", "super_admin"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isResourceId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * PostgREST `or=` branch for a resource read. Restricted ids only ever come
 * from a policy-filtered query, and anything that is not a uuid is dropped so a
 * caller cannot widen the branch through a crafted value.
 */
export function resourceVisibilityFilter(grantedRestrictedIds: readonly string[]): string {
  const ids = grantedRestrictedIds.filter(isResourceId);
  if (ids.length === 0) return "visibility.eq.internal";
  return `visibility.eq.internal,and(visibility.eq.restricted,id.in.(${ids.join(",")}))`;
}
