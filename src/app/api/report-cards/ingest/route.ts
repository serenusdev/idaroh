import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guards";
import { parseCsv, matchStudent } from "@/modules/report-cards/parser";
import { storageAdapter } from "@/lib/storage/adapter";

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
    const { data: students, error } = await supabase.from("students").select("id,nis,full_name").eq("is_active", true);
    if (error) throw error;
    const rows = file.name.toLowerCase().endsWith(".csv") ? parseCsv(new TextDecoder().decode(body)) : [];
    const matched = rows.map((row) => ({ row, ...matchStudent(row, students ?? []) }));
    const lowConfidence = matched.filter((item) => item.confidence < 0.85 || !item.student).map((item) => ({ sourceRow: item.row.sourceRow, confidence: item.confidence, nis: item.row.nis, fullName: item.row.fullName }));
    return NextResponse.json({ accepted: true, storage: raw, rows: rows.length, matched: matched.length - lowConfidence.length, reviewRequired: lowConfidence, actorId: actor.id, parser: rows.length ? "csv" : "manual-review-required" }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memproses unggahan";
    return NextResponse.json({ error: message }, { status: message.startsWith("FORBIDDEN") ? 403 : 500 });
  }
}
