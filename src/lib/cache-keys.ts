import type { QueryClient } from "@tanstack/react-query";
import { invalidateCache } from "@/lib/data-cache";
import type { UserProfile } from "@/lib/auth/types";

export type CacheSession = Pick<UserProfile, "id" | "role">;

/**
 * Query keys for every surface migrated in CACHE-01 (Batch 1: tugas + jadwal, Batch 2: kehadiran,
 * laporan, review, beranda).
 *
 * Every key is `[<surface>:<session id>, <active role>]`. TanStack matches keys element by
 * element, so the id keeps one browser from serving another account's rows and the role is
 * part of the identity because a multi-role user sees a different row set per active role
 * (PERMISSIONS.md D3). The surface names are the ones `useCachedData` already used, so a
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
 * replaces `invalidateCache(`reports:history:${user.id}:`)`. Today's draft goes stale with it
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
 * Two surfaces still read these through `useCachedData`: /admin/audit shows the policy it can also
 * save, and it reads the same dashboard metrics the beranda shows. Until Batch 3 migrates them, a
 * write from a migrated surface has to reset the legacy map beside the TanStack entry.
 */
function invalidateDashboard(client: QueryClient, session: CacheSession): Promise<void> {
  invalidateCache("admin:dashboard-stats");
  return invalidateAll(client, [cacheKeys.dashboard(session)]);
}

function invalidatePolicy(client: QueryClient, session: CacheSession): Promise<void> {
  invalidateCache("policy:");
  return invalidateAll(client, [cacheKeys.policy(session)]);
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
};
