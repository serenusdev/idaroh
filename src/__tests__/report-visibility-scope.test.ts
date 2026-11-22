/**
 * SEC-03 / REP-01 contracts.
 *
 * PERMISSIONS.md §3.4 + D1: report content is private. daily_reports carries
 * compliance metadata only; report_items carries the content. Beyond the
 * owner, content visibility flows exclusively from active
 * reviewer_assignments rows; review rights are limited to koordinator and
 * pengurus that hold such an assignment; Super Admin is denied. The queue
 * server action (service-role client, RLS bypass) must scope by assignment
 * instead of team membership. The follow-up migration also sanitizes the
 * save_report exception message per the operator note.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const migrationName = "20261122000002_report_rls_review_scope.sql";
const migrationPath = resolve(root, "supabase/migrations", migrationName);
const rollbackPath = resolve(
  root,
  "supabase/rollback",
  "20261122000002_report_rls_review_scope_down.sql",
);
const actionsPath = resolve(root, "src/modules/reports/actions.ts");
const tapPath = resolve(root, "supabase/tests/report_visibility_rls.sql");

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

/** Text from a marker up to the first `);` that closes the policy expression. */
function policyBlock(sql: string, marker: string): string {
  const start = sql.indexOf(marker);
  expect(start, `missing ${marker}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(");", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("SEC-03 migration artifact", () => {
  it("ships the visibility migration with a matching rollback", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(rollbackPath)).toBe(true);
    expect(readMigration()).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("drops every superseded policy before recreating it", () => {
    const sql = readMigration();
    for (const drop of [
      'DROP POLICY IF EXISTS "Users and assigned reviewers can view reports" ON public.daily_reports',
      'DROP POLICY IF EXISTS "Authorized reviewers can view report items" ON public.report_items',
      'DROP POLICY IF EXISTS "Assigned reviewers can insert reviews" ON public.report_reviews',
    ]) {
      expect(sql, `missing ${drop}`).toContain(drop);
    }
  });
});

describe("§3.4 / D1 visibility policies", () => {
  it("removes every broad elevated-role grant from the report read path", () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/has_any_role\(\s*'super_admin'/);
  });

  it("keeps daily_reports metadata readable for koordinator team, pengurus and yayasan, denies super_admin", () => {
    const block = policyBlock(
      readMigration(),
      'CREATE POLICY "Members can view report compliance metadata"',
    );
    expect(block).toContain("public.daily_reports FOR SELECT TO authenticated");
    expect(block).toContain("user_id = auth.uid()");
    expect(block).toContain("app.has_role('pengurus')");
    expect(block).toContain("app.has_role('yayasan')");
    expect(block).toContain("app.has_role('koordinator')");
    expect(block).toContain("public.team_members");
  });

  it("gates report content solely on ownership or an active reviewer assignment", () => {
    const block = policyBlock(
      readMigration(),
      'CREATE POLICY "Assigned reviewers can view report items"',
    );
    expect(block).toContain("public.report_items FOR SELECT TO authenticated");
    expect(block).toContain("public.reviewer_assignments");
    expect(block).toContain("ra.kind = 'report'");
    expect(block).not.toMatch(/has_role|has_any_role|reviewer_assignments ra_dummy/);
    expect(block).not.toMatch(/'pengurus'|'yayasan'|'super_admin'/);
  });

  it("restricts review writes to assigned koordinator or pengurus", () => {
    const block = policyBlock(
      readMigration(),
      'CREATE POLICY "Assigned reviewers can insert reviews"',
    );
    expect(block).toContain("public.report_reviews FOR INSERT TO authenticated");
    expect(block).toContain("app.has_any_role('koordinator', 'pengurus')");
    expect(block).toContain("public.reviewer_assignments");
  });
});

describe("review RPC loses the elevated bypass", () => {
  it("requires an active assignment and blocks all self-reviews", () => {
    const sql = readMigration();
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.review_report(");
    expect(sql).not.toMatch(/v_elevated/);
    expect(sql).not.toMatch(/NOT app\.has_role\('super_admin'\)/);
    expect(sql).toContain(
      "IF NOT app.has_any_role('koordinator', 'pengurus') OR NOT EXISTS",
    );
    expect(sql).toContain("app.is_active_member()");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION app.review_report(uuid, integer, text, text, text) TO authenticated;",
    );
  });
});

describe("exception messages are sanitized (operator note on SEC-02)", () => {
  it("save_report never returns raw SQLERRM to the client", () => {
    const sql = readMigration();
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.save_report(");
    expect(sql).not.toMatch(/'message',\s*SQLERRM/);
    expect(sql).toContain("RAISE WARNING");
    expect(sql).toContain("Penyimpanan laporan gagal diproses");
  });
});

describe("rollback restores the superseded behavior verbatim", () => {
  it("reinstates the old policies and the elevated review bypass", () => {
    const down = readFileSync(rollbackPath, "utf8");
    expect(down).toContain('CREATE POLICY "Users and assigned reviewers can view reports"');
    expect(down).toContain('CREATE POLICY "Authorized reviewers can view report items"');
    expect(down).toContain("has_any_role('super_admin', 'yayasan', 'pengurus')");
    expect(down).toMatch(/v_elevated/);
    expect(down).toContain("NOTIFY pgrst, 'reload schema';");
  });
});

describe("REP-01 server action scoping", () => {
  const src = readFileSync(actionsPath, "utf8");

  it("queue and review guards are limited to koordinator and pengurus", () => {
    const matches = src.match(/requireRole\(\["pengurus", "koordinator"\]\)/g) || [];
    expect(matches.length).toBe(2);
    expect(src).not.toContain('requireRole(["super_admin", "yayasan", "pengurus", "koordinator"])');
  });

  it("queue lists only reports of active reviewer_assignments, not whole teams", () => {
    expect(src).toMatch(
      /from\("reviewer_assignments"\)[\s\S]{0,400}\.eq\("reviewer_id", reviewer\.id\)/,
    );
    expect(src).not.toContain('reviewer.role === "koordinator"');
  });
});

describe("pgTAP visibility matrix integrity", () => {
  const tap = readFileSync(tapPath, "utf8");

  it("has no forbidden fixture table or dangling role usage", () => {
    expect(tap).toContain("SELECT plan(26);");
    const assertions = tap.match(/^SELECT (is|throws_ok|lives_ok)\(/gm) || [];
    expect(assertions.length).toBe(26);
  });

  it("asserts content denial for every unassigned elevated identity", () => {
    for (const marker of [
      "unassigned pengurus cannot read report content",
      "super_admin reads no report content",
      "yayasan without explicit grant cannot read report content",
      "expired assignment revokes report content",
    ]) {
      expect(tap, `missing assertion ${marker}`).toContain(marker);
    }
  });
});
