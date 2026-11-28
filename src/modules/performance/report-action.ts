"use server";

import { requireAuthUser } from "@/lib/auth/guards";
import { getActivePolicyAction } from "@/modules/analytics/actions";
import { getTodayReportAction, getReportCategoriesAction } from "@/modules/reports/actions";

export type ReportBundle = {
  today: Awaited<ReturnType<typeof getTodayReportAction>>;
  categories: Awaited<ReturnType<typeof getReportCategoriesAction>>;
  policy: Awaited<ReturnType<typeof getActivePolicyAction>>;
};

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
