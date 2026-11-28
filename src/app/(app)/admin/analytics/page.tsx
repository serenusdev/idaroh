"use client";

import * as React from "react";
import { useIdentity } from "@/components/auth/identity-context";
import { getAnalyticsDrilldownAction, getOperationalAnalyticsAction, type AnalyticsDrilldownRow, type OperationalAnalytics } from "@/modules/operations/actions";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { cacheKeys } from "@/lib/cache-keys";
import { useQuery } from "@tanstack/react-query";
import { hasAnyRole } from "@/lib/auth/role-utils";

type MetricKey =
  | "attendance_on_time" | "attendance_grace" | "attendance_late" | "attendance_no_checkin"
  | "reports_submitted" | "reports_late" | "reports_backlog"
  | "tasks_open" | "tasks_completed" | "tasks_overdue";

const EMPTY: OperationalAnalytics = {
  period: { from: "", to: "" },
  attendance: { population: 0, checkedIn: 0, onTime: 0, grace: 0, late: 0 },
  reports: { total: 0, submitted: 0, late: 0, reviewBacklog: 0 },
  tasks: { open: 0, completed: 0, overdue: 0 },
};

function rate(value: number, total: number) {
  return total ? `${Math.round((value / total) * 100)}%` : "—";
}

function Bar({ label, value, max, tone = "bg-primary" }: { label: string; value: number; max: number; tone?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-on-surface-variant">{label}</span>
        <span className="font-mono font-semibold text-on-surface">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden" aria-label={`${label}: ${value}`}>
        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${max ? Math.max(3, (value / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

function Segment({ label, value, metric, onOpen, tone = "text-primary" }: { label: string; value: number; metric: MetricKey; onOpen: (metric: MetricKey) => void; tone?: string }) {
  return <button type="button" onClick={() => onOpen(metric)} className={`text-left text-xs font-semibold hover:underline ${tone}`} aria-label={`${label}: ${value}`}><span>{label}</span> <span className="font-mono">{value}</span> →</button>;
}

export default function AdminAnalyticsPage() {
  const { user } = useIdentity();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [drilldown, setDrilldown] = React.useState<{ metric: MetricKey; rows: AnalyticsDrilldownRow[] } | null>(null);
  const [drilldownLoading, setDrilldownLoading] = React.useState(false);
  const [drilldownError, setDrilldownError] = React.useState<string | null>(null);
  // CACHE-01 Batch 3: the period is part of the key rather than a mutable global entry, so a back
  // navigation to a range already read stays instant and an unseen one is never answered from the
  // previous range's numbers.
  const analyticsQuery = useQuery({
    queryKey: cacheKeys.adminAnalytics(user, from, to),
    queryFn: () => getOperationalAnalyticsAction(from || undefined, to || undefined),
  });
  const data = analyticsQuery.data ?? EMPTY;
  const loading = analyticsQuery.isLoading;

  if (!hasAnyRole(user, ["super_admin", "yayasan", "pengurus", "koordinator"])) {
    return <UnauthorizedState requiredRole="Koordinator / Pengurus / Yayasan" />;
  }

  const openDrilldown = async (metric: MetricKey) => {
    setDrilldownLoading(true);
    setDrilldownError(null);
    try {
      const rows = await getAnalyticsDrilldownAction(metric, from || undefined, to || undefined);
      setDrilldown({ metric, rows });
    } catch {
      setDrilldownError("Record sumber gagal dimuat. Silakan coba lagi.");
    } finally {
      setDrilldownLoading(false);
    }
  };
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setDrilldown(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 pb-20" data-ui="analytics-screen">
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">ADM-002 · Analitik Operasional</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Apa yang perlu ditindak hari ini?</h1>
          <p className="text-sm text-muted-foreground mt-1">Angka bersumber dari presensi, laporan, dan tugas dalam rentang yang dipilih. Klik angka untuk melihat record sumber.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">Dari<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 h-9 rounded-lg border border-border bg-card px-2 text-sm" /></label>
          <label className="text-xs text-muted-foreground">Sampai<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 h-9 rounded-lg border border-border bg-card px-2 text-sm" /></label>
          <button type="button" onClick={() => analyticsQuery.refetch()} className="h-9 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold" disabled={loading}>{loading ? "Memuat…" : "Terapkan"}</button>
        </div>
      </header>

      {analyticsQuery.error && (
        <div role="alert" className="rounded-2xl border border-error/30 bg-error-container/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-error text-[20px]">error</span>
            <div>
              <p className="text-sm font-semibold text-on-surface">Analitik gagal dimuat</p>
              <p className="text-xs text-muted-foreground mt-0.5">Angka tidak ditampilkan karena data gagal diambil dari server. Ini bukan berarti nol.</p>
            </div>
          </div>
          <button type="button" onClick={() => analyticsQuery.refetch()} className="h-9 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold shrink-0">Coba lagi</button>
        </div>
      )}

      {!analyticsQuery.error && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex justify-between items-start"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Presensi</p><p className="text-3xl font-mono font-bold text-primary mt-1">{rate(data.attendance.checkedIn, data.attendance.population)}</p><p className="text-xs text-muted-foreground">{data.attendance.checkedIn} dari {data.attendance.population} wajib check-in</p></div><span className="material-symbols-outlined text-primary">how_to_reg</span></div>
          <Bar label="Tepat waktu" value={data.attendance.onTime} max={data.attendance.population} />
          <Bar label="Toleransi" value={data.attendance.grace} max={data.attendance.population} tone="bg-warning" />
          <div className="flex flex-wrap gap-x-4 gap-y-2"><Segment label="Tepat waktu" value={data.attendance.onTime} metric="attendance_on_time" onOpen={openDrilldown} /><Segment label="Toleransi" value={data.attendance.grace} metric="attendance_grace" onOpen={openDrilldown} tone="text-warning" /><Segment label="Terlambat" value={data.attendance.late} metric="attendance_late" onOpen={openDrilldown} tone="text-error" /><Segment label="Belum check-in" value={Math.max(0, data.attendance.population - data.attendance.checkedIn)} metric="attendance_no_checkin" onOpen={openDrilldown} tone="text-muted-foreground" /></div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex justify-between items-start"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Laporan</p><p className="text-3xl font-mono font-bold text-primary mt-1">{rate(data.reports.submitted, data.reports.total)}</p><p className="text-xs text-muted-foreground">{data.reports.submitted} dari {data.reports.total} laporan terkirim</p></div><span className="material-symbols-outlined text-primary">edit_document</span></div>
          <Bar label="Terkirim" value={data.reports.submitted} max={data.reports.total} />
          <Bar label="Terlambat" value={data.reports.late} max={data.reports.total} tone="bg-warning" />
          <div className="flex flex-wrap gap-x-4 gap-y-2"><Segment label="Terkirim" value={data.reports.submitted} metric="reports_submitted" onOpen={openDrilldown} /><Segment label="Terlambat" value={data.reports.late} metric="reports_late" onOpen={openDrilldown} tone="text-warning" /><Segment label="Backlog review" value={data.reports.reviewBacklog} metric="reports_backlog" onOpen={openDrilldown} tone="text-error" /></div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex justify-between items-start"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Tugas</p><p className="text-3xl font-mono font-bold text-primary mt-1">{data.tasks.open}</p><p className="text-xs text-muted-foreground">tugas masih terbuka</p></div><span className="material-symbols-outlined text-primary">task_alt</span></div>
          <Bar label="Selesai periode ini" value={data.tasks.completed} max={Math.max(data.tasks.completed, data.tasks.open, 1)} />
          <Bar label="Melewati tenggat" value={data.tasks.overdue} max={Math.max(data.tasks.open, 1)} tone="bg-error" />
          <div className="flex flex-wrap gap-x-4 gap-y-2"><Segment label="Terbuka" value={data.tasks.open} metric="tasks_open" onOpen={openDrilldown} /><Segment label="Selesai" value={data.tasks.completed} metric="tasks_completed" onOpen={openDrilldown} /><Segment label="Melewati tenggat" value={data.tasks.overdue} metric="tasks_overdue" onOpen={openDrilldown} tone="text-error" /></div>
        </section>
      </div>
      )}

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><h2 className="font-semibold text-on-surface">Definisi &amp; batas akses</h2><p className="text-xs text-muted-foreground mt-1">Periode: {data.period.from || "minggu berjalan"} s.d. {data.period.to || "hari ini"}. Koordinator hanya menerima scope timnya.</p></div><span className="text-xs text-muted-foreground">Data tidak dipakai untuk ranking individu</span></div>
      </section>

      {drilldown && (
        <section className="rounded-2xl border border-primary/30 bg-card p-5 space-y-3" aria-live="polite">
          <div className="flex items-center justify-between"><div><h2 className="font-semibold text-on-surface">Record sumber</h2><p className="text-xs text-muted-foreground">{drilldown.metric} · {from || data.period.from || "awal periode"} s.d. {to || data.period.to || "hari ini"} WIB</p></div><button type="button" onClick={() => setDrilldown(null)} className="text-xs text-muted-foreground hover:text-on-surface">Tutup</button></div>
          {drilldownLoading ? <p className="text-sm text-muted-foreground py-5" aria-live="polite">Memuat record sumber…</p> : drilldownError ? <div role="alert" className="py-5"><p className="text-sm text-error">{drilldownError}</p><button type="button" onClick={() => openDrilldown(drilldown.metric)} className="mt-2 text-xs font-semibold text-primary hover:underline">Coba lagi</button></div> : drilldown.rows.length === 0 ? <p className="text-sm text-muted-foreground py-5">Tidak ada record pada periode ini.</p> : <div className="divide-y divide-border">{drilldown.rows.map((row) => <div key={row.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm"><div><p className="font-medium text-on-surface">{row.label}</p><p className="text-xs text-muted-foreground">{row.detail}</p></div><div className="flex items-center gap-3 text-xs text-muted-foreground"><span>{row.date}</span><span className="font-mono text-primary">{row.status}</span></div></div>)}</div>}
        </section>
      )}
    </div>
  );
}
