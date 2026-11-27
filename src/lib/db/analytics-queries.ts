import { sql } from "kysely";
import { countInt, countIntOver, jsonMaxText, jsonText } from "@/lib/db/expressions";
import type { ReadOnlyDb } from "@/lib/db/reader";

/**
 * DX-01 — the analytics reads that used to be a scatter of PostgREST count requests.
 *
 * Each function replaces several round-trips with one statement, and each keeps the predicates the
 * HTTP path applied (`status`, `member_type`, the WIB date, the team scope, the four search columns)
 * so the numbers on the Admin Overview card and the rows in the audit explorer do not move. Nothing
 * here decides permission: the caller's `requireRole()` / `holdsRole()` guard has already answered,
 * and the reader itself cannot write.
 *
 * Values are always bound (`$1`, `$2`, …), never interpolated, so the search term and the date carry
 * the same injection safety PostgREST gave for free.
 */

/** The unscoped audit view: every actor, not one team. */
export const ORG_SCOPE = "Semua Tim (Organisasi)";

export interface SystemHealthCounts {
  activeUsersCount: number;
  pendingOutbox: number;
  deadLetterOutbox: number;
  deadLetterEmail: number;
  failedCronRuns: number;
  pendingAccountRequests: number;
  /** JSON text of the newest ledger success, or null while no job has ever completed. */
  lastWorkerTick: string | null;
}

export interface OperationalCounts {
  totalSantri: number;
  todayCheckedIn: number;
  todayLate: number;
  pendingReports: number;
  approvedReports: number;
  activeTasks: number;
}

export interface AuditLogRow {
  id: string;
  event_name: string;
  actor_name: string;
  target_label: string | null;
  action_detail: string;
  hash: string | null;
  /** Postgres-rendered ISO-8601 text, identical to what PostgREST returned. */
  created_at: string;
  /** Total rows behind the filter (window count), so one statement answers page + hasMore. */
  total_count: number;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  totalCount: number;
}

export interface AuditLogPageQuery {
  scope: string;
  query: string;
  page: number;
  pageSize: number;
}

export type ComplianceStatus = "all" | "compliant" | "attention";
export interface ComplianceCenterQuery {
  dateFrom?: string | null;
  dateTo?: string | null;
  actor?: string;
  actionType?: string;
  entityType?: string;
  complianceStatus?: ComplianceStatus;
  page?: number;
  pageSize?: number;
}
export interface ComplianceCenterRow extends AuditLogRow {
  actor_id: string | null;
  target_id: string | null;
  compliance_status: "compliant" | "attention";
}
export interface ComplianceCenterPage { rows: ComplianceCenterRow[]; totalCount: number; }

/**
 * The old `.or("event_name.ilike.%q%,…")` sent the term inside a PostgREST expression, so `,` `(` `)`
 * were stripped (they delimit/syntax the filter list) and `*` was rendered as the LIKE wildcard.
 * Keeping that behaviour verbatim is the point: a transport migration must not quietly redefine what
 * a search matches. `%` stayed live for the same reason.
 */
export function normalizeIlikeTerm(raw: string): string {
  return raw.replace(/[,()]/g, "").replace(/\*/g, "%").trim();
}

/**
 * Decision D3 metrics for super_admin. Seven head-count requests, one scalar-subquery select: the
 * counters stay independent aggregates, so an empty table is 0 and never a missing field.
 */
