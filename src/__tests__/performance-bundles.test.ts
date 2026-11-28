import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthUser = vi.fn();
const getTodayAttendanceStatusAction = vi.fn();
const getActivePolicyAction = vi.fn();
const getAdminDashboardStatsAction = vi.fn();
const getEventsAction = vi.fn();
const getAnnouncementsAction = vi.fn();
const getTodayReportAction = vi.fn();
const getReportCategoriesAction = vi.fn();
const getAttendanceHistoryAction = vi.fn();

vi.mock("@/lib/auth/guards", () => ({ requireAuthUser }));
vi.mock("@/modules/attendance/actions", () => ({ getTodayAttendanceStatusAction, getAttendanceHistoryAction }));
vi.mock("@/modules/analytics/actions", () => ({ getActivePolicyAction, getAdminDashboardStatsAction }));
vi.mock("@/modules/schedules/actions", () => ({ getEventsAction, getAnnouncementsAction }));
vi.mock("@/modules/reports/actions", () => ({ getTodayReportAction, getReportCategoriesAction }));

describe("performance bundles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthUser.mockResolvedValue({ id: "u-1", role: "pengurus", roles: ["santri", "pengurus"], status: "active" });
    getTodayAttendanceStatusAction.mockResolvedValue({ checked_in: true, late_window: false });
    getActivePolicyAction.mockResolvedValue({ code: "active" });
    getAdminDashboardStatsAction.mockResolvedValue({ totalSantri: 3 });
    getEventsAction.mockResolvedValue([{ id: "event-1" }]);
    getAnnouncementsAction.mockResolvedValue([{ id: "announcement-1" }]);
    getTodayReportAction.mockResolvedValue({ id: "report-1" });
    getReportCategoriesAction.mockResolvedValue([{ id: "category-1" }]);
    getAttendanceHistoryAction.mockResolvedValue([{ id: "attendance-1" }]);
  });

  it("returns all home sections from one bundled action and evaluates multi-role access", async () => {
    const { getHomeBundleAction } = await import("@/modules/performance/actions");
    await expect(getHomeBundleAction()).resolves.toEqual({
      todayStatus: { checked_in: true, late_window: false },
      policy: { code: "active" },
      events: [{ id: "event-1" }],
      announcements: [{ id: "announcement-1" }],
      adminStats: { totalSantri: 3 },
    });
    expect(requireAuthUser).toHaveBeenCalledTimes(1);
    expect(getAdminDashboardStatsAction).toHaveBeenCalledTimes(1);
  });

  it("returns the complete reports and attendance bootstraps", async () => {
    const { getReportBundleAction, getAttendanceBundleAction } = await import("@/modules/performance/actions");
    await expect(getReportBundleAction()).resolves.toMatchObject({ today: { id: "report-1" }, categories: [{ id: "category-1" }] });
    await expect(getAttendanceBundleAction()).resolves.toMatchObject({ history: [{ id: "attendance-1" }], todayStatus: { checked_in: true } });
  });

  it("invalidates the bundled cache alongside the existing surface keys", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { cacheKeys, invalidateAttendance, invalidatePolicy, invalidateReports } = await import("@/lib/cache-keys");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const session = { id: "u-1", role: "pengurus" } as const;
    for (const key of [cacheKeys.homeBundle(session), cacheKeys.reportsBundle(session), cacheKeys.attendanceBundle(session)]) {
      await client.fetchQuery({ queryKey: key, queryFn: async () => ({}) });
    }
    await invalidateAttendance(client, session);
    await invalidateReports(client, session);
    await invalidatePolicy(client, session);
    for (const key of [cacheKeys.homeBundle(session), cacheKeys.reportsBundle(session), cacheKeys.attendanceBundle(session)]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
