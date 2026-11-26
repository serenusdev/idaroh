import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("Cabang 3 (TSK-02 + ADM D3 + Import/People) — Tahap B contract pins", () => {
  it("TSK-02: tasks & projects read/write actions exclude super_admin (SA = —) and route writes through session RPCs", () => {
    const src = read("src/modules/tasks/actions.ts");

    // Read & assignable actions must gate on TASK_READ_ROLES (excludes super_admin)
    expect(src).toMatch(/getTasksAction[\s\S]*?holdsTaskRole\(user,\s*TASK_READ_ROLES\)/);
    expect(src).toMatch(/getProjectsAction[\s\S]*?holdsTaskRole\(user,\s*TASK_READ_ROLES\)/);
    expect(src).toMatch(/getAssignableMembersAction[\s\S]*?holdsTaskRole\(user,\s*TASK_READ_ROLES\)/);

    // organization visibility in TS must require TASK_READ_ROLES, matching SQL app.can_access_task
    expect(src).not.toMatch(/if\s*\(\s*task\.visibility\s*===\s*"organization"\s*\)\s*return\s+true\s*;/);

    // Detail/project/checklist/reviewer writes must route through session RPCs, not createAdminClient table writes
    expect(src).toContain('.rpc("task_update"');
    expect(src).toContain('.rpc("task_archive"');
    expect(src).toContain('.rpc("task_assign_reviewer"');
    expect(src).toContain('.rpc("task_checklist_mutate"');
    expect(src).toContain('.rpc("project_upsert"');
    expect(src).toContain('.rpc("project_archive"');
  });

  it("ADM-01/02/03 (D3): super_admin receives technical/system metrics only and dashboard cache keys are per-user", () => {
    const analytics = read("src/modules/analytics/actions.ts");
    const homePage = read("src/app/(app)/page.tsx");
    const auditPage = read("src/app/(app)/admin/audit/page.tsx");

    // D3 separation in getAdminDashboardStatsAction
    expect(analytics).toMatch(/isOperationalDashboardRole|holdsRole\(user,\s*\[\s*"pengurus"\s*,\s*"yayasan"\s*\]\)/);
    expect(analytics).toContain("systemHealth");

    // Per-user namespaced cache keys (no shared "admin:dashboard-stats" across roles/users). The
    // beranda moved onto TanStack Query in CACHE-01 Batch 2, so its namespace now comes from the
    // key builder; /admin/audit is still a data-cache reader until Batch 3 and keeps the literal.
    const cacheKeys = read("src/lib/cache-keys.ts");
    expect(homePage).toContain("cacheKeys.dashboard(currentUser)");
    expect(cacheKeys).toContain("`admin:dashboard-stats:${");
    expect(auditPage).toContain("`admin:dashboard-stats:${currentUser.id}`");
    expect(homePage).not.toMatch(/useCachedData\([^)]*"admin:dashboard-stats"[^)]*\)/);
    expect(auditPage).not.toMatch(/useCachedData\([^)]*"admin:dashboard-stats"[^)]*\)/);
  });

  it("Import & People: importMembersCsvAction is super_admin-only without member_type->role_requested, and getPeopleAction uses WIB valid_from/valid_to", () => {
    const ops = read("src/modules/operations/actions.ts");
    const people = read("src/modules/people/actions.ts");

    // Exclusive super_admin for importMembersCsvAction
    expect(ops).toMatch(/importMembersCsvAction[\s\S]{0,250}requireRole\(\["super_admin"\]\)/);
    // Must not copy member_type into role_requested
    expect(ops).not.toMatch(/role_requested:\s*String\(item\.member_type/);

    // getPeopleAction must not use UTC slice(0, 10) for reviewer_assignments
    expect(people).not.toContain('new Date().toISOString().slice(0, 10)');
    // Must check valid_from <= today (WIB) on reviewer_assignments and team_members
    expect(people).toMatch(/reviewer_assignments[\s\S]{0,250}valid_from/);
    expect(people).toMatch(/team_members[\s\S]{0,250}valid_from/);
  });
});
