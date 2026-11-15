/**
 * FUNC-12: klasifikasi yang diminta mengikuti kategori alasan; salah klasifikasi
 * dihitung ulang terhadap cutoff/grace kebijakan aktif, bukan hardcode on_time.
 *
 * Pure domain helper — deliberately NOT a server action. It lives outside the
 * "use server" actions module so it can stay synchronous and be unit-tested
 * directly; Next.js requires every export of a "use server" file to be async.
 */
export function resolveCorrectionClassification(
  reasonCategory: string,
  recordedTime: string,
  cutoffTime: string,
  graceTime: string
): { classification: string } | { error: string } {
  if (reasonCategory === "missed_checkin" || reasonCategory === "system_error") {
    return { classification: "on_time" };
  }
  if (reasonCategory === "other") return { classification: "excused" };
  if (reasonCategory === "wrong_time") {
    const toMinutes = (value: string) => {
      const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
      return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const recorded = toMinutes(recordedTime);
    if (recorded === null) return { error: "Waktu check-in aktual tidak valid untuk koreksi salah klasifikasi." };
    const cutoff = toMinutes(cutoffTime) ?? 8 * 60;
    const grace = toMinutes(graceTime) ?? 8 * 60 + 15;
    return { classification: recorded <= cutoff ? "on_time" : recorded <= grace ? "grace" : "late" };
  }
  return { error: "Kategori alasan koreksi tidak valid." };
}