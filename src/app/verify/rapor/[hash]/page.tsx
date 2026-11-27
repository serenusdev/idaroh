import { createClient } from "@/lib/supabase/server";

export default async function VerifyReportCardPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("verify_report_card_public", { p_hash: hash });
  const result = Array.isArray(data) ? data[0] : data;
  return <main className="mx-auto max-w-xl p-6"><h1 className="text-2xl font-semibold">Verifikasi Rapor</h1><p className="mt-4">Status: {result?.is_valid ? "Valid" : "Tidak ditemukan"}</p>{result?.is_valid && <p className="mt-2">{result.masked_student_name} · NIS ***{result.nis_suffix} · {result.term_name}</p>}</main>;
}
