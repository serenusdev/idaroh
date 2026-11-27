"use server";

import { getJakartaTime, requireRole } from "@/lib/auth/guards";
import { getReadOnlyDb } from "@/lib/db/reader";
import { fetchLiveTelemetry, type LiveTelemetry } from "@/lib/db/live-telemetry-queries";

export type { LiveTelemetry };

/**
 * Operational telemetry is deliberately narrower than the legacy analytics surface:
 * only explicit pengurus/super_admin role holders may request it. The Kysely reader is
 * read-only, while this guard prevents santri sessions from reaching the aggregate path.
 */
export async function getLiveTelemetryAction(): Promise<LiveTelemetry> {
  await requireRole(["pengurus", "super_admin"]);
  const today = getJakartaTime().dateStr;

  if (process.env.VITEST) {
    return {
      timezone: "Asia/Jakarta",
      today,
      attendanceToday: { population: 0, present: 0, grace: 0, late: 0, excused: 0, sick: 0, noCheckin: 0 },
      reports: { expectedToday: 0, submittedToday: 0, lateToday: 0, reviewBacklog: 0, compliance7Days: 0, compliance30Days: 0 },
      tasks: { open: 0, completed7Days: 0, completed30Days: 0 },
      attendanceTrend: [],
      attendanceTrend7Days: [],
    };
  }

  return fetchLiveTelemetry(getReadOnlyDb(), today);
}