export async function fetchSystemHealth(db: ReadOnlyDb): Promise<SystemHealthCounts> {
  const row = await db
    .selectNoFrom((eb) => [
      eb
        .selectFrom("profiles")
        .where("status", "=", "active")
        .select(countInt().as("c"))
        .as("active_users_count"),
      eb
        .selectFrom("notification_push_outbox")
        .where("status", "=", "pending")
        .select(countInt().as("c"))
        .as("pending_outbox"),
      eb
        .selectFrom("notification_push_outbox")
        .where("status", "=", "dead_letter")
        .select(countInt().as("c"))
        .as("dead_letter_outbox"),
      eb
        .selectFrom("email_outbox")
        .where("status", "=", "failed")
        .select(countInt().as("c"))
        .as("dead_letter_email"),
      eb
        .selectFrom("cron_job_runs")
        .where("status", "=", "failed")
        .select(countInt().as("c"))
        .as("failed_cron_runs"),
      eb
        .selectFrom("account_requests")
        .where("status", "=", "pending")
        .select(countInt().as("c"))
        .as("pending_account_requests"),
      eb
        .selectFrom("background_job_runs")
        .select(jsonMaxText("background_job_runs.last_success_at").as("c"))
        .as("last_worker_tick"),
    ])
    .executeTakeFirstOrThrow();

  return {
    // A scalar subquery is nullable as a type even though COUNT(*) always answers a row: the ?? 0 is
    // the same guard the old `count || 0` applied to a missing REST count.
    activeUsersCount: row.active_users_count ?? 0,
    pendingOutbox: row.pending_outbox ?? 0,
    deadLetterOutbox: row.dead_letter_outbox ?? 0,
    deadLetterEmail: row.dead_letter_email ?? 0,
    failedCronRuns: row.failed_cron_runs ?? 0,
    pendingAccountRequests: row.pending_account_requests ?? 0,
    lastWorkerTick: row.last_worker_tick,
  };
}

/**
 * The operational KPI strip. `today` is the WIB date the caller already computed with
 * `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })` — the database is pinned to UTC by the
 * reader, so the calendar day stays a bound `date` value rather than a `now()`-derived guess.
 */
export async function fetchOperationalCounts(db: ReadOnlyDb, today: string): Promise<OperationalCounts> {
  const row = await db
    .selectNoFrom((eb) => [
      eb
        .selectFrom("profiles")
        .where("member_type", "=", "santri")
        // Descriptive only: this counts santri, it does not grant anything (PERMISSIONS.md).
        .where("status", "=", "active")
        .select(countInt().as("c"))
        .as("total_santri"),
      eb
        .selectFrom("attendance_records")
        .where("attendance_date", "=", today)
        .select(countInt().as("c"))
        .as("today_checked_in"),
      eb
        .selectFrom("attendance_records")
        .where("attendance_date", "=", today)
        .where("classification", "=", "late")
        .select(countInt().as("c"))
        .as("today_late"),
      eb
        .selectFrom("daily_reports")
        .where("submission_status", "=", "submitted")
        .where("review_status", "in", ["not_reviewed", "under_review"])
        .select(countInt().as("c"))
        .as("pending_reports"),
      eb
        .selectFrom("daily_reports")
        .where("submission_status", "=", "submitted")
        .where("review_status", "=", "approved")
        .select(countInt().as("c"))
        .as("approved_reports"),
      eb
        .selectFrom("tasks")
        .where("status", "in", ["todo", "in_progress", "in_review"])
        .where("deleted_at", "is", null)
        .select(countInt().as("c"))
        .as("active_tasks"),
    ])
    .executeTakeFirstOrThrow();

  return {
    totalSantri: row.total_santri ?? 0,
    todayCheckedIn: row.today_checked_in ?? 0,
    todayLate: row.today_late ?? 0,
    pendingReports: row.pending_reports ?? 0,
    approvedReports: row.approved_reports ?? 0,
    activeTasks: row.active_tasks ?? 0,
  };
}

/**
 * One page of the audit explorer plus the exact size of the whole filtered set.
 *
 * A team scope used to fetch every profile id of that team and then send them back as
 * `actor_id=in.(…)` — an unbounded URL and a second query. It is now a single EXISTS, so the page
 * costs one statement regardless of how large the team is.
 *
 * `ORDER BY created_at DESC` alone could repeat or skip a row when two logs share a timestamp, so the
 * id is the tie-break; `cast(count(*) over () as int)` carries the total without a second round-trip,
 * which also means an off-the-end page reports a total of 0 — the same `hasMore: false` the old early
 * return for an empty page produced.
 */
