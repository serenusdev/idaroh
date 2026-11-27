import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

// fs-only scans first, so a missing implementation fails as an assertion instead of a
// module-resolution error (AGENTS.md / AGENT-WORKFLOW.md). The blocks that need the real
// library import it lazily behind an existsSync guard for the same reason.
function readOrEmpty(relativePath: string): string {
  const full = resolve(root, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const provider = readOrEmpty("src/components/providers/query-provider.tsx");
const cacheKeysSource = readOrEmpty("src/lib/cache-keys.ts");
const shell = readOrEmpty("src/components/layout/app-shell.tsx");
const tugasPage = readOrEmpty("src/app/(app)/tugas/page.tsx");
const jadwalPage = readOrEmpty("src/app/(app)/jadwal/page.tsx");
const adminPage = readOrEmpty("src/app/(app)/admin/jadwal/page.tsx");
const pages = [
  ["tugas", tugasPage],
  ["jadwal", jadwalPage],
  ["admin/jadwal", adminPage],
] as const;

describe("CACHE-01 Batch 1 — QueryClientProvider mounted inside the session shell", () => {
  it("adds @tanstack/react-query as a runtime dependency", () => {
    const pkg = JSON.parse(readOrEmpty("package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@tanstack/react-query"]).toBeTruthy();
  });

  it("ships a client component that owns one QueryClient per mount", () => {
    expect(provider, "src/components/providers/query-provider.tsx is missing").not.toBe("");
    expect(provider.split("\n")[0].trim()).toBe('"use client";');
    // A module-level client would be shared by every request on the server runtime, which is
    // exactly the cross-account leak §D3 forbids.
    expect(provider).not.toMatch(/^const \w+ = new QueryClient/m);
    expect(provider).toMatch(/useState\(\(\) => new QueryClient\(/);
    expect(provider).toContain("<QueryClientProvider");
  });

  it("keeps the freshness behaviour use-cached-data.ts had: focus and online revalidation", () => {
    expect(provider).toContain("refetchOnWindowFocus: true");
    expect(provider).toContain("refetchOnReconnect: true");
    expect(provider).toContain("staleTime:");
    expect(provider).toContain("gcTime:");
  });

  it("drops every cached Server Action response when the provider unmounts", () => {
    expect(provider).toContain("client.clear()");
  });

  it("wraps the shell and remounts on a new session or a new active role", () => {
    expect(shell, "app shell is missing").not.toBe("");
    expect(shell).toContain('from "@/components/providers/query-provider"');
    // AppShell already uses key={user.id} for the headers; the cache needs the same reset, and
    // a role change is a different RLS visibility, so both halves belong to the key.
    expect(shell).toMatch(/key=\{`\$\{user\.id\}:\$\{user\.role\}`\}/);
    expect(shell).toContain("<IdentityProvider");
    expect(shell.indexOf("<QueryProvider")).toBeLessThan(shell.indexOf("<ToastProvider"));
  });
});

describe("CACHE-01 Batch 1 — query keys carry the session and the active role", () => {
  it("exposes one session-scoped key builder per migrated surface", async () => {
    expect(cacheKeysSource, "src/lib/cache-keys.ts is missing").not.toBe("");
    const { cacheKeys } = await import("@/lib/cache-keys");
    const session = { id: "user-77", role: "pengurus" } as const;
    const surfaces = [
      "tasks",
      "projects",
      "events",
      "announcements",
      "adminEvents",
      "adminAnnouncements",
      "audience",
    ] as const;
    for (const name of surfaces) {
      const key = cacheKeys[name](session) as readonly string[];
      // The id and the role are both part of the identity: no cross-account reuse, and a role
      // switch cannot read a list fetched under the previous visibility (D3).
      expect(key[0], name).toContain("user-77");
      expect(key[1], name).toBe("pengurus");
    }
    // SCH-05: the manager list keeps the cancelled days, so it must never share a key with the
    // surface the santri read.
    expect(cacheKeys.adminEvents(session)).not.toEqual(cacheKeys.events(session));
    expect(cacheKeys.adminAnnouncements(session)).not.toEqual(cacheKeys.announcements(session));
    // The pre-migration key names survive inside the builder, so a surface is still greppable.
    expect(cacheKeysSource).toContain("`admin:events:${");
    expect(cacheKeysSource).toContain("`events:${");
    expect(cacheKeysSource).toContain("`tasks:list:${");
  });

  it("isolates two accounts and two roles inside one QueryClient", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const santri = { id: "santri-1", role: "santri" } as const;
    const manager = { id: "pengurus-2", role: "pengurus" } as const;
    const promoted = { id: "santri-1", role: "pengurus" } as const;

    for (const session of [santri, manager, promoted]) {
      await client.fetchQuery({
        queryKey: cacheKeys.events(session),
        queryFn: async () => [`rows-for:${session.id}:${session.role}`],
      });
    }

    expect(client.getQueryData(cacheKeys.events(santri))).toEqual(["rows-for:santri-1:santri"]);
    expect(client.getQueryData(cacheKeys.events(manager))).toEqual(["rows-for:pengurus-2:pengurus"]);
    // Same human, different active role: a separate entry, never the santri row set.
    expect(client.getQueryData(cacheKeys.events(promoted))).toEqual(["rows-for:santri-1:pengurus"]);
    expect(client.getQueryData(cacheKeys.events({ id: "santri-1", role: "koordinator" } as const))).toBeUndefined();
  });

  it("invalidates only the acting session when a schedule write lands", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateEvents, invalidateTasks } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const actor = { id: "pengurus-2", role: "pengurus" } as const;
    const other = { id: "pengurus-9", role: "pengurus" } as const;

    for (const session of [actor, other]) {
      for (const key of [
        cacheKeys.adminEvents(session),
        cacheKeys.events(session),
        cacheKeys.tasks(session),
      ]) {
        await client.fetchQuery({ queryKey: key, queryFn: async () => [] });
      }
    }
    await invalidateEvents(client, actor);
    await invalidateTasks(client, actor);

    expect(client.getQueryState(cacheKeys.adminEvents(actor))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.events(actor))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.tasks(actor))?.isInvalidated).toBe(true);
    // Another account in the same browser keeps its entries untouched.
    expect(client.getQueryState(cacheKeys.adminEvents(other))?.isInvalidated).toBe(false);
    expect(client.getQueryState(cacheKeys.events(other))?.isInvalidated).toBe(false);
    expect(client.getQueryState(cacheKeys.tasks(other))?.isInvalidated).toBe(false);
  });

  it("carries the reset through TanStack only, now that no legacy reader is left", async () => {
    // Batch 1 needed the bridge because `/` still read the agenda lists out of data-cache, and Batch
    // 2 kept it for /admin/audit's policy read. Batch 3 migrated that last reader and deleted the
    // module, so the reset is a single TanStack invalidation now.
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateEvents, invalidatePolicy } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const session = { id: "pengurus-2", role: "pengurus" } as const;

    await client.fetchQuery({ queryKey: cacheKeys.events(session), queryFn: async () => [] });
    await client.fetchQuery({ queryKey: cacheKeys.policy(session), queryFn: async () => null });
    await invalidateEvents(client, session);
    await invalidatePolicy(client, session);

    expect(client.getQueryState(cacheKeys.events(session))?.isInvalidated).toBe(true);
    expect(client.getQueryState(cacheKeys.policy(session))?.isInvalidated).toBe(true);
  });

  it("migrates the three pages to useQuery without touching any other module", () => {
    for (const [name, page] of pages) {
      expect(page, `${name} page is missing`).not.toBe("");
      expect(page, name).not.toContain("useCachedData");
      expect(page, name).not.toContain("writeCache");
      expect(page).toContain("useQuery({");
      expect(page).toContain("cacheKeys.");
    }
    // Batch 3 took the last surfaces that needed the legacy primitives and removed them, so nothing
    // in src may reference them any more — see cache-01-tanstack-batch3.test.ts for the sweep.
    expect(existsSync(resolve(root, "src/lib/data-cache.ts"))).toBe(false);
    expect(existsSync(resolve(root, "src/hooks/use-cached-data.ts"))).toBe(false);
    expect(readOrEmpty("src/app/(app)/page.tsx")).not.toContain("useCachedData");
    expect(readOrEmpty("src/app/(app)/laporan/page.tsx")).not.toContain("useCachedData");
    expect(readOrEmpty("src/app/(app)/tim/page.tsx")).not.toContain("useCachedData");
    expect(readOrEmpty("src/app/(app)/admin/audit/page.tsx")).not.toContain("useCachedData");
  });
});

