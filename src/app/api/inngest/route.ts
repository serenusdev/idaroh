import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guards";
import { chunk } from "@/lib/inngest/report-batch";
import { renderReportCardPdf } from "@/modules/report-cards/pdf";
import { storageAdapter } from "@/lib/storage/adapter";

export const runtime = "nodejs";

type BatchRow = {
  id: string; student_id: string; verification_hash: string; tahfidz_data: Record<string, unknown>;
  diniyah_scores: unknown[]; adab_scores: Record<string, unknown>; attendance_summary: Record<string, unknown>;
  students: { nis: string; full_name: string; dorm_room: string | null; halaqah_group: string | null } | null;
};

export async function POST(request: Request) {
  try {
    await requireRole(["pengurus", "super_admin"]);
    const event = await request.json() as { termId?: string; items?: Array<Record<string, unknown>> };
    if (!event.termId) return NextResponse.json({ error: "termId wajib diisi" }, { status: 400 });
    const supabase = await createClient();
    const { data: rows, error } = await supabase.from("report_cards").select("id,student_id,verification_hash,tahfidz_data,diniyah_scores,adab_scores,attendance_summary,students(nis,full_name,dorm_room,halaqah_group)").eq("term_id", event.termId).eq("status", "verified");
    if (error) throw error;
    const sourceRows = (rows ?? []) as unknown as BatchRow[];
    const items = sourceRows.map((row) => ({ id: row.id, studentId: row.student_id, verificationHash: row.verification_hash, tahfidzData: row.tahfidz_data, diniyahScores: row.diniyah_scores, adabScores: row.adab_scores, attendanceSummary: row.attendance_summary, nis: row.students?.nis ?? "", fullName: row.students?.full_name ?? "", dormRoom: row.students?.dorm_room ?? null, halaqahGroup: row.students?.halaqah_group ?? null }));
    const outputs: Array<{ id: string; storage: unknown }> = [];
    const archiveFiles: Array<{ name: string; body: Uint8Array }> = [];
    for (const group of chunk(items)) {
      for (const item of group) {
        const pdf = await renderReportCardPdf(item, process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
        const safeName = item.fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const stored = await storageAdapter.upload({ category: "rapor", path: `${event.termId}/${item.dormRoom ?? "tanpa-kamar"}/${item.nis}_${safeName}.pdf`, body: pdf, mimeType: "application/pdf" });
        archiveFiles.push({ name: `${item.dormRoom ?? "tanpa-kamar"}/${item.nis}_${safeName}.pdf`, body: pdf });
        outputs.push({ id: item.id, storage: stored });
      }
    }
    const archive = await storageAdapter.createArchive({
      category: "rapor",
      path: `${event.termId}/rapor-${event.termId}.zip`,
      files: archiveFiles,
    });
    return NextResponse.json({ processed: outputs.length, chunks: chunk(items).length, archive, outputs });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal menjalankan batch rapor" }, { status: 400 }); }
}
