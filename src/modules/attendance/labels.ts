import type { AttendanceClassification } from "./types";

/**
 * The effective-attendance layer (attendance_effective.status) is the auditable operational
 * result, so every status the database CHECK allows has to have a label here: the history page
 * drops rows it cannot name, which is how a Sunday could silently disappear from a santri's own
 * riwayat instead of reading "Hari Non-Operasional".
 *
 * Pure display data — deliberately NOT inside the "use server" actions module so it can be
 * unit-tested and reused, exactly like classification.ts.
 */
export const EFFECTIVE_STATUS_LABELS: Record<AttendanceClassification, string> = {
  on_time: "Tepat Waktu",
  grace: "Masa Toleransi",
  late: "Terlambat",
  excused: "Izin Resmi",
  sick: "Sakit",
  duty: "Tugas Luar",
  no_checkin: "Belum Presensi",
  non_operational: "Hari Non-Operasional",
  not_required: "Tidak Wajib Presensi",
};

/**
 * A correction asks "the database got my day wrong"; there is nothing to correct on a day nobody
 * was expected to attend, so the non-operational statuses never offer the correction form.
 */
export const CORRECTABLE_STATUSES: readonly AttendanceClassification[] = ["late", "grace", "no_checkin"];
