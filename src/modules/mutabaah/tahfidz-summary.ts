export interface HalaqahSummaryEntry {
  id: string;
  session_date: string;
  entry_type: "ziyadah" | "murojaah";
  surah_name: string;
  ayah_from: number;
  ayah_to: number;
  quality_grade: string;
  tajwid_errors: string;
  notes: string;
}

export function mergeHalaqahIntoTahfidzData(base: unknown, logs: HalaqahSummaryEntry[]) {
  const current = base && typeof base === "object" && !Array.isArray(base) ? base as Record<string, unknown> : {};
  return {
    ...current,
    halaqah_summary: {
      total_entries: logs.length,
      ziyadah_count: logs.filter((log) => log.entry_type === "ziyadah").length,
      murojaah_count: logs.filter((log) => log.entry_type === "murojaah").length,
      latest_session_date: logs[0]?.session_date ?? null,
    },
    halaqah_logs: logs,
  };
}
