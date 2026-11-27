export const ATTENDANCE_NOTIFICATION_STAGES = [
  { stage: "0730_morning", minute: 7 * 60 + 30, body: "Pengingat pagi: silakan melakukan presensi." },
  { stage: "0805_near_limit", minute: 8 * 60 + 5, body: "Batas toleransi presensi mendekat pada 08:15 WIB." },
  { stage: "0816_late_alert", minute: 8 * 60 + 16, body: "Anda belum presensi dan kini tercatat berisiko terlambat." },
] as const;

export type AttendanceNotificationStage = typeof ATTENDANCE_NOTIFICATION_STAGES[number]["stage"];

/** Returns stages whose WIB time has arrived; the database unique key makes retries idempotent. */
export function dueAttendanceNotificationStages(totalMinutes: number): typeof ATTENDANCE_NOTIFICATION_STAGES[number][] {
  return ATTENDANCE_NOTIFICATION_STAGES.filter((stage) => totalMinutes >= stage.minute);
}
