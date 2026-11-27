"use client";

import * as React from "react";
import { sendTestPushAction } from "@/modules/operations/actions";
import { getNotificationDeliverySummaryAction, getEmailDeliverySummaryAction } from "@/modules/notifications/actions";
import { useIdentity } from "@/components/auth/identity-context";
import { cacheKeys } from "@/lib/cache-keys";
import { useQuery } from "@tanstack/react-query";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";

export default function AdminNotificationsPage() {
  const { user } = useIdentity();
  const [notice, setNotice] = React.useState("Tekan tombol untuk mengirim notifikasi ke perangkat yang sedang login.");
  const [sending, setSending] = React.useState(false);
  // CACHE-01 Batch 3: `key === null` was the legacy way of saying "do not read"; `enabled` is the
  // same decision, kept on the same super_admin predicate so this migration changes no permission.
  const summaryQuery = useQuery({
    queryKey: cacheKeys.notificationsSummary(user),
    queryFn: getNotificationDeliverySummaryAction,
    enabled: user.role === "super_admin",
  });
  const summary = summaryQuery.data ?? null;
  const summaryError = Boolean(summaryQuery.error);
  const emailQuery = useQuery({
    queryKey: cacheKeys.emailSummary(user),
    queryFn: getEmailDeliverySummaryAction,
    enabled: user.role === "super_admin",
  });
  const emailSummary = emailQuery.data ?? null;
  const emailError = Boolean(emailQuery.error);
  if (!["super_admin", "yayasan", "pengurus"].includes(user.role)) return <UnauthorizedState requiredRole="Pengurus / Yayasan / Super Admin" />;
  const send = async () => {
    setSending(true);
    try {
      const result = await sendTestPushAction();
      setNotice(result.message);
      await summaryQuery.refetch();
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
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Antrean pengiriman</h2><button type="button" onClick={() => void summaryQuery.refetch()} className="text-sm text-primary underline">Perbarui</button></div>
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
      {user.role === "super_admin" && (
        <section className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Antrean email</h2><button type="button" onClick={() => void emailQuery.refetch()} className="text-sm text-primary underline">Perbarui</button></div>
          {emailError ? <p role="alert" className="text-sm text-destructive">Antrean email belum dapat dimuat. Periksa migrasi dan koneksi database.</p> : emailSummary ? (
            <>
              {!emailSummary.providerConfigured && <p role="alert" className="text-sm text-tertiary">Provider email belum dikonfigurasi (RESEND_API_KEY / EMAIL_FROM). Antrean dilewati (skip) sampai operator mengisi env — lihat runbook §3b. Ini bukan kegagalan kirim.</p>}
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div><dt className="text-muted-foreground">Menunggu</dt><dd className="font-semibold">{emailSummary.pending}</dd></div>
                <div><dt className="text-muted-foreground">Diproses</dt><dd className="font-semibold">{emailSummary.processing}</dd></div>
                <div><dt className="text-muted-foreground">Gagal permanen</dt><dd className="font-semibold">{emailSummary.failed}</dd></div>
              </dl>
            </>
          ) : <p className="text-sm text-muted-foreground">Memuat antrean…</p>}
          <p className="text-xs text-muted-foreground">Retry memerlukan scheduler aktif. Kegagalan permanen memerlukan pemeriksaan operator; alamat penerima dan isi email tidak ditampilkan.</p>
        </section>
      )}
    </div>
  );
}
