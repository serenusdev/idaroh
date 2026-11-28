"use server";

import { requireAuthUser } from "@/lib/auth/guards";
import { getTodayAttendanceStatusAction } from "@/modules/attendance/actions";
import { getActivePolicyAction, getAdminDashboardStatsAction } from "@/modules/analytics/actions";
import { getEventsAction, getAnnouncementsAction } from "@/modules/schedules/actions";
import { holdsRole } from "@/lib/export-policy";

export type HomeBundle = {
  todayStatus: Awaited<ReturnType<typeof getTodayAttendanceStatusAction>>;
  policy: Awaited<ReturnType<typeof getActivePolicyAction>>;
  events: Awaited<ReturnType<typeof getEventsAction>>;
  announcements: Awaited<ReturnType<typeof getAnnouncementsAction>>;
  adminStats: Awaited<ReturnType<typeof getAdminDashboardStatsAction>> | null;
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
