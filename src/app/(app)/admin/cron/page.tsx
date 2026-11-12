"use client";

import * as React from "react";
import { getCurrentUserAction } from "@/modules/iam/actions";
import { getCronJobSchedulesAction, updateCronJobScheduleAction } from "@/modules/cron/actions";
import type { CronJobSchedule } from "@/lib/cron-schedule";
import type { UserProfile } from "@/lib/auth/types";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { ErrorState } from "@/components/ui/error-state";

const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

type Draft = { timeWib: string; daysOfWeek: number[]; enabled: boolean };

export default function AdminCronPage() {
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [identityLoading, setIdentityLoading] = React.useState(true);
  const [identityError, setIdentityError] = React.useState(false);
  const [schedules, setSchedules] = React.useState<CronJobSchedule[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ key: string; ok: boolean; text: string } | null>(null);

  const loadUser = React.useCallback(async () => {
    setIdentityLoading(true);
    setIdentityError(false);
    try { setUser(await getCurrentUserAction()); }
    catch { setIdentityError(true); }
    finally { setIdentityLoading(false); }
  }, []);

  const loadSchedules = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await getCronJobSchedulesAction();
      setSchedules(rows);
      setDrafts(Object.fromEntries(rows.map((row) => [row.jobKey, { timeWib: row.timeWib, daysOfWeek: row.daysOfWeek, enabled: row.enabled }])));
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { void loadUser(); }, [loadUser]);
  React.useEffect(() => {
    if (user?.role === "super_admin") void loadSchedules();
  }, [user?.role, loadSchedules]);

  if (identityError) return <ErrorState title="Identitas Gagal Dimuat" description="Akses Anda belum dapat diverifikasi. Periksa koneksi lalu coba lagi." onRetry={() => void loadUser()} />;
  if (!user) return <div className="min-h-[360px] grid place-items-center text-sm text-muted-foreground">{identityLoading ? "Memverifikasi akses…" : "Sesi berakhir. Muat ulang halaman untuk masuk kembali."}</div>;
  if (user.role !== "super_admin") return <UnauthorizedState requiredRole="Super Admin" />;

  const setDraft = (key: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  const save = async (jobKey: string) => {
    const draft = drafts[jobKey];
    if (!draft || savingKey) return;
    setSavingKey(jobKey);
    setNotice(null);
    try {
      const result = await updateCronJobScheduleAction(jobKey, draft);
      setNotice({ key: jobKey, ok: result.success, text: result.message });
      if (result.success) {
        setSchedules((current) => current.map((row) => row.jobKey === jobKey ? { ...row, ...draft } : row));
      }
    } catch {
      setNotice({ key: jobKey, ok: false, text: "Jadwal belum tersimpan. Periksa koneksi lalu coba lagi." });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 pb-20">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">ADM-012 · Jadwal otomatis</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Jadwal otomatis</h1>
        <p className="text-sm text-muted-foreground mt-1">Atur kapan pengingat dan manifest database berjalan. Semua waktu dalam WIB dan berlaku untuk seluruh pengguna.</p>
      </header>
      <p role="note" className="rounded-xl border border-border bg-surface-container-low p-3 text-xs text-muted-foreground">
        Publikasi pengumuman terjadwal, kedaluwarsa agenda, dan retry push tetap diproses setiap ±15 menit selama heartbeat cron aktif di deployment. Jadwal di halaman ini hanya mengatur job harian di bawah.
      </p>
      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">Memuat jadwal…</div>
      ) : loadError ? (
        <ErrorState title="Jadwal Gagal Dimuat" description="Periksa koneksi dan migrasi database, lalu coba lagi." onRetry={() => void loadSchedules()} />
      ) : (
        <div className="space-y-4">
          {schedules.map((schedule) => {
            const draft = drafts[schedule.jobKey];
            if (!draft) return null;
            const busy = savingKey === schedule.jobKey;
            return (
              <section key={schedule.jobKey} className="rounded-2xl border border-border bg-card p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">{schedule.label}</h2>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => setDraft(schedule.jobKey, { enabled: event.target.checked })}
                      className="h-4 w-4 accent-primary"
                    />
                    Aktif
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Jam</span>
                    <input
                      type="time"
                      value={draft.timeWib}
                      onChange={(event) => setDraft(schedule.jobKey, { timeWib: event.target.value })}
                      className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span className="text-muted-foreground">WIB</span>
                  </label>
                  <fieldset className="flex items-center gap-1">
                    <legend className="sr-only">Hari aktif</legend>
                    {DAY_LABELS.map((label, day) => {
                      const active = draft.daysOfWeek.includes(day);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setDraft(schedule.jobKey, {
                            daysOfWeek: active ? draft.daysOfWeek.filter((d) => d !== day) : [...draft.daysOfWeek, day].sort((a, b) => a - b),
                          })}
                          className={`h-9 w-10 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground" : "bg-surface-container-low text-muted-foreground"}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </fieldset>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void save(schedule.jobKey)}
                    disabled={busy}
                    className="h-10 px-4 rounded-xl bg-primary text-on-primary text-sm font-semibold disabled:opacity-50"
                  >
                    {busy ? "Menyimpan…" : "Simpan jadwal"}
                  </button>
                  {notice?.key === schedule.jobKey && (
                    <p role={notice.ok ? "status" : "alert"} className={`text-sm ${notice.ok ? "text-success" : "text-destructive"}`}>{notice.text}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}