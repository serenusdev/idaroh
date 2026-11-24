/**
 * Migration replay safety for the pending production range
 * (20261105000002..20261121000001) plus RPC overload reconciliation.
 *
 * Production schema_migrations stops at 20261105000001 while most objects from
 * the newer files already exist there via manual application. Every statement
 * in the pending range must therefore be guarded (IF [NOT] EXISTS,
 * CREATE OR REPLACE, or a preceded DROP ... IF EXISTS) so the same sequence
 * replays cleanly onto drifted production AND onto a fresh database.
 * These are heuristic source guards, not a SQL parser.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const migrationsDir = resolve(root, "supabase/migrations");
const PENDING_FROM = 20261105000002;

const allMigrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
const pendingMigrations = allMigrations.filter((f) => Number(f.slice(0, 14)) >= PENDING_FROM);

function read(name: string): string {
  return readFileSync(join(migrationsDir, name), "utf8");
}

// Heuristic: drop line comments so prose like "otherwise CREATE UNIQUE INDEX
// fails" does not trip the DDL guards. Block comments are not used in these files.
function statementsOnly(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, "");
}

describe("pending migration inventory", () => {
  it("covers the audited drift range including the reconciliation migration", () => {
    expect(pendingMigrations.length).toBeGreaterThanOrEqual(22);
    expect(pendingMigrations).toContain("20261117000001_email_outbox_idempotency.sql");
    expect(pendingMigrations).toContain("20261118000001_report_review_command_idempotency.sql");
    expect(pendingMigrations).toContain("20261121000001_reconcile_rpc_overloads.sql");
  });

  it("places the reconciliation migration before the follow-up remediations", () => {
    const index = pendingMigrations.indexOf("20261121000001_reconcile_rpc_overloads.sql");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(pendingMigrations.slice(index + 1)).toEqual([
      "20261122000001_report_save_wib_is_late.sql",
      "20261122000002_report_rls_review_scope.sql",
      "20261122000003_audit_read_scope_and_import_administration.sql",
      "20261122000004_task_command_scope_alignment.sql",
      "20261122000005_resource_visibility_rules.sql",
      "20261122000006_event_occurrence_cancellation.sql",
      "20261122000007_team_command_rpcs_and_resource_upsert.sql",
      "20261122000008_event_command_scope.sql",
      "20261122000009_recurring_conflict_and_ics.sql",
    ]);
  });
});

describe("pending migrations are replay-safe on drifted production", () => {
  for (const file of pendingMigrations) {
    describe(file, () => {
      const sql = statementsOnly(read(file));

      it("never uses bare CREATE TABLE / CREATE INDEX", () => {
        expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
        expect(sql).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
      });

      it("never uses bare CREATE FUNCTION", () => {
        expect(sql).not.toMatch(/CREATE FUNCTION/i);
      });

      it("drops every CREATE TRIGGER target first", () => {
        for (const [, name] of sql.matchAll(/CREATE TRIGGER (\w+)/g)) {
          expect(sql, `missing DROP TRIGGER IF EXISTS ${name}`).toMatch(
            new RegExp(`DROP TRIGGER IF EXISTS ${name}\\b`, "i"),
          );
        }
      });

      it("drops every CREATE POLICY name first", () => {
        for (const [, name] of sql.matchAll(/CREATE POLICY "([^"]+)"/g)) {
          expect(sql, `missing DROP POLICY IF EXISTS "${name}"`).toMatch(
            new RegExp(`DROP POLICY IF EXISTS "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i"),
          );
        }
      });

      it("guards every ADD CONSTRAINT by drop or existence check", () => {
        for (const [, name] of sql.matchAll(/ADD CONSTRAINT (\w+)/g)) {
          const dropped = new RegExp(`DROP CONSTRAINT IF EXISTS ${name}\\b`, "i").test(sql);
          const existenceChecked = sql.includes(`conname = '${name}'`);
          expect(dropped || existenceChecked, `unguarded ADD CONSTRAINT ${name}`).toBe(true);
        }
      });
    });
  }
});

describe("RPC signature reconciliation", () => {
  it("20261114000007 upgrades the public review_attendance_correction wrapper to 4 arguments", () => {
    const sql = read("20261114000007_correction_effective_layer.sql");
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS app\.review_attendance_correction\(uuid, text, text\)/i);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.review_attendance_correction\(uuid, text, text\)/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.review_attendance_correction\(/i);
    expect(sql).toMatch(/p_effective_classification text DEFAULT NULL/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.review_attendance_correction\(uuid, text, text, text\) TO authenticated/i);
  });

  it("20261112000005 removes the 4-argument approve_account_application overload", () => {
    const sql = read("20261112000005_fix_account_approval.sql");
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.approve_account_application\(uuid, uuid, text, uuid\)/i);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS app\.approve_account_application\(uuid, uuid, text, uuid\)/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.approve_account_application\(/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.approve_account_application\(uuid, uuid, text, uuid, uuid\) TO service_role/i);
  });

  it("the reconciliation migration drops every obsolete overload", () => {
    const sql = read("20261121000001_reconcile_rpc_overloads.sql");
    for (const signature of [
      "public\\.approve_account_application\\(uuid, uuid, text, uuid\\)",
      "app\\.approve_account_application\\(uuid, uuid, text, uuid\\)",
      "public\\.review_attendance_correction\\(uuid, text, text\\)",
      "app\\.review_attendance_correction\\(uuid, text, text\\)",
      "public\\.review_report\\(uuid, text, text\\)",
      "app\\.review_report\\(uuid, text, text\\)",
    ]) {
      expect(sql, `missing drop for ${signature}`).toMatch(new RegExp(`DROP FUNCTION IF EXISTS ${signature}`, "i"));
    }
  });

  it("the reconciliation migration fails closed when expected signatures are absent", () => {
    const sql = read("20261121000001_reconcile_rpc_overloads.sql");
    for (const signature of [
      "app.approve_account_application(uuid, uuid, text, uuid, uuid)",
      "public.approve_account_application(uuid, uuid, text, uuid, uuid)",
      "app.review_attendance_correction(uuid, text, text, text)",
      "public.review_attendance_correction(uuid, text, text, text)",
      "app.review_report(uuid, integer, text, text, text)",
      "public.review_report(uuid, integer, text, text, text)",
    ]) {
      expect(sql, `missing assertion for ${signature}`).toContain(`'${signature}'`);
    }
    expect(sql).toMatch(/to_regprocedure/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
  });

  it("application call sites use the reconciled argument names", () => {
    const attendance = readFileSync(resolve(root, "src/modules/attendance/actions.ts"), "utf8");
    expect(attendance).toMatch(/rpc\("review_attendance_correction"[\s\S]*?p_effective_classification/);
    const iam = readFileSync(resolve(root, "src/modules/iam/actions.ts"), "utf8");
    expect(iam).toMatch(/rpc\("approve_account_application"[\s\S]*?p_team_id/);
  });
});

describe("idempotency migrations align with rollback", () => {
  it("20261117000001 guards the email outbox business-reference index", () => {
    const sql = read("20261117000001_email_outbox_idempotency.sql");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_email_outbox_business_reference/i);
    expect(sql).toMatch(/duplicate business references/i);
  });

  it("20261118000001 creates the idempotency table guarded and drops old review entry points", () => {
    const sql = read("20261118000001_report_review_command_idempotency.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.report_review_idempotency/i);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.review_report\(uuid, text, text\)/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.review_report\(/i);
  });

  it("the manual rollback restores exactly the pre-migration 3-argument pair", () => {
    const down = readFileSync(
      resolve(root, "supabase/rollback/20261118000001_report_review_command_idempotency_down.sql"),
      "utf8",
    );
    expect(down).toMatch(/DROP FUNCTION IF EXISTS public\.review_report\(uuid, integer, text, text, text\)/i);
    expect(down).toMatch(/CREATE OR REPLACE FUNCTION app\.review_report\(/i);
    expect(down).toMatch(/CREATE OR REPLACE FUNCTION public\.review_report\(/i);
    expect(down).toMatch(/DROP TABLE IF EXISTS public\.report_review_idempotency/i);
  });
});
