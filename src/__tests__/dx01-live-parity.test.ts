/**
 * DX-01 — live parity between the PostgREST read it replaces and the Kysely read that replaces it.
 *
 * The unit suites prove the emitted SQL and its bound parameters. Only a real Postgres can prove
 * the two transports agree on the things that are easy to get silently wrong:
 *   - timestamptz text (`pg` would hand back a JS Date and lose microseconds in the CSV export),
 *   - `cast(count(*) over () as int)` versus PostgREST's `Content-Range` total,
 *   - the team EXISTS rewrite versus the old "fetch every profile id, then IN (...)" filter,
 *   - the `*` wildcard PostgREST expands inside an ilike pattern,
 *   - the aggregate head-counts the Admin Overview card shows.
 *
 * It therefore runs only where a database is reachable: the CI `database-integration` job exports
 * DX01_DB_URL for the disposable Supabase, and the step is placed after `npm run e2e:seed` because
 * the team scoping check needs a real profile row. Without those variables the suite skips.
 *
 * The fixture rows carry a run-unique marker, and the audit ledger is NOT deleted afterwards:
 * `trg_audit_logs_append_only` is a BEFORE DELETE OR UPDATE trigger, so a delete is not merely
 * inconvenient, it is refused by the database — which is the guarantee this item must not weaken to
 * keep a test tidy. The instance is disposable, so the marked rows leave with it. Everything written
 * outside `audit_logs` (the team label, the attendance rows) is undone in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DX01_DB_URL ?? "";
const REST_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const LIVE = Boolean(DB_URL && REST_URL && SERVICE_KEY);

// Unique per run so a re-run on the same instance can never read another run's fixture: the audit
// rows themselves are kept, because the ledger refuses to delete them.
const RUN_TAG = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
  : `${process.pid}-${Date.now().toString(36)}`;
const MARKER = `DX01-PARITY-${RUN_TAG}`;
const TEAM = "DX01 Parity Team";
const AUDIT_COLUMNS = "id,event_name,actor_name,target_label,action_detail,hash,created_at";

type Row = Record<string, unknown>;

const { getReadOnlyDb } = await import("@/lib/db/reader");
const { ORG_SCOPE, fetchAuditLogPage, fetchOperationalCounts, fetchSystemHealth } = await import(
  "@/lib/db/analytics-queries"
);

async function rest(path: string, init: RequestInit = {}): Promise<{ body: Row[]; count: number | null }> {
  const response = await fetch(`${REST_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed (${response.status}): ${text}`);
  }
  const range = response.headers.get("content-range");
  const total = range && range.includes("/") ? Number(range.split("/")[1]) : NaN;
  return { body: text ? (JSON.parse(text) as Row[]) : [], count: Number.isNaN(total) ? null : total };
}

/** PostgREST exact head count, the mechanism every migrated query is compared against. */
async function restCount(table: string, filter: string): Promise<number> {
  // select=* because several migrated relations have no id column (cron_job_runs,
  // notification_push_outbox, background_job_runs); the count is what is compared, not the rows.
  const { count } = await rest(`${table}?select=*&${filter}`, {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  if (count === null) throw new Error(`no exact count for ${table} ${filter}`);
  return count;
}

async function restRows(path: string): Promise<Row[]> {
  return (await rest(path)).body;
}

let db: ReturnType<typeof getReadOnlyDb> | null = null;
let actorId: string | null = null;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

beforeAll(async () => {
  if (!LIVE) return;
  db = getReadOnlyDb();

  const email = process.env.E2E_EMAIL;
  if (email) {
    const profiles = await restRows(`profiles?select=id&email=eq.${encodeURIComponent(email)}&limit=1`);
    const profile = profiles[0];
    if (profile?.id) {
      actorId = String(profile.id);
      await rest(`profiles?id=eq.${actorId}`, {
        method: "PATCH",
        body: JSON.stringify({ team_name: TEAM }),
      });
    }
  }

  await rest("audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([
      {
        event_name: `${MARKER}-alpha`,
        actor_id: actorId,
        actor_name: `${MARKER} actor`,
        target_label: null,
        action_detail: `${MARKER} detail`,
        hash: null,
        created_at: "2026-11-27T01:02:03.456789+00:00",
      },
      {
        event_name: `${MARKER}-alpha-x`,
        actor_id: null,
        actor_name: `${MARKER} actor`,
        target_label: "target",
        action_detail: `${MARKER} detail`,
        hash: "sha256:parity",
        created_at: "2026-11-27T01:02:03.456789+00:00",
      },
      {
        event_name: `${MARKER}-beta`,
        actor_id: actorId,
        actor_name: `${MARKER} actor`,
        target_label: "label",
        action_detail: `${MARKER} detail`,
        hash: null,
        created_at: "2026-11-26T23:59:59.000123+00:00",
      },
    ]),
  });

  if (actorId) {
    await rest("attendance_records", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        { user_id: actorId, attendance_date: today, classification: "late" },
        { user_id: actorId, attendance_date: "2026-11-20", classification: "on_time" },
      ]),
    });
  }
});

