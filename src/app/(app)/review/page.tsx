"use client";

import * as React from "react";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { Illustration } from "@/components/ui/illustration";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { invalidateCache, writeCache } from "@/lib/data-cache";
import { DailyReport, ReviewStatus } from "@/modules/reports/types";
import { reviewReportAction, getReviewQueueAction } from "@/modules/reports/actions";

type QueueTab = "pending" | "revision" | "resubmitted" | "approved" | "unassigned";

export default function ReviewPage() {
  const { user: currentUser } = useIdentity();
  const [activeTab, setActiveTab] = React.useState<QueueTab>("pending");
  const [searchQuery, setSearchQuery] = React.useState("");
  const queueQuery = useCachedData(`review:queue:${currentUser.id}`, getReviewQueueAction);
  const [reports, setReports] = React.useState<DailyReport[]>(queueQuery.data ?? []);
  const [selectedReportId, setSelectedReportId] = React.useState<string>(queueQuery.data?.[0]?.id ?? "");

  React.useEffect(() => {
    if (queueQuery.data) {
      const list = queueQuery.data;
      setReports(list);
      setSelectedReportId((current) => current || list[0]?.id || "");
    }
  }, [queueQuery.data]);
  React.useEffect(() => {
    writeCache(`review:queue:${currentUser.id}`, reports);
  }, [reports, currentUser.id]);

  // Compute live counts from reports
  const filterCounts = React.useMemo(() => {
    return {
      pending: reports.filter((r) => r.reviewStatus === "not_reviewed").length,
      revision: reports.filter((r) => r.reviewStatus === "revision_required").length,
      resubmitted: reports.filter((r) => (r.revisionNo || 1) > 1 && r.reviewStatus === "not_reviewed").length,
      approved: reports.filter((r) => r.reviewStatus === "approved").length,
      unassigned: reports.filter((r) => r.submissionStatus === "submitted" && r.reviewStatus !== "approved" && !r.reviewerId).length,
    };
  }, [reports]);

  const [feedbackNotes, setFeedbackNotes] = React.useState("");
  const [isSubmittingReview, setIsSubmittingReview] = React.useState(false);
  const [alertNotice, setAlertNotice] = React.useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Filter reports according to tab & search
  const filteredReports = React.useMemo(() => {
    return reports.filter((rep) => {
      // Tab matching
      if (activeTab === "pending" && rep.reviewStatus !== "not_reviewed") return false;
      if (activeTab === "revision" && rep.reviewStatus !== "revision_required") return false;
      if (activeTab === "resubmitted" && (rep.revisionNo <= 1 || rep.reviewStatus !== "not_reviewed"))
        return false;
      if (activeTab === "approved" && rep.reviewStatus !== "approved") return false;
      if (
        activeTab === "unassigned" &&
        (rep.submissionStatus !== "submitted" || rep.reviewStatus === "approved" || rep.reviewerId)
      ) return false;

      // Search matching
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = rep.authorName.toLowerCase().includes(q);
        const matchTeam = rep.teamName.toLowerCase().includes(q);
        const matchItem = rep.items.some(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q)
        );
        if (!matchName && !matchTeam && !matchItem) return false;
      }
      return true;
    });
  }, [reports, activeTab, searchQuery]);

  const selectedReport =
    reports.find((r) => r.id === selectedReportId) || filteredReports[0] || reports[0];

  const canReview =
    currentUser?.role === "super_admin" ||
    currentUser?.role === "yayasan" ||
    currentUser?.role === "pengurus" ||
    currentUser?.role === "koordinator";

  if (!canReview) {
    return <UnauthorizedState requiredRole="Koordinator / Ustadz Pembina / Pengurus" />;
  }

  const handleReviewDecision = async (decision: "approved" | "revision_required") => {
    if (!selectedReport) return;
    setIsSubmittingReview(true);
    setAlertNotice(null);

    try {
      const res = await reviewReportAction({
        reportId: selectedReport.id,
        decision,
        notes: feedbackNotes,
        reviewerName: "Ustadz Ahmad Fauzi",
      });

      if (res.success) {
        setAlertNotice({ type: "success", message: res.message });
        setReports((prev) =>
          prev.map((r) => {
            if (r.id === selectedReport.id) {
              const updatedStatus: ReviewStatus =
                decision === "approved" ? "approved" : "revision_required";
              return {
                ...r,
                reviewStatus: updatedStatus,
                reviewedAt: new Date().toISOString(),
                reviews: [
                  ...(r.reviews || []),
                  {
                    id: `rev-${Date.now()}`,
                    reportId: r.id,
                    revisionNo: r.revisionNo,
                    reviewerId: "usr-fauzi",
                    reviewerName: "Ustadz Ahmad Fauzi",
                    decision,
                    notes: feedbackNotes || (decision === "approved" ? "Disetujui tanpa catatan khusus." : ""),
                    decidedAt: new Date().toISOString(),
                  },
                ],
              };
            }
            return r;
          })
        );
        setFeedbackNotes("");
        invalidateCache("admin:dashboard-stats");
      } else {
        setAlertNotice({ type: "error", message: res.message });
      }
    } catch {
      setAlertNotice({
        type: "error",
        message: "Terjadi kesalahan saat memproses review laporan.",
      });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-24">
      {/* Operational Context Header */}
      <section className="flex flex-col space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-headline-sm text-headline-sm text-on-surface tracking-tight">
              Antrean Review Laporan
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
              <span className="material-symbols-outlined text-[16px] text-primary">
                verified_user
              </span>
              <p className="font-body-sm text-body-sm text-muted-foreground">
                Peninjau: Ustadz Ahmad Fauzi • Tim Media &amp; IT
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent text-accent-foreground font-label-sm text-label-sm shadow-xs self-start sm:self-auto">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            Batch #42
          </span>
        </div>

        {/* Operational Philosophy Banner (BR-REP-06) */}
        <div className="bg-surface-container-low p-3.5 sm:p-4 rounded-xl flex items-start gap-3 shadow-xs border border-border/40">
          <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center shrink-0 text-primary mt-0.5">
            <span className="material-symbols-outlined text-[20px]">spa</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-label-sm text-label-sm text-on-surface font-semibold">
              Tarbiyah Nyaman &amp; Bermakna
            </p>
            <p className="font-body-sm text-body-sm text-muted-foreground leading-relaxed mt-0.5 text-xs sm:text-sm">
              Review santun mengikuti kesiapan asatidz—tidak dipaksakan deadline
              buru-buru (BR-REP-06). Berikan masukan yang membangun untuk progres
              santri. Barakallahu fiikum.
            </p>
          </div>
        </div>
      </section>

      {/* Alert Notification */}
      {alertNotice && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between gap-3 text-sm font-medium shadow-xs ${
            alertNotice.type === "success"
              ? "bg-success/15 text-success border border-success/30"
              : alertNotice.type === "error"
              ? "bg-error/15 text-error border border-error/30"
              : "bg-surface-container text-primary border border-border"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">
              {alertNotice.type === "success" ? "check_circle" : "error"}
            </span>
            <span>{alertNotice.message}</span>
          </div>
          <button
            onClick={() => setAlertNotice(null)}
            className="text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Filter Pills (Touch Scrollable) */}
        <section
          aria-label="Status Antrean"
          className="overflow-x-auto -mx-2 px-2 py-1 flex items-center gap-2 no-scrollbar"
        >
          <button
            type="button"
            onClick={() => setActiveTab("pending")}
            className={`h-10 px-3.5 rounded-full font-label-sm text-label-sm flex items-center gap-1.5 shrink-0 transition-all ${
              activeTab === "pending"
                ? "bg-primary text-on-primary shadow-xs"
                : "bg-card text-on-surface hover:bg-muted border border-border"
            }`}
          >
            <span>Menunggu</span>
            <span
              className={`px-1.5 py-0.5 rounded-full font-bold text-[11px] leading-none ${
                activeTab === "pending"
                  ? "bg-surface-container-lowest text-primary"
                  : "bg-surface-container text-primary"
              }`}
            >
              {filterCounts.pending}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("revision")}
            className={`h-10 px-3.5 rounded-full font-label-sm text-label-sm flex items-center gap-1.5 shrink-0 transition-all ${
              activeTab === "revision"
                ? "bg-primary text-on-primary shadow-xs"
                : "bg-card text-on-surface hover:bg-muted border border-border"
            }`}
          >
            <span>Perlu Revisi</span>
            <span className="px-1.5 py-0.5 rounded-full bg-warning/20 text-tertiary font-semibold text-[11px] leading-none">
              {filterCounts.revision}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("resubmitted")}
            className={`h-10 px-3.5 rounded-full font-label-sm text-label-sm flex items-center gap-1.5 shrink-0 transition-all ${
              activeTab === "resubmitted"
                ? "bg-primary text-on-primary shadow-xs"
                : "bg-card text-on-surface hover:bg-muted border border-border"
            }`}
          >
            <span>Dikirim Ulang</span>
            <span className="px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground font-semibold text-[11px] leading-none">
              {filterCounts.resubmitted}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("approved")}
            className={`h-10 px-3.5 rounded-full font-label-sm text-label-sm flex items-center gap-1.5 shrink-0 transition-all ${
              activeTab === "approved"
                ? "bg-primary text-on-primary shadow-xs"
                : "bg-card text-on-surface hover:bg-muted border border-border"
            }`}
          >
            <span>Disetujui</span>
            <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium text-[11px] leading-none">
              {filterCounts.approved}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("unassigned")}
            className={`h-10 px-3.5 rounded-full font-label-sm text-label-sm flex items-center gap-1.5 shrink-0 transition-all opacity-80 ${
              activeTab === "unassigned"
                ? "bg-primary text-on-primary shadow-xs"
                : "bg-card text-muted-foreground hover:bg-muted border border-border"
            }`}
          >
            <span>Belum Ditugaskan</span>
            <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium text-[11px] leading-none">
              {filterCounts.unassigned}
            </span>
          </button>
        </section>

        {/* Search Bar */}
        <div className="relative min-w-[220px]">
          <span className="material-symbols-outlined absolute left-3 top-2.5 text-muted-foreground text-[18px]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari santri atau aktivitas..."
            className="w-full h-10 pl-9 pr-3 rounded-full bg-card border border-border text-xs sm:text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs"
          />
        </div>
      </div>

      {/* Main Dual-Column Master-Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Queue List (col-span-5) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span className="font-medium">
              Menampilkan {filteredReports.length} laporan
            </span>
            <span>Urutkan: Terbaru</span>
          </div>

          {filteredReports.length === 0 ? (
            <div className="bg-card rounded-2xl p-8 sm:p-10 text-center border border-dashed border-border shadow-xs flex flex-col items-center justify-center space-y-3">
              <Illustration
                src={
                  activeTab === "approved"
                    ? "/illustrations/undraw_organizing-work_gmo9.svg"
                    : activeTab === "revision"
                    ? "/illustrations/undraw_reviews_bmgj.svg"
                    : "/illustrations/undraw_document-review_lfir.svg"
                }
                alt={
                  activeTab === "approved"
                    ? "Semua laporan telah disetujui"
                    : activeTab === "revision"
                    ? "Tidak ada laporan yang perlu direvisi"
                    : "Tidak ada antrean laporan"
                }
                width={
                  activeTab === "approved" ? 120 : activeTab === "revision" ? 130 : 130
                }
                height={
                  activeTab === "approved" ? 105 : activeTab === "revision" ? 90 : 90
                }
              />
              <div>
                <p className="font-headline-sm text-base font-semibold text-on-surface">
                  {activeTab === "approved"
                    ? "Antrean Persetujuan Bersih"
                    : activeTab === "revision"
                    ? "Tidak Ada Laporan Perlu Revisi"
                    : "Tidak Ada Antrean Laporan"}
                </p>
                <p className="text-xs text-muted-foreground max-w-xs mx-auto mt-1">
                  {activeTab === "approved"
                    ? "Semua laporan yang disetujui akan tersimpan di sini."
                    : activeTab === "revision"
                    ? "Laporan yang memerlukan perbaikan akan muncul di tab ini."
                    : "Semua laporan pada tab ini telah ditinjau atau tidak cocok dengan filter pencarian."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredReports.map((item) => {
                const isSelected = item.id === selectedReport?.id;
                return (
                  <article
                    key={item.id}
                    onClick={() => setSelectedReportId(item.id)}
                    className={`bg-card rounded-xl shadow-xs p-4 flex flex-col space-y-3 relative overflow-hidden cursor-pointer transition-all border ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/20 shadow-md"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-0 left-0 right-0 h-1 bg-primary"></div>
                    )}

                    {/* Top Meta */}
                    <div className="flex items-start justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-surface-container-high text-primary flex items-center justify-center font-headline-sm text-label-md font-bold shrink-0 shadow-2xs">
                          {item.authorAvatar || item.authorName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <h2 className="font-headline-sm text-[15px] text-on-surface tracking-tight truncate leading-tight font-semibold">
                            {item.authorName}
                          </h2>
                          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                            <span className="truncate">{item.reportDateFormatted}</span>
                            <span className="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
                            <span className="text-primary font-medium">
                              {item.items.length} Aktivitas
                            </span>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-xs shrink-0 ${
                          item.isLate
                            ? "bg-error/15 text-error"
                            : "bg-accent text-accent-foreground"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {item.isLate ? "alarm" : "check_circle"}
                        </span>
                        {item.isLate ? "Terlambat" : "Tepat Waktu"}{" "}
                        {item.submittedAtTime ? `(${item.submittedAtTime})` : ""}
                      </span>
                    </div>

                    {/* Activities Brief */}
                    <div className="bg-surface-container-lowest rounded-lg p-2.5 space-y-1.5 border border-border/40">
                      {item.items.slice(0, 2).map((act, i) => (
                        <div key={act.id} className="flex items-start gap-2">
                          <span className="w-4 h-4 rounded-full bg-surface-container text-primary font-label-sm text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <p className="font-body-sm text-xs text-on-surface line-clamp-1">
                            {act.title}
                          </p>
                        </div>
                      ))}
                      {item.items.length > 2 && (
                        <p className="text-[11px] text-muted-foreground pl-6">
                          +{item.items.length - 2} aktivitas lainnya...
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Detailed Inspection View (col-span-7, Desktop Sticky) */}
        <div className="lg:col-span-7 space-y-4 lg:sticky lg:top-20">
          {selectedReport ? (
            <div className="bg-card rounded-2xl p-5 sm:p-6 shadow-sm border border-border space-y-5">
              {/* Report Header Profile */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary flex items-center justify-center text-lg font-bold">
                    {selectedReport.authorAvatar || "SA"}
                  </div>
                  <div>
                    <h2 className="font-headline-sm text-headline-sm text-on-surface">
                      {selectedReport.authorName}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {selectedReport.authorRole} • {selectedReport.teamName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-xs ${
                      selectedReport.isLate
                        ? "bg-error/15 text-error"
                        : "bg-success/15 text-success"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px]">
                      {selectedReport.isLate ? "alarm" : "check_circle"}
                    </span>
                    <span>
                      {selectedReport.isLate ? "Terlambat" : "Tepat Waktu"}
                      {selectedReport.submittedAtTime
                        ? ` (${selectedReport.submittedAtTime})`
                        : ""}
                    </span>
                  </span>

                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-xs ${
                      selectedReport.reviewStatus === "approved"
                        ? "bg-success/15 text-success"
                        : selectedReport.reviewStatus === "revision_required"
                        ? "bg-warning/20 text-tertiary"
                        : "bg-secondary-container text-on-secondary-container"
                    }`}
                  >
                    {selectedReport.reviewStatus === "approved"
                      ? "Disetujui"
                      : selectedReport.reviewStatus === "revision_required"
                      ? "Perlu Revisi"
                      : "Menunggu Review"}
                  </span>
                  {/* Show reviewed_at timestamp when available */}
                  {selectedReport.reviewedAt && (
                    selectedReport.reviewStatus === "approved" ||
                    selectedReport.reviewStatus === "revision_required"
                  ) && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {selectedReport.reviewStatus === "approved" ? "Disetujui: " : "Perlu Revisi: "}
                      {new Date(selectedReport.reviewedAt).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })} WIB
                    </span>
                  )}
                </div>
              </div>

              {/* Items Details List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm uppercase tracking-wider text-primary text-xs font-semibold">
                    Rincian Aktivitas Harian ({selectedReport.items.length})
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Tanggal: {selectedReport.reportDateFormatted}
                  </span>
                </div>

                {selectedReport.items.map((act, idx) => (
                  <div
                    key={act.id}
                    className="p-4 rounded-xl bg-surface-container-low border border-border/50 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-[11px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <h3 className="font-label-md text-on-surface font-semibold text-sm">
                          {act.title}
                        </h3>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-card text-on-surface-variant text-[11px] font-medium border border-border/60">
                        {act.categoryName || "Aktivitas"}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-on-surface">
                      <p className="leading-relaxed text-muted-foreground">
                        <strong className="text-on-surface">Deskripsi:</strong>{" "}
                        {act.description}
                      </p>
                      {act.resultProgress && (
                        <p className="leading-relaxed">
                          <strong className="text-success font-semibold">
                            Output & Progres:
                          </strong>{" "}
                          {act.resultProgress}
                        </p>
                      )}
                      {act.obstacles && (
                        <p className="leading-relaxed text-tertiary">
                          <strong>Kendala:</strong> {act.obstacles}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground border-t border-border/40">
                      <span>Estimasi durasi: {act.durationMinutes} menit</span>
                      <span>Urutan #{act.sortOrder}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Previous Reviews History */}
              {selectedReport.reviews && selectedReport.reviews.length > 0 && (
                <div className="p-3.5 rounded-xl bg-surface-container space-y-2 border border-border">
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <span className="material-symbols-outlined text-[16px]">
                      history_edu
                    </span>
                    <span>Riwayat Evaluasi Reviewer</span>
                  </div>
                  {selectedReport.reviews.map((rev) => (
                    <div
                      key={rev.id}
                      className="text-xs bg-card p-2.5 rounded-lg border border-border/60 space-y-1"
                    >
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="font-semibold text-on-surface">
                          {rev.reviewerName}
                        </span>
                        <span>{rev.decision === "approved" ? "Disetujui" : "Perlu Revisi"}</span>
                      </div>
                      <p className="text-on-surface">{rev.notes}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Action Review Form */}
              <div className="pt-3 border-t border-border space-y-3">
                {selectedReport.reviewStatus === "approved" ? (
                  <div className="flex items-center gap-2 p-3.5 rounded-xl bg-success/10 border border-success/30 text-success text-sm font-medium">
                    <span className="material-symbols-outlined text-[20px]">verified</span>
                    <span>Laporan ini telah disetujui dan tidak dapat diubah kembali.</span>
                  </div>
                ) : (
                  <>
                    <label className="font-label-md text-label-md text-on-surface block text-xs">
                      Catatan Evaluasi / Rekomendasi Asatidz
                    </label>
                    <textarea
                      value={feedbackNotes}
                      onChange={(e) => setFeedbackNotes(e.target.value)}
                      rows={2}
                      placeholder="Tuliskan masukan santun, apresiasi capaian, atau poin revisi yang diperlukan..."
                      className="w-full p-3 rounded-xl bg-surface-container-low text-on-surface text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary border border-border focus:bg-card transition-all"
                    />

                    {/* Quick Feedback Chips */}
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        "Mumtaz! Dokumentasi sangat rapi.",
                        "Mohon detailkan output konkrit.",
                        "Perjelas kendala teknis yang dihadapi.",
                        "Barakallahu fiik, lanjutkan target pekanan.",
                      ].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setFeedbackNotes(chip)}
                          className="px-2.5 py-1 rounded-full bg-surface-container hover:bg-accent text-[11px] text-on-surface transition-colors"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>

                    {/* Action Buttons — only rendered when report is not yet approved */}
                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        disabled={isSubmittingReview}
                        onClick={() => handleReviewDecision("revision_required")}
                        className="h-10 px-4 rounded-xl bg-card border border-error/40 text-error hover:bg-error/10 font-label-md text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          edit_document
                        </span>
                        <span>Minta Revisi</span>
                      </button>

                      <button
                        type="button"
                        disabled={isSubmittingReview}
                        onClick={() => handleReviewDecision("approved")}
                        className="h-10 px-5 rounded-xl bg-primary text-on-primary hover:bg-primary-container font-label-md text-xs flex items-center gap-1.5 shadow-xs transition-all disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          verified
                        </span>
                        <span>Setujui Laporan</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-2xl p-12 text-center border border-border shadow-xs">
              <span className="material-symbols-outlined text-[48px] text-muted-foreground">
                touch_app
              </span>
              <p className="font-headline-sm text-on-surface mt-2">
                Pilih laporan dari daftar
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Klik salah satu kartu santri di sebelah kiri untuk melihat rincian aktivitas dan melakukan review.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
