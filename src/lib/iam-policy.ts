import type { UserRole } from "@/lib/auth/types";

/**
 * PERMISSIONS.md §3.1 — the Identity & Access command surface.
 *
 * The registration queue, the approve/reject decision, suspension and session revoke, and the
 * role assignment are `super_admin` only: yayasan supervises the institution but holds no
 * technical IAM, and pengurus executes operations. Because the server actions, the RPCs and the
 * `account_requests` RLS policy all read the same grants, this list is what the UI has to match
 * so a reader is never offered a button the database would refuse.
 */
export const IAM_MUTATION_ROLES: readonly UserRole[] = ["super_admin"];

/** `iam.user.read`: the read-only member console stays open below `super_admin`. */
export const IAM_READ_ROLES: readonly UserRole[] = ["pengurus", "yayasan", "super_admin"];
