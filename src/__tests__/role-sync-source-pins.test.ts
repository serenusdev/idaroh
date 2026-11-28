/**
 * ROLE-SYNC — source-level pins for PERMISSIONS.md §2 rules 1 and 2.
 *
 * A rank table cannot be re-introduced quietly: these pins fail the moment a role ordering or
 * a profiles.member_type lookup reappears in an authorization path, which is exactly how
 * ROLE-SYNC was found in the audit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(resolve(root, ...parts), "utf8");

function productionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(root, dir))) {
    if (entry === "__tests__" || entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(resolve(root, dir), entry);
    if (statSync(full).isDirectory()) out.push(...productionSources(relative(root, full)));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(root, full));
  }
  return out;
}

describe("the role rank table is gone from authorization code", () => {
  it("guards.ts exports no rank helper", () => {
    const guards = read("src/lib/auth/guards.ts");
    expect(guards).not.toContain("hasMinimumRole");
    expect(guards).not.toContain("ROLE_PRIORITY");
    expect(guards).not.toContain("getHighestRole");
  });

  it("only the session loader may order roles, and only for presentation", () => {
    const ranked = productionSources("src").filter((file) =>
      /ROLE_PRIORITY|hasMinimumRole|getHighestRole/.test(read(file))
    );
    expect(ranked).toEqual(["src/lib/auth/session.ts"]);
  });

  it("the session loader picks its primary role from user_roles, not from member_type", () => {
    const session = read("src/lib/auth/session.ts");
    expect(session).toContain("member_type is descriptive data");
    expect(session).toMatch(/state: 'role_missing'/);
  });
});

describe("iam actions authorise by role set, not by rank", () => {
  const actions = read("src/modules/iam/actions.ts");

  it("no rank table is consulted", () => {
    expect(actions).not.toMatch(/ROLE_PRIORITY|getHighestRole|hasMinimumRole/);
  });

  it("no permission decision reads profiles.member_type", () => {
    expect(actions).not.toMatch(/normalizeRole\([^)]*member_type/);
    expect(actions).not.toMatch(/resolveAssignableRole\([^)]*member_type/);
  });

  it("the assignable set is written out instead of derived from a hierarchy", () => {
    const assignable = actions.match(/const ASSIGNABLE_ROLES[^=]*=\s*\[([\s\S]*?)\]/)?.[1];
    expect(assignable).toBeDefined();
    for (const role of ["santri", "koordinator", "pengurus", "yayasan"]) {
      expect(assignable).toContain(`"${role}"`);
    }
    expect(assignable).not.toContain("super_admin");
  });

  it("every IAM mutation guard asks for super_admin only", () => {
    const guards = [...actions.matchAll(/requireRole\(\s*\[([^\]]*)\]/g)].map((m) => m[1]);
    expect(guards.length).toBeGreaterThanOrEqual(7);
    expect(guards.filter((list) => list.replace(/["\s]/g, "") === "super_admin").length).toBe(8);
  });
});

describe("attendance history does not decide scope in TypeScript", () => {
  const actions = read("src/modules/attendance/actions.ts");

  it("the normalizer and the rank table are gone", () => {
    expect(actions).not.toContain("normalizeAttendanceRole");
    expect(actions).not.toMatch(/ROLE_PRIORITY|getHighestRole|hasMinimumRole/);
  });

  it("member_type is never part of an attendance decision", () => {
    expect(actions).not.toContain("member_type");
  });

  it("the history read goes through the session client so RLS applies", () => {
    const history = actions.slice(
      actions.indexOf("export async function getAttendanceHistoryAction"),
      actions.indexOf("export async function submitCorrectionAction")
    );
    expect(history).toContain("await createClient()");
    expect(history).not.toContain("createAdminClient()");
  });
});

describe("people profile update honours own scope", () => {
  it("no rank helper guards the bio write", () => {
    const actions = read("src/modules/people/actions.ts");
    expect(actions).not.toContain("hasMinimumRole");
    expect(actions).toMatch(/caller\.id\s*!==\s*userId/);
  });
});

describe("the IAM console separates roles from categories", () => {
  const page = read("src/app/(app)/admin/users/page.tsx");

  it("mutating controls are gated by the super_admin set", () => {
    expect(page).toContain("IAM_MUTATION_ROLES");
    expect(page).toMatch(/holdsRole\(currentUser,\s*IAM_MUTATION_ROLES\)/);
  });

  it("the queue is not fetched for a reader that §3.1 excludes", () => {
    // CACHE-01 Batch 3: the legacy "key === null means do not read" became `enabled`, on the same
    // predicate — the migration may not widen who gets to read the IAM queue.
    expect(page).toMatch(/enabled:\s*canDecideIam/);
    expect(page).toMatch(/cacheKeys\.accountRequests\(currentUser\)/);
  });

  it("the ustadz tab counts categories, not roles", () => {
    expect(page).not.toMatch(/u\.role\.toLowerCase\(\)\.includes\("ustadz"\)/);
  });
});

describe("multi-role administration remains explicit and fail-closed", () => {
  it("offers a dedicated server action and RPC for replacing the active role set", () => {
    const actions = read("src/modules/iam/actions.ts");
    const migration = read("supabase/migrations/202612030001_attendance_checkin_and_multi_role.sql");
    expect(actions).toContain("adminSetUserRolesAction");
    expect(actions).toContain("requireRole([\"super_admin\"])");
    expect(migration).toContain("admin_set_user_roles");
    expect(migration).toContain("super_admin tidak dapat ditambahkan dari jalur ini");
  });

  it("keeps pending role applicants behind approval", () => {
    const migration = read("supabase/migrations/20261122000010_role_sync_ustadz_and_matrix.sql");
    expect(migration).toContain("Approver bukan super_admin aktif.");
    expect(migration).toContain("Peran super_admin tidak dapat ditetapkan dari antrean pendaftaran.");
  });
});
