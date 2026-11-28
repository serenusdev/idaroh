"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useIdentity } from "@/components/auth/identity-context";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { cacheKeys } from "@/lib/cache-keys";
import { getLiveTelemetryAction, type LiveTelemetry } from "@/modules/live-telemetry/actions";
import { wibDateString } from "@/lib/time/wib";
import { useLiveTelemetryRealtime } from "@/modules/live-telemetry/realtime";
import { hasAnyRole } from "@/lib/auth/role-utils";

const EMPTY: LiveTelemetry = {
  timezone: "Asia/Jakarta",
  today: "",
  attendanceToday: { population: 0, present: 0, grace: 0, late: 0, excused: 0, sick: 0, noCheckin: 0 },
  reports: { expectedToday: 0, submittedToday: 0, lateToday: 0, reviewBacklog: 0, compliance7Days: 0, compliance30Days: 0 },
  tasks: { open: 0, completed7Days: 0, completed30Days: 0 },
  attendanceTrend: [],
  attendanceTrend7Days: [],
};

function Metric({ label, value, tone = "text-primary" }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className={`mt-2 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p></div>;
}

function TrendChart({ data }: { data: LiveTelemetry["attendanceTrend"] }) {
  const max = Math.max(1, ...data.map((day) => day.present + day.grace + day.late));
  return (
    <div className="space-y-3" aria-label="Tren kehadiran 30 hari">
      <div className="flex items-end gap-1 h-40 overflow-hidden" role="img" aria-label="Grafik batang tren presensi 30 hari">
        {data.map((day) => {
          const total = day.present + day.grace + day.late;
          return <div key={day.date} className="flex-1 min-w-[5px] h-full flex items-end gap-px" title={`${day.date}: ${total} check-in`}>
            <span className="w-1/3 bg-primary rounded-t-sm" style={{ height: `${(day.present / max) * 100}%` }} />
            <span className="w-1/3 bg-warning rounded-t-sm" style={{ height: `${(day.grace / max) * 100}%` }} />
            <span className="w-1/3 bg-error rounded-t-sm" style={{ height: `${(day.late / max) * 100}%` }} />
          </div>;
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground"><span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-primary mr-2" />Tepat waktu</span><span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-warning mr-2" />Toleransi</span><span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-error mr-2" />Terlambat</span></div>
    </div>
  );
}

export default function LiveTelemetryPage() {
  const { user } = useIdentity();
  const allowed = hasAnyRole(user, ["pengurus", "super_admin"]);
  const query = useQuery({
    queryKey: cacheKeys.liveTelemetry(user),
    queryFn: getLiveTelemetryAction,
    enabled: allowed,
    staleTime: 15_000,
    retry: 1,
  });
  useLiveTelemetryRealtime(() => { void query.refetch(); });
  const data = query.data?.ok ? query.data.data : EMPTY;
  const failure = query.data && !query.data.ok ? query.data : null;
  const attendance = data.attendanceToday;
  const reportRate = data.reports.expectedToday ? Math.round((data.reports.submittedToday / data.reports.expectedToday) * 100) : 0;

  if (!allowed) return <UnauthorizedState requiredRole="Pengurus / Super Admin" />;

  return (
    <main className="w-full max-w-6xl mx-auto space-y-6 pb-20" data-ui="live-telemetry-screen">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-on-surface">Telemetry operasional langsung</h1><p className="text-base text-muted-foreground mt-2">Presensi, tugas, dan kepatuhan laporan diperbarui otomatis. Semua waktu mengikuti {data.timezone}.</p></div>
        <div className="text-sm text-muted-foreground tabular-nums">Hari server: {data.today || `${wibDateString()} (dari perangkat)`}</div>
      </header>

      {(query.error || failure) && <div role="alert" aria-live="polite" className="rounded-xl border border-error/30 bg-error-container/30 p-4 text-sm text-on-surface">{failure?.message ?? "Telemetry gagal dimuat. Periksa koneksi lalu coba lagi."} <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>Coba lagi</button></div>}
      {query.isLoading && <p className="text-sm text-muted-foreground" aria-live="polite">Memuat metrik terbaru…</p>}

      {!query.error && !failure && !query.isLoading && <>
        <section aria-labelledby="attendance-heading" className="space-y-3"><div className="flex items-center justify-between"><h2 id="attendance-heading" className="text-xl font-semibold text-on-surface">Presensi hari ini</h2><span className="text-sm text-muted-foreground">Populasi aktif: {attendance.population}</span></div><div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"><Metric label="Tepat waktu" value={attendance.present} /><Metric label="Masa toleransi" value={attendance.grace} tone="text-warning-foreground" /><Metric label="Terlambat" value={attendance.late} tone="text-error" /><Metric label="Izin" value={attendance.excused} /><Metric label="Sakit" value={attendance.sick} /><Metric label="Belum presensi" value={attendance.noCheckin} tone="text-muted-foreground" /></div></section>

        <section className="grid lg:grid-cols-[1.4fr_1fr] gap-4"><div className="rounded-xl border border-border bg-card p-5"><div className="flex items-start justify-between mb-5"><div><h2 className="text-xl font-semibold text-on-surface">Tren presensi</h2><p className="text-sm text-muted-foreground mt-1">30 hari terakhir · batang tersusun per status</p></div><span className="text-sm text-muted-foreground">Live</span></div><TrendChart data={data.attendanceTrend} /><div className="mt-6 pt-5 border-t border-border"><p className="text-sm font-semibold text-on-surface mb-3">7 hari terakhir</p><TrendChart data={data.attendanceTrend7Days} /></div></div><div className="rounded-xl border border-border bg-card p-5 space-y-4"><h2 className="text-xl font-semibold text-on-surface">Ringkasan tindak lanjut</h2><div className="flex items-end justify-between"><div><p className="text-sm text-muted-foreground">Laporan terkirim hari ini</p><p className="text-3xl font-semibold text-primary tabular-nums">{reportRate}%</p></div><p className="text-sm text-muted-foreground tabular-nums">{data.reports.submittedToday}/{data.reports.expectedToday}</p></div><div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, reportRate)}%` }} /></div><div className="grid grid-cols-2 gap-3"><Metric label="Terlambat laporan" value={data.reports.lateToday} tone="text-warning-foreground" /><Metric label="Backlog review" value={data.reports.reviewBacklog} tone="text-error" /></div><p className="text-sm text-muted-foreground">Kepatuhan 7 hari: <strong className="text-on-surface">{data.reports.compliance7Days}</strong> laporan · 30 hari: <strong className="text-on-surface">{data.reports.compliance30Days}</strong> laporan</p></div></section>

        <section aria-labelledby="tasks-heading" className="space-y-3"><div className="flex items-center justify-between"><h2 id="tasks-heading" className="text-xl font-semibold text-on-surface">Progres tugas</h2><span className="text-sm text-muted-foreground">Status agregat</span></div><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Metric label="Masih terbuka" value={data.tasks.open} tone="text-warning-foreground" /><Metric label="Selesai 7 hari" value={data.tasks.completed7Days} /><Metric label="Selesai 30 hari" value={data.tasks.completed30Days} /></div></section>
      </>}
    </main>
  );
}
