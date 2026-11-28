import { createClient } from "@/lib/supabase/server";
import { requireAuthUser } from "@/lib/auth/guards";
import MutabaahForm from "@/modules/mutabaah/mutabaah-form";
import { todayWibDate } from "@/modules/mutabaah/actions";
import { hasAnyRole } from "@/lib/auth/role-utils";

export const dynamic = "force-dynamic";

export default async function MutabaahPage() {
  const user = await requireAuthUser();
  const canRecordCollectively = hasAnyRole(user, ["pengurus", "super_admin"]);
  const supabase = await createClient();
  const query = canRecordCollectively
    ? supabase.from("students").select("id,full_name,nis").eq("is_active", true).order("full_name")
    : supabase.from("students").select("id,full_name,nis").eq("profile_id", user.id).eq("is_active", true).limit(1);
  const { data: students } = await query;
  const student = students?.[0];
  return <main className="w-full max-w-4xl mx-auto space-y-6 pb-20"><header><h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-on-surface">Mutaba&apos;ah &amp; halaqah</h1><p className="text-base text-muted-foreground mt-2">Catatan harian terikat NIS untuk santri berakun maupun santri reguler non-gawai.</p></header>{!student ? <section className="rounded-xl border border-border bg-card p-5 text-base text-muted-foreground">Belum ada santri yang terhubung ke akun ini. Pengurus dapat mencatat melalui daftar santri.</section> : <MutabaahForm studentId={student.id} studentName={`${student.full_name} · NIS ${student.nis}`} today={await todayWibDate()} />}</main>;
}
