import type { ParsedReportRow } from "./types";
import { strFromU8, unzipSync } from "fflate";

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

export function parseXlsx(body: Uint8Array): ParsedReportRow[] {
  const files = unzipSync(body);
  const sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) return [];
  const sharedStrings = files["xl/sharedStrings.xml"] ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/si>/g)].map((match) => xmlDecode(match[1])) : [];
  const rows: string[][] = [];
  for (const rowMatch of strFromU8(files[sheetName]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const ref = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1] ?? "A";
      const index = [...ref].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
      const raw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cellMatch[2])?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(cellMatch[2])?.[1] ?? "";
      const value = type === "s" ? sharedStrings[Number(raw)] ?? "" : xmlDecode(raw);
      cells[index] = value;
    }
    rows.push(cells);
  }
  return parseCsv(rows.map((row) => row.map((cell) => `"${(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"));
}

function xmlDecode(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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
