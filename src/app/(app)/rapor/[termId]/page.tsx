import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guards";
import ReportCardGrid from "@/modules/report-cards/report-card-grid";

export default async function ReportCardPage({ params }: { params: Promise<{ termId: string }> }) {
  await requireRole(["pengurus", "super_admin"]);
  const { termId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("report_cards").select("id,student_id,status,tahfidz_data,diniyah_scores,adab_scores,attendance_summary,students(nis,full_name)").eq("term_id", termId).order("updated_at");
  const studentIds = (data ?? []).map((row) => row.student_id);
  const { data: halaqahLogs } = studentIds.length ? await supabase.from("halaqah_logs").select("id,student_id,session_date,entry_type,surah_name,ayah_from,ayah_to,quality_grade,tajwid_errors,notes").in("student_id", studentIds).order("session_date", { ascending: false }) : { data: [] };
  const enriched = (data ?? []).map((row) => ({ ...row, tahfidz_data: { ...(row.tahfidz_data as Record<string, unknown>), halaqah_logs: (halaqahLogs ?? []).filter((log) => log.student_id === row.student_id), halaqah_summary: { total_entries: (halaqahLogs ?? []).filter((log) => log.student_id === row.student_id).length } } }));
  return <main className="p-6"><h1 className="text-2xl font-semibold">Koreksi Rapor</h1><p className="mt-1 text-sm text-slate-500">Auto-save 800ms · ringkasan setoran halaqah masuk ke Tahfidz · perubahan dicatat sebagai audit</p><ReportCardGrid termId={termId} initialRows={(enriched ?? []) as never[]} /></main>;
}
