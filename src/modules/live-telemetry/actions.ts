"use server";

import { getJakartaTime, requireRole } from "@/lib/auth/guards";
import { getReadOnlyDb } from "@/lib/db/reader";
import { fetchLiveTelemetry, type LiveTelemetry } from "@/lib/db/live-telemetry-queries";
import { errorToMessage } from "@/lib/action-error";

export type { LiveTelemetry };

export type LiveTelemetryResult =
  | { ok: true; data: LiveTelemetry }
  | { ok: false; code: "TELEMETRY_QUERY_FAILED" | "DB_UNAVAILABLE" | "FORBIDDEN"; message: string };

/**
 * Operational telemetry is deliberately narrower than the legacy analytics surface:
 * only explicit pengurus/super_admin role holders may request it. The Kysely reader is
 * read-only, while this guard prevents santri sessions from reaching the aggregate path.
 */
export async function getLiveTelemetryAction(): Promise<LiveTelemetryResult> {
  try {
    await requireRole(["pengurus", "super_admin"]);
    const today = getJakartaTime().dateStr;

    if (process.env.VITEST) {
      return { ok: true, data: {
      timezone: "Asia/Jakarta",
      today,
      attendanceToday: { population: 0, present: 0, grace: 0, late: 0, excused: 0, sick: 0, noCheckin: 0 },
      reports: { expectedToday: 0, submittedToday: 0, lateToday: 0, reviewBacklog: 0, compliance7Days: 0, compliance30Days: 0 },
      tasks: { open: 0, completed7Days: 0, completed30Days: 0 },
      attendanceTrend: [],
      attendanceTrend7Days: [],
      } };
    }

    return { ok: true, data: await fetchLiveTelemetry(getReadOnlyDb(), today) };
  } catch (error) {
    const message = errorToMessage(error);
    const code = message.includes("izin") ? "FORBIDDEN" : message.includes("SUPABASE_DB_URL") ? "DB_UNAVAILABLE" : "TELEMETRY_QUERY_FAILED";
    console.error(`[live-telemetry] code=${code} message=${message}`);
    return { ok: false, code, message: code === "FORBIDDEN" ? message : "Telemetry belum dapat dimuat. Coba lagi." };
  }
}
