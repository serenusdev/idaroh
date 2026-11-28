"use server";

import { getActivePolicyAction } from "@/modules/analytics/actions";
import { getAttendanceHistoryAction, getTodayAttendanceStatusAction } from "@/modules/attendance/actions";

export type AttendanceBundle = {
  history: Awaited<ReturnType<typeof getAttendanceHistoryAction>>;
  policy: Awaited<ReturnType<typeof getActivePolicyAction>>;
  todayStatus: Awaited<ReturnType<typeof getTodayAttendanceStatusAction>>;
};

/** Attendance page bootstrap: history, policy and today's status load in parallel. */
export async function getAttendanceBundleAction(): Promise<AttendanceBundle> {
  const [history, policy, todayStatus] = await Promise.all([
    getAttendanceHistoryAction(),
    getActivePolicyAction(),
    getTodayAttendanceStatusAction(),
  ]);
  return { history, policy, todayStatus };
}
