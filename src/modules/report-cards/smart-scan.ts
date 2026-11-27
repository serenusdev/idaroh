import { parseCsv } from "./parser";
import type { ParsedReportRow } from "./types";

type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

export type SmartScanResult = { rows: ParsedReportRow[]; mode: "gemini" | "manual-review-required" };

export async function extractReportRowsFromImage(body: Uint8Array, mimeType: string, fetcher: typeof fetch = fetch): Promise<SmartScanResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { rows: [], mode: "manual-review-required" };
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Ekstrak catatan nilai santri menjadi JSON array. Setiap objek harus memiliki nis atau full_name, dan boleh memiliki tahfidz_data, diniyah_scores, adab_scores, attendance_summary. Jangan mengarang nilai yang tidak terlihat." }, { inline_data: { mime_type: mimeType, data: Buffer.from(body).toString("base64") } }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!response.ok) return { rows: [], mode: "manual-review-required" };
  const payload = await response.json() as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
  try {
    const json = JSON.parse(text) as unknown;
    if (!Array.isArray(json)) return { rows: [], mode: "manual-review-required" };
    const rows = parseCsv(["full_name,tahfidz_data,diniyah_scores,adab_scores,attendance_summary", ...json.map((item) => {
      const value = item as Record<string, unknown>;
      return [value.full_name ?? value.nama ?? "", JSON.stringify(value.tahfidz_data ?? {}), JSON.stringify(value.diniyah_scores ?? []), JSON.stringify(value.adab_scores ?? {}), JSON.stringify(value.attendance_summary ?? {})].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",");
    })].join("\n"));
    return { rows: rows.map((row) => ({ ...row, confidence: 0.9 })), mode: "gemini" };
  } catch {
    return { rows: [], mode: "manual-review-required" };
  }
}
