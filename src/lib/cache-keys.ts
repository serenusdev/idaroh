import type { QueryClient } from "@tanstack/react-query";
import { invalidateCache } from "@/lib/data-cache";
import type { UserProfile } from "@/lib/auth/types";

export type CacheSession = Pick<UserProfile, "id" | "role">;

/**
 * Query keys for the surfaces migrated in CACHE-01 Batch 1.
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
};

/**
 * Batch 1 leaves the unmigrated surfaces — the dashboard at `/` still calls `useCachedData`
 * with `events:<uid>` and `announcements:<uid>` — so a write has to reset the legacy
 * data-cache next to the TanStack entry. Batch 3 deletes the legacy half of each helper.
 */
function invalidateTasks(client: QueryClient, session: CacheSession): Promise<void> {
  return client.invalidateQueries({ queryKey: cacheKeys.tasks(session) }).then(() => undefined);
}

function invalidateProjects(client: QueryClient, session: CacheSession): Promise<void> {
  invalidateCache("tasks:projects:");
  return client.invalidateQueries({ queryKey: cacheKeys.projects(session) }).then(() => undefined);
}

/**
 * A manager write changes both agenda lists: the manager view keeps the cancelled days and the
 * user view hides them (SCH-05), which is why they hold separate keys and both go stale here.
 */
function invalidateEvents(client: QueryClient, session: CacheSession): Promise<void> {
  invalidateCache("events:");
  return Promise.all([
    client.invalidateQueries({ queryKey: cacheKeys.adminEvents(session) }),
    client.invalidateQueries({ queryKey: cacheKeys.events(session) }),
  ]).then(() => undefined);
}

function invalidateAnnouncements(client: QueryClient, session: CacheSession): Promise<void> {
  invalidateCache("announcements:");
  return Promise.all([
    client.invalidateQueries({ queryKey: cacheKeys.adminAnnouncements(session) }),
    client.invalidateQueries({ queryKey: cacheKeys.announcements(session) }),
  ]).then(() => undefined);
}

export { invalidateTasks, invalidateProjects, invalidateEvents, invalidateAnnouncements };
