import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guards";

export async function POST(request: Request) {
  try {
    await requireRole(["pengurus", "super_admin"]);
    const payload = await request.json();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("upsert_wave5_report_card", {
      p_student_id: payload.studentId, p_term_id: payload.termId, p_tahfidz_data: payload.tahfidzData ?? {},
      p_diniyah_scores: payload.diniyahScores ?? [], p_adab_scores: payload.adabScores ?? {},
      p_attendance_summary: payload.attendanceSummary ?? {}, p_status: payload.status ?? "draft",
    });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal menyimpan rapor" }, { status: 400 }); }
}
