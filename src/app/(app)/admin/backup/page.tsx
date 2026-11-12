"use client";

import * as React from "react";
import { createBackupManifestAction, getBackupRunsAction } from "@/modules/operations/actions";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

interface BackupRun {
  id: string;
  run_type: string;
  status: string;
  artifact_ref?: string | null;
  started_at: string;
}

const statusLabels: Record<string, string> = {
  started: "Pencatatan dimulai",
  manifest_only: "Manifest saja — belum terverifikasi",
  completed: "Manifest saja — belum terverifikasi",
  backup_verified: "Backup terverifikasi",
  restore_verified: "Pemulihan terverifikasi",
  failed: "Gagal",
};

export default function AdminBackupPage() {
  const { user } = useIdentity();
  const [notice, setNotice] = React.useState<string | null>(null);
  const runsQuery = useCachedData("admin:backup-runs", getBackupRunsAction);
  const runs: BackupRun[] = runsQuery.data ?? [];
  if (runsQuery.isLoading) return <div className="min-h-[360px] grid place-items-center"><LoadingSpinner size="lg" /></div>;
  if (user.role !== "super_admin") return <UnauthorizedState requiredRole="Super Admin" />;
  const run = async () => { const result = await createBackupManifestAction("database"); setNotice(result.message); await runsQuery.refresh(); };
  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 pb-20">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">ADM-009 · Kontinuitas</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Manifest database &amp; status backup</h1>
        <p className="text-sm text-muted-foreground mt-1">Catat jumlah record database dan riwayat manifest. Verifikasi backup provider dilakukan secara terpisah.</p>
      </header>
      <div className="rounded-xl border border-primary/30 bg-accent/30 p-4 text-sm" role="note">
        <p className="font-semibold">Manifest ini bukan backup.</p>
        <p className="mt-1">Pencatatan hanya menghitung record pada enam tabel, tidak menyalin database atau file Storage dan tidak menjalankan uji restore. Backup dan pemulihan belum terverifikasi; verifikasi backup dan uji restore melalui provider masih diperlukan.</p>
      </div>
      {notice && <div className="rounded-xl border border-primary/30 bg-accent/30 p-3 text-sm" aria-live="polite">{notice}</div>}
      <section>
        <button type="button" onClick={run} className="rounded-xl border border-border bg-card p-4 text-left hover:border-primary">
          <span className="material-symbols-outlined text-primary" aria-hidden="true">database</span>
          <p className="font-semibold mt-2">Catat manifest database</p>
          <p className="text-xs text-muted-foreground mt-1">Catat jumlah record saja, tanpa membuat artefak backup.</p>
        </button>
      </section>
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-5 border-b border-border"><h2 className="font-semibold">Riwayat manifest dan verifikasi</h2></div>
        <div className="divide-y divide-border">
          {runs.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Belum ada catatan manifest.</p> : runs.map((item) => {
            const artifact = item.artifact_ref?.trim();
            const actualArtifact = artifact && artifact !== "Supabase PITR / provider backup" ? artifact : null;
            return (
              <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{item.run_type} · {statusLabels[item.status] || "Status tidak dikenal"}</p>
                  <p className="text-xs text-muted-foreground">{new Date(item.started_at).toLocaleString("id-ID")}</p>
                </div>
                {actualArtifact && <span className="text-xs font-mono text-muted-foreground break-all">Referensi artefak: {actualArtifact}</span>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
