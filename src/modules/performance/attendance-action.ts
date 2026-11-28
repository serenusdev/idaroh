"use server";

import type { getActivePolicyAction } from "@/modules/analytics/actions";
import type { getAttendanceHistoryAction, getTodayAttendanceStatusAction } from "@/modules/attendance/actions";

export type AttendanceBundle = {
  history: Awaited<ReturnType<typeof getAttendanceHistoryAction>>;
  policy: Awaited<ReturnType<typeof getActivePolicyAction>>;
  todayStatus: Awaited<ReturnType<typeof getTodayAttendanceStatusAction>>;
};

/** Attendance page bootstrap: history, policy and today's status load in parallel. */
export async function getAttendanceBundleAction(): Promise<AttendanceBundle> {
  const [analytics, attendance] = await Promise.all([
    import("@/modules/analytics/actions"),
    import("@/modules/attendance/actions"),
  ]);
  const [history, policy, todayStatus] = await Promise.all([
    attendance.getAttendanceHistoryAction(),
    analytics.getActivePolicyAction(),
    attendance.getTodayAttendanceStatusAction(),
  ]);
  return { history, policy, todayStatus };
}
