/**
 * DX-01 — the Kysely reader may only ever read.
 *
 * Three independent layers have to hold, and this suite pins all three because the app is live:
 *   1. types       — consumers receive `ReadonlyKysely`, where insert/update/delete are
 *                    `@deprecated` KyselyTypeError markers instead of runnable builders;
 *   2. the driver  — a compiled query that is not a SelectQueryNode is rejected before it
 *                    reaches Postgres, so a runtime-cast escape hatch still cannot write;
 *   3. the session — every pooled connection is opened with `default_transaction_read_only = on`,
 *                    so even a hand-written `sql.raw` write is refused by the database itself.
 *
 * The reader also has to stay honest about *where* it connects: SUPABASE_DB_URL is the only
 * source of a connection string, and a missing one must fail closed rather than quietly reuse
 * the service-role HTTP client.
 */

import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readerPath = resolve(process.cwd(), "src/lib/db/reader.ts");
const schemaPath = resolve(process.cwd(), "src/lib/db/schema.ts");

function read(rel: string): string {
  const abs = resolve(process.cwd(), rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}

/** Fake `pg` pool: records every statement and hands back queued rows. */
function createFakePool(results: Array<Array<Record<string, unknown>>> = []) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const queue = [...results];
  const client = {
    processID: 4242,
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      return { command: "SELECT", rowCount: 1, rows: queue.shift() ?? [] };
    },
  };
  return {
    statements,
    pool: {
      options: {} as Record<string, unknown>,
      Client: function Client() {},
      cursor: function Cursor() {},
      connect: async () => ({ ...client, release() {} }),
      end: async () => {},
    },
  };
}

describe("DX-01 — reader module shape", () => {
  it("ships a schema typed from the production catalog and a reader built on it", () => {
    expect(existsSync(schemaPath), "src/lib/db/schema.ts is missing").toBe(true);
    expect(existsSync(readerPath), "src/lib/db/reader.ts is missing").toBe(true);
    const schema = read("src/lib/db/schema.ts");
    // Column names and nullability were taken from information_schema on the live project.
    expect(schema).toContain("next_attempt_at");
    expect(schema).toMatch(/export interface Database/);
    // No `any` in the read model: the whole point of the item.
    expect(schema).not.toMatch(/:\s*any\b/);
  });

  it("exposes only the Kysely read-only facade to consumers", async () => {
    const reader = read("src/lib/db/reader.ts");
    expect(reader).toContain('from "kysely/readonly"');
    expect(reader).toMatch(/ReadonlyKysely<Database>/);
    expect(reader).not.toMatch(/export function getReadOnlyDb\([^)]*\)\s*:\s*Kysely</);
  });

  it("opens every connection in a read-only, UTC, time-boxed session", async () => {
    const { createReadOnlyDb } = await import("@/lib/db/reader");
    const fake = createFakePool();
    const db = createReadOnlyDb({ pool: fake.pool as never, url: "postgresql://x@127.0.0.1:5432/postgres" });
    await db.selectFrom("background_job_runs").select("job_key").execute();
    const text = fake.statements.map((statement) => statement.sql.toLowerCase());
    expect(text.some((sql) => sql.includes("set default_transaction_read_only = on")), text.join("\n")).toBe(true);
    expect(text.some((sql) => sql.includes(`set time zone 'utc'`)), text.join("\n")).toBe(true);
    expect(text.some((sql) => sql.includes("set statement_timeout"))).toBe(true);
    await db.destroy();
  });

  it("refuses a mutation attempted through the driver, even cast through any", async () => {
    const { createReadOnlyDb } = await import("@/lib/db/reader");
    const fake = createFakePool();
    const db = createReadOnlyDb({ pool: fake.pool as never, url: "postgresql://x@127.0.0.1:5432/postgres" });
    const mutator = db as unknown as {
      updateTable: (t: string) => { set: (v: Record<string, unknown>) => { execute: () => Promise<unknown> } };
      deleteFrom: (t: string) => { execute: () => Promise<unknown> };
    };
    await expect(mutator.updateTable("profiles").set({ full_name: "x" }).execute()).rejects.toThrow(/read-only/i);
    await expect(mutator.deleteFrom("profiles").execute()).rejects.toThrow(/read-only/i);
    // Nothing reached Postgres except the session bootstrap.
    expect(fake.statements.every((statement) => /^set /i.test(statement.sql.trim()))).toBe(true);
    await db.destroy();
  });

  it("refuses a raw write smuggled through the sql template tag", async () => {
    const { createReadOnlyDb } = await import("@/lib/db/reader");
    const { sql } = await import("kysely");
    const fake = createFakePool();
    const db = createReadOnlyDb({ pool: fake.pool as never, url: "postgresql://x@127.0.0.1:5432/postgres" });
    await expect(sql`truncate table profiles`.execute(db as never)).rejects.toThrow(/read-only/i);
    await db.destroy();
  });

  it("fails closed without SUPABASE_DB_URL instead of reusing the service-role client", async () => {
    const previous = process.env.SUPABASE_DB_URL;
    delete process.env.SUPABASE_DB_URL;
    const { getReadOnlyDb } = await import("@/lib/db/reader");
    try {
      expect(() => getReadOnlyDb()).toThrow(/SUPABASE_DB_URL/);
    } finally {
      if (previous !== undefined) process.env.SUPABASE_DB_URL = previous;
      vi.resetModules();
    }
  });
});

