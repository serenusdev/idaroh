/**
 * DX-01 — the migrated analytics reads return what the PostgREST reads returned.
 *
 * Two properties are pinned per query, because the item replaces a transport, not a policy:
 *   - shape:  one round-trip replaces N, and the returned object keeps the field names the
 *             Admin Overview card and the audit explorer already consume;
 *   - scope:  the predicates survive verbatim (`status`, `member_type`, the WIB date, the team
 *             EXISTS instead of an unbounded actor_id list, the four ilike columns) and arrive as
 *             *bound parameters*, never interpolated text.
 *
 * Timestamps are rendered by Postgres (`to_jsonb(col) #>> '{}'`) rather than by the `pg` driver,
 * so `created_at` / `last_success_at` keep the exact ISO-8601-with-offset text PostgREST produced.
 * `pg` would hand back a JS Date and lose sub-millisecond precision in the CSV export.
 */

import { describe, expect, it } from "vitest";
import { createFakePool, flat } from "./helpers/pg-fake-pool";

async function loadReader() {
  const { createReadOnlyDb } = await import("@/lib/db/reader");
  const queries = await import("@/lib/db/analytics-queries");
  return { createReadOnlyDb, ...queries };
}

describe("DX-01 — system health aggregates", () => {
  it("replaces seven head-count requests with one bound select", async () => {
    const { createReadOnlyDb, fetchSystemHealth } = await loadReader();
    const fake = createFakePool({}, [
      [
        {
          active_users_count: 7,
          pending_outbox: 3,
          dead_letter_outbox: 1,
          dead_letter_email: 2,
          failed_cron_runs: 4,
          pending_account_requests: 5,
          last_worker_tick: "2026-11-27T05:36:56.123456+00:00",
        },
      ],
    ]);
    const db = createReadOnlyDb({ pool: fake.pool as never, url: "postgresql://x@127.0.0.1:5432/db" });

    const counts = await fetchSystemHealth(db);
    const selects = fake.selects();
    expect(selects, "the health block still needs more than one query").toHaveLength(1);

    const sqlText = flat(selects[0]);
    expect(sqlText).toContain('from "profiles"');
    expect(sqlText).toContain('from "account_requests"');
    expect(sqlText).toContain('from "email_outbox"');
    expect(sqlText).toContain('from "cron_job_runs"');
    expect((sqlText.match(/from "notification_push_outbox"/g) || []).length).toBe(2);
    // MAX over the ledger, rendered as JSON text: no ORDER BY/LIMIT, so no extra bound parameter.
    expect(sqlText).toContain('to_jsonb(max("background_job_runs"."last_success_at")) #>> \'{}\'');
    // count() is bigint; the cast keeps it a JS number without a TS lie.
    expect(sqlText).toContain("count(*)::int");
    expect(selects[0].params).toEqual([
      "active",
      "pending",
      "dead_letter",
      "failed",
      "failed",
      "pending",
    ]);

    expect(counts).toEqual({
      activeUsersCount: 7,
      pendingOutbox: 3,
      deadLetterOutbox: 1,
      deadLetterEmail: 2,
      failedCronRuns: 4,
      pendingAccountRequests: 5,
      lastWorkerTick: "2026-11-27T05:36:56.123456+00:00",
    });
    await db.destroy();
  });

  it("reports a never-ticked worker as null, not as a zero", async () => {
    const { createReadOnlyDb, fetchSystemHealth } = await loadReader();
    const fake = createFakePool({}, [[{
      active_users_count: 0,
      pending_outbox: 0,
      dead_letter_outbox: 0,
      dead_letter_email: 0,
      failed_cron_runs: 0,
      pending_account_requests: 0,
      last_worker_tick: null,
    }]]);
    const db = createReadOnlyDb({ pool: fake.pool as never, url: "postgresql://x@127.0.0.1:5432/db" });
    const counts = await fetchSystemHealth(db);
    expect(counts.lastWorkerTick).toBeNull();
    expect(counts.activeUsersCount).toBe(0);
    await db.destroy();
  });
});

describe("DX-01 — operational KPI counts", () => {
  it("keeps every predicate and the WIB date when folding six counts into one query", async () => {
    const { createReadOnlyDb, fetchOperationalCounts } = await loadReader();
    const fake = createFakePool({}, [[{
      total_santri: 38,
      today_checked_in: 36,
      today_late: 1,
      pending_reports: 6,
      approved_reports: 30,
      active_tasks: 0,
    }]]);
    const db = createReadOnlyDb({ pool: fake.pool as never, url: "postgresql://x@127.0.0.1:5432/db" });
    const today = "2026-11-27";

    const counts = await fetchOperationalCounts(db, today);
    const selects = fake.selects();
    expect(selects).toHaveLength(1);
    const sqlText = flat(selects[0]);
    for (const table of ["profiles", "attendance_records", "daily_reports", "tasks"]) {
      expect(sqlText, `the ${table} KPI disappeared`).toContain(`from "${table}"`);
    }
    expect(sqlText).toContain('"member_type" = $1');
    expect(sqlText).toContain('"attendance_date" =');
    expect(sqlText).toContain('"classification" =');
    expect(sqlText).toContain('"submission_status" =');
    expect(sqlText).toContain('"review_status" in (');
    // Soft-deleted tasks stay out of the active count, exactly as the .is("deleted_at", null) did.
    expect(sqlText).toContain('"deleted_at" is null');
    // The WIB date is bound twice (all check-ins, late check-ins) and interpolated never.
    expect(selects[0].params.filter((value) => value === today)).toHaveLength(2);
    expect(selects[0].params).toContain("santri");
    expect(selects[0].params).toContain("late");
    for (const status of ["not_reviewed", "under_review", "approved", "todo", "in_progress", "in_review"]) {
      expect(selects[0].params, `${status} dropped from the bound parameters`).toContain(status);
    }
    expect(sqlText).not.toContain("2026-11-27");

    expect(counts).toEqual({
      totalSantri: 38,
      todayCheckedIn: 36,
      todayLate: 1,
      pendingReports: 6,
      approvedReports: 30,
      activeTasks: 0,
    });
    await db.destroy();
  });
});

