import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  result: { data: [] as unknown[], error: null as unknown, count: 0 },
  summaryCounts: null as Record<string, number> | null,
  summaryError: null as Error | null,
  calls: [] as Array<[string, unknown[]]>,
  requireRole: vi.fn(async () => ({ id: "admin-own", role: "super_admin" })),
}));
vi.mock("@/lib/auth/guards", () => ({
  requireAuthUser: async () => ({ id: "user-own" }),
  requireRole: mocks.requireRole,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      mocks.calls.push(["from", [table]]);
      const filters: Array<[string, unknown]> = [];
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "order", "limit", "update"]) {
        chain[method] = (...args: unknown[]) => {
          mocks.calls.push([method, args]);
          if (method === "eq" || method === "is") filters.push([args[0] as string, args[1]]);
          return chain;
        };
      }
      chain.then = (resolve: (result: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(() => {
        if (table === "notification_push_outbox") {
          if (mocks.summaryError) return { data: null, error: mocks.summaryError, count: null };
          const status = filters.find(([field]) => field === "status")?.[1];
          return { data: null, error: null, count: mocks.summaryCounts?.[String(status)] ?? 0 };
        }
        return mocks.result;
      }).then(resolve, reject);
      return chain;
    },
  }),
}));

import { getNotificationsAction, getUnreadNotificationCountAction, markNotificationReadAction, markAllNotificationsReadAction, getNotificationDeliverySummaryAction } from "@/modules/notifications/actions";

beforeEach(() => {
  vi.stubEnv("VITEST", "");
  mocks.result = { data: [], error: null, count: 0 };
  mocks.summaryCounts = null;
  mocks.summaryError = null;
  mocks.calls = [];
  mocks.requireRole.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("notification persistence boundary", () => {
  it("fetches only the authenticated user's inbox and clamps the page size", async () => {
    await getNotificationsAction(999);
    expect(mocks.calls).toContainEqual(["eq", ["user_id", "user-own"]]);
    expect(mocks.calls).toContainEqual(["limit", [100]]);
  });
  it("uses an exact unread count rather than the limited inbox length", async () => {
    mocks.result.count = 151;
    expect(await getUnreadNotificationCountAction()).toBe(151);
    expect(mocks.calls).toContainEqual(["select", ["id", { count: "exact", head: true }]]);
    expect(mocks.calls).toContainEqual(["eq", ["user_id", "user-own"]]);
    expect(mocks.calls).toContainEqual(["is", ["read_at", null]]);
  });
  it("does not falsely report a foreign/missing notification as read", async () => {
    expect((await markNotificationReadAction("foreign-id")).success).toBe(false);
    expect(mocks.calls).toContainEqual(["eq", ["user_id", "user-own"]]);
    expect(mocks.calls).toContainEqual(["eq", ["id", "foreign-id"]]);
  });
  it("reports success only after an own unread row is updated", async () => {
    mocks.result.data = [{ id: "own-id" }];
    expect((await markNotificationReadAction("own-id")).success).toBe(true);
    expect(mocks.calls).toContainEqual(["is", ["read_at", null]]);
  });
  it("propagates persistence errors instead of returning success", async () => {
    mocks.result.error = new Error("persistence unavailable");
    await expect(markNotificationReadAction("own-id")).rejects.toThrow("persistence unavailable");
    await expect(markAllNotificationsReadAction()).rejects.toThrow("persistence unavailable");
  });
  it("scopes mark-all to the caller's unread rows", async () => {
    expect((await markAllNotificationsReadAction()).success).toBe(true);
    expect(mocks.calls).toContainEqual(["eq", ["user_id", "user-own"]]);
    expect(mocks.calls).toContainEqual(["is", ["read_at", null]]);
  });
});

describe("operator delivery summary", () => {
  it("requires super_admin before reading outbox counts", async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(getNotificationDeliverySummaryAction()).rejects.toThrow("FORBIDDEN");
    expect(mocks.calls).toEqual([]);
  });

  it("returns exact per-status head counts without message contents", async () => {
    mocks.requireRole.mockClear();
    mocks.summaryCounts = { pending: 4, processing: 2, dead_letter: 1 };
    expect(await getNotificationDeliverySummaryAction()).toEqual({ pending: 4, processing: 2, deadLetter: 1 });
    expect(mocks.requireRole).toHaveBeenCalledWith(["super_admin"]);
    expect(mocks.calls.filter(([method]) => method === "from")).toEqual([
      ["from", ["notification_push_outbox"]], ["from", ["notification_push_outbox"]], ["from", ["notification_push_outbox"]],
    ]);
    expect(mocks.calls).toContainEqual(["select", ["notification_id", { count: "exact", head: true }]]);
    for (const status of ["pending", "processing", "dead_letter"]) {
      expect(mocks.calls).toContainEqual(["eq", ["status", status]]);
    }
  });

  it("propagates outbox query errors instead of reporting zero backlog", async () => {
    mocks.summaryError = new Error("relation does not exist");
    await expect(getNotificationDeliverySummaryAction()).rejects.toThrow("relation does not exist");
  });

  it("keeps the synthetic VITEST branch free of database access", async () => {
    vi.stubEnv("VITEST", "true");
    expect(await getNotificationDeliverySummaryAction()).toEqual({ pending: 0, processing: 0, deadLetter: 0 });
    expect(mocks.calls).toEqual([]);
  });
});