describe("DX-01 — the reader is a read path, never a write path", () => {
  const consumers = [
    "src/modules/analytics/actions.ts",
    "src/lib/db/analytics-queries.ts",
    "src/app/api/exports/[exportId]/route.ts",
  ];

  it("imports the reader only where the audited read paths live", () => {
    for (const file of consumers) {
      expect(existsSync(resolve(process.cwd(), file)), `${file} is missing`).toBe(true);
    }
    for (const file of consumers) {
      const src = read(file);
      expect(src, `${file} does not use the typed reader`).toMatch(/@\/lib\/db\/reader/);
      expect(src, `${file} builds a mutation on the reader`).not.toMatch(
        /\.(insertInto|updateTable|deleteFrom|mergeInto|replaceInto)\(/,
      );
      expect(src, `${file} smuggles raw DDL/DML`).not.toMatch(
        /sql`[^`]*\b(insert into|update |delete from|truncate|drop |alter )/i,
      );
    }
  });

  it("enters the typed reader only after the role guard has answered", () => {
    const analytics = read("src/modules/analytics/actions.ts");
    const audit = analytics.slice(
      analytics.indexOf("export async function queryAuditLogsAction("),
      analytics.indexOf("export async function", analytics.indexOf("export async function queryAuditLogsAction(") + 10)
    );
    expect(audit.indexOf('await requireRole(["super_admin", "yayasan"]);')).toBeGreaterThan(-1);
    expect(audit.indexOf("fetchAuditLogPage(")).toBeGreaterThan(audit.indexOf("await requireRole("));

    const dashboard = analytics.slice(analytics.indexOf("export async function getAdminDashboardStatsAction("));
    expect(dashboard.indexOf("await requireRole([")).toBeGreaterThan(-1);
    expect(dashboard.indexOf("getReadOnlyDb(")).toBeGreaterThan(dashboard.indexOf("await requireRole(["));
    // Decision D3 stays: the KPI block is still gated by the holders check, not by the reader.
    expect(dashboard).toMatch(/isOperationalDashboardRole|holdsRole\(user, \["pengurus", "yayasan"\]\)/);
  });

  it("types the enum domains it filters on", () => {
    const schema = read("src/lib/db/schema.ts");
    for (const value of ["grace", "dead_letter", "not_reviewed", "in_progress", "submitted"]) {
      expect(schema, `${value} is not part of the typed domains`).toContain(`"${value}"`);
    }
  });

  it("keeps every Server Action mutation on the audited service-role path", () => {
    // The zero-trust write path must not silently move to raw SQL.
    const analytics = read("src/modules/analytics/actions.ts");
    expect(analytics).toContain('await supabase.from("export_logs").insert(');
    expect(analytics).toContain('await supabase.from("audit_logs").insert(');
    const route = read("src/app/api/exports/[exportId]/route.ts");
    expect(route).toContain('supabase.from("export_logs").update({ row_count: rows.length })');
  });

  it("leaves the legacy reports reads untouched in this item", () => {
    const reports = read("src/modules/reports/actions.ts");
    // getMyReportHistoryAction / getReviewQueueAction keep their PostgREST embedded-resource
    // ordering and the RVS-01 pin; migrating them is a separate scope (see the DX-01 report).
    expect(reports).toContain('from("reviewer_assignments")');
    expect(reports).not.toMatch(/@\/lib\/db\/reader/);
  });
});
