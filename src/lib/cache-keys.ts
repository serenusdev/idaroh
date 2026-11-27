import type { QueryClient } from "@tanstack/react-query";
import type { UserProfile } from "@/lib/auth/types";

export type CacheSession = Pick<UserProfile, "id" | "role">;

/**
 * Query keys for every surface migrated in CACHE-01 (Batch 1: tugas + jadwal, Batch 2: kehadiran,
 * laporan, review, beranda, Batch 3: resources, directory, dan seluruh halaman /admin/*).
 *
 * Every key is `[<surface>:<session id>, <active role>]`. TanStack matches keys element by
 * element, so the id keeps one browser from serving another account's rows and the role is
 * part of the identity because a multi-role user sees a different row set per active role
 * (PERMISSIONS.md D3). The surface names are the ones the retired manual hook already used, so a
 * cache entry is still greppable.
 */
export const cacheKeys = {
  tasks: (session: CacheSession) => [`tasks:list:${session.id}`, session.role] as const,
  projects: (session: CacheSession) => [`tasks:projects:${session.id}`, session.role] as const,
  events: (session: CacheSession) => [`events:${session.id}`, session.role] as const,
  announcements: (session: CacheSession) => [`announcements:${session.id}`, session.role] as const,
  adminEvents: (session: CacheSession) => [`admin:events:${session.id}`, session.role] as const,
  adminAnnouncements: (session: CacheSession) => [`admin:announcements:${session.id}`, session.role] as const,
  audience: (session: CacheSession) => [`event-audience:${session.id}`, session.role] as const,
  attendance: (session: CacheSession) => [`attendance:history:${session.id}`, session.role] as const,
  // The policy row is organisation-wide, but the CACHE-01 rule is that every key carries the
  // reading session: getActivePolicyAction() answers through the caller's RLS visibility.
  policy: (session: CacheSession) => [`policy:active:${session.id}`, session.role] as const,
  reportsToday: (session: CacheSession) => [`reports:today:${session.id}`, session.role] as const,
  reportCategories: (session: CacheSession) => [`reports:categories:${session.id}`, session.role] as const,
  /**
   * `reports:history:<uid>:<version>:<cursor>` becomes a four-slot key. The version stays inside
   * the identity on purpose: /laporan bumps it after a save so a read that started before the save
   * settles on the old key instead of overwriting the refreshed page.
   */
  reportsHistory: (session: CacheSession, version: number, before?: string | null) =>
    [`reports:history:${session.id}`, session.role, String(version), before ?? "latest"] as const,
  reviewQueue: (session: CacheSession) => [`review:queue:${session.id}`, session.role] as const,
  dashboard: (session: CacheSession) => [`admin:dashboard-stats:${session.id}`, session.role] as const,
  // Batch 3 — the admin and directory surfaces. The legacy Map keyed these as global strings
  // (`people:list`, `teams:structure`, `admin:active-users`), so two accounts in one browser shared
  // one entry until a reload; the session slot is what closes that here.
  resourceCategories: (session: CacheSession) => [`resources:categories:${session.id}`, session.role] as const,
  resourceStats: (session: CacheSession) => [`resources:stats:${session.id}`, session.role] as const,
  resourceFavorites: (session: CacheSession) => [`resources:favorites:${session.id}`, session.role] as const,
  adminResources: (session: CacheSession) => [`admin:resources-list:${session.id}`, session.role] as const,
  adminResourceCategories: (session: CacheSession) => [`admin:resource-categories:${session.id}`, session.role] as const,
  people: (session: CacheSession) => [`people:list:${session.id}`, session.role] as const,
  teams: (session: CacheSession) => [`teams:structure:${session.id}`, session.role] as const,
  accountRequests: (session: CacheSession) => [`admin:account-requests:${session.id}`, session.role] as const,
  activeUsers: (session: CacheSession) => [`admin:active-users:${session.id}`, session.role] as const,
  auditChain: (session: CacheSession) => [`admin:audit-chain:${session.id}`, session.role] as const,
  pendingPolicies: (session: CacheSession) => [`admin:pending-policies:${session.id}`, session.role] as const,
  attendanceReview: (session: CacheSession) => [`admin:attendance-review:${session.id}`, session.role] as const,
  backupRuns: (session: CacheSession) => [`admin:backup-runs:${session.id}`, session.role] as const,
  notificationsSummary: (session: CacheSession) => [`admin:notifications-summary:${session.id}`, session.role] as const,
  emailSummary: (session: CacheSession) => [`admin:email-summary:${session.id}`, session.role] as const,
  cronSchedules: (session: CacheSession) => [`admin:cron-schedules:${session.id}`, session.role] as const,
  /**
   * `resources:list:<category>:<query>` and `admin:analytics:<from>:<to>` were one global key per
   * filter. As slots, a filter that was already read stays instant and an unseen one can never be
   * answered from the previous filter's rows.
   */
  resources: (session: CacheSession, category: string, search: string) =>
    [`resources:list:${session.id}`, session.role, category, search] as const,
  adminAnalytics: (session: CacheSession, from: string, to: string) =>
    [`admin:analytics:${session.id}`, session.role, from || "default", to || "default"] as const,
  liveTelemetry: (session: CacheSession) => [`admin:live-telemetry:${session.id}`, session.role] as const,
  auditLogs: (session: CacheSession, scope: string, search: string, page: number) =>
    [`admin:audit-logs:${session.id}`, session.role, scope, search, String(page)] as const,
};

