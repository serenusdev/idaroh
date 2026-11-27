import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dueAttendanceNotificationStages } from "@/lib/attendance/notification-stages";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("Wave 5.3 strict attendance window", () => {
  it("keeps the three WIB notification stages idempotently ordered", () => {
    expect(dueAttendanceNotificationStages(7 * 60 + 29)).toHaveLength(0);
    expect(dueAttendanceNotificationStages(7 * 60 + 30).map((stage) => stage.stage)).toEqual(["0730_morning"]);
    expect(dueAttendanceNotificationStages(8 * 60 + 5).map((stage) => stage.stage)).toEqual(["0730_morning", "0805_near_limit"]);
    expect(dueAttendanceNotificationStages(8 * 60 + 16).map((stage) => stage.stage)).toEqual(["0730_morning", "0805_near_limit", "0816_late_alert"]);
  });

  it("pins the server-side boundary and one-daily conflict code", () => {
    const migration = read("supabase/migrations/202611300001_wave5_3_attendance_escalation.sql");
    expect(migration).toContain("v_now_wib timestamp := (now() AT TIME ZONE 'Asia/Jakarta')");
    expect(migration).toContain("p_time <= TIME '08:15:00'");
    expect(migration).toContain("ALREADY_CHECKED_IN_TODAY");
    expect(migration).toContain("UNIQUE (user_id, dispatch_date, stage)");
  });

  it("keeps the action and UI on the new server status RPC", () => {
    const actions = read("src/modules/attendance/actions.ts");
    const page = read("src/app/(app)/kehadiran/page.tsx");
    expect(actions).toContain('rpc("check_in_attendance"');
    expect(actions).toContain('rpc("attendance_today_status")');
    expect(page).toContain("Sudah Presensi Hari Ini — Reset 00:00");
    expect(page).toContain("Presensi Terlambat (> 08:15)");
    expect(page).toContain("bg-red-600");
  });
});
