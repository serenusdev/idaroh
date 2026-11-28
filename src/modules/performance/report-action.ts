"use server";

import type { getActivePolicyAction } from "@/modules/analytics/actions";
import type { getTodayReportAction, getReportCategoriesAction } from "@/modules/reports/actions";

export type ReportBundle = {
  today: Awaited<ReturnType<typeof getTodayReportAction>>;
  categories: Awaited<ReturnType<typeof getReportCategoriesAction>>;
  policy: Awaited<ReturnType<typeof getActivePolicyAction>>;
};

/** Reports page bootstrap: draft, categories and policy load in parallel. */
export async function getReportBundleAction(): Promise<ReportBundle> {
  const [analytics, reports] = await Promise.all([
    import("@/modules/analytics/actions"),
    import("@/modules/reports/actions"),
  ]);
  const [today, categories, policy] = await Promise.all([
    reports.getTodayReportAction(),
    reports.getReportCategoriesAction(),
    analytics.getActivePolicyAction(),
  ]);
  return { today, categories, policy };
}