export async function fetchAuditLogPage(db: ReadOnlyDb, input: AuditLogPageQuery): Promise<AuditLogPage> {
  const pageSize = Math.max(1, Math.floor(input.pageSize));
  const safePage = Math.max(1, Math.floor(input.page));
  const term = normalizeIlikeTerm(input.query);
  const pattern = `%${term}%`;

  const rows = await db
    .selectFrom("audit_logs")
    .select([
      "audit_logs.id",
      "audit_logs.event_name",
      "audit_logs.actor_name",
      "audit_logs.target_label",
      "audit_logs.action_detail",
      "audit_logs.hash",
      jsonText("audit_logs.created_at").as("created_at"),
      countIntOver().as("total_count"),
    ])
    // One EXISTS instead of a fetched actor_id list: same team semantics, bounded cost.
    .$if(input.scope !== ORG_SCOPE, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom("profiles")
            .whereRef("profiles.id", "=", "audit_logs.actor_id")
            .where("profiles.team_name", "=", input.scope)
            .select(sql`1`.as("one")),
        ),
      ),
    )
    .$if(term.length > 0, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb("event_name", "ilike", pattern),
          eb("actor_name", "ilike", pattern),
          eb("target_label", "ilike", pattern),
          eb("action_detail", "ilike", pattern),
        ]),
      ),
    )
    // Qualified: an unqualified ORDER BY name would resolve to the created_at *alias*, sorting the
    // page by ISO text instead of by the instant.
    .orderBy("audit_logs.created_at", "desc")
    .orderBy("audit_logs.id", "desc")
    .limit(pageSize)
    .offset((safePage - 1) * pageSize)
    .execute();

  return { rows, totalCount: rows.length > 0 ? rows[0].total_count : 0 };
}

/** Wave 6.2 read-only compliance search with PostgreSQL-owned WIB boundaries. */
export async function fetchComplianceCenterPage(db: ReadOnlyDb, input: ComplianceCenterQuery): Promise<ComplianceCenterPage> {
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const actor = normalizeIlikeTerm(input.actor ?? "");
  const actionType = normalizeIlikeTerm(input.actionType ?? "");
  const entityType = normalizeIlikeTerm(input.entityType ?? "");
  const attention = sql<boolean>`audit_logs.event_name ILIKE '%failed%' OR audit_logs.event_name ILIKE '%error%' OR audit_logs.event_name ILIKE '%rejected%' OR audit_logs.event_name ILIKE '%late%' OR audit_logs.event_name ILIKE '%overdue%' OR audit_logs.event_name ILIKE '%denied%'`;
  const rows = await db.selectFrom("audit_logs").select([
    "audit_logs.id", "audit_logs.event_name", "audit_logs.actor_id", "audit_logs.actor_name", "audit_logs.target_id", "audit_logs.target_label", "audit_logs.action_detail", "audit_logs.hash",
    jsonText("audit_logs.created_at").as("created_at"),
    sql<"compliant" | "attention">`CASE WHEN ${attention} THEN 'attention' ELSE 'compliant' END`.as("compliance_status"),
    countIntOver().as("total_count"),
  ])
    .$if(Boolean(input.dateFrom), (qb) => qb.where(sql<boolean>`audit_logs.created_at >= (${input.dateFrom!}::date AT TIME ZONE 'Asia/Jakarta')`))
    .$if(Boolean(input.dateTo), (qb) => qb.where(sql<boolean>`audit_logs.created_at < ((${input.dateTo!}::date + 1) AT TIME ZONE 'Asia/Jakarta')`))
    .$if(actor.length > 0, (qb) => qb.where("audit_logs.actor_name", "ilike", `%${actor}%`))
    .$if(actionType.length > 0, (qb) => qb.where("audit_logs.event_name", "ilike", `%${actionType}%`))
    .$if(entityType.length > 0, (qb) => qb.where((eb) => eb.or([eb("audit_logs.target_label", "ilike", `%${entityType}%`), eb("audit_logs.event_name", "ilike", `%${entityType}%`)])))
    .$if(input.complianceStatus === "attention", (qb) => qb.where(attention))
    .$if(input.complianceStatus === "compliant", (qb) => qb.where(sql<boolean>`NOT (${attention})`))
    .orderBy("audit_logs.created_at", "desc").orderBy("audit_logs.id", "desc")
    .limit(pageSize).offset((page - 1) * pageSize).execute();
  return { rows, totalCount: rows.length ? rows[0].total_count : 0 };
}
