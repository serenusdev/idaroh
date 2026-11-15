"use client";

import * as React from "react";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { Illustration } from "@/components/ui/illustration";
import { Modal } from "@/components/ui/modal";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { invalidateCache } from "@/lib/data-cache";
import {
  exportAuditedDataAction,
  queryAuditLogsAction,
  getActivePolicyAction,
  updatePolicySettingsAction,
  getPendingPolicySettingsAction,
  approvePolicySettingsAction,
  activatePolicySettingsAction,
  getAuditChainStatusAction,
  getAdminDashboardStatsAction,
} from "@/modules/analytics/actions";

export default function AdminAuditPage() {
  const { user: currentUser } = useIdentity();
  const [scope, setScope] = React.useState("Semua Tim (Organisasi)");
  const [auditPage, setAuditPage] = React.useState(1);
  const [searchLogQuery, setSearchLogQuery] = React.useState("");
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  const policyQuery = useCachedData("policy:active", getActivePolicyAction);
  const chainQuery = useCachedData("admin:audit-chain", getAuditChainStatusAction);
  const pendingQuery = useCachedData("admin:pending-policies", getPendingPolicySettingsAction);
  const logsQuery = useCachedData(`admin:audit-logs:${scope}:${searchLogQuery}:${auditPage}`, () => queryAuditLogsAction(searchLogQuery, scope, auditPage));
  const statsQuery = useCachedData("admin:dashboard-stats", getAdminDashboardStatsAction);

  const policy = policyQuery.data ?? null;
  const auditChain = chainQuery.data ?? null;
  const pendingPolicies = pendingQuery.data ?? [];
  const logsResult = logsQuery.data;
  const auditLogs = logsResult?.success ? logsResult.logs : [];
  const auditHasMore = Boolean(logsResult?.success && logsResult.hasMore);

  const stats = statsQuery.data ?? null;
  const totalSantri = stats?.totalSantri ?? 0;
  const checkedIn = stats?.todayCheckedIn ?? 0;
  const lateCount = stats?.todayLate ?? 0;
  const absentCount = Math.max(0, totalSantri - checkedIn);
  const checkInRate = totalSantri > 0 ? Math.round((checkedIn / totalSantri) * 100) : 0;
  const pendingReports = stats?.pendingReports ?? 0;
  const approvedReports = stats?.approvedReports ?? 0;
  const totalSubmitted = pendingReports + approvedReports;
  const reviewProgress = totalSubmitted > 0 ? Math.round((approvedReports / totalSubmitted) * 100) : 0;

  // Modals state
  const [isExportDialogOpen, setIsExportDialogOpen] = React.useState(false);
  const [isDrilldownOpen, setIsDrilldownOpen] = React.useState(false);
  const [isPolicyModalOpen, setIsPolicyModalOpen] = React.useState(false);
  const [exportFormat, setExportFormat] = React.useState<"csv" | "pdf">("csv");
  const [exportCategory, setExportCategory] = React.useState("presensi_laporan");
  const [isExporting, setIsExporting] = React.useState(false);

  const [approveTargetId, setApproveTargetId] = React.useState<string | null>(null);
  const [approveReason, setApproveReason] = React.useState("");
  const [approveError, setApproveError] = React.useState<string | null>(null);
  const [isApproving, setIsApproving] = React.useState(false);

  const [policyForm, setPolicyForm] = React.useState({
    name: "",
    attendanceCutoffTime: "",
    attendanceGraceCutoffTime: "",
    reportDeadlineTime: "",
    effectiveFrom: "",
    changeReason: "",
  });

  React.useEffect(() => {
    const p = policyQuery.data;
    if (p === undefined) return;
    setPolicyForm(p ? {
      name: p.name,
      attendanceCutoffTime: p.attendanceCutoffTime,
      attendanceGraceCutoffTime: p.attendanceGraceCutoffTime,
      reportDeadlineTime: p.reportDeadlineTime,
      effectiveFrom: p.effectiveFrom,
      changeReason: "",
    } : { name: "", attendanceCutoffTime: "", attendanceGraceCutoffTime: "", reportDeadlineTime: "", effectiveFrom: "", changeReason: "" });
  }, [policyQuery.data]);

  const loadError = policyQuery.error ?? chainQuery.error ?? logsQuery.error ?? statsQuery.error;
  React.useEffect(() => {
    if (loadError) setToastMessage("Data audit atau kebijakan belum dapat dimuat. Silakan coba lagi.");
  }, [loadError]);

  const reload = () => {
    void policyQuery.refresh();
    void chainQuery.refresh();
    void pendingQuery.refresh();
    void logsQuery.refresh();
    void statsQuery.refresh();
  };

  const isAdminOrPengurus =
    currentUser?.role === "super_admin" ||
    currentUser?.role === "yayasan" ||
    currentUser?.role === "pengurus";

  if (!isAdminOrPengurus) {
    return <UnauthorizedState requiredRole="Super Admin / Pengurus / Yayasan" />;
  }

  // Handle Log search
  const handleSearchLogs = (q: string) => {
    setSearchLogQuery(q);
    setAuditPage(1);
  };

  // Handle Export submission
  const handleExecuteExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExporting(true);
    try {
      const res = await exportAuditedDataAction(
        exportFormat,
        exportCategory,
        "Super Admin"
      );
      if (res.success) {
        setToastMessage(res.message);
        setIsExportDialogOpen(false);
        if (res.downloadUrl) window.location.assign(res.downloadUrl);
      }
    } catch {
      setToastMessage("Terjadi kesalahan saat memproses ekspor data.");
    } finally {
      setIsExporting(false);
      setTimeout(() => setToastMessage(null), 4500);
    }
  };

  // Handle Save Policy Settings (Setting and adjusting hours by Super Admin)
  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await updatePolicySettingsAction(policyForm);
    if (res.success) {
      setToastMessage(res.message);
      setIsPolicyModalOpen(false);
      reload();
      setTimeout(() => setToastMessage(null), 4500);
    } else {
      setToastMessage(res.message);
    }
  };

  const openApproveDialog = (id: string) => {
    setApproveTargetId(id);
    setApproveReason("");
    setApproveError(null);
  };

  const handleConfirmApprove = async () => {
    if (!approveTargetId || isApproving) return;
    const reason = approveReason.trim();
    if (!reason) {
      setApproveError("Alasan persetujuan wajib diisi sebelum menyetujui usulan kebijakan.");
      return;
    }
    setIsApproving(true);
    setApproveError(null);
    try {
      const result = await approvePolicySettingsAction(approveTargetId, reason);
      setToastMessage(result.message);
      if (result.success) {
        setApproveTargetId(null);
        reload();
      } else {
        setApproveError(result.message || "Gagal menyetujui usulan kebijakan.");
      }
    } catch {
      setApproveError("Terjadi kesalahan saat menyetujui usulan kebijakan. Silakan coba lagi.");
    } finally {
      setIsApproving(false);
      setTimeout(() => setToastMessage(null), 4500);
    }
  };

  const handleActivatePolicy = async (id: string) => {
    const result = await activatePolicySettingsAction(id);
    setToastMessage(result.message);
    if (result.success) {
      reload();
      invalidateCache("policy:");
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-24">
      {/* Toast Alert Notice */}
      {toastMessage && (
        <div role="status" aria-live="polite" className="p-3.5 rounded-xl bg-surface-container text-primary border border-border flex items-center justify-between text-xs sm:text-sm shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">verified</span>
            <span>{toastMessage}</span>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Sub-header & Meta Section */}
      <div className="flex flex-col gap-1 pt-1">
        <div className="flex items-center justify-between">
          <span className="font-code-md text-xs text-primary font-medium tracking-wider uppercase px-2.5 py-0.5 bg-accent rounded-lg">
            PRD-08 • ANALYTICS &amp; ADMIN
          </span>
          <span className="inline-flex items-center gap-1.5 font-label-sm text-xs text-success bg-surface-container-low px-2.5 py-0.5 rounded-full font-medium">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
            {auditChain ? (auditChain.valid ? `Audit Chain Valid · ${auditChain.checked}` : "Audit Chain Perlu Pemeriksaan") : "Memeriksa Audit Chain…"}
          </span>
        </div>
        <h1 className="font-headline-sm text-xl sm:text-2xl text-on-surface font-bold tracking-tight">
          Pusat Kontrol Kebijakan &amp; Audit Trail
        </h1>
        <p className="font-body-sm text-xs sm:text-sm text-muted-foreground">
          Kelola kebijakan jam operasional, pantau ringkasan kepatuhan organisasi, dan periksa jejak audit append-only.
        </p>
      </div>

      {/* Scope Selector Bar */}
      <div className="bg-card rounded-xl p-3 sm:p-4 shadow-xs border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-label-md text-xs sm:text-sm font-semibold text-on-surface">
            Status Operasional
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            • Data Terhubung Dinamis
          </span>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <span className="material-symbols-outlined text-[18px] text-primary">
              corporate_fare
            </span>
            <span className="font-label-sm">Cakupan Unit:</span>
          </div>
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setAuditPage(1);
            }}
            className="font-label-sm text-xs text-primary font-semibold py-1 px-2.5 rounded-lg bg-surface-container border border-border focus:outline-none"
          >
            <option value="Semua Tim (Organisasi)">Semua Tim (Organisasi)</option>
            <option value="Sentra Digital">Sentra Digital</option>
            <option value="Tim Media & Konten">Tim Media &amp; Konten</option>
            <option value="Halaqah Tahfidz">Halaqah Tahfidz</option>
          </select>
        </div>
      </div>

      {/* Main Responsive Grid Layout (Desktop 2-Column, Mobile Stack) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 3 Core Metrics & Guidance Banner (col-span-7) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Metric 1: Kehadiran / Absensi */}
          <div className="bg-card rounded-xl p-4 sm:p-5 shadow-xs border border-border flex flex-col gap-3.5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                  <span className="material-symbols-outlined text-[22px]">how_to_reg</span>
                </div>
                <div>
                  <span className="font-label-sm text-xs text-muted-foreground uppercase tracking-wider block">
                    Absensi Santri Hari Ini
                  </span>
                  <span className="font-headline-sm text-sm sm:text-base font-semibold text-on-surface">
                    Tingkat Check-in
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-code-md text-xl sm:text-2xl text-primary font-bold leading-none">
                  {stats ? `${checkInRate}%` : "…"}
                </div>
                <span className="font-body-sm text-xs text-muted-foreground">
                  {stats ? `${checkedIn} dari ${totalSantri} Santri Terdaftar` : "Memuat data presensi…"}
                </span>
              </div>
            </div>

            {/* Progress Bar Segments */}
            <div className="w-full bg-muted h-2.5 rounded-full overflow-hidden flex">
              <div className="bg-primary h-full transition-all" style={{ width: `${checkInRate}%` }} />
            </div>

            {/* Detailed Badges */}
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div className="bg-surface-container-low p-2 rounded-lg flex flex-col border border-border/40">
                <span className="font-label-sm text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-primary inline-block"></span> Hadir
                </span>
                <span className="font-code-md text-base text-primary font-semibold mt-0.5">{stats ? checkedIn : "…"}</span>
              </div>
              <div className="bg-surface-container-low p-2 rounded-lg flex flex-col border border-border/40">
                <span className="font-label-sm text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-warning inline-block"></span> Terlambat
                </span>
                <span className="font-code-md text-base text-on-surface font-semibold mt-0.5">{stats ? lateCount : "…"}</span>
              </div>
              <div className="bg-surface-container-low p-2 rounded-lg flex flex-col border border-border/40">
                <span className="font-label-sm text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-error inline-block"></span> Belum Hadir
                </span>
                <span className="font-code-md text-base text-error font-semibold mt-0.5">{stats ? absentCount : "…"}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsDrilldownOpen(true)}
              className="w-full mt-1 py-2 px-3 rounded-lg bg-surface-container-high hover:bg-surface-dim text-primary font-label-sm text-xs flex items-center justify-center gap-1.5 transition-all"
            >
              <span>Rincian Record Presensi</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          </div>

          {/* Metric 2: Kepatuhan Laporan Harian */}
          <div className="bg-card rounded-xl p-4 sm:p-5 shadow-xs border border-border flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center text-accent-foreground shrink-0">
                  <span className="material-symbols-outlined text-[22px]">assignment_turned_in</span>
                </div>
                <div>
                  <span className="font-label-sm text-xs text-muted-foreground uppercase tracking-wider block">
                    Laporan Mutaba&apos;ah &amp; Kerja
                  </span>
                  <span className="font-headline-sm text-sm sm:text-base font-semibold text-on-surface">
                    Progres Review Laporan
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-code-md text-xl sm:text-2xl text-primary font-bold leading-none">
                  {stats ? `${reviewProgress}%` : "…"}
                </div>
                <span className="font-body-sm text-xs text-muted-foreground">
                  {policy ? `Tenggat ${policy.reportDeadlineTime} WIB` : "Tenggat Belum Diatur"}
                </span>
              </div>
            </div>

            {/* Mini Visual Strip */}
            <div className="flex items-center gap-2 bg-surface-container-low p-2.5 rounded-lg border border-border/40">
              <div className="flex-1 flex flex-col">
                <span className="font-label-sm text-[11px] text-muted-foreground">
                  Rekap Pelaporan
                </span>
                <div className="flex items-baseline gap-2 mt-0.5 text-xs">
                  <span className="font-code-md text-tertiary font-semibold">{stats ? pendingReports : "…"} Menunggu</span>
                  <span className="text-muted-foreground">•</span>
                  <span className="font-code-md text-primary font-semibold">{stats ? approvedReports : "…"} Disetujui</span>
                </div>
              </div>
              <div className="w-px h-8 bg-border"></div>
              <div className="flex flex-col text-right pl-2">
                <span className="font-label-sm text-[11px] text-muted-foreground">
                  Antrean Review
                </span>
                <div className="flex items-center justify-end gap-1 mt-0.5 text-xs">
                  <span className="font-code-md font-semibold text-tertiary">{stats ? pendingReports : "…"} Berkas</span>
                </div>
              </div>
            </div>
          </div>

          {/* Guidance Banner ISO/IEC 27001 */}
          <div className="bg-surface-container-low rounded-xl p-4 flex items-center gap-3.5 border border-border/40">
            <div className="w-9 h-9 rounded-lg bg-surface flex items-center justify-center text-primary shrink-0 shadow-2xs">
              <span className="material-symbols-outlined text-[20px]">security</span>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-label-md text-xs font-semibold text-on-surface">
                Integritas Operasional &amp; Keamanan Data
              </h4>
              <p className="font-body-sm text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                Semua penetapan jam kerja, persetujuan akun, dan penerbitan laporan diaudit secara kriptografis menggunakan audit log append-only.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Policy Settings & Audit Trail Explorer (col-span-5) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Policy Settings Card (PRD-08 §5) */}
          {pendingPolicies.length > 0 && (
            <div className="bg-accent/30 rounded-xl p-4 sm:p-5 border border-primary/20 space-y-3">
              <div className="flex items-center gap-2"><span className="material-symbols-outlined text-primary">pending_actions</span><div><p className="font-semibold text-sm text-on-surface">Alur persetujuan dua tahap</p><p className="text-[11px] text-muted-foreground">Usulan tidak mengubah kebijakan aktif sebelum Yayasan menyetujui dan Super Admin mengaktifkannya.</p></div></div>
              {pendingPolicies.map((item) => <div key={item.id} className="rounded-lg bg-card border border-border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"><div><p className="text-xs font-semibold text-on-surface">{item.code} · {item.name}</p><p className="text-[11px] text-muted-foreground">Berlaku {item.effectiveFrom} · Tepat ≤ {item.attendanceCutoffTime} · Laporan {item.reportDeadlineTime}</p></div>{currentUser?.role === "yayasan" && item.status === "proposed" ? <button type="button" onClick={() => openApproveDialog(item.id)} className="h-8 px-3 rounded-lg bg-primary text-on-primary text-[11px] font-semibold">Setujui</button> : currentUser?.role === "super_admin" && item.status === "approved" ? <button type="button" onClick={() => handleActivatePolicy(item.id)} className="h-8 px-3 rounded-lg bg-primary text-on-primary text-[11px] font-semibold">Aktifkan</button> : <span className="text-[11px] text-muted-foreground">{item.status === "proposed" ? "Menunggu Yayasan" : "Menunggu aktivasi"}</span>}</div>)}
            </div>
          )}
          <div className="bg-card rounded-xl p-4 sm:p-5 shadow-xs border border-border flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">
                  rule_folder
                </span>
                <span className="font-headline-sm text-sm font-semibold text-on-surface">
                  Kebijakan Operasional Aktif
                </span>
              </div>
              {policy ? (
                <span className="inline-flex items-center gap-1 font-label-sm text-[11px] text-primary bg-accent px-2 py-0.5 rounded-full font-semibold">
                  <span className="material-symbols-outlined text-[13px]">lock</span>
                  Terkonfirmasi &amp; Terkunci
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-label-sm text-[11px] text-error bg-error-container/40 px-2 py-0.5 rounded-full font-semibold">
                  Belum Dikonfigurasi
                </span>
              )}
            </div>

            {policy ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex flex-col">
                    <span className="font-body-sm text-muted-foreground">ID Kebijakan</span>
                    <span className="font-code-md text-on-surface font-semibold text-sm">
                      {policy.code}
                    </span>
                    <span className="font-body-sm text-[11px] text-muted-foreground mt-0.5">
                      Berlaku: {policy.effectiveFrom}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-body-sm text-muted-foreground">
                      Parameter Kehadiran
                    </span>
                    <span className="font-code-md text-on-surface text-sm">
                      Tepat: ≤ {policy.attendanceCutoffTime} WIB
                    </span>
                    <span className="font-body-sm text-[11px] text-muted-foreground mt-0.5">
                      Toleransi: s.d. {policy.attendanceGraceCutoffTime} WIB
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Batas Pelaporan Harian:</span>
                  <span className="font-code-md font-semibold text-primary">
                    {policy.reportDeadlineTime} WIB
                  </span>
                </div>

                {currentUser?.role === "super_admin" && <button
                  type="button"
                  onClick={() => setIsPolicyModalOpen(true)}
                  className="w-full mt-1 py-2 px-3 rounded-lg bg-surface-container hover:bg-surface-dim text-primary font-label-sm text-xs flex items-center justify-center gap-1.5 transition-all font-semibold"
                >
                  <span className="material-symbols-outlined text-[16px]">tune</span>
                  <span>Ubah Jam Operasional (Super Admin)</span>
                </button>}
              </>
            ) : (
              <div className="p-4 rounded-xl bg-surface-container-low border border-dashed border-border text-center space-y-2">
                <span className="material-symbols-outlined text-[32px] text-muted-foreground">
                  schedule
                </span>
                <p className="font-label-md text-on-surface text-xs">
                  Jam operasional belum ditentukan oleh Admin tertinggi.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Atur jam masuk, batas toleransi, dan deadline laporan agar sistem memiliki jadwal yang pasti dan dapat diisi mandiri.
                </p>
                {currentUser?.role === "super_admin" && <button
                  type="button"
                  onClick={() => setIsPolicyModalOpen(true)}
                  className="h-9 px-4 rounded-lg bg-primary text-on-primary font-label-md text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">edit_calendar</span>
                  <span>+ Atur Jam Operasional Sekarang</span>
                </button>}
              </div>
            )}
          </div>

          {/* Append-Only Audit Log List (PRD-08 §7) */}
          <div className="bg-card rounded-xl p-4 sm:p-5 shadow-xs border border-border flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">
                  history_edu
                </span>
                <span className="font-headline-sm text-sm font-semibold text-on-surface">
                  Jejak Audit Terbaru
                </span>
              </div>
              <span className="font-code-md text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded font-medium">
                Append-Only
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-success font-label-sm text-[11px] pb-1">
              <span className="material-symbols-outlined text-[15px]">enhanced_encryption</span>
              <span>Hash Chaining Valid • Supabase Cryptographic Logs</span>
            </div>

            {/* Search Audit Logs input */}
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-2 text-muted-foreground text-[16px]">
                search
              </span>
              <input
                type="text"
                value={searchLogQuery}
                onChange={(e) => handleSearchLogs(e.target.value)}
                placeholder="Cari event atau target log..."
                className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-surface-container-low border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Entry Timeline */}
            <div className="flex flex-col space-y-3 pt-1">
              {auditLogs.length === 0 ? (
                <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
                  <Illustration
                    src="/illustrations/undraw_status-page_46km.svg"
                    alt="Belum ada jejak audit"
                    width={130}
                    height={90}
                  />
                  <div>
                    <p className="font-headline-sm text-base font-semibold text-on-surface">
                      Belum Ada Jejak Audit Tercatat
                    </p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                      Setiap aksi administratif, perubahan jam kebijakan, dan persetujuan akun akan tercatat di sini secara otomatis.
                    </p>
                  </div>
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-col gap-1.5 p-3 rounded-lg bg-surface-container-low border border-border/40 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-code-md text-xs text-primary font-semibold break-all">
                        {log.eventName}
                      </span>
                      <span className="font-code-md text-[10px] text-muted-foreground shrink-0">
                        {log.timeAgo}
                      </span>
                    </div>
                    <div className="text-on-surface-variant">
                      Oleh{" "}
                      <strong className="text-on-surface font-semibold">{log.actorName}</strong> •
                      Target:{" "}
                      <span className="font-code-md text-primary">{log.targetLabel}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground bg-card p-2 rounded border border-border/60">
                      <span className="font-medium text-on-surface">Aksi:</span> {log.actionDetail}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-[11px] text-muted-foreground">Halaman {auditPage}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage((page) => Math.max(1, page - 1))}
                  className="h-7 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-on-surface disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={!auditHasMore}
                  onClick={() => setAuditPage((page) => page + 1)}
                  className="h-7 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-on-surface disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          </div>

          {/* Operational Bottom Actions */}
          <div className="flex flex-col gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setIsExportDialogOpen(true)}
              className="w-full h-11 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span>Ekspor Rekap Beraudit (CSV / PDF)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (searchLogQuery === "" && auditPage === 1) void logsQuery.refresh();
                else handleSearchLogs("");
              }}
              className="w-full h-11 bg-secondary-container hover:bg-secondary-fixed text-on-secondary-fixed font-label-md text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">manage_search</span>
              <span>Reset &amp; Muat Ulang Log Explorer</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Dialog: Atur Jam Operasional Kebijakan (Super Admin) */}
      {isPolicyModalOpen && (
        <Modal
          isOpen
          onClose={() => setIsPolicyModalOpen(false)}
          title="Atur Kebijakan Jam Operasional"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          className="bg-card rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-xl border border-border space-y-4"
        >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">
                  schedule
                </span>
                <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                  Atur Kebijakan Jam Operasional
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPolicyModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSavePolicy} className="space-y-4">
              <div>
                <label htmlFor="policy-name" className="text-xs font-semibold text-on-surface block mb-1">
                  Nama Kebijakan / Shift Kerja
                </label>
                <input
                  id="policy-name"
                  type="text"
                  required
                  value={policyForm.name}
                  onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                  placeholder="Contoh: Shift Reguler Santri 2026/2027"
                  className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="policy-cutoff" className="text-xs font-semibold text-on-surface block mb-1">
                    Batas Check-in Tepat Waktu (WIB)
                  </label>
                  <input
                    id="policy-cutoff"
                    type="time"
                    required
                    value={policyForm.attendanceCutoffTime}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, attendanceCutoffTime: e.target.value })
                    }
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-[11px] text-muted-foreground mt-0.5 block">
                    Presensi sebelum jam ini diklasifikasikan Tepat Waktu
                  </span>
                </div>

                <div>
                  <label htmlFor="policy-grace" className="text-xs font-semibold text-on-surface block mb-1">
                    Batas Masa Toleransi (WIB)
                  </label>
                  <input
                    id="policy-grace"
                    type="time"
                    required
                    value={policyForm.attendanceGraceCutoffTime}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, attendanceGraceCutoffTime: e.target.value })
                    }
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-[11px] text-muted-foreground mt-0.5 block">
                    Lewat jam ini otomatis berstatus Terlambat
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="policy-report-deadline" className="text-xs font-semibold text-on-surface block mb-1">
                  Batas Akhir Pelaporan Harian Mutaba&apos;ah (WIB)
                </label>
                <input
                  id="policy-report-deadline"
                  type="time"
                  required
                  value={policyForm.reportDeadlineTime}
                  onChange={(e) =>
                    setPolicyForm({ ...policyForm, reportDeadlineTime: e.target.value })
                  }
                  className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="text-[11px] text-muted-foreground mt-0.5 block">
                  Tenggat akhir pengisian laporan santri harian
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label htmlFor="policy-effective-from" className="text-xs font-semibold text-on-surface block mb-1">Mulai berlaku</label><input id="policy-effective-from" type="date" required value={policyForm.effectiveFrom} onChange={(e) => setPolicyForm({ ...policyForm, effectiveFrom: e.target.value })} className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary" /></div>
                <div><label htmlFor="policy-change-reason" className="text-xs font-semibold text-on-surface block mb-1">Alasan perubahan</label><input id="policy-change-reason" type="text" required value={policyForm.changeReason} onChange={(e) => setPolicyForm({ ...policyForm, changeReason: e.target.value })} placeholder="Contoh: Perubahan jadwal semester" className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary" /></div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsPolicyModalOpen(false)}
                  className="h-10 px-4 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-muted"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-10 px-5 rounded-xl bg-primary text-on-primary text-xs font-semibold shadow-xs hover:bg-primary-container"
                >
                  Ajukan untuk Persetujuan Yayasan
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Modal Dialog: Drill-down Record Presensi */}
      {isDrilldownOpen && (
        <Modal
          isOpen
          onClose={() => setIsDrilldownOpen(false)}
          title="Rincian Presensi Hari Ini (Drill-down BR-ADM-01)"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          className="bg-card rounded-2xl w-full max-w-lg p-5 shadow-xl border border-border space-y-4"
        >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                Rincian Presensi Hari Ini (Drill-down BR-ADM-01)
              </h3>
              <button
                type="button"
                onClick={() => setIsDrilldownOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="p-8 text-center bg-surface-container-low rounded-xl border border-dashed border-border text-muted-foreground space-y-1">
              <span className="material-symbols-outlined text-[32px] text-muted-foreground">
                group_off
              </span>
              <p className="font-label-md text-on-surface text-xs font-semibold">
                Belum ada presensi santri yang tercatat hari ini
              </p>
              <p className="text-[11px] text-muted-foreground">
                Daftar absensi harian akan langsung diperbarui saat santri melakukan check-in.
              </p>
            </div>
        </Modal>
      )}

      {/* Modal Dialog: Ekspor Data Beraudit */}
      {isExportDialogOpen && (
        <Modal
          isOpen
          onClose={() => setIsExportDialogOpen(false)}
          title="Ekspor Rekap Beraudit"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          className="bg-card rounded-2xl w-full max-w-md p-5 shadow-xl border border-border space-y-4"
        >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                Ekspor Rekap Beraudit
              </h3>
              <button
                type="button"
                onClick={() => setIsExportDialogOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleExecuteExport} className="space-y-3.5">
              <div className="space-y-1">
                <label htmlFor="export-category" className="text-xs font-semibold text-on-surface block">
                  Kategori Rekap
                </label>
                <select
                  id="export-category"
                  value={exportCategory}
                  onChange={(e) => setExportCategory(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg bg-surface-container-low border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="presensi_laporan">Presensi &amp; Laporan Harian Terpadu</option>
                  <option value="tugas_proyek">Rekap Tugas &amp; Proyek Sentra</option>
                  <option value="audit_logs">Log Audit ISO/IEC 27001 Lengkap</option>
                </select>
              </div>

              <div className="space-y-1">
                <span id="export-format-label" className="text-xs font-semibold text-on-surface block">
                  Format Berkas
                </span>
                <div role="group" aria-labelledby="export-format-label" className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setExportFormat("csv")}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                      exportFormat === "csv"
                        ? "bg-primary text-on-primary border-primary"
                        : "bg-card text-on-surface border-border hover:bg-muted"
                    }`}
                  >
                    CSV (Spreadsheet)
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportFormat("pdf")}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                      exportFormat === "pdf"
                        ? "bg-primary text-on-primary border-primary"
                        : "bg-card text-on-surface border-border hover:bg-muted"
                    }`}
                  >
                    PDF (Dokumen Resmi)
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed bg-surface-container-low p-2.5 rounded-lg border border-border/40">
                Sesuai <strong>BR-ADM-08</strong>, setiap aksi ekspor data pribadi tercatat secara otomatis di dalam audit log sistem.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsExportDialogOpen(false)}
                  className="h-9 px-3 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-muted"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isExporting}
                  className="h-9 px-4 rounded-xl bg-primary text-on-primary text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {isExporting ? "Memproses..." : "Konfirmasi & Unduh"}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Modal Dialog: Alasan Persetujuan Kebijakan (Yayasan) */}
      {approveTargetId && (
        <Modal
          isOpen
          onClose={() => setApproveTargetId(null)}
          title="Setujui Usulan Kebijakan"
          labelledBy="approve-policy-title"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          className="bg-card rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5 shadow-xl border border-border space-y-4"
        >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 id="approve-policy-title" className="font-headline-sm text-base text-on-surface font-semibold">
                Setujui Usulan Kebijakan
              </h3>
              <button
                type="button"
                onClick={() => setApproveTargetId(null)}
                disabled={isApproving}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Alasan persetujuan tercatat permanen di jejak audit kebijakan. Tuliskan alasan yang spesifik, bukan kalimat umum.
            </p>
            <div>
              <label htmlFor="approve-policy-reason" className="text-xs font-semibold text-on-surface block mb-1">
                Alasan persetujuan
              </label>
              <textarea
                id="approve-policy-reason"
                value={approveReason}
                onChange={(e) => { setApproveReason(e.target.value); if (approveError) setApproveError(null); }}
                rows={3}
                placeholder="Contoh: Jadwal shift baru sesuai keputusan rapat yayasan 14 Nov 2026."
                className="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {approveError && (
              <div role="alert" className="rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error">
                {approveError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setApproveTargetId(null)}
                disabled={isApproving}
                className="h-10 px-4 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-muted disabled:opacity-40"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmApprove}
                disabled={isApproving || !approveReason.trim()}
                className="h-10 px-5 rounded-xl bg-primary text-on-primary text-xs font-semibold shadow-xs hover:bg-primary-container disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {isApproving && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                {isApproving ? "Memproses..." : "Konfirmasi Setujui"}
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}
