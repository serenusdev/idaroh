/**
 * CACHE-01 Batch 3 — the last readers leave the manual data-cache, and the module goes with them.
 *
 * Batch 1 took the schedule and task surfaces, Batch 2 the daily operational ones. What stayed on
 * `useCachedData` were the admin surfaces, `/tim` and `/resources` — and because they stayed,
 * `src/lib/cache-keys.ts` had to keep two bridges into the old Map (`invalidateCache("policy:")`
 * and `invalidateCache("admin:dashboard-stats")`) so a write from a migrated page also reset the
 * legacy copy. Those bridges are the reason `data-cache.ts` was still reachable from a production
 * bundle.
 *
 * The manual Map is also the only cache layer in this app that was never scoped per account: every
 * key below is a global string (`people:list`, `teams:structure`, `admin:active-users`,
 * `policy:active`, …), so two accounts opening the same browser share one entry until the page is
 * reloaded. The TanStack rule CACHE-01 set — `[<surface>:<session id>, <active role>]` — is what
 * removes that, which is why these keys are asserted rather than left to naming taste (D3).
 *
 * Three behaviours the hook gave and a plain `useQuery` does not have to lose:
 *  - `/admin/resources` reads the refreshed rows out of the call (`const items = await
 *    listQuery.refresh()`) and re-selects the saved resource from them.
 *  - `/admin/cron` writes the saved row straight back into the cache (`writeCache`) instead of
 *    refetching, because the action already returns the committed state.
 *  - every legacy gate was a `key === null` decision; the TanStack equivalent is `enabled`, and the
 *    predicate must not silently widen or narrow.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

// fs-only scans first, so a missing implementation fails as an assertion instead of a
// module-resolution error (AGENTS.md / AGENT-WORKFLOW.md).
function readOrEmpty(relativePath: string): string {
  const full = resolve(root, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const cacheKeysSource = readOrEmpty("src/lib/cache-keys.ts");
const providerSource = readOrEmpty("src/components/providers/query-provider.tsx");

const batch3Pages: Array<[string, string]> = [
  ["/resources", readOrEmpty("src/app/(app)/resources/page.tsx")],
  ["/tim", readOrEmpty("src/app/(app)/tim/page.tsx")],
  ["/admin/resources", readOrEmpty("src/app/(app)/admin/resources/page.tsx")],
  ["/admin/people", readOrEmpty("src/app/(app)/admin/people/page.tsx")],
  ["/admin/users", readOrEmpty("src/app/(app)/admin/users/page.tsx")],
  ["/admin/audit", readOrEmpty("src/app/(app)/admin/audit/page.tsx")],
  ["/admin/kehadiran", readOrEmpty("src/app/(app)/admin/kehadiran/page.tsx")],
  ["/admin/backup", readOrEmpty("src/app/(app)/admin/backup/page.tsx")],
  ["/admin/notifications", readOrEmpty("src/app/(app)/admin/notifications/page.tsx")],
  ["/admin/cron", readOrEmpty("src/app/(app)/admin/cron/page.tsx")],
  ["/admin/analytics", readOrEmpty("src/app/(app)/admin/analytics/page.tsx")],
];

describe("CACHE-01 Batch 3 — the manual data-cache is retired, not just unused", () => {
  it("deletes both legacy modules", () => {
    expect(existsSync(resolve(root, "src/lib/data-cache.ts")), "src/lib/data-cache.ts still exists").toBe(false);
    expect(existsSync(resolve(root, "src/hooks/use-cached-data.ts")), "src/hooks/use-cached-data.ts still exists").toBe(false);
  });

  it("leaves no importer of the removed modules anywhere in src or e2e", () => {
    const importers = [
      ...batch3Pages.map(([name, source]) => [name, source] as const),
      ["src/lib/cache-keys.ts", cacheKeysSource] as const,
      ["src/app/(app)/page.tsx", readOrEmpty("src/app/(app)/page.tsx")] as const,
      ["src/app/(app)/laporan/page.tsx", readOrEmpty("src/app/(app)/laporan/page.tsx")] as const,
      ["src/app/(app)/review/page.tsx", readOrEmpty("src/app/(app)/review/page.tsx")] as const,
    ];
    for (const [name, source] of importers) {
      expect(source, `${name} is missing`).not.toBe("");
      expect(source, `${name} still imports the legacy cache`).not.toMatch(/hooks\/use-cached-data|lib\/data-cache/);
      expect(source, `${name} still calls useCachedData`).not.toContain("useCachedData");
    }
    // The old module-level Map had no notion of invalidation depth; nothing may reintroduce it.
    expect(cacheKeysSource).not.toMatch(/invalidateCache/);
  });

  it("moves all eleven remaining surfaces onto useQuery with a session-scoped key", () => {
    for (const [name, page] of batch3Pages) {
      expect(page, `${name} page is missing`).not.toBe("");
      expect(page, `${name} never reached for useQuery`).toContain("useQuery({");
      expect(page, `${name} builds keys by hand instead of through cacheKeys`).toContain("cacheKeys.");
      expect(page, `${name} still reads the manual hook`).not.toMatch(/useCachedData|writeCache|readCache|hasCache|invalidateCache/);
    }
  });
});

describe("CACHE-01 Batch 3 — every migrated key carries the session and the active role", () => {
  it("publishes one builder per Batch 3 surface", async () => {
    const { cacheKeys } = await import("@/lib/cache-keys");
    const session = { id: "user-77", role: "pengurus" } as const;
    const single = [
      "resourceCategories",
      "resourceStats",
      "resourceFavorites",
      "adminResources",
      "adminResourceCategories",
      "people",
      "teams",
      "accountRequests",
      "activeUsers",
      "auditChain",
      "pendingPolicies",
      "attendanceReview",
      "backupRuns",
      "notificationsSummary",
      "emailSummary",
      "cronSchedules",
    ] as const;
    for (const name of single) {
      const key = cacheKeys[name](session) as readonly string[];
      expect(key[0], name).toContain("user-77");
      expect(key[1], name).toBe("pengurus");
      // The pre-migration key names survive inside the builders, so a surface stays greppable.
      expect(key[0], name).toMatch(/^(resources|people|teams|admin):/);
    }
  });

  it("keeps the filter-dependent reads inside the key instead of a shared entry", async () => {
    const { cacheKeys } = await import("@/lib/cache-keys");
    const santri = { id: "user-77", role: "santri" } as const;
    // `resources:list:<category>:<query>` and `admin:analytics:<from>:<to>` were one global string
    // per filter; as key slots a back-navigation to a filter that was already read stays instant
    // while an unseen filter value can never be answered from the previous filter's rows.
    expect(cacheKeys.resources(santri, "perpustakaan", "kitab")).toEqual([
      "resources:list:user-77",
      "santri",
      "perpustakaan",
      "kitab",
    ]);
    expect(cacheKeys.resources(santri, "perpustakaan", "")).not.toEqual(cacheKeys.resources(santri, "all", ""));
    expect(cacheKeys.adminAnalytics(santri, "", "")).toEqual(["admin:analytics:user-77", "santri", "default", "default"]);
    expect(cacheKeys.adminAnalytics(santri, "2026-11-01", "2026-11-30")).toEqual([
      "admin:analytics:user-77",
      "santri",
      "2026-11-01",
      "2026-11-30",
    ]);
    // `admin:audit-logs:<scope>:<query>:<page>` keeps scope, search and page as separate slots, and
    // the two-element prefix still matches every page of this session for an invalidation.
    expect(cacheKeys.auditLogs(santri, "all", "login", 2)).toEqual(["admin:audit-logs:user-77", "santri", "all", "login", "2"]);
    expect(cacheKeys.auditLogs(santri, "all", "login", 1)).not.toEqual(cacheKeys.auditLogs(santri, "all", "login", 2));
  });

  it("isolates the migrated surfaces between accounts and roles inside one QueryClient", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const santri = { id: "santri-1", role: "santri" } as const;
    const manager = { id: "pengurus-2", role: "pengurus" } as const;
    const promoted = { id: "santri-1", role: "pengurus" } as const;

    // These three are the rows the legacy global keys really did share between accounts: the
    // directory, the IAM queue and the resource list.
    for (const session of [santri, manager, promoted]) {
      await client.fetchQuery({ queryKey: cacheKeys.people(session), queryFn: async () => [`people-for:${session.id}:${session.role}`] });
      await client.fetchQuery({ queryKey: cacheKeys.activeUsers(session), queryFn: async () => [`users-for:${session.id}:${session.role}`] });
      await client.fetchQuery({ queryKey: cacheKeys.resources(session, "all", ""), queryFn: async () => [`res-for:${session.id}:${session.role}`] });
    }

    expect(client.getQueryData(cacheKeys.people(santri))).toEqual(["people-for:santri-1:santri"]);
    expect(client.getQueryData(cacheKeys.people(promoted))).toEqual(["people-for:santri-1:pengurus"]);
    expect(client.getQueryData(cacheKeys.people({ id: "santri-1", role: "yayasan" } as const))).toBeUndefined();
    expect(client.getQueryData(cacheKeys.activeUsers(manager))).toEqual(["users-for:pengurus-2:pengurus"]);
    expect(client.getQueryData(cacheKeys.resources(manager, "all", ""))).toEqual(["res-for:pengurus-2:pengurus"]);
  });
});

describe("CACHE-01 Batch 3 — the invalidation graph survives the bridges coming down", () => {
  it("a manager resource write resets the santri-facing keys it used to clear by prefix", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateResources } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const manager = { id: "pengurus-2", role: "pengurus" } as const;
    const other = { id: "pengurus-9", role: "pengurus" } as const;

    await client.fetchQuery({ queryKey: cacheKeys.adminResources(manager), queryFn: async () => [] });
    await client.fetchQuery({ queryKey: cacheKeys.resources(manager, "all", "kitab"), queryFn: async () => [] });
    await client.fetchQuery({ queryKey: cacheKeys.resources(manager, "perpustakaan", ""), queryFn: async () => [] });
    await client.fetchQuery({ queryKey: cacheKeys.resourceStats(manager), queryFn: async () => [] });
    await client.fetchQuery({ queryKey: cacheKeys.resources(other, "all", "kitab"), queryFn: async () => [] });

    await invalidateResources(client, manager);

    // `invalidateCache("resources:list")` cleared every filter and every account at once; the
    // prefix now stops at this session's entries.
    expect(client.getQueryState(cacheKeys.resources(manager, "all", "kitab"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.resources(manager, "perpustakaan", ""))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.resourceStats(manager))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.resources(other, "all", "kitab"))?.isInvalidated).toBe(false);
  });

  it("a directory write resets both directory reads, because /tim and /admin/people share them", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateDirectory } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const yayasan = { id: "yayasan-1", role: "yayasan" } as const;
    const other = { id: "yayasan-9", role: "yayasan" } as const;

    for (const session of [yayasan, other]) {
      await client.fetchQuery({ queryKey: cacheKeys.people(session), queryFn: async () => [] });
      await client.fetchQuery({ queryKey: cacheKeys.teams(session), queryFn: async () => [] });
    }
    await invalidateDirectory(client, yayasan);

    expect(client.getQueryState(cacheKeys.people(yayasan))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.teams(yayasan))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.people(other))?.isInvalidated).toBe(false);
  });

  it("an IAM decision resets the queue, the active list and the team picker it refreshed together", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateIamQueue } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const actor = { id: "sa-1", role: "super_admin" } as const;

    for (const key of [cacheKeys.accountRequests(actor), cacheKeys.activeUsers(actor), cacheKeys.teams(actor)]) {
      await client.fetchQuery({ queryKey: key, queryFn: async () => [] });
    }
    await invalidateIamQueue(client, actor);

    for (const key of [cacheKeys.accountRequests(actor), cacheKeys.activeUsers(actor), cacheKeys.teams(actor)]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("an audit-surface write resets the whole console, including the policy and metrics it read", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateAudit } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const actor = { id: "sa-1", role: "super_admin" } as const;

    // The console's "Muat ulang" hit five reads at once, and a policy activation changes the active
    // row plus the dashboard counters the same page shows — the two keys whose legacy bridges this
    // batch removes.
    await client.fetchQuery({ queryKey: cacheKeys.policy(actor), queryFn: async () => null });
    await client.fetchQuery({ queryKey: cacheKeys.dashboard(actor), queryFn: async () => null });
    await client.fetchQuery({ queryKey: cacheKeys.auditChain(actor), queryFn: async () => null });
    await client.fetchQuery({ queryKey: cacheKeys.pendingPolicies(actor), queryFn: async () => [] });
    await client.fetchQuery({ queryKey: cacheKeys.auditLogs(actor, "all", "", 1), queryFn: async () => null });
    await client.fetchQuery({ queryKey: cacheKeys.auditLogs(actor, "auth", "login", 4), queryFn: async () => null });

    await invalidateAudit(client, actor);

    for (const key of [
      cacheKeys.policy(actor),
      cacheKeys.dashboard(actor),
      cacheKeys.auditChain(actor),
      cacheKeys.pendingPolicies(actor),
      cacheKeys.auditLogs(actor, "all", "", 1),
      cacheKeys.auditLogs(actor, "auth", "login", 4),
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("no migrated page still reaches the database client directly", () => {
    for (const [name, page] of batch3Pages) {
      // UI copy legitimately names Supabase (the /admin/resources CSV sample), so the check is on the
      // client import and the query-builder calls a page must never make.
      expect(page, `${name} touches the supabase client`).not.toMatch(/from "@\/lib\/supabase|\.rpc\(|\.from\("/);
    }
    expect(readOrEmpty("src/app/(app)/admin/backup/page.tsx")).toContain("queryFn: getBackupRunsAction");
    expect(readOrEmpty("src/app/(app)/tim/page.tsx")).toContain("queryFn: getPeopleAction");
    expect(readOrEmpty("src/app/(app)/tim/page.tsx")).toContain("queryFn: getTeamsAction");
  });
});

describe("CACHE-01 Batch 3 — what the manual hook did by construction has to be restated", () => {
  it("keeps every disabled read disabled, with the same predicate the legacy key used", () => {
    const notifications = readOrEmpty("src/app/(app)/admin/notifications/page.tsx");
    const cron = readOrEmpty("src/app/(app)/admin/cron/page.tsx");
    const users = readOrEmpty("src/app/(app)/admin/users/page.tsx");
    // A `null` key meant "do not fetch"; `enabled` is the same decision, so the SA-only gates stay
    // SA-only. Widening them here would be a permission change (§3 needs its own 5-layer sync).
    expect(notifications).toMatch(/enabled: user\.role === "super_admin"/);
    expect(cron).toMatch(/enabled: user\.role === "super_admin"/);
    expect(users).toMatch(/enabled: canDecideIam/);
  });

  it("keeps the awaited refresh that /admin/resources re-selects the saved row from", () => {
    const adminResources = readOrEmpty("src/app/(app)/admin/resources/page.tsx");
    // `const items = await listQuery.refresh()` handed back rows. `refetch()` hands back the query
    // result, so the dereference has to be explicit or the form silently keeps the stale row.
    expect(adminResources).toMatch(/await listQuery\.refetch\(\)/);
    expect(adminResources).toMatch(/listResult\.data\b|\.refetch\(\)\.data\b/);
    expect(adminResources).not.toMatch(/await listQuery\.refresh\(\)/);
  });

  it("keeps /admin/cron writing the saved schedule back into the cache instead of refetching", () => {
    const cron = readOrEmpty("src/app/(app)/admin/cron/page.tsx");
    // The action returns the committed row, so the page used to seed `writeCache`. setQueryData is
    // the equivalent; an invalidateQueries here would fire a read the page never asked for.
    expect(cron).toContain("queryClient.setQueryData(");
    expect(cron).toContain("cacheKeys.cronSchedules(");
  });

  it("keeps the freshness behaviour the hook gave: focus and online revalidation, 30s window", () => {
    expect(providerSource).toContain("refetchOnWindowFocus: true");
    expect(providerSource).toContain("refetchOnReconnect: true");
    expect(providerSource).toContain("staleTime: 30_000");
  });
});
