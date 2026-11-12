"use client";

import * as React from "react";
import Link from "next/link";
import { UserProfile } from "@/lib/auth/types";
import { Avatar } from "@/components/ui/avatar";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cleanupPushNotifications } from "@/lib/notifications";

interface MoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
}

export function MoreSheet({ isOpen, onClose, user }: MoreSheetProps) {
  const router = useRouter();
  if (!isOpen) return null;

  const handleLogout = async () => {
    await cleanupPushNotifications();
    await createClient().auth.signOut();
    onClose();
    router.replace("/login");
    router.refresh();
  };

  const isAdminOrPengurus =
    user.role === "super_admin" ||
    user.role === "yayasan" ||
    user.role === "pengurus";

  return (
    <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Sheet Content */}
      <div className="relative z-10 w-full bg-card rounded-t-2xl shadow-xl border-t border-border p-5 pb-safe max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
        <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mb-4" />

        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Avatar
              src={user.avatar_url}
              alt={user.full_name}
              fallback={user.full_name}
              size="lg"
            />
            <div>
              <h4 className="font-headline-sm text-headline-sm text-on-surface">
                {user.full_name}
              </h4>
              <p className="font-body-sm text-[12px] text-muted-foreground">
                {user.email} • {user.team_name || "Santri"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Modules Section */}
        <div className="py-4 space-y-1">
          <p className="font-label-sm text-[11px] uppercase tracking-wider text-muted-foreground px-3 mb-2">
            Modul Operasional
          </p>

          <Link
            href="/tugas"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
          >
            <span className="material-symbols-outlined text-primary text-[22px]">
              task_alt
            </span>
            <div className="flex-1">
              <span className="font-label-md text-label-md block">
                Tugas &amp; Proyek
              </span>
              <span className="font-body-sm text-[11px] text-muted-foreground block">
                Koordinasi tugas santri dan tim
              </span>
            </div>
          </Link>

          <Link
            href="/jadwal"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
          >
            <span className="material-symbols-outlined text-primary text-[22px]">
              calendar_month
            </span>
            <div className="flex-1">
              <span className="font-label-md text-label-md block">
                Jadwal &amp; Pengumuman
              </span>
              <span className="font-body-sm text-[11px] text-muted-foreground block">
                Agenda kegiatan harian &amp; siaran pondok
              </span>
            </div>
          </Link>

          <Link
            href="/resources"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
          >
            <span className="material-symbols-outlined text-primary text-[22px]">
              menu_book
            </span>
            <div className="flex-1">
              <span className="font-label-md text-label-md block">
                Resource Library
              </span>
              <span className="font-body-sm text-[11px] text-muted-foreground block">
                SOP, kredensial, materi &amp; aset pondok
              </span>
            </div>
          </Link>

          <Link
            href="/tim"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
          >
            <span className="material-symbols-outlined text-primary text-[22px]">
              groups
            </span>
            <div className="flex-1">
              <span className="font-label-md text-label-md block">
                Direktori Tim &amp; Orang
              </span>
              <span className="font-body-sm text-[11px] text-muted-foreground block">
                Daftar pengurus, santri &amp; kontak
              </span>
            </div>
          </Link>

          {isAdminOrPengurus && (
            <>
              <p className="font-label-sm text-[11px] uppercase tracking-wider text-muted-foreground px-3 mt-4 mb-2">
                Administrasi &amp; Audit
              </p>

              <Link
                href="/admin/users"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
              >
                <span className="material-symbols-outlined text-primary text-[22px]">
                  manage_accounts
                </span>
                <div className="flex-1">
                  <span className="font-label-md text-label-md block">
                    Kelola Pengguna IAM
                  </span>
                  <span className="font-body-sm text-[11px] text-muted-foreground block">
                    Persetujuan akun &amp; manajemen peran
                  </span>
                </div>
              </Link>

              <Link
                href="/admin/jadwal"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
              >
                <span className="material-symbols-outlined text-primary text-[22px]">
                  edit_calendar
                </span>
                <div className="flex-1">
                  <span className="font-label-md text-label-md block">
                    Kelola Jadwal &amp; Siaran
                  </span>
                  <span className="font-body-sm text-[11px] text-muted-foreground block">
                    Buat agenda &amp; siarkan pengumuman
                  </span>
                </div>
              </Link>

              <Link
                href="/admin/resources"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
              >
                <span className="material-symbols-outlined text-primary text-[22px]">library_books</span>
                <div className="flex-1">
                  <span className="font-label-md text-label-md block">Kelola Resource Library</span>
                  <span className="font-body-sm text-[11px] text-muted-foreground block">CRUD, archive, dan riwayat revisi</span>
                </div>
              </Link>

              <Link
                href="/admin/audit"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
              >
                <span className="material-symbols-outlined text-primary text-[22px]">
                  monitoring
                </span>
                <div className="flex-1">
                  <span className="font-label-md text-label-md block">
                    Analitik &amp; Audit Trail
                  </span>
                  <span className="font-body-sm text-[11px] text-muted-foreground block">
                    Atur jam operasional &amp; log perubahan
                  </span>
                </div>
              </Link>

              <Link
                href="/admin/kehadiran"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors"
              >
                <span className="material-symbols-outlined text-primary text-[22px]">fact_check</span>
                <div className="flex-1">
                  <span className="font-label-md text-label-md block">Review Presensi</span>
                  <span className="font-body-sm text-[11px] text-muted-foreground block">Koreksi, izin, dan sakit</span>
                </div>
              </Link>

              <Link href="/admin/analytics" onClick={onClose} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors">
                <span className="material-symbols-outlined text-primary text-[22px]">monitoring</span>
                <div className="flex-1"><span className="font-label-md text-label-md block">Analitik Operasional</span><span className="font-body-sm text-[11px] text-muted-foreground block">Grafik, periode, dan drill-down record</span></div>
              </Link>
              <Link href="/admin/people" onClick={onClose} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors">
                <span className="material-symbols-outlined text-primary text-[22px]">groups</span>
                <div className="flex-1"><span className="font-label-md text-label-md block">Anggota &amp; Reviewer</span><span className="font-body-sm text-[11px] text-muted-foreground block">Struktur tim dan penugasan review</span></div>
              </Link>
              {(user.role === "super_admin" || user.role === "yayasan" || user.role === "pengurus") && <Link href="/admin/notifications" onClick={onClose} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors">
                <span className="material-symbols-outlined text-primary text-[22px]">notifications_active</span>
                <div className="flex-1"><span className="font-label-md text-label-md block">Uji Notifikasi</span><span className="font-body-sm text-[11px] text-muted-foreground block">Kirim push ke perangkat sendiri</span></div>
              </Link>}
              {user.role === "super_admin" && <Link href="/admin/cron" onClick={onClose} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors">
                <span className="material-symbols-outlined text-primary text-[22px]">schedule</span>
                <div className="flex-1"><span className="font-label-md text-label-md block">Jadwal Otomatis</span><span className="font-body-sm text-[11px] text-muted-foreground block">Jam pengingat dan manifest database</span></div>
              </Link>}
              {user.role === "super_admin" && <Link href="/admin/backup" onClick={onClose} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface hover:bg-accent/40 active:bg-accent transition-colors">
                <span className="material-symbols-outlined text-primary text-[22px]">backup</span>
                <div className="flex-1"><span className="font-label-md text-label-md block">Backup &amp; Pemulihan</span><span className="font-body-sm text-[11px] text-muted-foreground block">Manifest dan uji restore</span></div>
              </Link>}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="pt-3 border-t border-border flex items-center justify-between">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 text-destructive font-label-md text-body-sm py-2 px-3 rounded-lg hover:bg-destructive/10"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span>Keluar Akun</span>
          </button>

          <span className="text-[11px] font-mono text-muted-foreground">
            v2.0 • Asia/Jakarta
          </span>
        </div>
      </div>
    </div>
  );
}

