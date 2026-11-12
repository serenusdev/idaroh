import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/auth/guards", () => ({ requireRole: mocks.requireRole }));

import { getCronJobSchedulesAction, updateCronJobScheduleAction } from "@/modules/cron/actions";

const validInput = { timeWib: "07:45", daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true };

function mockDatabase() {
  const scheduleEq = vi.fn().mockResolvedValue({ error: null });
  const scheduleUpdate = vi.fn(() => ({ eq: scheduleEq }));
  const auditInsert = vi.fn().mockResolvedValue({ error: null });
  const order = vi.fn().mockResolvedValue({
    data: [{
      job_key: "attendance_reminder", label: "Pengingat presensi pagi", time_wib: "07:30",
      days_of_week: [1, 2, 3, 4, 5, 6], enabled: true, updated_at: "2026-11-12T00:00:00Z",
    }],
    error: null,
  });
  const select = vi.fn(() => ({ order }));
  const from = vi.fn((table: string) => table === "cron_job_schedules"
    ? { select, update: scheduleUpdate }
    : { insert: auditInsert });
  mocks.createAdminClient.mockReturnValue({ from });
  return { from, select, order, scheduleUpdate, scheduleEq, auditInsert };
}

let database: ReturnType<typeof mockDatabase>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITEST", "");
  mocks.requireRole.mockResolvedValue({ id: "admin-1", role: "super_admin", full_name: "Admin Utama" });
  database = mockDatabase();
});

afterEach(() => { vi.unstubAllEnvs(); });

describe("getCronJobSchedulesAction", () => {
  it("requires super admin before reading schedules", async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(getCronJobSchedulesAction()).rejects.toThrow("FORBIDDEN");
    expect(mocks.requireRole).toHaveBeenCalledWith(["super_admin"]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("maps database rows to the shared schedule shape", async () => {
    const schedules = await getCronJobSchedulesAction();
    expect(database.from).toHaveBeenCalledWith("cron_job_schedules");
    expect(database.order).toHaveBeenCalledWith("job_key");
    expect(schedules).toEqual([{
      jobKey: "attendance_reminder", label: "Pengingat presensi pagi", timeWib: "07:30",
      daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true, updatedAt: "2026-11-12T00:00:00Z",
    }]);
  });

  it("propagates read errors instead of returning empty schedules", async () => {
    database.order.mockResolvedValueOnce({ data: null, error: new Error("Read unavailable") });
    await expect(getCronJobSchedulesAction()).rejects.toThrow("Read unavailable");
  });

  it("serves fixture defaults under VITEST without touching the database", async () => {
    vi.stubEnv("VITEST", "true");
    const schedules = await getCronJobSchedulesAction();
    expect(schedules.map((schedule) => schedule.jobKey)).toEqual(["attendance_reminder", "report_reminder", "backup_manifest"]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("updateCronJobScheduleAction", () => {
  it("requires super admin before validating or writing", async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(updateCronJobScheduleAction("attendance_reminder", validInput)).rejects.toThrow("FORBIDDEN");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unknown job keys without writing", async () => {
    const result = await updateCronJobScheduleAction("drop_database", validInput);
    expect(result).toEqual({ success: false, message: "Job terjadwal tidak dikenal." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(["24:00", "7:5", "07:60", "abc", "", "  "])("rejects invalid time %j", async (timeWib) => {
    const result = await updateCronJobScheduleAction("attendance_reminder", { ...validInput, timeWib });
    expect(result.success).toBe(false);
    expect(result.message).toContain("HH:MM");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([[[]], [[7]], [[-1]], [[1.5]], [1.5]])("rejects invalid day selection %j", async (daysOfWeek) => {
    const result = await updateCronJobScheduleAction("attendance_reminder", { ...validInput, daysOfWeek: daysOfWeek as number[] });
    expect(result.success).toBe(false);
    expect(result.message).toContain("minimal satu hari");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("persists normalized input with actor attribution and an audit entry", async () => {
    const result = await updateCronJobScheduleAction("report_reminder", {
      timeWib: " 21:15 ", daysOfWeek: [6, 1, 1, 3], enabled: false,
    });
    expect(database.scheduleUpdate).toHaveBeenCalledExactlyOnceWith({
      time_wib: "21:15", days_of_week: [1, 3, 6], enabled: false,
      updated_at: expect.any(String), updated_by: "admin-1",
    });
    expect(database.scheduleEq).toHaveBeenCalledWith("job_key", "report_reminder");
    expect(database.auditInsert).toHaveBeenCalledExactlyOnceWith({
      event_name: "cron_schedule.updated",
      actor_id: "admin-1",
      actor_name: "Admin Utama",
      target_id: "report_reminder",
      target_label: "report_reminder",
      action_detail: expect.stringContaining("21:15 WIB"),
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("tick berikutnya");
  });

  it("propagates schedule write errors", async () => {
    database.scheduleEq.mockResolvedValueOnce({ error: new Error("Write unavailable") });
    await expect(updateCronJobScheduleAction("attendance_reminder", validInput)).rejects.toThrow("Write unavailable");
    expect(database.auditInsert).not.toHaveBeenCalled();
  });

  it("does not report success when the audit entry fails", async () => {
    database.auditInsert.mockResolvedValueOnce({ error: new Error("Audit unavailable") });
    await expect(updateCronJobScheduleAction("attendance_reminder", validInput)).rejects.toThrow("Audit unavailable");
  });

  it("returns the fixture success under VITEST without touching the database", async () => {
    vi.stubEnv("VITEST", "true");
    const result = await updateCronJobScheduleAction("attendance_reminder", validInput);
    expect(result).toEqual({ success: true, message: "Jadwal disimpan." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});