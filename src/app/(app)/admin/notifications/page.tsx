"use client";

import * as React from "react";
import { sendTestPushAction } from "@/modules/operations/actions";
import { getNotificationDeliverySummaryAction, type NotificationDeliverySummary } from "@/modules/notifications/actions";
import { getCurrentUserAction } from "@/modules/iam/actions";
import type { UserProfile } from "@/lib/auth/types";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { ErrorState } from "@/components/ui/error-state";

export default function AdminNotificationsPage() {
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [notice, setNotice] = React.useState("Tekan tombol untuk mengirim notifikasi ke perangkat yang sedang login.");
  const [summary, setSummary] = React.useState<NotificationDeliverySummary | null>(null);
  const [summaryError, setSummaryError] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [identityLoading, setIdentityLoading] = React.useState(true);
  const [identityError, setIdentityError] = React.useState(false);
  const loadUser = React.useCallback(async () => {
    setIdentityLoading(true);
    setIdentityError(false);
    try { setUser(await getCurrentUserAction()); }
    catch { setIdentityError(true); }
    finally { setIdentityLoading(false); }
  }, []);
  const refreshSummary = React.useCallback(async () => {
    try { setSummary(await getNotificationDeliverySummaryAction()); setSummaryError(false); }
    catch { setSummaryError(true); }
  }, []);
  React.useEffect(() => { void loadUser(); }, [loadUser]);
  React.useEffect(() => {
    if (user?.role === "super_admin") void refreshSummary();
  }, [user?.role, refreshSummary]);
  if (identityError) return <ErrorState title="Identitas Gagal Dimuat" description="Akses Anda belum dapat diverifikasi. Periksa koneksi lalu coba lagi." onRetry={() => void loadUser()} />;
  if (!user) return <div className="min-h-[360px] grid place-items-center text-sm text-muted-foreground">{identityLoading ? "Memverifikasi akses…" : "Sesi berakhir. Muat ulang halaman untuk masuk kembali."}</div>;
  if (!["super_admin", "yayasan", "pengurus"].includes(user.role)) return <UnauthorizedState requiredRole="Pengurus / Yayasan / Super Admin" />;
  const send = async () => {
    setSending(true);
    try {
      const result = await sendTestPushAction();
      setNotice(result.message);
      if (user.role === "super_admin") await refreshSummary();
    } catch { setNotice("Push belum berhasil diproses. Silakan coba lagi."); }
    finally { setSending(false); }
  };
  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 pb-20">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">ADM-011 · Notifikasi</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Uji push notification</h1>
        <p className="text-sm text-muted-foreground mt-1">Pastikan aplikasi mobile sudah dibuka dan perangkat sudah memberi izin notifikasi.</p>
      </header>
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Kirim ke perangkat saya</h2>
        <p className="text-sm text-muted-foreground">Uji ini hanya dikirim ke perangkat akunmu. Penerimaan FCM bukan bukti notifikasi sudah tampil di perangkat.</p>
        <button type="button" onClick={send} disabled={sending} className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm font-semibold disabled:opacity-50">{sending ? "Memproses…" : "Kirim push uji"}</button>
        <div className="rounded-xl bg-surface-container-low p-3 text-sm" aria-live="polite">{notice}</div>
      </section>
      {user.role === "super_admin" && (
        <section className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Antrean pengiriman</h2><button type="button" onClick={() => void refreshSummary()} className="text-sm text-primary underline">Perbarui</button></div>
          {summaryError ? <p role="alert" className="text-sm text-destructive">Antrean belum dapat dimuat. Periksa migrasi dan koneksi database.</p> : summary ? (
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Menunggu</dt><dd className="font-semibold">{summary.pending}</dd></div>
              <div><dt className="text-muted-foreground">Diproses</dt><dd className="font-semibold">{summary.processing}</dd></div>
              <div><dt className="text-muted-foreground">Gagal permanen</dt><dd className="font-semibold">{summary.deadLetter}</dd></div>
            </dl>
          ) : <p className="text-sm text-muted-foreground">Memuat antrean…</p>}
          <p className="text-xs text-muted-foreground">Retry memerlukan scheduler aktif. Kegagalan permanen memerlukan pemeriksaan operator; token dan isi pesan tidak ditampilkan.</p>
        </section>
      )}
    </div>
  );
}
