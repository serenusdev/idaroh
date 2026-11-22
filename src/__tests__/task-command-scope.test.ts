import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const policyPath = resolve(process.cwd(), "src/lib/task-policy.ts");
const exportPolicyPath = resolve(process.cwd(), "src/lib/export-policy.ts");
const actionsPath = resolve(process.cwd(), "src/modules/tasks/actions.ts");
const sidebarPath = resolve(process.cwd(), "src/components/layout/desktop-sidebar.tsx");
const mobileNavPath = resolve(process.cwd(), "src/components/layout/mobile-nav.tsx");
const moreSheetPath = resolve(process.cwd(), "src/components/layout/more-sheet.tsx");

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

// PERMISSIONS.md §3.5 denies super_admin every Tasks/Projects row and D4 keeps
// yayasan out of the daily transitions. The enforcement lives in SQL, but the
// server actions and the navigation must not offer a wider surface than the
// database will honour, otherwise the five layers of AGENTS.md drift apart.
describe("task command scope contract (SEC-04 / TASK-01)", () => {
  it("declares the §3.5 role matrix in one module without super_admin", () => {
    expect(existsSync(policyPath), "src/lib/task-policy.ts is missing").toBe(true);
    const policy = read(policyPath);
    expect(policy).toContain('export const TASK_OVERSIGHT_ROLES: readonly UserRole[] = ["pengurus", "yayasan"];');
    expect(policy).toContain('export const TASK_REVIEW_ROLES: readonly UserRole[] = ["koordinator", "pengurus"];');
    expect(policy).toContain('export const TASK_PROJECT_ROLES: readonly UserRole[] = ["koordinator", "pengurus", "yayasan"];');
    expect(policy).toContain('export const TASK_READ_ROLES: readonly UserRole[] = ["santri", "koordinator", "pengurus", "yayasan"];');
    expect(policy).not.toContain('"super_admin"');
    // AGENTS.md: permission checks are explicit pairs, never a role rank.
    expect(policy).not.toContain("hasMinimumRole");
    expect(policy).not.toContain("ROLE_PRIORITY");
  });

  it("scopes task and project reads to the oversight roles", () => {
    const actions = read(actionsPath);
    expect(actions).toContain("holdsTaskRole(user, TASK_OVERSIGHT_ROLES)");
    expect(actions).not.toContain("super_admin");
    expect(actions).not.toContain("hasMinimumRole");
    // Seven call sites: four read paths (the access helper, the task list, the
    // project list and the assignable-roster lookup) plus the three task write
    // guards, which stay oversight-only so a creator can never widen their own
    // row by editing it.
    expect((actions.match(/holdsTaskRole\(user, TASK_OVERSIGHT_ROLES\)/g) || []).length).toBe(7);
  });

  it("keeps review authority with the designated reviewer only", () => {
    const actions = read(actionsPath);
    expect(actions).toContain("if (!holdsTaskRole(user, TASK_REVIEW_ROLES)) {");
    expect(actions).toContain("if (task.created_by === user.id || assigneeIds.includes(user.id)) {");
    expect(actions).toContain("Dilarang self-review");
    expect(actions).toContain("const elevated = holdsTaskRole(user, TASK_OVERSIGHT_ROLES)");
  });

  it("routes status changes through task_transition instead of a service write", () => {
    const actions = read(actionsPath);
    // updateTaskStatusAction plus the review decision path.
    expect((actions.match(/rpc\("task_transition"/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(actions).not.toMatch(/\.update\(\{ status: newStatus/);
    expect(actions).toContain('if (!holdsTaskRole(user, TASK_PROJECT_ROLES)) {');
  });

  it("refuses to hand out a roster of a team the caller is not part of", () => {
    const actions = read(actionsPath);
    expect(actions).toContain("if (teamId && !elevated && !callerTeamIds.has(teamId)) {");
    expect(actions).toContain("const callerTeamIds = new Set<string>(");
    expect(actions).toContain("Anda bukan anggota tim tersebut.");
  });

  it("hides the task and audit entries from roles that cannot open them", () => {
    const sidebar = read(sidebarPath);
    expect(sidebar).toContain("const canViewTasks = holdsTaskRole(user, TASK_READ_ROLES);");
    expect(sidebar).toContain("...(canViewTasks ? [{ label: \"Tugas & Proyek\", href: \"/tugas\", icon: \"task_alt\" }] : []),");
    expect(sidebar).toContain("holdsRole(user, AUDIT_READ_ROLES)");

    const mobile = read(mobileNavPath);
    expect(mobile).toContain("...(holdsRole(user, AUDIT_READ_ROLES) ? [");
    expect(mobile).toContain('href: "/admin/audit"');

    const moreSheet = read(moreSheetPath);
    expect(moreSheet).toContain("{canViewTasks && (");
    expect(moreSheet).toContain("{holdsRole(user, AUDIT_READ_ROLES) && (");

    const exportPolicy = read(exportPolicyPath);
    expect(exportPolicy).toContain('export const AUDIT_READ_ROLES: readonly UserRole[] = ["yayasan", "super_admin"];');
  });
});