function invalidateAll(client: QueryClient, keys: readonly (readonly unknown[])[]): Promise<void> {
  return Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: key }))).then(() => undefined);
}

function invalidateTasks(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.tasks(session)]);
}

function invalidateProjects(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.projects(session)]);
}

/**
 * A manager write changes both agenda lists: the manager view keeps the cancelled days and the
 * user view hides them (SCH-05), which is why they hold separate keys and both go stale here.
 */
function invalidateEvents(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.adminEvents(session), cacheKeys.events(session)]);
}

function invalidateAnnouncements(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.adminAnnouncements(session), cacheKeys.announcements(session)]);
}

/**
 * A check-in, a correction or an exception all change the same list, and they are written from
 * three surfaces (/kehadiran, the beranda quick check-in and /admin/kehadiran's decision), so each
 * caller routes through this one helper.
 */
function invalidateAttendance(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.attendance(session)]);
}

/**
 * The two-element prefix matches every version and every cursor of this session's history, which
 * is what the legacy per-user history prefix reset used to do. Today's draft goes stale with it
 * because a save changes both.
 */
function invalidateReports(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [
    cacheKeys.reportsToday(session),
    [`reports:history:${session.id}`, session.role],
  ]);
}

/** /laporan submits into the queue that /review reads. */
function invalidateReviewQueue(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.reviewQueue(session)]);
}

/**
 * The dashboard metrics are read by the beranda and by /admin/audit and written from /review. The
 * legacy prefix bridge that used to sit here is gone: Batch 3 moved /admin/audit onto this key, so
 * no reader of `admin:dashboard-stats` is left outside TanStack.
 */
function invalidateDashboard(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.dashboard(session)]);
}

/**
 * `policy:active` is read by /laporan, the beranda and /admin/audit. Same reason as the dashboard:
 * after Batch 3 the TanStack entry is the only copy.
 */
function invalidatePolicy(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.policy(session)]);
}

/**
 * A manager resource change is visible to every santri-facing resource read: the filtered list (all
 * categories and search terms of this session, matched by the two-slot prefix) and the stats card.
 * This replaces the two legacy global prefix resets for that list and stats, which cleared the same
 * prefixes for every account in the browser. The admin console's own list is not reset here — the
 * page refetches it because it reads the saved row back out of that result.
 */
function invalidateResources(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [[`resources:list:${session.id}`], cacheKeys.resourceStats(session)]);
}

/**
 * /tim and /admin/people read the same two lists, and a membership, coordinator or reviewer write
 * changes both — the reviewer column lives on the person row, the team roster on the structure.
 */
function invalidateDirectory(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [cacheKeys.people(session), cacheKeys.teams(session)]);
}

/**
 * /admin/users refreshed its three reads together after every IAM decision: the approval queue, the
 * active list, and the team picker the role/team selects are built from.
 */
function invalidateIamQueue(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [
    cacheKeys.accountRequests(session),
    cacheKeys.activeUsers(session),
    cacheKeys.teams(session),
  ]);
}

/**
 * The audit console's reload button hit five reads, and a policy activation also changes the active
 * row (§3.9) and the counters the same page shows — so all six go stale together. The log key stays
 * a two-slot prefix so every scope, search term and page of this session resets with it.
 */
function invalidateAudit(client: QueryClient, session: CacheSession): Promise<void> {
  return invalidateAll(client, [
    cacheKeys.policy(session),
    cacheKeys.dashboard(session),
    cacheKeys.auditChain(session),
    cacheKeys.pendingPolicies(session),
    [`admin:audit-logs:${session.id}`],
  ]);
}

export {
  invalidateTasks,
  invalidateProjects,
  invalidateEvents,
  invalidateAnnouncements,
  invalidateAttendance,
  invalidateReports,
  invalidateReviewQueue,
  invalidateDashboard,
  invalidatePolicy,
  invalidateResources,
  invalidateDirectory,
  invalidateIamQueue,
  invalidateAudit,
};