describe("CACHE-01 Batch 1 — Server Actions stay the only write path", () => {
  it("no page reaches for the database client or an RPC directly", () => {
    for (const [name, page] of pages) {
      expect(page, name).not.toMatch(/\bsupabase\b/);
      expect(page, name).not.toMatch(/\.rpc\(/);
      expect(page, name).not.toMatch(/\.from\("/);
    }
    // queryFn and mutationFn wrap the existing actions; their signatures are untouched.
    expect(tugasPage).toContain("queryFn: getTasksAction");
    expect(tugasPage).toContain("queryFn: getProjectsAction");
    // getEventsAction takes an options bag, so it is called from an arrow: TanStack hands every
    // queryFn its context object, which must not arrive as the action's options.
    expect(jadwalPage).toContain("queryFn: () => getEventsAction()");
    expect(jadwalPage).toContain("queryFn: getAnnouncementsAction");
    expect(adminPage).toContain("getEventsAction({ includeCancelledOccurrences: true })");
  });

  it("/tugas ticks the checklist optimistically and rolls a rejected write back", () => {
    expect(tugasPage).toContain("useMutation({");
    const start = tugasPage.indexOf("const checklistToggleMutation = useMutation");
    expect(start, "checklist toggle is not a useMutation").toBeGreaterThan(-1);
    const body = tugasPage.slice(start, tugasPage.indexOf("const handleToggleChecklist", start));
    expect(body.length).toBeGreaterThan(150);
    expect(body).toContain("toggleChecklistItemAction");
    expect(body).toContain("onMutate:");
    expect(body).toContain("queryClient.getQueryData");
    expect(body).toContain("queryClient.setQueryData");
    expect(body).toContain("onSettled:");
    expect(body).toContain("invalidateTasks(");
    // The action answers { success, message } instead of throwing, so the rollback has to be
    // driven from the result as well as from onError.
    expect(body).toMatch(/!res\.success|!result\.success/);
  });

  it("/jadwal marks an announcement read optimistically and rolls back", () => {
    const start = jadwalPage.indexOf("const markReadMutation = useMutation");
    expect(start, "mark-read is not a useMutation").toBeGreaterThan(-1);
    const body = jadwalPage.slice(start, jadwalPage.indexOf("const handleMarkRead", start));
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain("markAnnouncementReadAction");
    expect(body).toContain("onMutate:");
    expect(body).toContain("queryClient.getQueryData");
    expect(body).toContain("invalidateAnnouncements(queryClient, user)");
    // The optimistic list is patched in the query cache, not in a detached useState mirror.
    expect(jadwalPage).not.toContain("const [announcements, setAnnouncements]");
    expect(jadwalPage).not.toContain("const [events, setEvents]");
  });

  it("/admin/jadwal resets the manager list and the user surfaces after every write", () => {
    // These two bridges existed only while `/` read the same lists through data-cache. Batch 2
    // migrated it, so an agenda write goes through TanStack alone.
    expect(cacheKeysSource).not.toContain('invalidateCache("events:")');
    expect(cacheKeysSource).not.toContain('invalidateCache("announcements:")');
    for (const name of ["deleteEventMutation", "occurrenceMutation", "announcementMutation"]) {
      expect(adminPage, `${name} is missing`).toContain(`const ${name} = useMutation({`);
    }
    const deleteStart = adminPage.indexOf("const deleteEventMutation = useMutation");
    const deleteBody = adminPage.slice(deleteStart, adminPage.indexOf("const handleDeleteEvent", deleteStart));
    expect(deleteBody.length).toBeGreaterThan(150);
    expect(deleteBody).toContain("deleteEventAction");
    expect(deleteBody).toContain("invalidateEvents(queryClient, currentUser)");
    expect(deleteBody).not.toContain("invalidateCache(");

    const occurrenceStart = adminPage.indexOf("const occurrenceMutation = useMutation");
    const occurrenceBody = adminPage.slice(occurrenceStart, adminPage.indexOf("const handleToggleOccurrence", occurrenceStart));
    expect(occurrenceBody).toContain("setEventOccurrenceCancelledAction");
    expect(occurrenceBody).toContain("invalidateEvents(queryClient, currentUser)");

    const annStart = adminPage.indexOf("const announcementMutation = useMutation");
    const annBody = adminPage.slice(annStart, adminPage.indexOf("const handleCreateAnnouncement", annStart));
    expect(annBody).toContain("invalidateAnnouncements(queryClient, currentUser)");
  });

  it("keeps the identity gate on the client surface where the read path needs it", () => {
    // The keys are session-scoped, so a manager cannot poison a santri entry — but the write
    // decision still belongs to the database, and the page still only renders the surface.
    expect(adminPage).toContain("holdsScheduleRole(currentUser, AGENDA_WRITE_ROLES)");
    expect(adminPage).toContain("holdsScheduleRole(currentUser, AGENDA_MANAGER_ROLES)");
    expect(adminPage).not.toContain("requireRole(");
    expect(adminPage).toMatch(/enabled: canManageEvents/);
    expect(adminPage).toMatch(/enabled: canManageAnnouncements/);
  });
});
