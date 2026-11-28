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

  it("extracts the classification fields from the classifier object", () => {
    const migration = read("supabase/migrations/202612030001_attendance_checkin_and_multi_role.sql");
    expect(migration).toContain("app.wave5_3_classify_time(v_now_wib::time)->>'classification'");
    expect(migration).toContain("app.wave5_3_classify_time(v_now_wib::time)->>'status'");
    expect(migration).not.toContain("FROM jsonb_each(app.wave5_3_classify_time(v_now_wib::time))");
  });

  it("keeps the Beranda card on the same server status and late-window labels", () => {
    const home = read("src/app/(app)/page.tsx");
    expect(home).toContain("getHomeBundleAction");
    expect(home).toContain("late_window");
    expect(home).toContain("Presensi Terlambat (> 08:15)");
    expect(home).toContain("bg-red-600");
  });
});
