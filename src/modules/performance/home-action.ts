"use server";

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
  // Child actions enforce the same request-memoized identity guard. Keeping the wrapper free of a
  // direct auth import also prevents server-only auth dependencies entering browser test bundles.
  const user = await getHomeUserForGate();
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

async function getHomeUserForGate() {
  const { requireAuthUser } = await import("@/lib/auth/guards");
  return requireAuthUser();
}
