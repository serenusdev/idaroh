import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CRON_GRACE_MINUTES, CRON_JOB_KEYS, isCronJobDue, jakartaWeekday } from "@/lib/cron-schedule";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = { timeWib: "07:30", daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true };
// 2026-11-12 is a Thursday (4), 2026-11-15 a Sunday (0).
const thursday = { dateStr: "2026-11-12", hours: 7, minutes: 30 };

describe("isCronJobDue", () => {
  it("fires at the scheduled minute and across the grace window, once per boundary", () => {
    expect(isCronJobDue(base, thursday)).toBe(true);
    expect(isCronJobDue(base, { ...thursday, minutes: 30 + CRON_GRACE_MINUTES - 1 })).toBe(true);
    expect(isCronJobDue(base, { ...thursday, minutes: 30 + CRON_GRACE_MINUTES })).toBe(false);
    expect(isCronJobDue(base, { ...thursday, minutes: 29 })).toBe(false);
  });

  it("keeps the grace window wider than the 15-minute heartbeat", () => {
    expect(CRON_GRACE_MINUTES).toBeGreaterThan(15);
  });

  it("respects the enabled flag and weekday selection", () => {
    expect(isCronJobDue({ ...base, enabled: false }, thursday)).toBe(false);
    const sunday = { dateStr: "2026-11-15", hours: 7, minutes: 30 };
    expect(isCronJobDue(base, sunday)).toBe(false);
    expect(isCronJobDue({ ...base, daysOfWeek: [0] }, sunday)).toBe(true);
    expect(isCronJobDue({ ...base, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, sunday)).toBe(true);
  });

  it("rejects malformed schedule times instead of throwing", () => {
    expect(isCronJobDue({ ...base, timeWib: "bukan-jam" }, thursday)).toBe(false);
    expect(isCronJobDue({ ...base, timeWib: "" }, thursday)).toBe(false);
  });

  it("handles midnight schedules without wrapping into the previous day", () => {
    const midnight = { timeWib: "00:30", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], enabled: true };
    expect(isCronJobDue(midnight, { dateStr: "2026-11-12", hours: 0, minutes: 30 })).toBe(true);
    expect(isCronJobDue(midnight, { dateStr: "2026-11-12", hours: 0, minutes: 49 })).toBe(true);
    expect(isCronJobDue(midnight, { dateStr: "2026-11-12", hours: 0, minutes: 50 })).toBe(false);
    expect(isCronJobDue(midnight, { dateStr: "2026-11-12", hours: 23, minutes: 59 })).toBe(false);
  });
});

describe("jakartaWeekday", () => {
  it("derives the weekday from the WIB calendar date, not the server timezone", () => {
    expect(jakartaWeekday("2026-11-12")).toBe(4);
    expect(jakartaWeekday("2026-11-13")).toBe(5);
    expect(jakartaWeekday("2026-11-15")).toBe(0);
    expect(jakartaWeekday("2026-11-16")).toBe(1);
  });
});

describe("cron schedule migration and deployment heartbeat", () => {
  const migration = readFileSync(resolve(root, "supabase/migrations/20261112000004_cron_job_schedules.sql"), "utf8");

  it("locks the schedule table to service-role access with validated rows", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toMatch(/REVOKE ALL ON public\.cron_job_schedules FROM PUBLIC, anon, authenticated/);
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.cron_job_schedules TO service_role");
    expect(migration).toMatch(/time_wib ~ '\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$'/);
    expect(migration).toContain("cardinality(days_of_week) > 0");
    expect(migration).toContain("days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]");
  });

  it("seeds exactly the jobs the routes and admin UI understand", () => {
    for (const key of CRON_JOB_KEYS) {
      expect(migration).toContain(`('${key}'`);
    }
    expect(migration).toContain("ON CONFLICT (job_key) DO NOTHING");
  });

  it("runs both cron endpoints on a fixed heartbeat instead of hardcoded job times", () => {
    const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
    expect(vercel.crons).toEqual([
      { path: "/api/cron/notifications", schedule: "*/15 * * * *" },
      { path: "/api/cron/backups", schedule: "*/15 * * * *" },
    ]);
  });
});