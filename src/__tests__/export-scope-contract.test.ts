import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const policyPath = resolve(process.cwd(), "src/lib/export-policy.ts");
const actionsPath = resolve(process.cwd(), "src/modules/analytics/actions.ts");
const routePath = resolve(process.cwd(), "src/app/api/exports/[exportId]/route.ts");
const auditPagePath = resolve(process.cwd(), "src/app/(app)/admin/audit/page.tsx");
const usersPagePath = resolve(process.cwd(), "src/app/(app)/admin/users/page.tsx");

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

// PERMISSIONS.md §3.8 keeps `analytics.export` away from super_admin and
// `admin.audit.read` away from pengurus. These scans fail on the layer that
// drifts, which the behavioural suites cannot see because they mock the guards.
describe("export scope contract (SEC-01)", () => {
  it("declares the §3.8 role matrix in one module without super_admin", () => {
    expect(existsSync(policyPath), "src/lib/export-policy.ts is missing").toBe(true);
    const policy = read(policyPath);
    expect(policy).toContain('export const EXPORT_ROLES: readonly UserRole[] = ["pengurus", "yayasan"];');
    expect(policy).toContain('export const AUDIT_EXPORT_ROLES: readonly UserRole[] = ["yayasan"];');
    expect(policy).not.toContain('"super_admin"');
  });

  it("requests exports as yayasan/pengurus over a closed category list", () => {
    const actions = read(actionsPath);
    expect(actions).toContain("const admin = await requireRole([...EXPORT_ROLES]);");
    expect(actions).toContain("if (!isExportCategory(trimmedCategory)) {");
    expect(actions).toContain("if (!holdsRole(admin, exportRolesFor(trimmedCategory))) {");
    expect(actions).toContain("Log audit hanya dapat diekspor oleh Yayasan.");
  });

  it("downloads as the requesting admin only, never as a privileged reader", () => {
    const route = read(routePath);
    expect(route).toContain("user = await requireRole([...EXPORT_ROLES]);");
    expect(route).toContain("if (!log || log.user_id !== user.id) {");
    expect(route).toContain('if (!isExportCategory(log.category)) {');
    expect(route).toContain('return NextResponse.json({ error: "Kategori ekspor tidak dikenal." }, { status: 400 });');
    expect(route).toContain("if (!holdsRole(user, exportRolesFor(log.category))) {");
    expect(route).not.toMatch(/!==\s*["']super_admin["']/);
    expect(route).not.toMatch(/===\s*["']super_admin["']/);
  });

  it("replays the stored filter over every dataset", () => {
    const route = read(routePath);
    expect(route).toContain("parseStoredExportFilters(log.filter_criteria)");
    expect(route).toContain("return NextResponse.json({ error: \"Filter ekspor tersimpan tidak valid.\" }, { status: 400 });");
    // Seven call sites: attendance, its report join, daily reports, tasks,
    // project tasks, accounts and audit logs.
    expect((route.match(/withDateRange\(/g) || []).length).toBeGreaterThanOrEqual(7);
    for (const column of ["attendance_date", "report_date", "created_at"]) {
      expect(route, `date range never applied to ${column}`).toContain(`"${column}"`);
    }
  });

  it("hides the export entries from roles that cannot use them", () => {
    const auditPage = read(auditPagePath);
    expect(auditPage).toContain("const canExport = EXPORT_ROLES.some((role) => heldRoles.has(role));");
    expect(auditPage).toContain("const canExportAuditLogs = AUDIT_EXPORT_ROLES.some((role) => heldRoles.has(role));");
    expect(auditPage).toContain("{canExport && (");
    expect(auditPage).toContain("{canExportAuditLogs && (");

    const usersPage = read(usersPagePath);
    expect(usersPage).toContain("const canExportAccounts = EXPORT_ROLES.some((role) => heldRoles.has(role));");
    expect(usersPage).toContain("{canExportAccounts && (");
  });
});