afterAll(async () => {
  if (!LIVE) return;
  // No audit_logs DELETE here: trg_audit_logs_append_only rejects it, and the run-unique marker means
  // the leftovers cannot be mistaken for another run's fixture. The disposable instance drops them.
  if (actorId) {
    await rest(`attendance_records?user_id=eq.${actorId}&attendance_date=gte.2026-11-20`, { method: "DELETE" });
    await rest(`profiles?id=eq.${actorId}`, {
      method: "PATCH",
      body: JSON.stringify({ team_name: null }),
    });
  }
  await db?.destroy();
  db = null;
});

/** Id set of a page, so both transports compare the same rows regardless of their row types. */
const idsOf = <T>(rows: readonly T[], pick: (row: T) => unknown) =>
  rows.map((row) => String(pick(row))).sort();

describe.skipIf(!LIVE)("DX-01 live parity against PostgREST", () => {
  it("reads the same rows and the same timestamptz text as the REST select", async () => {
    const viaRest = await restRows(
      `audit_logs?select=${AUDIT_COLUMNS}&action_detail=eq.${encodeURIComponent(`${MARKER} detail`)}&order=created_at.desc,id.desc`
    );
    const page = await fetchAuditLogPage(db!, {
      scope: ORG_SCOPE,
      query: MARKER,
      page: 1,
      pageSize: 50,
    });
    const typed = page.rows.filter((row) => String(row.event_name).startsWith(MARKER));

    expect(viaRest.length).toBe(3);
    expect(idsOf(typed, (row) => row.id)).toEqual(idsOf(viaRest, (row) => row.id));
    // The exact JSON text PostgREST produced, microseconds included — not a Date round-trip.
    expect(typed.map((row) => row.created_at).sort()).toEqual(
      viaRest.map((row) => String(row.created_at)).sort(),
    );
    expect(typed.map((row) => row.hash).sort()).toEqual(viaRest.map((row) => row.hash).sort());
    expect(typed.map((row) => row.target_label).sort()).toEqual(
      viaRest.map((row) => row.target_label).sort(),
    );
  });

  it("counts the filtered total the way Content-Range did", async () => {
    const exact = await restCount("audit_logs", `action_detail=eq.${encodeURIComponent(`${MARKER} detail`)}`);
    const page = await fetchAuditLogPage(db!, { scope: ORG_SCOPE, query: MARKER, page: 1, pageSize: 50 });
    expect(page.totalCount).toBeGreaterThanOrEqual(exact);
    // Same filter, same number: the window count must equal PostgREST's exact count.
    const sameFilter = await fetchAuditLogPage(db!, {
      scope: ORG_SCOPE,
      query: `${MARKER} detail`,
      page: 1,
      pageSize: 50,
    });
    expect(sameFilter.totalCount).toBe(exact);
  });

  it("expands the * wildcard exactly like the PostgREST ilike filter", async () => {
    const term = `${MARKER}-alpha*`;
    const viaRest = await restRows(
      `audit_logs?select=id&action_detail=eq.${encodeURIComponent(`${MARKER} detail`)}&or=(event_name.ilike.%${term}%,actor_name.ilike.%${term}%,target_label.ilike.%${term}%,action_detail.ilike.%${term}%)`
    );
    const page = await fetchAuditLogPage(db!, { scope: ORG_SCOPE, query: term, page: 1, pageSize: 50 });
    const typed = page.rows.filter((row) => String(row.action_detail) === `${MARKER} detail`);
    expect(idsOf(typed, (row) => row.id)).toEqual(idsOf(viaRest, (row) => row.id));
  });

  it("scopes a team with EXISTS to the same rows the actor_id list selected", async () => {
    expect(actorId, "the E2E profile is required for the team scope check").toBeTruthy();
    const teamMembers = await restRows(`profiles?select=id&team_name=eq.${encodeURIComponent(TEAM)}`);
    const memberIds = teamMembers.map((member) => String(member.id));
    const viaRest = await restRows(
      `audit_logs?select=${AUDIT_COLUMNS}&action_detail=eq.${encodeURIComponent(`${MARKER} detail`)}&actor_id=in.(${memberIds.join(",")})`
    );
    const page = await fetchAuditLogPage(db!, { scope: TEAM, query: MARKER, page: 1, pageSize: 50 });
    const typed = page.rows.filter((row) => String(row.event_name).startsWith(MARKER));
    expect(typed.length).toBeGreaterThan(0);
    expect(idsOf(typed, (row) => row.id)).toEqual(idsOf(viaRest, (row) => row.id));
  });

  it("aggregates the operational KPIs to the same numbers as the head counts", async () => {
    const counts = await fetchOperationalCounts(db!, today);
    expect(counts.totalSantri).toBe(await restCount("profiles", "member_type=eq.santri&status=eq.active"));
    expect(counts.todayCheckedIn).toBe(await restCount("attendance_records", `attendance_date=eq.${today}`));
    expect(counts.todayLate).toBe(
      await restCount("attendance_records", `attendance_date=eq.${today}&classification=eq.late`)
    );
    expect(counts.pendingReports).toBe(
      await restCount(
        "daily_reports",
        "submission_status=eq.submitted&review_status=in.(not_reviewed,under_review)"
      )
    );
    expect(counts.approvedReports).toBe(
      await restCount("daily_reports", "submission_status=eq.submitted&review_status=eq.approved")
    );
    expect(counts.activeTasks).toBe(
      await restCount("tasks", "status=in.(todo,in_progress,in_review)&deleted_at=is.null")
    );
  });

  it("aggregates the system-health numbers to the same values as the head counts", async () => {
    const health = await fetchSystemHealth(db!);
    expect(health.activeUsersCount).toBe(await restCount("profiles", "status=eq.active"));
    expect(health.pendingOutbox).toBe(await restCount("notification_push_outbox", "status=eq.pending"));
    expect(health.deadLetterOutbox).toBe(await restCount("notification_push_outbox", "status=eq.dead_letter"));
    expect(health.deadLetterEmail).toBe(await restCount("email_outbox", "status=eq.failed"));
    expect(health.failedCronRuns).toBe(await restCount("cron_job_runs", "status=eq.failed"));
    expect(health.pendingAccountRequests).toBe(await restCount("account_requests", "status=eq.pending"));

    const viaRest = await restRows(
      "background_job_runs?select=last_success_at&last_success_at=not.is.null&order=last_success_at.desc&limit=1"
    );
    expect(health.lastWorkerTick).toBe(viaRest[0] ? String(viaRest[0].last_success_at) : null);
  });
});

describe.skipIf(LIVE)("DX-01 live parity", () => {
  it("skips rather than pretending when no database is reachable", () => {
    expect(LIVE).toBe(false);
    expect(ORG_SCOPE).toBe("Semua Tim (Organisasi)");
  });
});
