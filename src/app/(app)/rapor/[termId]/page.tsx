import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guards";
import ReportCardGrid from "@/modules/report-cards/report-card-grid";

export default async function ReportCardPage({ params }: { params: Promise<{ termId: string }> }) {
  await requireRole(["pengurus", "super_admin"]);
  const { termId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("report_cards").select("id,student_id,status,tahfidz_data,diniyah_scores,adab_scores,attendance_summary,students(nis,full_name)").eq("term_id", termId).order("updated_at");
  return <main className="p-6"><h1 className="text-2xl font-semibold">Koreksi Rapor</h1><p className="mt-1 text-sm text-slate-500">Auto-save 800ms · perubahan dicatat sebagai audit</p><ReportCardGrid termId={termId} initialRows={(data ?? []) as never[]} /></main>;
}
