import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guards";
import CreateTermForm from "@/modules/report-cards/create-term-form";

export const dynamic = "force-dynamic";

export default async function ReportCardIndexPage() {
  await requireRole(["pengurus", "super_admin"]);
  const supabase = await createClient();
  const { data: term } = await supabase.from("academic_terms").select("id").order("start_date", { ascending: false }).limit(1).maybeSingle();
  if (!term) {
    return <main className="p-6"><h1 className="text-2xl font-semibold">Rapor Digital</h1><p className="mt-2 text-muted-foreground">Belum ada tahun ajaran atau semester yang dapat dipilih.</p><CreateTermForm /></main>;
  }
  redirect(`/rapor/${term.id}`);
}
