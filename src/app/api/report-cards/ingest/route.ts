import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guards";
import { parseCsv, parseXlsx, matchStudent } from "@/modules/report-cards/parser";
import { storageAdapter } from "@/lib/storage/gdrive";
import { extractReportRowsFromImage } from "@/modules/report-cards/smart-scan";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await requireRole(["pengurus", "super_admin"]);
    const form = await request.formData();
    const file = form.get("file");
    const termId = String(form.get("term_id") ?? "");
    if (!(file instanceof File) || !termId) return NextResponse.json({ error: "file dan term_id wajib diisi" }, { status: 400 });
    const body = new Uint8Array(await file.arrayBuffer());
    const raw = await storageAdapter.upload({ category: "raw-imports", path: `${termId}/${Date.now()}-${file.name}`, body, mimeType: file.type || "application/octet-stream" });
    const supabase = await createClient();
    const { error: metadataError } = await supabase.from("stored_files").insert({ gdrive_file_id: raw.id, folder_category: "raw-imports", original_name: file.name, mime_type: file.type || "application/octet-stream", byte_size: body.byteLength, visibility: "private_sensitive", owner_profile_id: actor.id });
    if (metadataError) throw metadataError;
    const { data: students, error } = await supabase.from("students").select("id,nis,full_name").eq("is_active", true);
    if (error) throw error;
    const lowerName = file.name.toLowerCase();
    const image = file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(lowerName);
    const scan = image ? await extractReportRowsFromImage(body, file.type || "image/jpeg") : null;
    const rows = lowerName.endsWith(".csv") ? parseCsv(new TextDecoder().decode(body)) : lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") ? parseXlsx(body) : scan?.rows ?? [];
    const matched = rows.map((row) => ({ row, ...matchStudent(row, students ?? []) }));
    const lowConfidence = matched.filter((item) => item.confidence < 0.85 || !item.student).map((item) => ({ sourceRow: item.row.sourceRow, confidence: item.confidence, nis: item.row.nis, fullName: item.row.fullName }));
    for (const item of matched.filter((candidate) => candidate.student && candidate.confidence >= 0.85)) {
      const { error: saveError } = await supabase.rpc("upsert_wave5_report_card", { p_student_id: item.student!.id, p_term_id: termId, p_tahfidz_data: item.row.tahfidzData ?? {}, p_diniyah_scores: item.row.diniyahScores ?? [], p_adab_scores: item.row.adabScores ?? {}, p_attendance_summary: item.row.attendanceSummary ?? { source: "raw-import" }, p_status: "draft" });
      if (saveError) throw saveError;
    }
    return NextResponse.json({ accepted: true, storage: raw, rows: rows.length, matched: matched.length - lowConfidence.length, reviewRequired: lowConfidence, actorId: actor.id, parser: scan?.mode ?? (rows.length ? (lowerName.endsWith(".csv") ? "csv" : "xlsx") : "manual-review-required") }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memproses unggahan";
    return NextResponse.json({ error: message }, { status: message.startsWith("FORBIDDEN") ? 403 : 500 });
  }
}