describe("DX-01 — audit explorer page", () => {
  const logRow = {
    id: "l1",
    event_name: "attendance.correction_approved",
    actor_name: "Ustadz",
    target_label: null,
    action_detail: null,
    hash: null,
    created_at: "2026-11-27T01:02:03.456789+00:00",
    total_count: 3,
  };

  it("scopes a team with EXISTS instead of an unbounded actor_id list, in one round-trip", async () => {
    const { createReadOnlyDb, fetchAuditLogPage, ORG_SCOPE } = await loadReader();
    expect(ORG_SCOPE).toBe("Semua Tim (Organisasi)");

    const fake = createFakePool({ audit_logs: [logRow] });
    const db = createReadOnlyDb({ pool: fake.pool as never, url: "postgresql://x@127.0.0.1:5432/db" });
    const page = await fetchAuditLogPage(db, {
      scope: "Cabang 3",
      query: "",
      page: 3,
      pageSize: 20,
    });

    // The old action first fetched every profile id of the team, then filtered.
    const selects = fake.selects();
    expect(selects).toHaveLength(1);
    const sqlText = flat(selects[0]);
    expect(sqlText).toContain("exists (select");
    expect(sqlText).toContain('"profiles"."team_name" = $1');
    expect(sqlText).toContain('"profiles"."id" = "audit_logs"."actor_id"');
    expect(sqlText).not.toContain('"actor_id" in (');
    // Window count narrowed in the database. `count(*)::int over ()` is a Postgres syntax error (the
    // cast binds before OVER can attach), so the cast wraps the window expression instead.
    expect(sqlText).toContain("cast(count(*) over () as int)");
    expect(sqlText).not.toContain("::int over");
    expect(sqlText).toContain('to_jsonb("audit_logs"."created_at") #>> \'{}\'');
    // Newest first, by the column rather than the same-named ISO-text alias, with a stable tie-break
    // so a page cannot repeat or skip a row.
    expect(sqlText).toContain('order by "audit_logs"."created_at" desc, "audit_logs"."id" desc');
    expect(selects[0].params).toEqual(["Cabang 3", 20, 40]);
    expect(page.totalCount).toBe(3);
    expect(page.rows[0].id).toBe("l1");
    expect(page.rows[0].created_at).toBe("2026-11-27T01:02:03.456789+00:00");
    await db.destroy();
  });

  it("searches the same four columns as the PostgREST .or() and drops the org scope clause", async () => {
    const { createReadOnlyDb, fetchAuditLogPage } = await loadReader();
    const fake = createFakePool({ audit_logs: [logRow] });
    const db = createReadOnlyDb({ pool: fake.pool as never, url: "postgresql://x@127.0.0.1:5432/db" });
    const page = await fetchAuditLogPage(db, {
      scope: "Semua Tim (Organisasi)",
      query: "koreksi",
      page: 1,
      pageSize: 50,
    });
    const selects = fake.selects();
    const sqlText = flat(selects[0]);
    for (const column of ["event_name", "actor_name", "target_label", "action_detail"]) {
      expect(sqlText, `${column} left the search` ).toContain(`"${column}" ilike $`);
    }
    expect(sqlText).not.toContain('"profiles"');
    expect(selects[0].params).toEqual(["%koreksi%", "%koreksi%", "%koreksi%", "%koreksi%", 50, 0]);
    expect(page.totalCount).toBe(3);
    await db.destroy();
  });

  it("keeps the PostgREST filter semantics for a search term", async () => {
    const { normalizeIlikeTerm } = await loadReader();
    // PostgREST splits .or() members on commas and treats ( ) as syntax, so they were stripped.
    expect(normalizeIlikeTerm(" review, koreksi (manual) ")).toBe("review koreksi manual");
    // PostgREST renders * as the LIKE wildcard and leaves % untouched: parity keeps both quirks,
    // it does not quietly "fix" them inside a transport migration.
    expect(normalizeIlikeTerm("a*b")).toBe("a%b");
    expect(normalizeIlikeTerm("100%")).toBe("100%");
    expect(normalizeIlikeTerm("   ")).toBe("");
  });
});
