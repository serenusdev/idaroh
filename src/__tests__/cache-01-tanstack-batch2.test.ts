/**
 * CACHE-01 Batch 2 — the daily operational surfaces move onto TanStack Query.
 *
 * Batch 1 only migrated the schedule and task surfaces, and it did so while `/` still read the
 * same agenda lists out of `src/lib/data-cache.ts`. Batch 2 takes the four surfaces a santri or a
 * manager actually lives on — `/kehadiran`, `/laporan`, `/review` and the beranda `/` — and it has
 * to keep the invalidation graph that grew around them:
 *
 *  - `attendance:history` is written from three places (the page itself, the beranda check-in and
 *    `/admin/kehadiran`'s correction decision), so all three have to speak through one helper.
 *  - `policy:active` is read by four surfaces but only `/admin/audit` stays legacy after this
 *    batch, so `invalidatePolicy()` bridges both caches while the other bridges go dead.
 *  - `admin:dashboard-stats` is read by the beranda and by `/admin/audit`, and written from
 *    `/review` — the same bridge argument.
 *  - `/laporan` deliberately puts a `historyVersion` counter inside the history key so an in-flight
 *    read started before a save cannot overwrite the refreshed page. That guard is a race fix, not
 *    an accident, so the key builder keeps the version slot instead of a plain invalidate.
 *  - `/review` carries the sessionStorage idempotency machinery from SEC-04/TASK-01. Migrating its
 *    cache must not touch it: a replayed review decision is exactly what that machinery exists to
 *    prevent.
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
const kehadiranPage = readOrEmpty("src/app/(app)/kehadiran/page.tsx");
const laporanPage = readOrEmpty("src/app/(app)/laporan/page.tsx");
const reviewPage = readOrEmpty("src/app/(app)/review/page.tsx");
const homePage = readOrEmpty("src/app/(app)/page.tsx");
const auditPage = readOrEmpty("src/app/(app)/admin/audit/page.tsx");
const adminKehadiranPage = readOrEmpty("src/app/(app)/admin/kehadiran/page.tsx");

const migrated = [
  ["kehadiran", kehadiranPage],
  ["laporan", laporanPage],
  ["review", reviewPage],
  ["beranda", homePage],
] as const;

describe("CACHE-01 Batch 2 — the new query keys carry the session and the active role", () => {
  it("exposes one session-scoped key builder per Batch 2 surface", async () => {
    expect(cacheKeysSource, "src/lib/cache-keys.ts is missing").not.toBe("");
    const { cacheKeys } = await import("@/lib/cache-keys");
    const session = { id: "user-77", role: "pengurus" } as const;
    const surfaces = ["attendance", "policy", "reportsToday", "reportCategories", "reviewQueue", "dashboard"] as const;
    for (const name of surfaces) {
      const key = cacheKeys[name](session) as readonly string[];
      expect(key[0], name).toContain("user-77");
      // A role switch changes what the RLS policies let this session read, so the entry from the
      // old role must never be reused (D3).
      expect(key[1], name).toBe("pengurus");
    }
    // The pre-migration key names survive inside the builders, so a surface stays greppable.
    expect(cacheKeysSource).toContain("`attendance:history:${");
    expect(cacheKeysSource).toContain("`reports:today:${");
    expect(cacheKeysSource).toContain("`review:queue:${");
    expect(cacheKeysSource).toContain("`admin:dashboard-stats:${");
  });

  it("keeps the laporan history race guard inside the key", async () => {
    const { cacheKeys } = await import("@/lib/cache-keys");
    const session = { id: "user-77", role: "santri" } as const;
    // `reports:history:<uid>:<version>:<cursor>` becomes a key slot pair, so a read that started
    // before a save settles on the old version and cannot overwrite the refreshed list.
    expect(cacheKeys.reportsHistory(session, 1)).toEqual(["reports:history:user-77", "santri", "1", "latest"]);
    expect(cacheKeys.reportsHistory(session, 2, "2027-01-05")).toEqual([
      "reports:history:user-77",
      "santri",
      "2",
      "2027-01-05",
    ]);
    expect(cacheKeys.reportsHistory(session, 1)).not.toEqual(cacheKeys.reportsHistory(session, 2));
    expect(cacheKeys.reportsHistory(session, 1)).not.toEqual(
      cacheKeys.reportsHistory({ id: "user-77", role: "pengurus" }, 1),
    );
  });

  it("isolates the Batch 2 surfaces between accounts and roles inside one QueryClient", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const santri = { id: "santri-1", role: "santri" } as const;
    const manager = { id: "pengurus-2", role: "pengurus" } as const;
    const promoted = { id: "santri-1", role: "pengurus" } as const;

    for (const session of [santri, manager, promoted]) {
      await client.fetchQuery({
        queryKey: cacheKeys.reviewQueue(session),
        queryFn: async () => [`queue-for:${session.id}:${session.role}`],
      });
      await client.fetchQuery({
        queryKey: cacheKeys.dashboard(session),
        queryFn: async () => [{ pending: `${session.id}:${session.role}` }],
      });
    }

    expect(client.getQueryData(cacheKeys.reviewQueue(santri))).toEqual(["queue-for:santri-1:santri"]);
    expect(client.getQueryData(cacheKeys.reviewQueue(promoted))).toEqual(["queue-for:santri-1:pengurus"]);
    expect(client.getQueryData(cacheKeys.reviewQueue({ id: "santri-1", role: "yayasan" } as const))).toBeUndefined();
    // The review queue and the dashboard metrics are the two rows an out-of-scope role must never
    // see (ADM-01/03), so they stay apart from each other too.
    expect(client.getQueryData(cacheKeys.dashboard(manager))).toEqual([{ pending: "pengurus-2:pengurus" }]);
  });
});

describe("CACHE-01 Batch 2 — the invalidation graph around these pages survives the move", () => {
  it("a check-in from any caller resets the attendance history", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateAttendance } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const actor = { id: "santri-1", role: "santri" } as const;
    const other = { id: "santri-9", role: "santri" } as const;

    for (const session of [actor, other]) {
      await client.fetchQuery({ queryKey: cacheKeys.attendance(session), queryFn: async () => [] });
    }
    await invalidateAttendance(client, actor);

    expect(client.getQueryState(cacheKeys.attendance(actor))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.attendance(other))?.isInvalidated).toBe(false);
  });

  it("a reports write resets today's draft and every history page of that session only", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateReports } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const actor = { id: "santri-1", role: "santri" } as const;
    const other = { id: "santri-9", role: "santri" } as const;

    for (const key of [
      cacheKeys.reportsToday(actor),
      cacheKeys.reportsHistory(actor, 1),
      cacheKeys.reportsHistory(actor, 2, "2027-01-05"),
      cacheKeys.reportsHistory(other, 1),
    ]) {
      await client.fetchQuery({ queryKey: key, queryFn: async () => [] });
    }
    await invalidateReports(client, actor);

    expect(client.getQueryState(cacheKeys.reportsToday(actor))?.isInvalidated).toBe(true);
    // Both the latest page and the older cursor go stale, and the bumped version too — that is what
    // replaces `invalidateCache(`reports:history:${user.id}:`)`.
    expect(client.getQueryState(cacheKeys.reportsHistory(actor, 1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.reportsHistory(actor, 2, "2027-01-05"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.reportsHistory(other, 1))?.isInvalidated).toBe(false);
  });

  it("resets the policy and dashboard keys that this batch had to bridge", async () => {
    // Batch 2 shipped these two helpers as a bridge: /admin/audit still read `policy:active` and
    // `admin:dashboard-stats` out of the legacy Map, so a write had to clear both copies. Batch 3
    // migrated that page and deleted src/lib/data-cache.ts, so the reset is TanStack-only now and a
    // prefix that belongs to no key must stay untouched (D3).
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidatePolicy, invalidateDashboard } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const session = { id: "pengurus-2", role: "pengurus" } as const;
    const other = { id: "pengurus-9", role: "pengurus" } as const;

    await client.fetchQuery({ queryKey: cacheKeys.policy(session), queryFn: async () => null });
    await client.fetchQuery({ queryKey: cacheKeys.dashboard(session), queryFn: async () => null });
    await client.fetchQuery({ queryKey: cacheKeys.dashboard(other), queryFn: async () => null });

    await invalidatePolicy(client, session);
    expect(client.getQueryState(cacheKeys.policy(session))?.isInvalidated).toBe(true);

    await invalidateDashboard(client, session);
    expect(client.getQueryState(cacheKeys.dashboard(session))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.dashboard(other))?.isInvalidated).toBe(false);
  });

  it("drops the bridges that this batch leaves with no legacy reader", async () => {
    expect(cacheKeysSource, "src/lib/cache-keys.ts is missing").not.toBe("");
    // `/` was the last `useCachedData` reader of the agenda lists, and no surface ever read
    // `tasks:projects:` outside /tugas, so these three resets are dead code from here on.
    expect(cacheKeysSource).not.toContain('invalidateCache("events:")');
    expect(cacheKeysSource).not.toContain('invalidateCache("announcements:")');
    expect(cacheKeysSource).not.toContain('invalidateCache("tasks:projects:")');
  });

  it("keeps every Batch 2 read behind a Server Action, with no direct database access", () => {
    for (const [name, page] of migrated) {
      expect(page, `${name} page is missing`).not.toBe("");
      expect(page, name).not.toMatch(/\bsupabase\b|\.rpc\(|\.from\("/);
      expect(page, name).not.toContain("useCachedData");
      expect(page, name).toContain("useQuery({");
      expect(page, name).toContain("cacheKeys.");
    }
    // getAttendanceHistoryAction takes an optional targetUserId, so the queryFn must not be handed
    // TanStack's QueryFunctionContext.
    expect(kehadiranPage).toContain("queryFn: () => getAttendanceHistoryAction()");
    expect(laporanPage).toContain("queryFn: () => getMyReportHistoryAction({ before, limit: 20 })");
    expect(reviewPage).toContain("queryFn: getReviewQueueAction");
    expect(homePage).toContain("queryFn: getAdminDashboardStatsAction");
  });
});

describe("CACHE-01 Batch 2 — writes stay Server Actions and their guards stay in place", () => {
  it("/kehadiran runs check-in, correction and exception through mutations", () => {
    for (const name of ["checkInMutation", "correctionMutation", "exceptionMutation"]) {
      expect(kehadiranPage, `${name} is missing`).toContain(`const ${name} = useMutation({`);
    }
    const checkInStart = kehadiranPage.indexOf("const checkInMutation = useMutation");
    const checkInBody = kehadiranPage.slice(checkInStart, kehadiranPage.indexOf("const correctionMutation", checkInStart));
    expect(checkInBody.length).toBeGreaterThan(120);
    expect(checkInBody).toContain("checkInAttendanceAction()");
    expect(checkInBody).toContain("invalidateAttendance(queryClient, user)");
    expect(kehadiranPage.slice(kehadiranPage.indexOf("const correctionMutation"))).toContain("submitCorrectionAction");
    expect(kehadiranPage.slice(kehadiranPage.indexOf("const exceptionMutation"))).toContain("submitExceptionAction");
    // A rejected write keeps telling the user why, exactly as the pre-migration handlers did.
    expect(kehadiranPage).toContain("Gagal mencatat presensi");
  });

  it("/laporan keeps the editable draft in local state and the cache for the reads", () => {
    // The form mirror is not a cache copy: the user types into it, so it stays a useState.
    expect(laporanPage).toContain("const [report, setReport] = React.useState<DailyReport>");
    expect(laporanPage).toContain("const draftMutation = useMutation({");
    expect(laporanPage).toContain("const submitMutation = useMutation({");
    expect(laporanPage).toContain("saveReportDraftAction");
    expect(laporanPage).toContain("submitReportAction");
    expect(laporanPage).toContain("invalidateReports(queryClient, user)");
    // A submission belongs on a manager's queue, so the cross-surface reset is explicit.
    expect(laporanPage).toContain("invalidateReviewQueue(queryClient, user)");
    expect(laporanPage).not.toContain("invalidateCache(");
    // The version slot that replaces the prefix invalidation.
    expect(laporanPage).toContain("cacheKeys.reportsHistory(user, historyVersion");
  });

  it("/review migrates its cache without touching the review idempotency machinery", () => {
    expect(reviewPage).toContain("const reviewDecisionMutation = useMutation({");
    expect(reviewPage).toContain("reviewReportAction");
    expect(reviewPage).toContain("invalidateDashboard(queryClient, currentUser)");
    // SEC-04/TASK-01: a replayed decision must stay impossible, so none of this may move into a
    // retrying mutation.
    for (const guard of [
      "resolveReviewCommand(",
      "storeReviewCommand(",
      "clearStoredReviewCommand(",
      "pendingReviewCommand",
      "idempotencyKey",
    ]) {
      expect(reviewPage, `${guard} is missing`).toContain(guard);
    }
    // The write result is patched into the queue instead of a detached useState mirror.
    expect(reviewPage).not.toContain("writeCache(");
    expect(reviewPage).not.toContain("const [reports, setReports]");
  });

  it("declares every mutation before a page's role early return", () => {
    // react-hooks/rules-of-hooks: a useMutation below an early return is a conditional hook.
    const reviewGate = reviewPage.indexOf("if (!canReview)");
    expect(reviewGate).toBeGreaterThan(-1);
    expect(reviewPage.indexOf("const reviewDecisionMutation = useMutation")).toBeLessThan(reviewGate);
    const homeGate = homePage.indexOf("if (isAdminOrPengurus");
    for (const name of ["homeCheckInMutation", "policySaveMutation"]) {
      const hook = homePage.indexOf(`const ${name} = useMutation`);
      expect(hook, `${name} is missing`).toBeGreaterThan(-1);
      if (homeGate > -1) expect(hook).toBeLessThan(homeGate);
    }
  });

  it("the beranda reads the agenda lists through the Batch 1 keys", () => {
    expect(homePage).toContain("cacheKeys.events(currentUser)");
    expect(homePage).toContain("cacheKeys.announcements(currentUser)");
    expect(homePage).toContain("cacheKeys.policy(currentUser)");
    expect(homePage).toContain("cacheKeys.dashboard(currentUser)");
    // The supervisor gate stays a key decision, not a fetch that returns someone else's metrics.
    expect(homePage).toMatch(/dashboard\(currentUser\)[\s\S]{0,160}enabled: isSupervisor/);
  });

  it("the attendance and policy writers that stay legacy reach the migrated cache too", () => {
    // /admin/kehadiran decides a correction that changes the santri's own history list, and
    // /admin/audit saves the policy the migrated pages read. Both are callers, so they have to
    // speak through the helpers rather than the old prefix reset.
    expect(adminKehadiranPage).toContain("invalidateAttendance(queryClient, user)");
    expect(adminKehadiranPage).not.toContain('invalidateCache("attendance:history")');
    expect(auditPage).toContain("invalidatePolicy(queryClient,");
    expect(auditPage).not.toContain('invalidateCache("policy:")');
    expect(homePage).toContain("invalidateAttendance(queryClient, currentUser)");
    expect(homePage).toContain("invalidatePolicy(queryClient, currentUser)");
  });
});
