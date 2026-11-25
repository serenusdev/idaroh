import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

// fs-only scans: a missing file must fail as an assertion, never as a throw, so
// the Stage-B evidence stays assertion-level (AGENTS.md / AGENT-WORKFLOW.md).
function readOrEmpty(relativePath: string): string {
  const full = resolve(root, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const peopleActions = readOrEmpty("src/modules/people/actions.ts");
const migration = readOrEmpty("supabase/migrations/20261122000007_team_command_rpcs_and_resource_upsert.sql");
const rollback = readOrEmpty("supabase/rollback/20261122000007_team_command_rpcs_and_resource_upsert_down.sql");

const TEAM_ROLES = 'requireRole(["super_admin", "yayasan", "pengurus"])';

/** Text of one exported server action, up to the next exported function. */
function actionBody(source: string, name: string): string {
  const marker = `export async function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const rest = source.slice(start + marker.length);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Body of one dollar-quoted SQL function, from its header to the closing $$. */
function sqlFunction(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const end = source.indexOf("\n$$;", start);
  return end < 0 ? source.slice(start) : source.slice(start, end + 4);
}

describe("PPL-01 — team and reviewer commands follow PERMISSIONS.md §3.7", () => {
  it("admits yayasan to all four team/reviewer actions", () => {
    for (const name of [
      "setTeamCoordinatorAction",
      "addTeamMemberAction",
      "removeTeamMemberAction",
      "assignReviewerAction",
    ]) {
      const body = actionBody(peopleActions, name);
      expect(body, `${name} is missing from the module`).toContain(TEAM_ROLES);
    }
  });

  it("opens the admin people page itself to yayasan", () => {
    // Five-layer sync (§3.7): the server action guard, the RPC and the page gate
    // all deny or admit the same role set, and a grant can live in roles[].
    const page = readOrEmpty("src/app/(app)/admin/people/page.tsx");
    expect(page, "admin people page is missing").not.toBe("");
    expect(page).toContain('["super_admin", "yayasan", "pengurus"]');
    expect(page).toContain("user.roles");
    expect(page).toContain('requiredRole="Super Admin / Yayasan / Pengurus"');
    expect(page).not.toContain('["super_admin", "pengurus"].includes(user.role)');
  });

  it("guards the team commands on explicit role keys instead of a rank", () => {
    for (const name of [
      "setTeamCoordinatorAction",
      "addTeamMemberAction",
      "removeTeamMemberAction",
      "assignReviewerAction",
    ]) {
      const body = actionBody(peopleActions, name);
      expect(body, `${name} is missing`).not.toBe("");
      expect(body, `${name} authorises by rank`).not.toContain("hasMinimumRole");
      expect(body, `${name} authorises by rank`).not.toContain("roleRank");
    }
  });

  it("sends every team mutation through an RPC on the caller's own session", () => {
    for (const name of ["addTeamMemberAction", "removeTeamMemberAction"]) {
      const body = actionBody(peopleActions, name);
      expect(body, `${name} has no body`).toContain("createClient()");
      expect(body, `${name} still writes with the service role`).not.toContain("createAdminClient()");
    }
    expect(actionBody(peopleActions, "addTeamMemberAction")).toContain('rpc("team_member_set"');
    expect(actionBody(peopleActions, "removeTeamMemberAction")).toContain('rpc("team_member_end"');
    // Direct DML would have to reopen team_members RLS, which AGENTS.md forbids.
    expect(actionBody(peopleActions, "addTeamMemberAction")).not.toContain('from("team_members")');
    expect(actionBody(peopleActions, "removeTeamMemberAction")).not.toContain('from("team_members")');
  });

  it("leaves the audit ledger to the RPC instead of a second client", () => {
    for (const name of ["addTeamMemberAction", "removeTeamMemberAction", "assignReviewerAction"]) {
      const body = actionBody(peopleActions, name);
      expect(body, `${name} writes audit from the application`).not.toContain('from("audit_logs")');
    }
    expect(peopleActions.slice(0, peopleActions.indexOf("export async function setTeamCoordinatorAction")))
      .not.toMatch(/audit_logs/);
  });

  it("derives membership dates from WIB, not from the UTC calendar", () => {
    for (const name of ["addTeamMemberAction", "removeTeamMemberAction"]) {
      const body = actionBody(peopleActions, name);
      expect(body, `${name} is missing`).not.toBe("");
      expect(body, `${name} builds a UTC calendar date in the browser`).not.toContain(
        'new Date().toISOString().slice(0, 10)',
      );
    }
  });

  it("ships the four command RPCs with a pinned search_path and a role guard", () => {
    expect(migration, "migration 20261122000007 is missing").not.toBe("");
    for (const marker of [
      "CREATE OR REPLACE FUNCTION app.team_set_coordinator",
      "CREATE OR REPLACE FUNCTION app.team_member_set",
      "CREATE OR REPLACE FUNCTION app.team_member_end",
      "CREATE OR REPLACE FUNCTION app.assign_reviewer",
    ]) {
      const fn = sqlFunction(migration, marker);
      expect(fn, `${marker} is missing`).not.toBe("");
      expect(fn).toContain("SECURITY DEFINER");
      expect(fn).toContain("SET search_path = public, app, pg_temp");
      expect(fn).toContain("auth.uid() IS NULL");
      expect(fn).toContain("app.is_active_member()");
      expect(fn).toContain("app.has_any_role('super_admin', 'yayasan', 'pengurus')");
      expect(fn).toContain("people.");
      // The RPC owns the ledger row, in the same transaction as the mutation.
      expect(fn).toContain("INSERT INTO public.audit_logs");
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("stamps effective dates with the WIB calendar date", () => {
    for (const marker of [
      "app.team_set_coordinator",
      "app.team_member_set",
      "app.team_member_end",
      "app.assign_reviewer",
    ]) {
      const fn = sqlFunction(migration, `CREATE OR REPLACE FUNCTION ${marker}`);
      expect(fn, `${marker} has no date variable`).toContain(
        "AT TIME ZONE 'Asia/Jakarta')::date",
      );
      expect(fn, `${marker} still uses the server CURRENT_DATE`).not.toMatch(/\bCURRENT_DATE\b/);
    }
  });

  it("refuses a coordinator through the member RPC so one path owns the seat", () => {
    const fn = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.team_member_set");
    expect(fn).toContain("'coordinator'");
    expect(fn).toMatch(/team_role|p_team_role/);
    expect(fn).toContain("IF NOT FOUND");
  });

  it("exposes PostgREST wrappers for the new command RPCs", () => {
    for (const name of ["team_member_set", "team_member_end"]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(migration).toContain(`SELECT app.${name}`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${name}`);
    }
  });

  it("rolls the command surface back to the pre-fix guards", () => {
    expect(rollback, "rollback file is missing").not.toBe("");
    for (const signature of [
      "app.team_member_set(uuid, uuid, text, text)",
      "app.team_member_end(uuid, uuid)",
      "public.team_member_set(uuid, uuid, text, text)",
      "public.team_member_end(uuid, uuid)",
    ]) {
      expect(rollback).toContain(`DROP FUNCTION IF EXISTS ${signature}`);
    }
    // The recreated functions go back to the super_admin+pengurus guard.
    expect(rollback).toContain("CREATE OR REPLACE FUNCTION app.team_set_coordinator");
    expect(rollback).toContain("app.has_any_role('super_admin', 'pengurus')");
    expect(rollback).toContain("NOTIFY pgrst, 'reload schema';");
  });
});

describe("pgTAP coverage for the PPL-01 / LIB-03 commands", () => {
  for (const [file, expected] of [
    ["supabase/tests/team_command_rls.sql", 31],
    ["supabase/tests/resource_upsert_rls.sql", 25],
  ] as const) {
    it(`${file} is sized to its plan`, () => {
      const tap = readOrEmpty(file);
      expect(tap, `${file} is missing`).not.toBe("");
      expect(tap).toContain(`SELECT plan(${expected});`);
      const assertions = tap.match(/^SELECT (is|isnt|ok|throws_ok)\(/gm) || [];
      expect(assertions.length, `${file} assertion count`).toBe(expected);
      expect(tap).toContain("ROLLBACK;");
      // A leaked identity switch would poison the next file in the same run.
      expect(tap).toContain("DROP FUNCTION IF EXISTS public.");
    });
  }
});
