"use client";

import * as React from "react";
import {
  checkInAttendanceAction,
  getAttendanceHistoryAction,
  submitCorrectionAction,
  submitExceptionAction,
} from "@/modules/attendance/actions";
import { AttendanceRecordItem } from "@/modules/attendance/types";
import { getActivePolicyAction } from "@/modules/analytics/actions";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { LiveClock } from "@/components/ui/live-clock";
import { Illustration } from "@/components/ui/illustration";

export default function KehadiranPage() {
  const { user } = useIdentity();
  // Live server clock
  const [currentDateFormatted, setCurrentDateFormatted] = React.useState("");
  const [checkedIn, setCheckedIn] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [checkedInTime, setCheckedInTime] = React.useState("");
  const [checkedInStatus, setCheckedInStatus] = React.useState("Tepat Waktu");
  const [checkinError, setCheckinError] = React.useState<string | null>(null);

  const historyQuery = useCachedData(`attendance:history:${user.id}`, getAttendanceHistoryAction);
  const policyQuery = useCachedData("policy:active", getActivePolicyAction);
  const historyItems: AttendanceRecordItem[] = historyQuery.data ?? [];
  const policy = policyQuery.data ?? null;
  const loadError = historyQuery.error?.message || policyQuery.error?.message || null;

  React.useEffect(() => {
    const now = new Date();
    const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
    setExceptionDateFrom(todayIso);
    setExceptionDateTo(todayIso);
    setCurrentDateFormatted(
      now.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Jakarta",
      })
    );
  }, []);

  // Correction Modal State
  const [isCorrectionOpen, setIsCorrectionOpen] = React.useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = React.useState<AttendanceRecordItem | null>(null);
  const [correctionReason, setCorrectionReason] = React.useState("other");
  const [correctionNotes, setCorrectionNotes] = React.useState("");
  const [correctionSuccessMsg, setCorrectionSuccessMsg] = React.useState("");

  // Exception / Leave Modal State
  const [isExceptionOpen, setIsExceptionOpen] = React.useState(false);
  const [exceptionType, setExceptionType] = React.useState("sick");
  const [exceptionReason, setExceptionReason] = React.useState("");
  const [exceptionDateFrom, setExceptionDateFrom] = React.useState("");
  const [exceptionDateTo, setExceptionDateTo] = React.useState("");
  const [exceptionSuccessMsg, setExceptionSuccessMsg] = React.useState("");

  const handleCheckin = async () => {
    setIsProcessing(true);
    setCheckinError(null);
    const res = await checkInAttendanceAction();
    setIsProcessing(false);
    if (res.success) {
      setCheckedIn(true);
      setCheckedInTime(res.timeStr);
      setCheckedInStatus(
        res.classification === "on_time"
          ? "Tepat Waktu"
          : res.classification === "grace"
          ? "Masa Toleransi"
          : "Terlambat"
      );
      historyQuery.refresh();
    } else {
      setCheckinError(res.message || "Gagal mencatat presensi. Silakan coba lagi.");
    }
  };

  const openCorrectionDialog = (item: AttendanceRecordItem) => {
    setSelectedHistoryItem(item);
    setCorrectionNotes("");
    setCorrectionSuccessMsg("");
    setIsCorrectionOpen(true);
  };

  const handleCorrectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHistoryItem) return;

    const res = await submitCorrectionAction({
      attendanceDate: selectedHistoryItem.dateStr,
      recordedTime: selectedHistoryItem.timeStr,
      reasonCategory: correctionReason,
      notes: correctionNotes,
    });

    if (res.success) {
      setCorrectionSuccessMsg(res.message);
      historyQuery.refresh();
      setTimeout(() => {
        setIsCorrectionOpen(false);
        setCorrectionSuccessMsg("");
      }, 1400);
    }
  };

  const handleExceptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await submitExceptionAction(
      exceptionDateFrom,
      exceptionDateTo,
      exceptionType,
      exceptionReason
    );
    if (res.success) {
      setExceptionSuccessMsg(res.message);
      historyQuery.refresh();
      setTimeout(() => {
        setIsExceptionOpen(false);
        setExceptionSuccessMsg("");
        setExceptionReason("");
      }, 1400);
    }
  };

  return (
    <div className="flex flex-col w-full pb-10 max-w-7xl mx-auto space-y-4">
      {loadError && <div className="rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error" role="alert">{loadError}. Muat ulang halaman untuk mencoba lagi.</div>}
      {/* 1. Operational Time & Verified Server Sync Banner */}
      <div className="w-full bg-card rounded-2xl p-4 sm:p-5 shadow-xs space-y-3 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="inline-flex relative flex-shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-success" />
              <span className="animate-ping absolute inset-0 w-2.5 h-2.5 rounded-full bg-success opacity-75" />
            </span>
            <span className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1 font-semibold">
              Server Presensi Terverifikasi
              <span className="material-symbols-outlined text-[15px] text-primary">
                verified
              </span>
            </span>
          </div>
          <span className="font-mono text-[12px] text-muted-foreground bg-surface-container px-2.5 py-0.5 rounded-full font-medium">
            BR-ATT-05
          </span>
        </div>

        <div className="flex items-baseline justify-between pt-1">
          <div>
            <p className="font-body-sm text-body-sm text-muted-foreground">
              Waktu Resmi Operasional
            </p>
            <p className="font-mono text-[30px] md:text-[34px] font-bold tracking-tight text-primary leading-none mt-1">
              <LiveClock format="time-seconds" />{" "}
              <span className="font-body-sm text-body-sm font-normal text-muted-foreground">
                WIB
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="font-label-md text-label-md text-on-surface font-semibold">
              {currentDateFormatted || "Memuat..."}
            </p>
            <span className="inline-block mt-0.5 font-label-sm text-[11px] text-primary bg-accent px-2.5 py-0.5 rounded-md font-semibold">
              {policy ? policy.name : "Belum Diatur Admin"}
            </span>
          </div>
        </div>

        {/* Threshold Rules Bar (BR-ATT-03 & 09) */}
        <div className="bg-surface-container-low rounded-xl p-3 text-on-surface space-y-1.5 border border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[18px]">
                info
              </span>
              <span className="font-label-sm text-label-sm text-on-surface font-semibold">
                Aturan Kebijakan Presensi (BR-ATT-03 &amp; 09)
              </span>
            </div>
            {!policy && (
              <span className="text-[11px] font-mono text-error font-semibold bg-error-container/40 px-2 py-0.5 rounded">
                Jam Belum Dikonfigurasi
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center pt-1">
            <div className="bg-card rounded-xl p-2.5 shadow-xs border border-border/40">
              <p className="font-label-sm text-[11px] text-success font-semibold flex items-center justify-center gap-1">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                Tepat
              </p>
              <p className="font-mono text-[13px] text-on-surface mt-0.5 font-bold">
                {policy ? `≤ ${policy.attendanceCutoffTime}` : "--:--"}
              </p>
            </div>
            <div className="bg-card rounded-xl p-2.5 shadow-xs border border-border/40">
              <p className="font-label-sm text-[11px] text-warning font-semibold flex items-center justify-center gap-1">
                <span className="material-symbols-outlined text-[14px]">timelapse</span>
                Toleransi
              </p>
              <p className="font-mono text-[13px] text-on-surface mt-0.5 font-bold">
                {policy
                  ? `${policy.attendanceCutoffTime}–${policy.attendanceGraceCutoffTime}`
                  : "--:--"}
              </p>
            </div>
            <div className="bg-card rounded-xl p-2.5 shadow-xs border border-border/40">
              <p className="font-label-sm text-[11px] text-tertiary font-semibold flex items-center justify-center gap-1">
                <span className="material-symbols-outlined text-[14px]">warning</span>
                Terlambat
              </p>
              <p className="font-mono text-[13px] text-on-surface mt-0.5 font-bold">
                {policy ? `> ${policy.attendanceGraceCutoffTime}` : "--:--"}
              </p>
            </div>
          </div>
          {!policy && (
            <p className="text-[11px] text-muted-foreground text-center pt-0.5 italic">
              Jam operasional resmi belum ditetapkan oleh Admin tertinggi.
            </p>
          )}
        </div>
      </div>

      {/* Responsive 2-Column Grid on Desktop (≥ 1024px) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* COLUMN LEFT: Check-in CTA Card & Monthly Visual Strip */}
        <div className="space-y-4">
          {/* 2. Primary Check-in Interactive Tactile Card */}
          <div className="w-full bg-card rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">
                  touch_app
                </span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Presensi Mandiri Hari Ini
                </h2>
              </div>
              <span className="font-label-sm text-label-sm text-primary font-semibold bg-accent px-2.5 py-1 rounded-full">
                {checkedIn ? "Tercatat" : "Siap Dicatat"}
              </span>
            </div>

            {/* Interactive Tactile Button with Ripple & State */}
            <div className="relative">
              {checkedIn ? (
                <div className="p-4 bg-surface-container-low text-success border border-success/30 rounded-2xl flex items-center gap-3.5">
                  <Illustration
                    src="/illustrations/undraw_done_erdp.svg"
                    alt="Presensi Berhasil"
                    width={70}
                    height={55}
                    className="shrink-0 max-h-[55px]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-headline-sm text-[16px] font-bold leading-tight text-on-surface">
                      Presensi Anda Telah Tercatat
                    </p>
                    <p className="font-body-sm text-[12px] sm:text-[13px] text-muted-foreground mt-0.5">
                      {checkedInTime} • Status: <span className="font-semibold text-success">{checkedInStatus}</span> (Tervalidasi Server)
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  className="w-full min-h-[64px] bg-primary text-on-primary rounded-2xl flex items-center justify-center gap-3 shadow-sm hover:bg-primary-container active:scale-[0.98] transition-all p-4 select-none relative overflow-hidden group disabled:opacity-80"
                  id="btn-checkin"
                  onClick={handleCheckin}
                  disabled={isProcessing}
                  type="button"
                >
                  {isProcessing ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-[26px]">
                        progress_activity
                      </span>
                      <div className="text-left">
                        <p className="font-headline-sm text-headline-sm text-on-primary leading-tight font-semibold">
                          Menghubungkan ke Server...
                        </p>
                        <p className="font-body-sm text-body-sm text-on-primary-container leading-none opacity-90 mt-0.5">
                          Memverifikasi jam resmi WIB
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[28px] group-active:rotate-12 transition-transform">
                        how_to_reg
                      </span>
                      <div className="text-left">
                        <p className="font-headline-sm text-headline-sm text-on-primary leading-tight font-semibold">
                          Tekan untuk Check-in Mandiri
                        </p>
                        <p className="font-body-sm text-body-sm text-on-primary-container leading-none opacity-90 mt-0.5">
                          Sinkronisasi 1 ketuk ke basis data pondok
                        </p>
                      </div>
                    </>
                  )}
                </button>
              )}
            </div>

            {checkinError ? (
              <div
                role="alert"
                className="rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error flex items-start gap-2"
              >
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{checkinError}</span>
              </div>
            ) : null}

            <div className="flex items-start gap-2 bg-surface-container-low p-3 rounded-xl border border-border/40">
              <span className="material-symbols-outlined text-primary text-[18px] flex-shrink-0 mt-0.5">
                verified_user
              </span>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Presensi tervalidasi menggunakan jam server resmi (WIB). Tidak mewajibkan akses GPS maupun foto biometrik berulang.
              </p>
            </div>

            {/* Quick Preview of Prior Active Record */}
            <div className="pt-1 flex items-center justify-between bg-surface-container/40 p-3 rounded-xl border border-border/30">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-primary flex-shrink-0">
                  <span className="material-symbols-outlined text-[18px]">history</span>
                </span>
                <div>
                  <p className="font-body-sm text-[12px] text-muted-foreground">Catatan Terakhir</p>
                  <p className="font-label-md text-label-md text-on-surface font-semibold">
                    {historyItems[0]
                      ? `${historyItems[0].dateFormatted} • ${historyItems[0].timeStr}`
                      : "Belum ada presensi tercatat"}
                  </p>
                </div>
              </div>
              {historyItems[0] && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-semibold">
                  <span className="material-symbols-outlined text-[14px] text-success">
                    check_circle
                  </span>
                  {historyItems[0].label}
                </span>
              )}
            </div>
          </div>

          {/* 3. Monthly Attendance Calendar & Visual Strip (ATT-005) */}
          <div className="w-full bg-card rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">
                  calendar_month
                </span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Peta Kehadiran Bulanan
                </h3>
              </div>
              <div className="flex items-center gap-1 bg-surface-container-low px-2.5 py-1 rounded-lg border border-border/40">
                <span className="font-label-sm text-label-sm text-on-surface font-semibold capitalize">
                  {new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" })}
                </span>
              </div>
            </div>

            {/* Visual Strip: Current Week */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-label-sm text-[12px] text-muted-foreground">
                  Pekan Berjalan
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1.5 text-center">
                {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((dayName) => {
                  return (
                    <div
                      key={dayName}
                      className="flex flex-col items-center p-2 rounded-xl bg-surface-container-low border border-border/30"
                    >
                      <span className="font-label-sm text-[11px] text-muted-foreground">
                        {dayName}
                      </span>
                      <span className="font-label-md text-label-md text-on-surface font-semibold my-0.5">
                        -
                      </span>
                      <span className="material-symbols-outlined text-[16px] text-muted-foreground">
                        remove
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Monthly Stats Summary Cards (3 Columns) */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div className="bg-surface-container-low rounded-xl p-3 flex flex-col items-center text-center border border-border/30">
                <span className="material-symbols-outlined text-success text-[20px] mb-1">
                  check_circle
                </span>
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  {historyItems.filter((i) => i.classification === "on_time").length}
                </span>
                <span className="font-label-sm text-[11px] text-muted-foreground mt-0.5">
                  Tepat Waktu
                </span>
              </div>
              <div className="bg-surface-container-low rounded-xl p-3 flex flex-col items-center text-center border border-border/30">
                <span className="material-symbols-outlined text-warning text-[20px] mb-1">
                  timelapse
                </span>
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  {historyItems.filter((i) => i.classification === "grace").length}
                </span>
                <span className="font-label-sm text-[11px] text-muted-foreground mt-0.5">
                  Toleransi
                </span>
              </div>
              <div className="bg-surface-container-low rounded-xl p-3 flex flex-col items-center text-center border border-border/30">
                <span className="material-symbols-outlined text-accent-foreground text-[20px] mb-1">
                  event_busy
                </span>
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  {historyItems.filter((i) => i.classification === "excused").length}
                </span>
                <span className="font-label-sm text-[11px] text-muted-foreground mt-0.5">
                  Izin / Sakit
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* COLUMN RIGHT: Attendance History & Correction Flow (ATT-007) */}
        <div className="space-y-4">
          <div className="w-full bg-card rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5 border border-border">
            <div className="flex items-center justify-between pb-1 border-b border-border/40">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">
                  manage_search
                </span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Riwayat Presensi Terbaru
                </h3>
              </div>
              <span className="font-mono text-[12px] text-muted-foreground bg-surface-container px-2 py-0.5 rounded-full font-medium">
                ATT-007
              </span>
            </div>

            {/* History Records List */}
            <div className="space-y-2.5">
              {historyItems.length === 0 ? (
                <div className="p-8 text-center bg-surface-container-low rounded-xl border border-dashed border-border text-muted-foreground space-y-1">
                  <span className="material-symbols-outlined text-[32px] text-muted-foreground">event_busy</span>
                  <p className="font-label-md text-on-surface text-[13px]">Belum ada riwayat presensi tercatat</p>
                  <p className="text-[11px] text-muted-foreground">Lakukan check-in presensi di atas untuk mulai mencatat riwayat.</p>
                </div>
              ) : (
                historyItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-surface-container-low rounded-xl p-3.5 space-y-2 border border-border/40 transition-all hover:border-primary/30"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-label-md text-label-md font-semibold text-on-surface">
                        {item.dateFormatted}
                      </p>
                      <p className="font-mono text-[12px] text-muted-foreground">
                        Tercatat: {item.timeStr}
                      </p>
                    </div>
                    {item.classification === "on_time" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-semibold">
                        <span className="material-symbols-outlined text-[13px] text-success">
                          check_circle
                        </span>
                        Tepat Waktu
                      </span>
                    ) : item.classification === "grace" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface font-label-sm text-label-sm font-semibold">
                        <span className="material-symbols-outlined text-[13px] text-warning">
                          timelapse
                        </span>
                        Masa Toleransi
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent text-accent-foreground font-label-sm text-label-sm font-semibold">
                        <span className="material-symbols-outlined text-[13px]">
                          assignment
                        </span>
                        Izin Resmi
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="font-body-sm text-[12px] text-muted-foreground">
                      {item.sessionTitle} {item.notes ? `• ${item.notes}` : ""}
                    </span>
                    {item.canCorrect && (
                      <button
                        className="font-label-sm text-[12px] text-primary hover:text-primary-container font-semibold flex items-center gap-0.5 transition-colors"
                        onClick={() => openCorrectionDialog(item)}
                        type="button"
                      >
                        <span>Ajukan Koreksi</span>
                        <span className="material-symbols-outlined text-[14px]">
                          arrow_forward
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )))}
            </div>

            {/* Secondary Exception / Leave Application Button */}
            <div className="pt-2">
              <button
                className="w-full min-h-[48px] bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed rounded-xl flex items-center justify-center gap-2 p-3 active:scale-[0.99] transition-all font-label-md text-label-md font-semibold border border-border/50"
                onClick={() => setIsExceptionOpen(true)}
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">edit_note</span>
                <span>Ajukan Keterangan Izin / Sakit</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL 1: Correction Modal Dialog (ATT-007) */}
      {isCorrectionOpen && selectedHistoryItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-card rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto border border-border">
            <div className="w-12 h-1.5 bg-muted rounded-full mx-auto sm:hidden mb-1" />
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
              <div>
                <h4 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Formulir Koreksi Presensi
                </h4>
                <p className="font-body-sm text-[13px] text-muted-foreground">
                  Riwayat: {selectedHistoryItem.dateFormatted} ({selectedHistoryItem.timeStr})
                </p>
              </div>
              <button
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-muted"
                onClick={() => setIsCorrectionOpen(false)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {correctionSuccessMsg ? (
              <div className="py-6 text-center text-success flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[36px]">check_circle</span>
                <p className="font-label-md text-label-md">{correctionSuccessMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleCorrectionSubmit} className="space-y-3.5">
                <div>
                  <label className="block font-label-sm text-label-sm font-semibold text-on-surface mb-1">
                    Alasan Penyesuaian
                  </label>
                  <select
                    className="w-full h-12 bg-surface-container text-on-surface rounded-xl px-3 font-body-md text-[15px] focus:outline-none focus:ring-2 focus:ring-primary border border-border"
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                  >
                    <option value="wrong_time">
                      Piket Dapur / Operasional Kebersihan
                    </option>
                    <option value="missed_checkin">
                      Tugas Luar / Pengawalan Pengasuh
                    </option>
                    <option value="system_error">
                      Antrian Masuk Asrama / Gangguan Sinyal
                    </option>
                    <option value="other">
                      Lainnya (Perlu Disposisi Ustadz)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block font-label-sm text-label-sm font-semibold text-on-surface mb-1">
                    Catatan Tambahan (Opsional)
                  </label>
                  <textarea
                    className="w-full bg-surface-container text-on-surface rounded-xl p-3 font-body-md text-[15px] focus:outline-none focus:ring-2 focus:ring-primary resize-none border border-border"
                    placeholder="Tuliskan keterangan detail untuk verifikator..."
                    rows={3}
                    value={correctionNotes}
                    onChange={(e) => setCorrectionNotes(e.target.value)}
                  />
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    className="flex-1 h-12 bg-surface-container text-on-surface rounded-xl font-label-md text-label-md font-semibold border border-border"
                    onClick={() => setIsCorrectionOpen(false)}
                    type="button"
                  >
                    Batal
                  </button>
                  <button
                    className="flex-1 h-12 bg-primary text-on-primary rounded-xl font-label-md text-label-md font-semibold shadow-xs"
                    type="submit"
                  >
                    Kirim Pengajuan
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: Sickness / Leave Exception Modal */}
      {isExceptionOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-card rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto border border-border">
            <div className="w-12 h-1.5 bg-muted rounded-full mx-auto sm:hidden mb-1" />
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
              <div>
                <h4 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Permohonan Izin / Sakit
                </h4>
                <p className="font-body-sm text-[13px] text-muted-foreground">
                  Dispensasi ketidakhadiran resmi santri
                </p>
              </div>
              <button
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-muted"
                onClick={() => setIsExceptionOpen(false)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {exceptionSuccessMsg ? (
              <div className="py-6 text-center text-success flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[36px]">check_circle</span>
                <p className="font-label-md text-label-md">{exceptionSuccessMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleExceptionSubmit} className="space-y-3.5">
                <div>
                  <label className="block font-label-sm text-label-sm font-semibold text-on-surface mb-1">
                    Rentang Tanggal
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      required
                      value={exceptionDateFrom}
                      onChange={(e) => setExceptionDateFrom(e.target.value)}
                      className="h-12 bg-surface-container text-on-surface rounded-xl px-3 font-body-md text-[15px] border border-border"
                    />
                    <input
                      type="date"
                      required
                      min={exceptionDateFrom || undefined}
                      value={exceptionDateTo}
                      onChange={(e) => setExceptionDateTo(e.target.value)}
                      className="h-12 bg-surface-container text-on-surface rounded-xl px-3 font-body-md text-[15px] border border-border"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-label-sm text-label-sm font-semibold text-on-surface mb-1">
                    Jenis Keterangan
                  </label>
                  <select
                    className="w-full h-12 bg-surface-container text-on-surface rounded-xl px-3 font-body-md text-[15px] focus:outline-none focus:ring-2 focus:ring-primary border border-border"
                    value={exceptionType}
                    onChange={(e) => setExceptionType(e.target.value)}
                  >
                    <option value="sick">Sakit (Disertai Surat / Istirahat)</option>
                    <option value="excused">Izin Keperluan Keluarga / Santri</option>
                    <option value="duty">Tugas Operasional / Dinas Pondok</option>
                  </select>
                </div>

                <div>
                  <label className="block font-label-sm text-label-sm font-semibold text-on-surface mb-1">
                    Alasan Lengkap
                  </label>
                  <textarea
                    required
                    className="w-full bg-surface-container text-on-surface rounded-xl p-3 font-body-md text-[15px] focus:outline-none focus:ring-2 focus:ring-primary resize-none border border-border"
                    placeholder="Jelaskan alasan dan perkiraan tanggal kembali..."
                    rows={3}
                    value={exceptionReason}
                    onChange={(e) => setExceptionReason(e.target.value)}
                  />
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    className="flex-1 h-12 bg-surface-container text-on-surface rounded-xl font-label-md text-label-md font-semibold border border-border"
                    onClick={() => setIsExceptionOpen(false)}
                    type="button"
                  >
                    Batal
                  </button>
                  <button
                    className="flex-1 h-12 bg-primary text-on-primary rounded-xl font-label-md text-label-md font-semibold shadow-xs"
                    type="submit"
                  >
                    Ajukan Keterangan
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
