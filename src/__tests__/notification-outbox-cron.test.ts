import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), drain: vi.fn(), send: vi.fn(), jakarta: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/fcm", () => ({ drainNotificationOutbox: mocks.drain, sendPushToUsers: mocks.send }));
vi.mock("@/lib/auth/guards", () => ({ getJakartaTime: mocks.jakarta }));
import { GET } from "@/app/api/cron/notifications/route";

let dueIds: string[];
let events: string[];
let claimed: Set<string>;
let dueError: Error | null;
let scheduleRows: { job_key: string; time_wib: string; days_of_week: number[]; enabled: boolean }[];
let scheduleError: Error | null;
function query(table: string) {
  let operation = "select";
  let id: string | undefined;
  let jobKey = "";
  const result = () => {
    if (table === "cron_job_schedules") return { data: scheduleRows, error: scheduleError };
    if (table === "announcements") {
      if (operation === "select") return { data: dueIds.map((id) => ({ id })), error: dueError };
      if (id) { events.push(`publish:${id}`); return { data: { id }, error: null }; }
      return { data: [], error: null };
    }
    if (table === "cron_job_runs" && operation === "insert") {
      if (claimed.has(jobKey)) return { data: null, error: { code: "23505" } };
      claimed.add(jobKey); return { data: { job_key: jobKey }, error: null };
    }
    if (table === "profiles") return { data: [{ id: "user-1" }], error: null };
    if (table === "attendance_effective") return { data: [{ user_id: "user-1" }], error: null };
    return { data: [], error: null };
  };
  const chain = {
    select: () => chain,
    update: () => { operation = "update"; return chain; },
    insert: (payload: { job_key: string }) => { operation = "insert"; jobKey = payload.job_key; return chain; },
    delete: () => chain,
    eq: (key: string, value: string) => { if (key === "id") id = value; return chain; },
    not: () => chain, lte: () => chain, gte: () => chain, lt: () => chain, in: () => chain,
    maybeSingle: async () => result(),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return chain;
}
function request(auth = true) {
  return new Request("http://localhost/api/cron/notifications", { headers: auth ? { authorization: "Bearer cron-test" } : {} });
}
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-test");
  dueIds = []; events = []; claimed = new Set(); dueError = null; scheduleError = null;
  scheduleRows = [
    { job_key: "attendance_reminder", time_wib: "07:30", days_of_week: [1, 2, 3, 4, 5, 6], enabled: true },
    { job_key: "report_reminder", time_wib: "21:00", days_of_week: [1, 2, 3, 4, 5, 6], enabled: true },
  ];
  mocks.admin.mockReturnValue({ from: query, rpc: vi.fn(async () => ({ data: null, error: null })) });
  mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 12, minutes: 0 });
  mocks.drain.mockReset(); mocks.send.mockReset();
  mocks.drain.mockImplementation(async () => { events.push("drain"); return { sent: 0, removed: 0, skipped: true }; });
  mocks.send.mockResolvedValue({ sent: 0, removed: 0, skipped: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("notification cron outbox integration", () => {
  it("never dispatches unauthorized requests", async () => {
    const response = await GET(request(false));
    expect(response.status).toBe(401); expect(mocks.drain).not.toHaveBeenCalled();
  });
  it("publishes before draining and drains even when the reminder path skips", async () => {
    dueIds = ["announcement-1"];
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(events).toEqual(["publish:announcement-1", "drain"]);
    expect(await response.json()).toMatchObject({ skipped: true, scheduledPublished: 1, outboxPush: { skipped: true } });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("drains again on each invocation, including already-processed reminders", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    claimed.add("attendance-reminder:2026-11-12");
    expect(await (await GET(request())).json()).toMatchObject({ reason: "already_processed" });
    await GET(request()); expect(mocks.drain).toHaveBeenCalledTimes(2);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("attempts a drain even when publication lookup fails", async () => {
    dueError = new Error("announcement query failed");
    expect((await GET(request())).status).toBe(500);
    expect(mocks.drain).toHaveBeenCalledTimes(1);
  });
  it("gives attendance and report reminders day-specific reference ids", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    expect((await GET(request())).status).toBe(200);
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-13", hours: 7, minutes: 30 });
    expect((await GET(request())).status).toBe(200);
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-13", hours: 21, minutes: 0 });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.send.mock.calls.map(([, message]) => [message.type, message.referenceId])).toEqual([
      ["ATTENDANCE_REMINDER", "2026-11-12"], ["ATTENDANCE_REMINDER", "2026-11-13"], ["REPORT_DEADLINE_REMINDER", "2026-11-13"],
    ]);
  });
  it("honors admin-edited schedule times instead of hardcoded windows", async () => {
    scheduleRows[0].time_wib = "08:15";
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    expect(await (await GET(request())).json()).toMatchObject({ skipped: true });
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 8, minutes: 15 });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.send.mock.calls.map(([, message]) => message.type)).toEqual(["ATTENDANCE_REMINDER"]);
  });

  it("skips disabled schedules, unselected weekdays and missing rows", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    scheduleRows[0].enabled = false;
    expect(await (await GET(request())).json()).toMatchObject({ skipped: true });
    scheduleRows[0].enabled = true;
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-15", hours: 7, minutes: 30 });
    expect(await (await GET(request())).json()).toMatchObject({ skipped: true });
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    scheduleRows = scheduleRows.filter((row) => row.job_key !== "attendance_reminder");
    expect(await (await GET(request())).json()).toMatchObject({ skipped: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("fires inside the grace window and stops at its boundary", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 49 });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    claimed.clear();
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 50 });
    expect(await (await GET(request())).json()).toMatchObject({ skipped: true });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("fails closed on schedule read errors but still drains the outbox", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    scheduleError = new Error("schedule read failed");
    expect((await GET(request())).status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.drain).toHaveBeenCalledTimes(1);
  });

  it("keeps manual publication delivery trigger-owned, including draft transitions", () => {
    const actions = readFileSync(new URL("../modules/schedules/actions.ts", import.meta.url), "utf8");
    expect(actions).not.toMatch(/type: "ANNOUNCEMENT_PUBLISHED"/);
    expect(actions).toContain('drainNotificationOutbox({ notificationType: "ANNOUNCEMENT_PUBLISHED", referenceId: newId })');
    expect(actions).toContain('if (existing.status !== "published")');
    expect(actions).toContain('drainNotificationOutbox({ notificationType: "ANNOUNCEMENT_PUBLISHED", referenceId: announcementId })');
  });
});
