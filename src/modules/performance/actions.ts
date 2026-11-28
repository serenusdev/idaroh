"use server";

import { requireAuthUser } from "@/lib/auth/guards";
import { getTodayAttendanceStatusAction } from "@/modules/attendance/actions";
import { getActivePolicyAction, getAdminDashboardStatsAction } from "@/modules/analytics/actions";
import { getEventsAction, getAnnouncementsAction } from "@/modules/schedules/actions";
import { getTodayReportAction, getReportCategoriesAction } from "@/modules/reports/actions";
import { getAttendanceHistoryAction } from "@/modules/attendance/actions";
import { holdsRole } from "@/lib/export-policy";

export type HomeBundle = {
  todayStatus: Awaited<ReturnType<typeof getTodayAttendanceStatusAction>>;
  policy: Awaited<ReturnType<typeof getActivePolicyAction>>;
  events: Awaited<ReturnType<typeof getEventsAction>>;
  announcements: Awaited<ReturnType<typeof getAnnouncementsAction>>;
  adminStats: Awaited<ReturnType<typeof getAdminDashboardStatsAction>> | null;
};

export type ReportBundle = {
  today: Awaited<ReturnType<typeof getTodayReportAction>>;
  categories: Awaited<ReturnType<typeof getReportCategoriesAction>>;
  policy: Awaited<ReturnType<typeof getActivePolicyAction>>;
};

export type AttendanceBundle = {
  history: Awaited<ReturnType<typeof getAttendanceHistoryAction>>;
  policy: Awaited<ReturnType<typeof getActivePolicyAction>>;
  todayStatus: Awaited<ReturnType<typeof getTodayAttendanceStatusAction>>;
};

/** One browser request; child actions share the request-memoized identity guard. */
export async function getHomeBundleAction(): Promise<HomeBundle> {
  const user = await requireAuthUser();
  const [todayStatus, policy, events, announcements, adminStats] = await Promise.all([
    getTodayAttendanceStatusAction(),
    getActivePolicyAction(),
    getEventsAction(),
    getAnnouncementsAction(),
    holdsRole(user, ["super_admin", "yayasan", "pengurus"])
      ? getAdminDashboardStatsAction()
      : Promise.resolve(null),
  ]);
  return { todayStatus, policy, events, announcements, adminStats };
}

/** Reports page bootstrap: draft, categories and policy load in parallel. */
export async function getReportBundleAction(): Promise<ReportBundle> {
  await requireAuthUser();
  const [today, categories, policy] = await Promise.all([
    getTodayReportAction(),
    getReportCategoriesAction(),
    getActivePolicyAction(),
  ]);
  return { today, categories, policy };
}

/** Attendance page bootstrap: history, policy and today's status load in parallel. */
export async function getAttendanceBundleAction(): Promise<AttendanceBundle> {
  await requireAuthUser();
  const [history, policy, todayStatus] = await Promise.all([
    getAttendanceHistoryAction(),
    getActivePolicyAction(),
    getTodayAttendanceStatusAction(),
  ]);
  return { history, policy, todayStatus };
}
