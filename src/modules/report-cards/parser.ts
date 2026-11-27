import type { ParsedReportRow } from "./types";

function parseJsonCell(value: string | undefined): unknown {
  if (!value?.trim()) return undefined;
  try { return JSON.parse(value); } catch { return value.trim(); }
}

export function parseCsv(text: string): ParsedReportRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const cells = (line: string) => line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((v) => v.trim().replace(/^\"|\"$/g, "").replace(/\"\"/g, "\""));
  const headers = cells(lines[0]).map((v) => v.toLowerCase().replace(/[\s-]+/g, "_"));
  return lines.slice(1).map((line, index) => {
    const values = cells(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
    const confidence = row.nis ? 1 : row.full_name || row.nama ? 0.9 : 0;
    return {
      nis: row.nis || undefined,
      fullName: row.full_name || row.nama || undefined,
      tahfidzData: parseJsonCell(row.tahfidz_data) as Record<string, unknown> | undefined,
      diniyahScores: parseJsonCell(row.diniyah_scores) as unknown[] | undefined,
      adabScores: parseJsonCell(row.adab_scores) as Record<string, unknown> | undefined,
      attendanceSummary: parseJsonCell(row.attendance_summary) as Record<string, unknown> | undefined,
      confidence,
      sourceRow: index + 2,
    };
  });
}

export function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchStudent(row: ParsedReportRow, students: Array<{ id: string; nis: string; full_name: string }>) {
  if (row.nis) {
    const exact = students.find((student) => student.nis.trim().toLowerCase() === row.nis?.trim().toLowerCase());
    if (exact) return { student: exact, confidence: 1 };
  }
  const wanted = normalizeName(row.fullName ?? "");
  const exact = students.find((student) => normalizeName(student.full_name) === wanted && wanted.length > 0);
  return exact ? { student: exact, confidence: row.confidence } : { student: null, confidence: 0 };
}
