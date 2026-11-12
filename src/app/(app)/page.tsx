"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { formatOperationalDateTime } from "@/lib/utils";
import { checkInAttendanceAction } from "@/modules/attendance/actions";
import {
  getActivePolicyAction,
  updatePolicySettingsAction,
  getAdminDashboardStatsAction,
  type PolicySettingItem,
  type AdminDashboardMetrics,
} from "@/modules/analytics/actions";
import { getEventsAction, getAnnouncementsAction } from "@/modules/schedules/actions";
import { getCurrentUserAction } from "@/modules/iam/actions";
import { UserProfile } from "@/lib/auth/types";
import type { ScheduleEventItem, AnnouncementItem } from "@/modules/schedules/types";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { LiveClock } from "@/components/ui/live-clock";
import { Illustration } from "@/components/ui/illustration";

export default function BerandaPage() {
  const [currentUser, setCurrentUser] = React.useState<UserProfile | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = React.useState(true);
  const [checkedIn, setCheckedIn] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [checkinError, setCheckinError] = React.useState<string | null>(null);

  // Live configs & data
  const [policy, setPolicy] = React.useState<PolicySettingItem | null>(null);
  const [events, setEvents] = React.useState<ScheduleEventItem[]>([]);
  const [announcements, setAnnouncements] = React.useState<AnnouncementItem[]>([]);
  const [adminStats, setAdminStats] = React.useState<AdminDashboardMetrics | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Time clocks
  const [currentDateTime, setCurrentDateTime] = React.useState(formatOperationalDateTime());

  // Admin Quick Policy Modal
  const [isPolicyModalOpen, setIsPolicyModalOpen] = React.useState(false);
  const [isUpdatingPolicy, setIsUpdatingPolicy] = React.useState(false);
  const [policyFeedback, setPolicyFeedback] = React.useState<string | null>(null);
  const [policyForm, setPolicyForm] = React.useState({
    name: "Shift Reguler Operasional Santri",
    attendanceCutoffTime: "08:00",
    attendanceGraceCutoffTime: "08:15",
    reportDeadlineTime: "21:00",
  });

  // Admin View Switcher (allows admin to test member view)
  const [previewAsMember, setPreviewAsMember] = React.useState(false);

  const loadData = React.useCallback(async () => {
    setLoadError(null);
    try {
      const user = await getCurrentUserAction();
      setCurrentUser(user);

      const isSupervisor = user?.role && ["super_admin", "yayasan", "pengurus"].includes(user.role);

      // Hanya panggil query data yang relevan dengan izin pengguna
      const [p, ev, an, stats] = await Promise.all([
        getActivePolicyAction(),
        getEventsAction(),
        getAnnouncementsAction(),
        isSupervisor ? getAdminDashboardStatsAction() : Promise.resolve(null),
      ]);

      setPolicy(p);
      if (p) {
        setPolicyForm({
          name: p.name,
          attendanceCutoffTime: p.attendanceCutoffTime,
          attendanceGraceCutoffTime: p.attendanceGraceCutoffTime,
          reportDeadlineTime: p.reportDeadlineTime,
        });
      }
      setEvents(ev || []);
      setAnnouncements(an || []);
      setAdminStats(stats);
    } catch (err) {
      console.error("Gagal memuat data beranda:", err);
      setLoadError(err instanceof Error ? err.message : "Data beranda gagal dimuat.");
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
    setCurrentDateTime(formatOperationalDateTime());
  }, [loadData]);

  const handleCheckin = async () => {
    setIsProcessing(true);
    setCheckinError(null);
    const res = await checkInAttendanceAction();
    setIsProcessing(false);
    if (res.success) {
      setCheckedIn(true);
    } else {
      setCheckinError(res.message || "Gagal mencatat presensi. Silakan coba lagi.");
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingPolicy(true);
    setPolicyFeedback(null);

    const res = await updatePolicySettingsAction(policyForm);
    setIsUpdatingPolicy(false);

    if (res.success) {
      setPolicyFeedback("Kebijakan jam operasional berhasil diperbarui!");
      setTimeout(() => {
        setIsPolicyModalOpen(false);
        setPolicyFeedback(null);
      }, 1200);
      loadData();
    } else {
      setPolicyFeedback(res.message);
    }
  };

  const pinnedAnnouncement = announcements.find((a) => a.isPinned) || announcements[0];

  const isAdminOrPengurus =
    currentUser?.role === "super_admin" ||
    currentUser?.role === "yayasan" ||
    currentUser?.role === "pengurus";

  if (isLoadingAuth) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[350px] gap-3">
        <LoadingSpinner size="lg" />
        <p className="font-body-sm text-sm text-muted-foreground">Sinkronisasi data sistem...</p>
      </div>
    );
  }

  // =========================================================================
  // VIEW 1: ADMIN & PENGURUS OPERATIONAL DASHBOARD
  // =========================================================================
  if (isAdminOrPengurus && !previewAsMember) {
    return (
      <div className="flex flex-col w-full pb-16 space-y-6 max-w-5xl mx-auto">
        {/* Admin Header Banner */}
        <section className="bg-gradient-to-r from-primary/10 via-accent/30 to-surface-container rounded-2xl p-5 border border-primary/20 shadow-xs relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Image
                  src="/idaroh-icon.svg"
                  alt="IDAROH"
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-xl shrink-0 object-contain bg-card/80 p-0.5"
                />
                <span className="px-2.5 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-[11px] font-semibold uppercase tracking-wider">
                  Panel Administrator
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                  Supabase Live Sync
                </span>
              </div>
              <h1 className="font-headline-sm text-xl sm:text-2xl text-on-surface font-bold tracking-tight">
                Pusat Kendali Operasional Pesantren
              </h1>
              <p className="font-body-sm text-xs sm:text-sm text-muted-foreground">
                Pantau progres santri, kelola jam kebijakan, agenda jadwal, dan siaran pengumuman.
              </p>
            </div>

            <div className="flex items-center gap-2 self-start md:self-auto">
              {/* Preview Toggle Button */}
              <button
                onClick={() => setPreviewAsMember(true)}
                className="px-3 py-1.5 rounded-xl bg-card border border-border text-xs font-label-md text-on-surface hover:bg-accent/40 transition-colors flex items-center gap-1.5 shadow-2xs"
                title="Beralih ke tampilan pandangan santri biasa"
              >
                <span className="material-symbols-outlined text-[16px]">visibility</span>
                <span>Lihat Mode Santri</span>
              </button>

              {/* Quick Hours Config Button */}
              <button
                onClick={() => setIsPolicyModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-label-md hover:bg-primary-container transition-all flex items-center gap-1.5 shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px]">schedule</span>
                <span>Atur Jam</span>
              </button>
            </div>

            {/* Decorative illustration — desktop only, aria-hidden */}
            <div className="hidden md:flex items-end justify-end shrink-0 self-center" aria-hidden="true">
              <Illustration
                src="/illustrations/adapted/undraw_control-panel_s0j2.svg"
                alt=""
                width={140}
                height={100}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3 pt-3 border-t border-border/40 font-mono">
            <span className="material-symbols-outlined text-[16px] text-primary">schedule</span>
            <span>{currentDateTime}</span>
          </div>
        </section>

        {/* Operational Hours Policy Card */}
        <section className="bg-card rounded-2xl p-4 sm:p-5 border border-border shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-accent text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">tune</span>
              </div>
              <div>
                <span className="text-[11px] font-label-sm text-muted-foreground uppercase tracking-wider">
                  Kebijakan Jam Berlaku Saat Ini
                </span>
                <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                  {policy?.name || "Kebijakan Operasional Pesantren"}
                </h3>
              </div>
            </div>

            <button
              onClick={() => setIsPolicyModalOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 text-xs font-label-md flex items-center gap-1 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              <span>Ubah Jam</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="p-3 bg-surface-container-low rounded-xl border border-border/40 space-y-1">
              <span className="text-xs text-muted-foreground font-body-sm flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px] text-success">alarm</span>
                Batas Tepat Waktu
              </span>
              <p className="font-headline-sm text-lg font-bold text-on-surface font-mono">
                {policy?.attendanceCutoffTime ? `${policy.attendanceCutoffTime} WIB` : "--:--"}
              </p>
              <p className="text-[10px] text-muted-foreground">Check-in setelah jam ini masuk toleransi</p>
            </div>

            <div className="p-3 bg-surface-container-low rounded-xl border border-border/40 space-y-1">
              <span className="text-xs text-muted-foreground font-body-sm flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px] text-tertiary">timer</span>
                Batas Akhir Toleransi
              </span>
              <p className="font-headline-sm text-lg font-bold text-on-surface font-mono">
                {policy?.attendanceGraceCutoffTime ? `${policy.attendanceGraceCutoffTime} WIB` : "--:--"}
              </p>
              <p className="text-[10px] text-muted-foreground">Check-in setelah jam ini dicatat terlambat</p>
            </div>

            <div className="p-3 bg-surface-container-low rounded-xl border border-border/40 space-y-1">
              <span className="text-xs text-muted-foreground font-body-sm flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px] text-primary">edit_document</span>
                Batas Laporan Harian
              </span>
              <p className="font-headline-sm text-lg font-bold text-on-surface font-mono">
                {policy?.reportDeadlineTime ? `${policy.reportDeadlineTime} WIB` : "--:--"}
              </p>
              <p className="text-[10px] text-muted-foreground">Laporan setelah jam ini ditandai terlambat</p>
            </div>
          </div>
        </section>

        {/* Live Metrics Grid (Progres & Aktivitas Terkini) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-sm text-base text-on-surface font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">analytics</span>
              <span>Progres Operasional Hari Ini</span>
            </h2>
            <span className="text-xs text-muted-foreground">Data Real-time</span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Presensi Hari Ini */}
            <div className="bg-card p-4 rounded-xl border border-border shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">Presensi Hari Ini</span>
                <span className="material-symbols-outlined text-primary text-[20px]">how_to_reg</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-headline-sm text-2xl font-bold text-on-surface">
                  {adminStats?.todayCheckedIn || 0}
                </span>
                <span className="text-xs text-muted-foreground">
                  / {adminStats?.totalSantri || 0} Santri
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="material-symbols-outlined text-[14px] text-tertiary">alarm</span>
                <span>{adminStats?.todayLate || 0} tercatat terlambat</span>
              </div>
            </div>

            {/* Laporan Pending Review */}
            <div className="bg-card p-4 rounded-xl border border-border shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">Laporan Pending</span>
                <span className="material-symbols-outlined text-tertiary text-[20px]">fact_check</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-headline-sm text-2xl font-bold text-tertiary">
                  {adminStats?.pendingReports || 0}
                </span>
                <span className="text-xs text-muted-foreground">perlu ditinjau</span>
              </div>
              <Link
                href="/review"
                className="text-[11px] text-primary hover:underline flex items-center gap-0.5 pt-1"
              >
                <span>Buka Antrean Review</span>
                <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
              </Link>
            </div>

            {/* Pendaftar Akun Baru (IAM) */}
            <div className="bg-card p-4 rounded-xl border border-border shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">Pengajuan Akun</span>
                <span className="material-symbols-outlined text-primary text-[20px]">person_add</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-headline-sm text-2xl font-bold text-on-surface">
                  {adminStats?.pendingAccountRequests || 0}
                </span>
                <span className="text-xs text-muted-foreground">permohonan baru</span>
              </div>
              <Link
                href="/admin/users"
                className="text-[11px] text-primary hover:underline flex items-center gap-0.5 pt-1"
              >
                <span>Kelola Pengguna IAM</span>
                <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
              </Link>
            </div>

            {/* Tugas & Proyek Aktif */}
            <div className="bg-card p-4 rounded-xl border border-border shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">Tugas &amp; Proyek</span>
                <span className="material-symbols-outlined text-primary text-[20px]">task_alt</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-headline-sm text-2xl font-bold text-on-surface">
                  {adminStats?.activeTasks || 0}
                </span>
                <span className="text-xs text-muted-foreground">tugas aktif</span>
              </div>
              <Link
                href="/tugas"
                className="text-[11px] text-primary hover:underline flex items-center gap-0.5 pt-1"
              >
                <span>Lihat Manajemen Tugas</span>
                <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Pusat Kontrol Admin (Direct Action Shortcuts) */}
        <section className="space-y-3">
          <h2 className="font-headline-sm text-base text-on-surface font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">hub</span>
            <span>Akses Cepat Pengelolaan Sistem</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Action 1: Atur Jam */}
            <button
              onClick={() => setIsPolicyModalOpen(true)}
              className="p-4 bg-card rounded-xl border border-border hover:border-primary/50 text-left transition-all space-y-2 shadow-2xs hover:shadow-xs group"
            >
              <div className="w-10 h-10 rounded-xl bg-accent text-primary flex items-center justify-center group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[22px]">timer</span>
              </div>
              <div>
                <p className="font-label-md text-sm text-on-surface font-semibold">
                  Atur Jam Operasional
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Batas check-in, toleransi &amp; deadline laporan
                </p>
              </div>
            </button>

            {/* Action 2: Kelola Jadwal & Siaran */}
            <Link
              href="/admin/jadwal"
              className="p-4 bg-card rounded-xl border border-border hover:border-primary/50 text-left transition-all space-y-2 shadow-2xs hover:shadow-xs group"
            >
              <div className="w-10 h-10 rounded-xl bg-accent text-primary flex items-center justify-center group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[22px]">edit_calendar</span>
              </div>
              <div>
                <p className="font-label-md text-sm text-on-surface font-semibold">
                  Kelola Jadwal &amp; Siaran
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tambah agenda kajian &amp; siarkan pengumuman
                </p>
              </div>
            </Link>

            {/* Action 3: Review Laporan Santri */}
            <Link
              href="/review"
              className="p-4 bg-card rounded-xl border border-border hover:border-primary/50 text-left transition-all space-y-2 shadow-2xs hover:shadow-xs group"
            >
              <div className="w-10 h-10 rounded-xl bg-accent text-primary flex items-center justify-center group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[22px]">fact_check</span>
              </div>
              <div>
                <p className="font-label-md text-sm text-on-surface font-semibold">
                  Review Laporan Santri
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tinjau dan beri masukan laporan aktivitas harian
                </p>
              </div>
            </Link>

            {/* Action 4: Kelola Pengguna IAM */}
            <Link
              href="/admin/users"
              className="p-4 bg-card rounded-xl border border-border hover:border-primary/50 text-left transition-all space-y-2 shadow-2xs hover:shadow-xs group"
            >
              <div className="w-10 h-10 rounded-xl bg-accent text-primary flex items-center justify-center group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[22px]">manage_accounts</span>
              </div>
              <div>
                <p className="font-label-md text-sm text-on-surface font-semibold">
                  Kelola Pengguna IAM
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Persetujuan akun baru &amp; hak akses
                </p>
              </div>
            </Link>
          </div>
        </section>

        {/* Agenda & Pengumuman Live Preview for Admin */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Agenda Section */}
          <section className="bg-card rounded-2xl p-4 sm:p-5 border border-border shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">calendar_month</span>
                <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                  Agenda Jadwal ({events.length})
                </h3>
              </div>
              <Link
                href="/admin/jadwal"
                className="text-xs text-primary hover:underline font-label-sm flex items-center gap-1"
              >
                <span>Kelola Agenda</span>
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </Link>
            </div>

            {events.length === 0 ? (
              <div className="p-6 text-center bg-surface-container-low rounded-xl border border-dashed border-border text-muted-foreground space-y-2">
                <span className="material-symbols-outlined text-[32px] text-muted-foreground">event_busy</span>
                <p className="text-xs">Belum ada agenda jadwal aktif di database.</p>
                <Link
                  href="/admin/jadwal"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-label-sm"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  <span>Tambah Agenda</span>
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                {events.slice(0, 3).map((evt) => (
                  <div key={evt.id} className="p-3 rounded-xl bg-surface-container-low flex items-start justify-between gap-2 border border-border/40">
                    <div className="space-y-0.5 min-w-0">
                      <p className="font-label-md text-sm text-on-surface font-semibold truncate">
                        {evt.title}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">location_on</span>
                        <span>{evt.location}</span>
                      </p>
                    </div>
                    <span className="font-mono text-xs text-primary font-bold shrink-0">
                      {evt.timeRangeStr.split(" - ")[0] || "-"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Pengumuman Section */}
          <section className="bg-card rounded-2xl p-4 sm:p-5 border border-border shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">campaign</span>
                <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                  Siaran Pengumuman ({announcements.length})
                </h3>
              </div>
              <Link
                href="/admin/jadwal"
                className="text-xs text-primary hover:underline font-label-sm flex items-center gap-1"
              >
                <span>Kelola Siaran</span>
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </Link>
            </div>

            {announcements.length === 0 ? (
              <div className="p-6 text-center bg-surface-container-low rounded-xl border border-dashed border-border text-muted-foreground space-y-2">
                <span className="material-symbols-outlined text-[32px] text-muted-foreground">notifications_off</span>
                <p className="text-xs">Belum ada siaran pengumuman diterbitkan.</p>
                <Link
                  href="/admin/jadwal"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-label-sm"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  <span>Siarkan Pengumuman</span>
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                {announcements.slice(0, 3).map((ann) => (
                  <div key={ann.id} className="p-3 rounded-xl bg-surface-container-low space-y-1 border border-border/40">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-label-md text-sm text-on-surface font-semibold truncate">
                        {ann.title}
                      </p>
                      {ann.isPinned && (
                        <span className="px-1.5 py-0.5 rounded-md bg-tertiary/15 text-tertiary text-[10px] font-bold shrink-0">
                          Disematkan
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {ann.bodyMarkdown}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Modal: Atur Jam Operasional Langsung dari Beranda */}
        {isPolicyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="bg-card w-full max-w-lg rounded-2xl p-6 shadow-xl border border-border space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[24px]">schedule</span>
                  <h3 className="font-headline-sm text-lg text-on-surface font-semibold">
                    Atur Kebijakan Jam Operasional
                  </h3>
                </div>
                <button
                  onClick={() => setIsPolicyModalOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              {policyFeedback && (
                <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-xs text-primary font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">info</span>
                  <span>{policyFeedback}</span>
                </div>
              )}

              <form onSubmit={handleSavePolicy} className="space-y-4">
                <div className="space-y-1">
                  <label className="font-label-sm text-xs text-on-surface font-medium">
                    Nama Kebijakan / Shift Kerja
                  </label>
                  <input
                    type="text"
                    required
                    value={policyForm.name}
                    onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-label-sm text-xs text-on-surface font-medium">
                      Batas Tepat Waktu (WIB)
                    </label>
                    <input
                      type="time"
                      required
                      value={policyForm.attendanceCutoffTime}
                      onChange={(e) =>
                        setPolicyForm({ ...policyForm, attendanceCutoffTime: e.target.value })
                      }
                      className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-label-sm text-xs text-on-surface font-medium">
                      Batas Akhir Toleransi (WIB)
                    </label>
                    <input
                      type="time"
                      required
                      value={policyForm.attendanceGraceCutoffTime}
                      onChange={(e) =>
                        setPolicyForm({ ...policyForm, attendanceGraceCutoffTime: e.target.value })
                      }
                      className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-label-sm text-xs text-on-surface font-medium">
                    Batas Akhir Laporan Harian (WIB)
                  </label>
                  <input
                    type="time"
                    required
                    value={policyForm.reportDeadlineTime}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, reportDeadlineTime: e.target.value })
                    }
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Santri yang mengirim laporan setelah jam ini akan otomatis ditandai terlambat.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setIsPolicyModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs text-muted-foreground hover:bg-muted font-label-md"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdatingPolicy}
                    className="px-5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs shadow-xs hover:bg-primary-container disabled:opacity-50 transition-all flex items-center gap-1.5"
                  >
                    {isUpdatingPolicy && <LoadingSpinner size="sm" />}
                    <span>Simpan &amp; Terapkan Langsung</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: SANTRI / MEMBER BIASA DASHBOARD
  // =========================================================================
  return (
    <div className="flex flex-col w-full pb-8 space-y-4 max-w-4xl mx-auto">
      {loadError && <div className="rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error" role="alert">{loadError}. Muat ulang halaman untuk mencoba lagi.</div>}
      {/* Return to Admin Mode Banner if in preview mode */}
      {isAdminOrPengurus && previewAsMember && (
        <div className="bg-surface-container-high p-3 rounded-xl flex items-center justify-between gap-3 text-xs border border-primary/30">
          <span className="flex items-center gap-1.5 font-medium text-primary">
            <span className="material-symbols-outlined text-[16px]">visibility</span>
            Anda sedang melihat simulasi tampilan santri biasa
          </span>
          <button
            onClick={() => setPreviewAsMember(false)}
            className="px-3 py-1 rounded-lg bg-primary text-on-primary font-bold hover:bg-primary-container transition-all"
          >
            Kembali ke Tampilan Admin
          </button>
        </div>
      )}

      {/* Greeting & Server Sync Bar */}
      <section className="bg-card rounded-2xl p-4 sm:p-5 border border-border shadow-xs flex flex-col space-y-2">
        <h1 className="sr-only">Beranda Santri</h1>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent/60 text-accent-foreground w-fit">
            <Image
              src="/idaroh-icon.svg"
              alt="IDAROH"
              width={22}
              height={22}
              className="w-5 h-5 rounded-md object-contain"
            />
            <span className="font-label-sm text-label-sm">
              {policy ? policy.name : "Operasional Pesantren"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container-low text-success">
            <span className="material-symbols-outlined text-[14px]">cloud_done</span>
            <span className="font-label-sm text-[11px] leading-tight">Server Sinkron</span>
          </div>
        </div>
        <div>
          <h2 className="font-headline-sm text-lg sm:text-xl font-bold text-on-surface tracking-tight">
            Assalamu&apos;alaikum Warahmatullahi Wabarakatuh
          </h2>
          <div className="flex items-center gap-1.5 text-muted-foreground mt-0.5">
            <span className="material-symbols-outlined text-[16px]">schedule</span>
            <p className="font-body-sm text-xs sm:text-sm" id="live-server-clock">
              {currentDateTime}
            </p>
          </div>
        </div>
      </section>

      {/* Pinned Announcement Banner */}
      {pinnedAnnouncement ? (
        <section className="bg-surface-container-low rounded-xl p-3.5 shadow-sm relative overflow-hidden flex flex-col gap-2 border border-border/50">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-[18px]">campaign</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="font-label-sm text-[11px] uppercase tracking-wider text-primary font-semibold">
                  Pengumuman Pondok
                </span>
                <span className="font-body-sm text-[11px] text-muted-foreground">
                  {pinnedAnnouncement.publishedAtStr}
                </span>
              </div>
              <h3 className="font-label-md text-label-md text-on-surface truncate">
                {pinnedAnnouncement.title}
              </h3>
              <p className="font-body-sm text-body-sm text-muted-foreground line-clamp-1 mt-0.5">
                {pinnedAnnouncement.bodyMarkdown}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Link
              href="/jadwal"
              className="text-primary font-label-sm text-label-sm flex items-center gap-0.5 py-1 px-2 rounded-lg hover:bg-accent/40 active:scale-95 transition-all"
            >
              <span>Lihat Selengkapnya</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>
        </section>
      ) : null}

      {/* Card Presensi Hari Ini (Priority 1) */}
      <section className="bg-card rounded-xl p-4 shadow-sm flex flex-col space-y-3.5 relative overflow-hidden border border-border">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-primary flex-shrink-0">
              <span className="material-symbols-outlined text-[24px]">fingerprint</span>
            </div>
            <div>
              <span className="font-label-sm text-label-sm text-muted-foreground uppercase tracking-wider">
                Presensi Harian
              </span>
              <h3 className="font-headline-sm text-headline-sm text-on-surface leading-tight">
                Kehadiran Operasional
              </h3>
            </div>
          </div>
          {checkedIn ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-low text-success font-label-sm text-label-sm border border-success/30">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              Tercatat (<LiveClock suffix="WIB" />)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-tertiary font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-[14px]">alarm</span>
              Belum Check-in
            </span>
          )}
        </div>

        {/* Countdown & Rules Callout */}
        <div className="bg-surface-container rounded-lg p-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-tertiary">timer</span>
              Batas Tepat Waktu
            </span>
            <span className="font-label-md text-label-md text-tertiary" id="countdown-badge">
              {policy ? `${policy.attendanceCutoffTime} WIB` : "Belum Diatur Admin"}
            </span>
          </div>
          <p className="font-body-sm text-[12px] text-muted-foreground flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-muted-foreground">info</span>
            {policy
              ? `Toleransi keterlambatan sistem s.d. ${policy.attendanceGraceCutoffTime} WIB`
              : "Jam operasional presensi belum diatur oleh Admin"}
          </p>
        </div>

        {/* Primary Touch CTA Button */}
        {checkedIn ? (
          <div className="w-full h-[52px] bg-success text-white font-label-md text-body-md rounded-xl flex items-center justify-center gap-2.5 shadow-sm">
            <span className="material-symbols-outlined text-[24px]">check_circle</span>
            <span>Berhasil Presensi Hari Ini (<LiveClock suffix="WIB" />)</span>
          </div>
        ) : (
          <button
            className="w-full h-[52px] bg-primary text-on-primary font-label-md text-body-md rounded-xl flex items-center justify-center gap-2.5 shadow-sm active:scale-[0.98] transition-all disabled:opacity-90"
            id="btn-checkin"
            type="button"
            onClick={handleCheckin}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[22px]">
                  progress_activity
                </span>
                <span>Mencatat Presensi...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[24px]">touch_app</span>
                <span>Check-in Sekarang (<LiveClock suffix="WIB" />)</span>
              </>
            )}
          </button>
        )}

        {checkinError ? (
          <div
            role="alert"
            className="rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error flex items-start gap-2"
          >
            <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
            <span>{checkinError}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-center pt-0.5">
          <Link
            className="font-label-sm text-label-sm text-muted-foreground hover:text-primary active:scale-95 flex items-center gap-1 py-1 px-2 transition-colors"
            href="/kehadiran"
          >
            <span className="material-symbols-outlined text-[16px]">contact_support</span>
            <span>Ada kendala? Ajukan Izin / Sakit</span>
          </Link>
        </div>
      </section>

      {/* Card Laporan Aktivitas Harian (PRD-04) */}
      <section className="bg-card rounded-xl p-4 shadow-sm flex flex-col space-y-3.5 relative overflow-hidden border border-border">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-primary flex-shrink-0">
              <span className="material-symbols-outlined text-[24px]">edit_note</span>
            </div>
            <div>
              <span className="font-label-sm text-label-sm text-muted-foreground uppercase tracking-wider">
                Laporan Individu
              </span>
              <h3 className="font-headline-sm text-headline-sm text-on-surface leading-tight">
                Aktivitas Harian Santri
              </h3>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-tertiary font-label-sm text-label-sm">
            <span className="material-symbols-outlined text-[14px]">pending_actions</span>
            Belum Kirim
          </span>
        </div>

        <div className="bg-surface-container rounded-lg p-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-tertiary">timelapse</span>
              Batas Akhir Pelaporan
            </span>
            <span className="font-label-md text-label-md text-tertiary">
              {policy ? `Malam ini ${policy.reportDeadlineTime} WIB` : "Belum Diatur Admin"}
            </span>
          </div>
          <p className="font-body-sm text-[12px] text-muted-foreground flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-muted-foreground">info</span>
            Pelaporan kegiatan diisi mandiri setiap hari sebelum tenggat waktu
          </p>
        </div>

        <Link
          href="/laporan"
          className="w-full h-[52px] bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed font-label-md text-body-md rounded-xl flex items-center justify-center gap-2.5 shadow-sm active:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-[22px]">edit_document</span>
          <span>Tulis Laporan Hari Ini</span>
        </Link>
      </section>

      {/* Agenda Hari Ini */}
      <section className="bg-card rounded-xl p-4 shadow-sm flex flex-col space-y-3 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">event_note</span>
            <h3 className="font-headline-sm text-headline-sm text-on-surface">
              Jadwal &amp; Agenda Hari Ini
            </h3>
          </div>
          <Link href="/jadwal" className="text-primary font-label-sm text-label-sm hover:underline">
            Lihat Semua
          </Link>
        </div>

        {events.length === 0 ? (
          <div className="p-8 text-center bg-surface-container-low rounded-xl border border-dashed border-border text-muted-foreground space-y-1">
            <span className="material-symbols-outlined text-[32px] text-muted-foreground">
              event_busy
            </span>
            <p className="font-label-md text-on-surface text-[13px]">
              Belum ada agenda jadwal hari ini
            </p>
            <p className="text-[11px] text-muted-foreground">
              Agenda harian atau kajian akan tampil di sini setelah ditambahkan oleh admin atau pembina.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.slice(0, 3).map((evt) => (
              <div key={evt.id} className="p-3 rounded-lg bg-surface flex items-start gap-3">
                <div className="flex flex-col items-center justify-center px-2 py-1.5 rounded-lg bg-surface-container text-center min-w-[76px] flex-shrink-0">
                  <span className="font-label-sm text-[11px] text-primary font-bold">
                    {evt.timeRangeStr.split(" - ")[0] || "-"}
                  </span>
                  <span className="font-body-sm text-[10px] text-muted-foreground">
                    {evt.timeRangeStr.split(" - ")[1] || "WIB"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-label-md text-label-md text-on-surface truncate">
                    {evt.title}
                  </h4>
                  <p className="font-body-sm text-body-sm text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                    <span className="material-symbols-outlined text-[14px]">location_on</span>
                    {evt.location}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
