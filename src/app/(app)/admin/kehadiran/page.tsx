"use client";

import * as React from "react";
import { getAttendanceReviewQueueAction, reviewAttendanceCorrectionAction, reviewAttendanceExceptionAction } from "@/modules/attendance/actions";
import { useIdentity } from "@/components/auth/identity-context";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { useCachedData } from "@/hooks/use-cached-data";
import { invalidateCache } from "@/lib/data-cache";

export default function AdminAttendanceReviewPage() {
  const { user } = useIdentity();
  const queueQuery = useCachedData("admin:attendance-review", getAttendanceReviewQueueAction);
  const queue = queueQuery.data ?? { corrections: [], exceptions: [] };
  const [notice, setNotice] = React.useState<string | null>(null);
  const [approvingCorrection, setApprovingCorrection] = React.useState<{ id: string; requested: string } | null>(null);
  const [approvalClassification, setApprovalClassification] = React.useState("on_time");
  const [approvalNote, setApprovalNote] = React.useState("");
  const [isDeciding, setIsDeciding] = React.useState(false);

  React.useEffect(() => {
    if (queueQuery.error) setNotice(queueQuery.error.message);
  }, [queueQuery.error]);

  if (!["super_admin", "yayasan", "pengurus"].includes(user.role)) return <UnauthorizedState requiredRole="Super Admin / Pengurus / Yayasan" />;

  const decide = async (kind: "correction" | "exception", id: string, decision: "approved" | "rejected", effectiveClassification?: string, noteOverride?: string) => {
    let note = noteOverride;
    if (note === undefined) {
      const input = window.prompt("Catatan reviewer (opsional):", "");
      // UX-18: cancelling the prompt must abort the decision, not approve with "".
      if (input === null) return;
      note = input;
    }
    setIsDeciding(true);
    try {
      const result = kind === "correction"
        ? await reviewAttendanceCorrectionAction(id, decision, note, effectiveClassification)
        : await reviewAttendanceExceptionAction(id, decision, note);
      setNotice(result.message);
      if (result.success) {
        setApprovingCorrection(null);
        queueQuery.refresh();
        invalidateCache("attendance:history");
      }
    } catch {
      setNotice("Terjadi kesalahan saat memproses keputusan. Silakan coba lagi.");
    } finally {
      setIsDeciding(false);
    }
  };

  const startApproval = (item: { id: string; requestedClassification: string }) => {
    const allowed = ["on_time", "grace", "late", "excused", "sick", "duty"];
    setApprovingCorrection({ id: item.id, requested: item.requestedClassification });
    setApprovalClassification(allowed.includes(item.requestedClassification) ? item.requestedClassification : "on_time");
    setApprovalNote("");
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-5 pb-20">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">ATT-REVIEW · Approval presensi</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Review koreksi dan izin</h1>
        <p className="text-sm text-muted-foreground mt-1">Keputusan tercatat pada audit log. Catatan asli tidak diubah; hasil koreksi tampak di lapisan efektif, dan Anda tidak dapat mereview koreksi Anda sendiri.</p>
      </header>
      {notice && <div className="rounded-xl border border-primary/30 bg-accent/30 p-3 text-sm" aria-live="polite">{notice}</div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border"><h2 className="font-semibold">Koreksi presensi ({queue.corrections.length})</h2></div>
          <div className="divide-y divide-border">
            {queue.corrections.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Tidak ada koreksi yang menunggu.</p> : queue.corrections.map((item) => (
              <div key={item.id} className="p-4 space-y-2">
                <div><p className="text-sm font-semibold">{item.userName} · {item.attendanceDate}</p><p className="text-xs text-muted-foreground">{item.reason} · Minta: {item.requestedClassification}</p></div>
                {approvingCorrection?.id === item.id ? (
                  <div className="space-y-2 rounded-xl border border-primary/30 bg-accent/20 p-3">
                    <label className="block text-xs font-semibold" htmlFor={`eff-class-${item.id}`}>Klasifikasi efektif bila disetujui</label>
                    <select
                      id={`eff-class-${item.id}`}
                      value={approvalClassification}
                      onChange={(event) => setApprovalClassification(event.target.value)}
                      className="w-full h-9 px-2 rounded-lg bg-card border border-border text-xs"
                    >
                      <option value="on_time">Tepat Waktu (on_time)</option>
                      <option value="grace">Toleransi (grace)</option>
                      <option value="late">Terlambat (late)</option>
                      <option value="excused">Izin (excused)</option>
                      <option value="sick">Sakit (sick)</option>
                      <option value="duty">Dinas (duty)</option>
                    </select>
                    <input
                      value={approvalNote}
                      onChange={(event) => setApprovalNote(event.target.value)}
                      placeholder="Catatan reviewer (opsional)"
                      aria-label="Catatan reviewer"
                      className="w-full h-9 px-2 rounded-lg bg-card border border-border text-xs"
                    />
                    <div className="flex gap-2">
                      <button type="button" disabled={isDeciding} onClick={() => { void decide("correction", item.id, "approved", approvalClassification, approvalNote); }} className="h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold disabled:opacity-50">Konfirmasi Setujui</button>
                      <button type="button" disabled={isDeciding} onClick={() => setApprovingCorrection(null)} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold">Batal</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2"><button type="button" onClick={() => startApproval(item)} className="h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold">Setujui</button><button type="button" onClick={() => { void decide("correction", item.id, "rejected"); }} className="h-8 px-3 rounded-lg border border-error/30 text-error text-xs font-semibold">Tolak</button></div>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border"><h2 className="font-semibold">Izin / sakit ({queue.exceptions.length})</h2></div>
          <div className="divide-y divide-border">
            {queue.exceptions.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Tidak ada pengajuan izin yang menunggu.</p> : queue.exceptions.map((item) => (
              <div key={item.id} className="p-4 space-y-2">
                <div><p className="text-sm font-semibold">{item.userName} · {item.dateFrom} s.d. {item.dateTo}</p><p className="text-xs text-muted-foreground">{item.type} · {item.reason}</p></div>
                <div className="flex gap-2"><button type="button" onClick={() => decide("exception", item.id, "approved")} className="h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold">Setujui</button><button type="button" onClick={() => decide("exception", item.id, "rejected")} className="h-8 px-3 rounded-lg border border-error/30 text-error text-xs font-semibold">Tolak</button></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
