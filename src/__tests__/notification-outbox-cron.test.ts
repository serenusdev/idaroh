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
let snapshotError: Error | null;
let operationalDay: boolean | null;
let dayError: Error | null;
let profilesError: Error | null;
let profiles: { id: string; attendance_reminder_enabled: boolean; status: string; member_type: string }[];
let missingAttendance: { user_id: string }[];
let attendance: { user_id: string }[];
let reports: { user_id: string }[];
let exceptions: { user_id: string }[];
let profileSelects: string[];
function query(table: string) {
  let operation = "select";
  let id: string | undefined;
  let jobKey = "";
  const filters: [string, string][] = [];
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
    if (table === "profiles") return {
      data: profiles.filter(profile => filters.every(([key, value]) => profile[key as keyof typeof profile] === value)),
      error: profilesError,
    };
    if (table === "attendance_effective") return { data: missingAttendance, error: null };
    if (table === "attendance_records") return { data: attendance, error: null };
    if (table === "daily_reports") return { data: reports, error: null };
    if (table === "attendance_exceptions") return { data: exceptions, error: null };
    return { data: [], error: null };
  };
  const chain = {
    select: (columns: string) => { if (table === "profiles") profileSelects.push(columns); return chain; },
    update: () => { operation = "update"; return chain; },
    insert: (payload: { job_key: string }) => { operation = "insert"; jobKey = payload.job_key; return chain; },
    delete: () => chain,
    eq: (key: string, value: string) => { filters.push([key, value]); if (key === "id") id = value; return chain; },
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
  snapshotError = null; profilesError = null; profileSelects = [];
  operationalDay = true; dayError = null;
  profiles = [{ id: "user-1", attendance_reminder_enabled: true, status: "active", member_type: "santri" }];
  missingAttendance = [{ user_id: "user-1" }]; attendance = []; reports = []; exceptions = [];
  mocks.admin.mockReturnValue({
    from: query,
    rpc: vi.fn(async (fn: string) => (
      fn === "is_operational_day" ? { data: operationalDay, error: dayError } : { data: null, error: snapshotError }
    )),
  });
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

  it("holds the attendance reminder on a non-operational day but not the report reminder", async () => {
    // An admin selected Sunday in the weekday picker, and the day is a calendar closure: only the
    // database day rule knows the difference, which is why the cron asks instead of filtering rows.
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-24", hours: 7, minutes: 30 });
    scheduleRows[0].days_of_week = [0, 1, 2, 3, 4, 5, 6];
    scheduleRows[1].days_of_week = [0, 1, 2, 3, 4, 5, 6];
    scheduleRows[1].time_wib = "07:30";
    operationalDay = false;
    expect((await GET(request())).status).toBe(200);
    expect(mocks.send.mock.calls.map(([, message]) => message.type)).toEqual(["REPORT_DEADLINE_REMINDER"]);
    expect(claimed.has("attendance-reminder:2026-11-24")).toBe(false);
  });

  it("treats an absent day answer as not operational rather than defaulting to sending", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-23", hours: 7, minutes: 30 });
    operationalDay = null;
    expect((await GET(request())).status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("fails rather than guessing the calendar when the day guard cannot be read", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-23", hours: 7, minutes: 30 });
    dayError = new Error("day guard unavailable");
    expect((await GET(request())).status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(claimed.size).toBe(0);
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

  it.each(["effective", "fallback"])("OPS-12 filters attendance preferences in the %s path without suppressing reports", async (path) => {
    snapshotError = path === "fallback" ? new Error("snapshot unavailable") : null;
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    scheduleRows[1].time_wib = "07:30";
    profiles = ["enabled", "disabled", "checked-in", "submitted", "excused", "inactive", "staff"].map(id => ({
      id, attendance_reminder_enabled: id !== "disabled", status: id === "inactive" ? "inactive" : "active",
      member_type: id === "staff" ? "staff" : "santri",
    }));
    missingAttendance = profiles.filter(profile => profile.id !== "checked-in").map(profile => ({ user_id: profile.id }));
    attendance = [{ user_id: "checked-in" }];
    reports = [{ user_id: "submitted" }];
    exceptions = [{ user_id: "excused" }];
    expect((await GET(request())).status).toBe(200);
    expect(profileSelects).toEqual(["id, attendance_reminder_enabled"]);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledWith(["enabled", "submitted"], expect.objectContaining({ type: "ATTENDANCE_REMINDER" }));
    expect(mocks.send).toHaveBeenCalledWith(["enabled", "disabled", "checked-in"], expect.objectContaining({ type: "REPORT_DEADLINE_REMINDER" }));
  });

  it.each(["effective", "fallback"])("OPS-12 sends no attendance recipients when all opted out in the %s path", async (path) => {
    snapshotError = path === "fallback" ? new Error("snapshot unavailable") : null;
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    scheduleRows[1].time_wib = "07:30";
    profiles[0].attendance_reminder_enabled = false;
    expect((await GET(request())).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith([], expect.objectContaining({ type: "ATTENDANCE_REMINDER" }));
    expect(mocks.send).toHaveBeenCalledWith(["user-1"], expect.objectContaining({ type: "REPORT_DEADLINE_REMINDER" }));
  });

  it("OPS-12 reports still include opted-out santri when only the report job is due", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 21, minutes: 0 });
    profiles[0].attendance_reminder_enabled = false;
    expect((await GET(request())).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(["user-1"], expect.objectContaining({ type: "REPORT_DEADLINE_REMINDER" }));
  });

  it("OPS-12 fails rather than guessing preferences when the profile query fails", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 7, minutes: 30 });
    profilesError = new Error("preference column unavailable");
    expect((await GET(request())).status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("keeps manual publication delivery trigger-owned, including draft transitions", () => {
    const actions = readFileSync(new URL("../modules/schedules/actions.ts", import.meta.url), "utf8");
    expect(actions).not.toMatch(/type: "ANNOUNCEMENT_PUBLISHED"/);
    expect(actions).toContain('drainNotificationOutbox({ notificationType: "ANNOUNCEMENT_PUBLISHED", referenceId: newId })');
    expect(actions).toContain('if (existing.status !== "published")');
    expect(actions).toContain('drainNotificationOutbox({ notificationType: "ANNOUNCEMENT_PUBLISHED", referenceId: announcementId })');
  });
});
