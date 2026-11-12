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

  React.useEffect(() => {
    if (queueQuery.error) setNotice(queueQuery.error.message);
  }, [queueQuery.error]);

  if (!["super_admin", "yayasan", "pengurus"].includes(user.role)) return <UnauthorizedState requiredRole="Super Admin / Pengurus / Yayasan" />;

  const decide = async (kind: "correction" | "exception", id: string, decision: "approved" | "rejected") => {
    const note = window.prompt("Catatan reviewer (opsional):", "") || "";
    const result = kind === "correction"
      ? await reviewAttendanceCorrectionAction(id, decision, note)
      : await reviewAttendanceExceptionAction(id, decision, note);
    setNotice(result.message);
    if (result.success) {
      queueQuery.refresh();
      invalidateCache("attendance:history");
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-5 pb-20">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">ATT-REVIEW · Approval presensi</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Review koreksi dan izin</h1>
        <p className="text-sm text-muted-foreground mt-1">Setiap keputusan mengubah data presensi dan tercatat pada audit log secara atomik.</p>
      </header>
      {notice && <div className="rounded-xl border border-primary/30 bg-accent/30 p-3 text-sm" aria-live="polite">{notice}</div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border"><h2 className="font-semibold">Koreksi presensi ({queue.corrections.length})</h2></div>
          <div className="divide-y divide-border">
            {queue.corrections.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Tidak ada koreksi yang menunggu.</p> : queue.corrections.map((item) => (
              <div key={item.id} className="p-4 space-y-2">
                <div><p className="text-sm font-semibold">{item.userName} · {item.attendanceDate}</p><p className="text-xs text-muted-foreground">{item.reason} · Minta: {item.requestedClassification}</p></div>
                <div className="flex gap-2"><button type="button" onClick={() => decide("correction", item.id, "approved")} className="h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold">Setujui</button><button type="button" onClick={() => decide("correction", item.id, "rejected")} className="h-8 px-3 rounded-lg border border-error/30 text-error text-xs font-semibold">Tolak</button></div>
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
