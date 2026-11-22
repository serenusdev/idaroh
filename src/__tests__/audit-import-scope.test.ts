import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261122000003_audit_read_scope_and_import_administration.sql",
);
const tapPath = resolve(process.cwd(), "supabase/tests/audit_read_scope_rls.sql");
const analyticsPath = resolve(process.cwd(), "src/modules/analytics/actions.ts");
const libraryPath = resolve(process.cwd(), "src/modules/library/actions.ts");
const auditPagePath = resolve(process.cwd(), "src/app/(app)/admin/audit/page.tsx");
const resourcesPagePath = resolve(process.cwd(), "src/app/(app)/admin/resources/page.tsx");

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** Text of one exported server action, up to the next exported action. */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const rest = source.slice(start + `export async function ${name}(`.length);
  const next = rest.indexOf("export async function ");
  return next < 0 ? rest : rest.slice(0, next);
}

/** Body of one SQL statement that starts with the given marker. */
function sqlStatement(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const end = source.indexOf(";", start);
  return end < 0 ? source.slice(start) : source.slice(start, end + 1);
}

/** Body of one dollar-quoted SQL function, from its header to the closing $$. */
function sqlFunction(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const end = source.indexOf("\n$$;", start);
  return end < 0 ? source.slice(start) : source.slice(start, end + 4);
}

// PERMISSIONS.md §3.8 denies pengurus `admin.audit.read` in the Server Action
// *and* in RLS, and §3.2 makes `library.import.run` exclusive to super_admin.
describe("audit read scope contract (SEC-05)", () => {
  it("narrows the audit_logs SELECT policy to yayasan and super admin", () => {
    expect(existsSync(migrationPath), "SEC-05/LIB-01 migration is missing").toBe(true);
    const policy = sqlStatement(read(migrationPath), 'CREATE POLICY "Audit logs are viewable by yayasan and super admin"');
    expect(policy).toContain("ON public.audit_logs FOR SELECT TO authenticated");
    expect(policy).toContain("app.is_active_member()");
    expect(policy).toContain("app.has_any_role('super_admin', 'yayasan')");
    expect(policy).not.toContain("pengurus");
  });

  it("drops the role guard inside app.verify_audit_chain", () => {
    const fn = sqlFunction(read(migrationPath), "CREATE OR REPLACE FUNCTION app.verify_audit_chain()");
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("IF auth.uid() IS NULL OR NOT app.has_any_role('super_admin', 'yayasan') THEN");
    expect(fn).not.toContain("'pengurus'");
  });

  it("refuses the audit actions outside the §3.8 reader set", () => {
    const analytics = read(analyticsPath);
    for (const name of ["queryAuditLogsAction", "getAuditChainStatusAction"]) {
      const body = actionBody(analytics, name);
      expect(body, `${name} has no guard`).toContain('await requireRole(["super_admin", "yayasan"]);');
      expect(body, `${name} still admits pengurus`).not.toContain('"pengurus"');
    }
  });

  it("gates the audit page on the same reader set", () => {
    const page = read(auditPagePath);
    expect(page).toContain('const canReadAuditLogs = heldRoles.has("super_admin") || heldRoles.has("yayasan");');
    expect(page).toContain("if (!canReadAuditLogs) {");
    expect(page).toContain('requiredRole="Super Admin / Yayasan"');
    expect(page).not.toContain("isAdminOrPengurus");
  });
});

describe("library import contract (LIB-01)", () => {
  it("keeps the CSV import exclusive to super_admin", () => {
    const library = read(libraryPath);
    expect(library).toContain('const LIBRARY_IMPORT_ROLES = ["super_admin"] as const;');
    expect(actionBody(library, "importResourcesCsvAction")).toContain(
      "await requireRole([...LIBRARY_IMPORT_ROLES]);",
    );
    // The shared admin surface (create/update/archive/restore) keeps yayasan.
    expect(library).toContain('const RESOURCE_ADMIN_ROLES = ["super_admin", "yayasan", "pengurus"] as const;');
  });

  it("hides the import panel from roles that cannot run it", () => {
    const page = read(resourcesPagePath);
    expect(page).toContain('.has("super_admin");');
    expect(page).toContain("{canRunImport && (");
  });

  it("follows the import permission into the batch log policy", () => {
    const policy = sqlStatement(read(migrationPath), 'CREATE POLICY "Super admin can view import batches"');
    expect(policy).toContain("ON public.resource_import_batches FOR SELECT TO authenticated");
    expect(policy).toContain("app.has_role('super_admin')");
    expect(policy).not.toContain("yayasan");
  });
});

describe("pgTAP audit scope matrix integrity", () => {
  const tap = read(tapPath);

  it("is sized to its plan", () => {
    expect(tap).toContain("SELECT plan(13);");
    const assertions = tap.match(/^SELECT (is|isnt|throws_ok|lives_ok)\(/gm) || [];
    expect(assertions.length).toBe(13);
  });

  it("covers every role on both surfaces", () => {
    for (const marker of [
      "yayasan reads the audit trail",
      "pengurus is denied the audit trail by RLS",
      "koordinator cannot verify the audit chain",
      "yayasan cannot read import batches",
    ]) {
      expect(tap, `missing assertion ${marker}`).toContain(marker);
    }
    expect(tap).toContain("ROLLBACK;");
  });
});
