import { describe, it, expect } from "vitest";
import {
  checkInAttendanceAction,
  submitCorrectionAction,
  submitExceptionAction,
} from "@/modules/attendance/actions";
import { resolveCorrectionClassification } from "@/modules/attendance/classification";
import {
  WEEK_ATTENDANCE_STRIP,
  ATTENDANCE_HISTORY,
  ATTENDANCE_MONTHLY_STATS,
} from "@/modules/attendance/data";

describe("Stage 4 — Attendance Module (PRD-03)", () => {
  it("records attendance with valid server time and classification", async () => {
    const result = await checkInAttendanceAction();
    expect(result.success).toBe(true);
    expect(["on_time", "grace", "late"]).toContain(result.classification);
    expect(result.timeStr).toMatch(/\d{2}:\d{2}:\d{2} WIB/);
    expect(result.message).toContain("Presensi berhasil dicatat");
  });

  it("enforces correction request validation (ATT-007)", async () => {
    const invalidResult = await submitCorrectionAction({
      attendanceDate: "2026-11-14",
      recordedTime: "08:08 WIB",
      reasonCategory: "",
    });
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.message).toContain("Alasan koreksi presensi wajib dipilih");

    const validResult = await submitCorrectionAction({
      attendanceDate: "2026-11-14",
      recordedTime: "08:08 WIB",
      reasonCategory: "Tugas mendesak / Piket pondok",
      notes: "Dipanggil ustadz pengasuh untuk logistik pagi",
    });
    expect(validResult.success).toBe(true);
    expect(validResult.message).toContain("Pengajuan koreksi untuk 2026-11-14");
  });

  it("validates leave and sick exception submissions (BR-ATT-06)", async () => {
    const invalidSick = await submitExceptionAction("2026-11-17", "2026-11-18", "sick", "   ");
    expect(invalidSick.success).toBe(false);
    expect(invalidSick.message).toContain("Keterangan alasan izin / sakit wajib diisi");

    const validSick = await submitExceptionAction(
      "2026-11-17",
      "2026-11-18",
      "sick",
      "Demam tinggi dan istirahat di Poskestren"
    );
    expect(validSick.success).toBe(true);
    expect(validSick.message).toContain("Permohonan Sakit");
  });

  it("verifies operational days and non-operational Sunday per BR-ATT-04", () => {
    expect(WEEK_ATTENDANCE_STRIP).toHaveLength(7);
    const sunday = WEEK_ATTENDANCE_STRIP.find((d) => d.dayName === "Ahad");
    expect(sunday).toBeDefined();
    expect(sunday?.status).toBe("holiday");
    expect(sunday?.label).toBe("Libur Operasional");
  });

  it("calculates attendance rate accurately from monthly statistics", () => {
    const { onTimeCount, graceCount, excusedCount, lateCount, attendanceRate } = ATTENDANCE_MONTHLY_STATS;
    const totalPresent = onTimeCount + graceCount + excusedCount + lateCount;
    expect(totalPresent).toBe(16);
    expect(attendanceRate).toBe(94.2);
  });

  it("preserves attendance history immutable audit records", () => {
    expect(ATTENDANCE_HISTORY.length).toBeGreaterThanOrEqual(3);
    const excuseItem = ATTENDANCE_HISTORY.find((item) => item.classification === "excused");
    expect(excuseItem?.canCorrect).toBe(false);
  });

  it("derives requested classification from reason and recomputes against policy (FUNC-12)", () => {
    expect(resolveCorrectionClassification("missed_checkin", "", "08:00", "08:15")).toEqual({ classification: "on_time" });
    expect(resolveCorrectionClassification("system_error", "", "08:00", "08:15")).toEqual({ classification: "on_time" });
    expect(resolveCorrectionClassification("other", "", "08:00", "08:15")).toEqual({ classification: "excused" });

    expect(resolveCorrectionClassification("wrong_time", "07:50 WIB", "08:00", "08:15")).toEqual({ classification: "on_time" });
    expect(resolveCorrectionClassification("wrong_time", "08:08 WIB", "08:00", "08:15")).toEqual({ classification: "grace" });
    expect(resolveCorrectionClassification("wrong_time", "08:30 WIB", "08:00", "08:15")).toEqual({ classification: "late" });
    expect(resolveCorrectionClassification("wrong_time", "08:08 WIB", "07:30", "07:45")).toEqual({ classification: "late" });

    expect(resolveCorrectionClassification("wrong_time", "", "08:00", "08:15")).toHaveProperty("error");
    expect(resolveCorrectionClassification("unknown_category", "08:00", "08:00", "08:15")).toHaveProperty("error");
  });
});
