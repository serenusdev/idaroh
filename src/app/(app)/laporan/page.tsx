"use client";

import * as React from "react";
import { Illustration } from "@/components/ui/illustration";
import { DailyReport, ReportCategory, ReportItem, ReviewStatus } from "@/modules/reports/types";
import {
  saveReportDraftAction,
  submitReportAction,
  getMyReportHistoryAction,
} from "@/modules/reports/actions";
import { getReportBundleAction } from "@/modules/performance/actions";
import { useIdentity } from "@/components/auth/identity-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cacheKeys, invalidateReports, invalidateReviewQueue } from "@/lib/cache-keys";

function getJakartaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

const BLANK_REPORT: DailyReport = {
  id: "rep-draft",
  userId: "",
  authorName: "Santri",
  authorRole: "Santri",
  teamName: "Sentra Santri",
  reportDate: getJakartaDate(),
  reportDateFormatted: new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
  submissionStatus: "draft",
  isLate: false,
  reviewStatus: "not_reviewed",
  revisionNo: 1,
  items: [
    {
      id: "item-init",
      categoryId: "",
      categoryName: "Pilih kategori",
      title: "",
      description: "",
      resultProgress: "",
      obstacles: "",
      durationMinutes: 60,
      sortOrder: 1,
    },
  ],
};

export default function LaporanPage() {
  const { user } = useIdentity();
  // CACHE-01 Batch 2: every read is a Server Action behind a session+role key, so a second account
  // or a role switch on the same browser cannot be handed this santri's draft (D3).
  const queryClient = useQueryClient();
  const reportBundleQuery = useQuery({ queryKey: cacheKeys.reportsBundle(user), queryFn: getReportBundleAction });
  const reportCategories: ReportCategory[] = React.useMemo(() => reportBundleQuery.data?.categories ?? [], [reportBundleQuery.data?.categories]);
  const policy = reportBundleQuery.data?.policy ?? null;

  const [report, setReport] = React.useState<DailyReport>(reportBundleQuery.data?.today ?? BLANK_REPORT);
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isDrafting, setIsDrafting] = React.useState(false);
  const [historyVersion, setHistoryVersion] = React.useState(0);
  // Filter/sort state for history (UX-08)
  const [historyFilter, setHistoryFilter] = React.useState<"all" | "submitted" | "draft" | "late">("all");
  const [historySort, setHistorySort] = React.useState<"desc" | "asc">("desc");

  // The version bump stays the race guard it always was: a history read that started before the
  // write answers into the previous key. invalidateReports() marks today's draft and every cursor
  // of this session's history stale, which replaces the old prefix reset.
  const refreshHistory = () => {
    void invalidateReports(queryClient, user);
    setHistoryVersion((version) => version + 1);
  };

  React.useEffect(() => {
    if (reportBundleQuery.data?.today) setReport(reportBundleQuery.data.today);
  }, [reportBundleQuery.data?.today]);

  React.useEffect(() => {
    if (reportCategories.length) {
      setReport((current) => ({
        ...current,
        items: current.items.map((item) => {
          const category = reportCategories.find((candidate) => candidate.id === item.categoryId)
            || reportCategories.find((candidate) => candidate.slug === item.categoryId)
            || reportCategories[0];
          return {
            ...item,
            categoryId: category.id,
            categoryName: category.name,
          };
        }),
      }));
    }
  }, [reportCategories]);

  // Add new activity item
  const handleAddItem = () => {
    const newItem: ReportItem = {
      id: `item-${Date.now()}`,
      categoryId: reportCategories[0]?.id || "",
      categoryName: reportCategories[0]?.name || "Pilih kategori",
      title: "",
      description: "",
      resultProgress: "",
      obstacles: "",
      durationMinutes: 60,
      sortOrder: report.items.length + 1,
    };
    setReport((prev) => ({
      ...prev,
      items: [...prev.items, newItem],
    }));
  };

  // Remove activity item
  const handleRemoveItem = (id: string) => {
    if (report.items.length <= 1) {
      setFeedback({
        type: "error",
        message: "Laporan harian harus memiliki minimal 1 item aktivitas.",
      });
      return;
    }
    setReport((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }));
  };

  // Update specific item field
  const handleUpdateItem = (
    id: string,
    field: keyof ReportItem,
    value: string | number
  ) => {
    setReport((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id === id) {
          if (field === "categoryId") {
            const cat = reportCategories.find((c) => c.id === value);
            return {
              ...item,
              categoryId: String(value),
              categoryName: cat?.name || item.categoryName,
            };
          }
          return { ...item, [field]: value };
        }
        return item;
      }),
    }));
  };

  // Handle Save Draft
  const draftMutation = useMutation({
    mutationFn: () =>
      saveReportDraftAction({
        reportId: report.id,
        reportDate: report.reportDate,
        items: report.items,
      }),
    onMutate: () => {
      setIsDrafting(true);
      setFeedback(null);
    },
    onSuccess: (res) => {
      if (!res.success) {
        setFeedback({ type: "error", message: res.message });
        return;
      }
      setFeedback({ type: "info", message: res.message });
      refreshHistory();
    },
    onError: () =>
      setFeedback({
        type: "error",
        message: "Terjadi kesalahan saat menyimpan draft laporan.",
      }),
    onSettled: () => setIsDrafting(false),
  });

  const handleSaveDraft = () => {
    draftMutation.mutate();
  };

  // Handle Submit Report
  const submitMutation = useMutation({
    mutationFn: () =>
      submitReportAction({
        reportId: report.id,
        reportDate: report.reportDate,
        items: report.items,
      }),
    onMutate: () => {
      setIsSubmitting(true);
      setFeedback(null);
    },
    onSuccess: (res) => {
      if (!res.success) {
        setFeedback({ type: "error", message: res.message });
        return;
      }
      setReport((prev) => ({
        ...prev,
        submissionStatus: "submitted",
        isLate: res.isLate,
        submittedAtTime: res.submittedAtTime,
        reviewStatus: "not_reviewed",
      }));
      setFeedback({ type: "success", message: res.message });
      refreshHistory();
      // /review reads the queue this submission just entered.
      void invalidateReviewQueue(queryClient, user);
    },
    onError: () =>
      setFeedback({
        type: "error",
        message: "Terjadi gangguan koneksi saat mengirim laporan.",
      }),
    onSettled: () => setIsSubmitting(false),
  });

  const handleSubmitReport = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.mutate();
  };

  const totalMinutes = report.items.reduce(
    (acc, curr) => acc + (Number(curr.durationMinutes) || 0),
    0
  );
  const totalHours = (totalMinutes / 60).toFixed(1);

  // Keyboard shortcut: Ctrl/Cmd+Enter to submit the form
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (report.submissionStatus !== "submitted" && !isSubmitting) {
          const form = document.querySelector<HTMLFormElement>("form[data-laporan-form]");
          if (form) form.requestSubmit();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [report.submissionStatus, isSubmitting]);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-24">
      {/* Load Error — bedakan gagal muat vs formulir kosong (UX-08) */}
      {reportBundleQuery.error && (
        <div
          role="alert"
          className="p-4 rounded-xl flex items-center justify-between gap-3 text-sm font-medium bg-error/15 text-error border border-error/30"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">error</span>
            <span>Data laporan/kategori/kebijakan gagal dimuat. Formulir mungkin tidak lengkap.</span>
          </div>
          <button
            type="button"
            onClick={() => { void reportBundleQuery.refetch(); }}
            className="underline shrink-0"
          >
            Coba lagi
          </button>
        </div>
      )}
      {/* Toast Alert Feedback */}
      {feedback && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between gap-3 text-sm font-medium transition-all shadow-sm ${
            feedback.type === "success"
              ? "bg-success/15 text-success border border-success/30"
              : feedback.type === "error"
              ? "bg-error/15 text-error border border-error/30"
              : "bg-surface-container text-primary border border-border"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[20px] shrink-0">
              {feedback.type === "success"
                ? "check_circle"
                : feedback.type === "error"
                ? "error"
                : "info"}
            </span>
            <p className="truncate">{feedback.message}</p>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Main Responsive Grid Layout (Desktop 2-Column, Mobile Stack) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Context, Metadata, Deadline & Reviewer (Desktop Sticky) */}
        <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
          {/* Status & Context Card */}
          <div className="w-full bg-card rounded-xl p-4 sm:p-5 shadow-sm border border-border space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-primary tracking-wide uppercase">
                Form Harian Santri
              </span>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-container rounded-full">
                <span className="material-symbols-outlined text-primary text-[14px]">
                  calendar_today
                </span>
                <span className="font-label-sm text-label-sm text-primary">
                  {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            </div>

            <div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface">
                Laporan Aktivitas Harian
              </h2>
              <p className="font-body-sm text-body-sm text-muted-foreground mt-0.5">
                {report.reportDateFormatted} (Hari Ini)
              </p>
            </div>

            {/* Dual Status Badges (BR-REP-05) */}
            <div className="flex flex-wrap gap-2 pt-1">
              {report.submissionStatus === "draft" ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-warning/15 text-tertiary rounded-full font-label-sm text-label-sm">
                  <span
                    className="material-symbols-outlined text-[15px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    edit_note
                  </span>
                  <span>Draft (Belum Dikirim)</span>
                </div>
              ) : (
                <div
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-label-sm ${
                    report.isLate
                      ? "bg-error/15 text-error"
                      : "bg-success/15 text-success"
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {report.isLate ? "alarm" : "check_circle"}
                  </span>
                  <span>
                    {report.isLate
                      ? `Terlambat ${report.submittedAtTime ? `(${report.submittedAtTime})` : ""}`
                      : `Tepat Waktu ${report.submittedAtTime ? `(${report.submittedAtTime})` : ""}`}
                  </span>
                </div>
              )}

              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-label-sm ${
                  report.reviewStatus === "approved"
                    ? "bg-success/15 text-success"
                    : report.reviewStatus === "revision_required"
                    ? "bg-error/15 text-error"
                    : "bg-secondary-container text-on-secondary-container"
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">
                  {report.reviewStatus === "approved"
                    ? "verified"
                    : report.reviewStatus === "revision_required"
                    ? "rule"
                    : "hourglass_empty"}
                </span>
                <span>
                  {report.reviewStatus === "approved"
                    ? "Disetujui"
                    : report.reviewStatus === "revision_required"
                    ? "Perlu Revisi"
                    : "Belum Ditinjau"}
                </span>
              </div>
            </div>

            {report.submissionStatus === "submitted" && (
              <div className="bg-success/10 border border-success/30 rounded-xl p-3.5 flex items-center gap-3">
                <Illustration
                  src="/illustrations/undraw_mail-sent_dagx.svg"
                  alt="Laporan Terkirim"
                  width={64}
                  height={50}
                  className="shrink-0 max-h-[50px]"
                />
                <div className="min-w-0">
                  <p className="font-label-md text-success font-semibold text-xs sm:text-sm">
                    Laporan Berhasil Terkirim
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Laporan harian telah tersimpan dan masuk antrean tinjauan asatidz pembina.
                  </p>
                </div>
              </div>
            )}

            {/* Deadline & SLA Banner (BR-REP-03, BR-REP-04) */}
            <div className="bg-surface-container-low rounded-lg p-3.5 flex gap-2.5 items-start">
              <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">
                schedule
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-label-md text-label-md text-on-surface">
                  {policy
                    ? `Batas pengumpulan: ${policy.reportDeadlineTime} WIB`
                    : "Batas pengumpulan: Belum diatur Admin"}
                </p>
                <p className="font-body-sm text-body-sm text-muted-foreground text-xs leading-relaxed mt-0.5">
                  Laporan terlambat tetap dapat dikirim dan ditandai terlambat sesuai
                  regulasi kedisiplinan.
                </p>
              </div>
            </div>

            {/* Reviewer Info Meta */}
            <div className="flex items-center gap-3 pt-2 border-t border-border/60">
              <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-label-sm text-label-sm shrink-0">
                {report.reviewerName
                  ? report.reviewerName
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()
                  : "PB"}
              </div>
              <div className="min-w-0">
                <p className="font-body-sm text-body-sm text-muted-foreground text-xs leading-tight">
                  Peninjau Terjadwal
                </p>
                <p className="font-label-md text-label-md text-on-surface truncate">
                  {report.reviewerName || "Ustadz Pembina"}
                  {report.reviewerRole && (
                    <span className="text-muted-foreground font-body-sm text-xs ml-1">
                      ({report.reviewerRole})
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Productivity Metric Quick Counter */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="p-2.5 bg-surface-container-lowest rounded-lg border border-border/40 text-center">
                <p className="text-xs text-muted-foreground font-body-sm">
                  Jumlah Item
                </p>
                <p className="font-headline-sm text-primary font-bold">
                  {report.items.length}
                </p>
              </div>
              <div className="p-2.5 bg-surface-container-lowest rounded-lg border border-border/40 text-center">
                <p className="text-xs text-muted-foreground font-body-sm">
                  Estimasi Waktu
                </p>
                <p className="font-headline-sm text-primary font-bold">
                  {totalHours} Jam
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Multi-Item Activity Form Container (BR-REP-08 / OD-017) */}
        <div className="lg:col-span-8 space-y-4">
          <form onSubmit={handleSubmitReport} data-laporan-form className="space-y-4">
            {report.items.map((item, index) => {
              const isFilled =
                item.title.trim().length > 0 && item.description.trim().length > 0;

              return (
                <div
                  key={item.id}
                  className="w-full bg-card rounded-xl p-4 sm:p-5 shadow-sm border border-border space-y-4 relative overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-on-primary font-label-sm text-label-sm flex items-center justify-center">
                        {index + 1}
                      </span>
                      <span className="font-label-md text-label-md text-on-surface font-semibold">
                        {index === 0
                          ? "Aktivitas Utama"
                          : `Aktivitas Pendukung #${index + 1}`}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`font-label-sm text-label-sm px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                          isFilled
                            ? "bg-success/15 text-success"
                            : "bg-surface-container text-muted-foreground"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {isFilled ? "check_circle" : "pending"}
                        </span>
                        {isFilled ? "Lengkap" : "Draf"}
                      </span>

                      {report.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-error hover:bg-error/10 transition-colors"
                          title="Hapus aktivitas ini"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            delete
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Category Pills (Touch Scrollable) */}
                  <div className="space-y-1.5">
                    <span id={`category-label-${item.id}`} className="font-label-sm text-label-sm text-muted-foreground">
                      Kategori Aktivitas
                    </span>
                    <div role="group" aria-labelledby={`category-label-${item.id}`} className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
                      {reportCategories.map((cat) => {
                        const isSelected = item.categoryId === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() =>
                              handleUpdateItem(item.id, "categoryId", cat.id)
                            }
                            className={`shrink-0 px-3 py-1.5 rounded-full font-label-sm text-label-sm transition-all flex items-center gap-1.5 ${
                              isSelected
                                ? "bg-primary text-on-primary shadow-xs"
                                : "bg-surface-container text-on-surface hover:bg-accent"
                            }`}
                          >
                            {cat.icon && (
                              <span className="material-symbols-outlined text-[15px]">
                                {cat.icon}
                              </span>
                            )}
                            {cat.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Field: Judul Aktivitas */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`title-${item.id}`}
                      className="font-label-md text-label-md text-on-surface block"
                    >
                      Judul Aktivitas <span className="text-error" aria-hidden="true">*</span>
                    </label>
                    <input
                      id={`title-${item.id}`}
                      type="text"
                      value={item.title}
                      onChange={(e) =>
                        handleUpdateItem(item.id, "title", e.target.value)
                      }
                      onBlur={(e) => {
                        if (!e.target.value.trim()) {
                          e.target.setAttribute("aria-invalid", "true");
                        } else {
                          e.target.removeAttribute("aria-invalid");
                        }
                      }}
                      placeholder="Contoh: Mengikuti kajian kitab kuning atau implementasi modul"
                      className="w-full h-12 px-3.5 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all border border-transparent focus:border-primary aria-[invalid=true]:border-error aria-[invalid=true]:ring-error/30"
                      required
                      aria-required="true"
                      aria-describedby={`title-err-${item.id}`}
                    />
                    <p
                      id={`title-err-${item.id}`}
                      role="alert"
                      className="text-xs text-error hidden [input[aria-invalid]+&]:block"
                      aria-live="polite"
                    >
                      Judul aktivitas wajib diisi.
                    </p>
                  </div>

                  {/* Field: Deskripsi Kegiatan */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`desc-${item.id}`}
                      className="font-label-md text-label-md text-on-surface block"
                    >
                      Deskripsi Kegiatan <span className="text-error" aria-hidden="true">*</span>
                    </label>
                    <textarea
                      id={`desc-${item.id}`}
                      value={item.description}
                      onChange={(e) =>
                        handleUpdateItem(item.id, "description", e.target.value)
                      }
                      onBlur={(e) => {
                        if (!e.target.value.trim()) {
                          e.target.setAttribute("aria-invalid", "true");
                        } else {
                          e.target.removeAttribute("aria-invalid");
                        }
                      }}
                      rows={3}
                      placeholder="Jelaskan alur, materi, atau proses kegiatan yang Anda laksanakan..."
                      className="w-full p-3 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all border border-transparent focus:border-primary aria-[invalid=true]:border-error aria-[invalid=true]:ring-error/30"
                      required
                      aria-required="true"
                      aria-describedby={`desc-err-${item.id}`}
                    />
                    <p
                      id={`desc-err-${item.id}`}
                      role="alert"
                      className="text-xs text-error hidden [textarea[aria-invalid]+&]:block"
                      aria-live="polite"
                    >
                      Deskripsi kegiatan wajib diisi.
                    </p>
                  </div>

                  {/* Field: Hasil & Progres */}
                  <div className="space-y-1.5">
                    <label htmlFor={`result-${item.id}`} className="font-label-md text-label-md text-on-surface block">
                      Hasil & Progres (Output)
                    </label>
                    <textarea
                      id={`result-${item.id}`}
                      value={item.resultProgress || ""}
                      onChange={(e) =>
                        handleUpdateItem(item.id, "resultProgress", e.target.value)
                      }
                      rows={2}
                      placeholder="Uraikan output konkrit, capaian hafalan, atau perubahan status..."
                      className="w-full p-3 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all border border-transparent focus:border-primary"
                    />
                  </div>

                  {/* Field: Kendala / Hambatan & Durasi */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor={`obstacles-${item.id}`} className="font-label-md text-label-md text-on-surface block">
                        Kendala / Hambatan (Bila Ada)
                      </label>
                      <input
                        id={`obstacles-${item.id}`}
                        type="text"
                        value={item.obstacles || ""}
                        onChange={(e) =>
                          handleUpdateItem(item.id, "obstacles", e.target.value)
                        }
                        placeholder="Contoh: Gangguan jaringan internet atau storage penuh"
                        className="w-full h-11 px-3.5 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all border border-transparent"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor={`duration-${item.id}`} className="font-label-md text-label-md text-on-surface block">
                        Durasi (Menit)
                      </label>
                      <input
                        id={`duration-${item.id}`}
                        type="number"
                        min="15"
                        step="15"
                        value={item.durationMinutes}
                        onChange={(e) =>
                          handleUpdateItem(
                            item.id,
                            "durationMinutes",
                            Number(e.target.value) || 0
                          )
                        }
                        className="w-full h-11 px-3.5 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all border border-transparent"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add More Activity Button */}
            <button
              type="button"
              onClick={handleAddItem}
              className="w-full py-3.5 rounded-xl border-2 border-dashed border-primary/30 hover:border-primary bg-card/50 hover:bg-accent/20 text-primary font-label-md flex items-center justify-center gap-2 transition-all shadow-xs"
            >
              <span className="material-symbols-outlined text-[20px]">add_circle</span>
              <span>Tambah Item Aktivitas Lain</span>
            </button>

            {/* Sticky Action Footer */}
            <div className="bg-card rounded-xl p-4 shadow-md border border-border flex flex-col sm:flex-row items-center justify-between gap-3 sticky bottom-4 z-20">
              <div className="flex items-center gap-2 text-xs text-muted-foreground w-full sm:w-auto">
                <span className="material-symbols-outlined text-[16px] text-primary">
                  verified
                </span>
                <span>
                  Total {report.items.length} aktivitas dicatat • Estimasi {totalHours} jam
                </span>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={isDrafting || isSubmitting}
                  className="flex-1 sm:flex-initial h-11 px-4 rounded-xl bg-surface-container text-on-surface hover:bg-accent font-label-md text-label-md flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    save
                  </span>
                  <span>{isDrafting ? "Menyimpan..." : "Simpan Draft"}</span>
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 sm:flex-initial h-11 px-6 rounded-xl bg-primary text-on-primary hover:bg-primary-container font-label-md text-label-md flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50"
                  title="Kirim laporan (Ctrl+Enter)"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    send
                  </span>
                  <span>
                    {isSubmitting
                      ? "Mengirim..."
                      : `Kirim Laporan (${report.items.length})`}
                  </span>
                  <span className="hidden sm:inline text-[10px] opacity-60 ml-0.5">⌘↵</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <section aria-labelledby="report-history-heading" className="bg-card rounded-xl p-4 sm:p-5 border border-border space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 id="report-history-heading" className="font-headline-sm text-headline-sm text-on-surface">
              Riwayat Laporan Saya
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Laporan terbaru ditampilkan lebih dulu. Riwayat hanya dapat dibaca; pengisian tetap untuk hari ini.
            </p>
          </div>
          {/* Filter & Sort controls (UX-08) */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {(["all", "submitted", "draft", "late"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setHistoryFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                    historyFilter === f
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container text-on-surface hover:bg-accent"
                  }`}
                >
                  {f === "all" ? "Semua" : f === "submitted" ? "Terkirim" : f === "draft" ? "Draft" : "Terlambat"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setHistorySort((s) => s === "desc" ? "asc" : "desc")}
              aria-label={historySort === "desc" ? "Urutkan terlama dulu" : "Urutkan terbaru dulu"}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-container text-on-surface hover:bg-accent text-xs font-medium transition-all"
            >
              <span className="material-symbols-outlined text-[15px]">
                {historySort === "desc" ? "arrow_downward" : "arrow_upward"}
              </span>
              {historySort === "desc" ? "Terbaru" : "Terlama"}
            </button>
          </div>
        </div>
        <ReportHistoryPage
          key={`${user.id}:${historyVersion}:${historyFilter}:${historySort}`}
          historyVersion={historyVersion}
          statusFilter={historyFilter}
          sortOrder={historySort}
        />
      </section>
    </div>
  );
}

const HISTORY_REVIEW_LABELS: Record<ReviewStatus, string> = {
  not_reviewed: "Belum Ditinjau",
  under_review: "Sedang Ditinjau",
  revision_required: "Perlu Revisi",
  approved: "Disetujui",
};

function historyDate(value: string, withTime = false) {
  return new Date(value).toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } as const : {}),
  }) + (withTime ? " WIB" : "");
}

function ReportHistoryPage({
  historyVersion,
  before = null,
  statusFilter = "all",
  sortOrder = "desc",
}: {
  historyVersion: number;
  before?: string | null;
  statusFilter?: "all" | "submitted" | "draft" | "late";
  sortOrder?: "desc" | "asc";
}) {
  const { user } = useIdentity();
  // CACHE-01 Batch 2: the version lives inside the key, so an older-page read that started before
  // a submit answers the previous key instead of overwriting the list the parent just remounted.
  const query = useQuery({
    queryKey: cacheKeys.reportsHistory(user, historyVersion, before),
    queryFn: () => getMyReportHistoryAction({ before, limit: 20 }),
  });
  const [showOlder, setShowOlder] = React.useState(false);

  const filteredReports = React.useMemo(() => {
    const reports = query.data?.reports ?? [];
    const filtered = reports.filter((entry) => {
      if (statusFilter === "submitted") return entry.submissionStatus === "submitted";
      if (statusFilter === "draft") return entry.submissionStatus === "draft";
      if (statusFilter === "late") return entry.isLate;
      return true;
    });
    return sortOrder === "asc" ? [...filtered].reverse() : filtered;
  }, [query.data, statusFilter, sortOrder]);

  return (
    <div className="space-y-3">
      {query.isLoading && <p role="status" className="text-sm text-muted-foreground">Memuat riwayat laporan...</p>}
      {query.error && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          <p>Riwayat laporan gagal dimuat. Silakan coba lagi.</p>
          <button type="button" onClick={() => void query.refetch()} disabled={query.isLoading}
            className="mt-2 px-3 py-2 rounded-lg border border-current font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
            Coba lagi memuat riwayat
          </button>
        </div>
      )}
      {!query.isLoading && !query.error && query.data?.reports.length === 0 && (
        <div className="p-8 text-center bg-surface-container-low rounded-xl border border-dashed border-border space-y-2">
          <span className="material-symbols-outlined text-[32px] text-muted-foreground">description</span>
          <p className="font-label-md text-on-surface text-[13px]">
            {before ? "Tidak ada laporan lebih lama." : "Belum ada riwayat laporan."}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {before ? "" : "Laporan yang dikirim akan muncul di sini. Buat dan kirim laporan harian pertama Anda."}
          </p>
        </div>
      )}
      {filteredReports.length === 0 && (query.data?.reports.length ?? 0) > 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Tidak ada laporan yang cocok dengan filter ini.
        </p>
      )}
      {filteredReports.length > 0 && (
        <ul className="space-y-3">
          {filteredReports.map((entry) => (
            <li key={entry.id}>
              <details className="rounded-lg border border-border">
                <summary className="cursor-pointer p-4 text-sm text-on-surface rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <time dateTime={entry.reportDate} className="font-semibold">{historyDate(entry.reportDate)}</time>
                  <span className="inline-flex flex-wrap gap-2 mx-2 align-middle">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      entry.submissionStatus === "draft"
                        ? "bg-warning/15 text-tertiary"
                        : entry.isLate
                        ? "bg-error/15 text-error"
                        : "bg-success/15 text-success"
                    }`}>
                      <span className="material-symbols-outlined text-[13px]">
                        {entry.submissionStatus === "draft" ? "edit_note" : entry.isLate ? "alarm" : "check_circle"}
                      </span>
                      {entry.submissionStatus === "draft" ? "Draft" : entry.isLate ? "Terlambat" : "Tepat Waktu"}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      entry.reviewStatus === "approved"
                        ? "bg-success/15 text-success"
                        : entry.reviewStatus === "revision_required"
                        ? "bg-error/15 text-error"
                        : entry.reviewStatus === "under_review"
                        ? "bg-primary/10 text-primary"
                        : "bg-secondary-container text-on-secondary-container"
                    }`}>
                      <span className="material-symbols-outlined text-[13px]">
                        {entry.reviewStatus === "approved" ? "verified" : entry.reviewStatus === "revision_required" ? "rule" : entry.reviewStatus === "under_review" ? "rate_review" : "hourglass_empty"}
                      </span>
                      {HISTORY_REVIEW_LABELS[entry.reviewStatus]}
                    </span>
                  </span>
                  <span className="text-muted-foreground">Detail laporan</span>
                </summary>
                <div className="border-t border-border p-4 space-y-4 text-sm break-words">
                  {entry.firstSubmittedAt && (
                    <p className="text-muted-foreground">
                      Dikirim pertama: <time dateTime={entry.firstSubmittedAt}>{historyDate(entry.firstSubmittedAt, true)}</time>
                      {entry.submissionStatus === "submitted" && (entry.isLate ? " · Terlambat" : " · Tepat Waktu")}
                    </p>
                  )}
                  {entry.items.length === 0 ? <p>Belum ada aktivitas tersimpan.</p> : (
                    <ol className="space-y-4">
                      {entry.items.map((item, index) => (
                        <li key={item.id} className="space-y-1">
                          <h3 className="font-semibold">{index + 1}. {item.title || "Aktivitas tanpa judul"}</h3>
                          <p className="text-muted-foreground">{item.categoryName} · {item.durationMinutes} menit</p>
                          <p className="whitespace-pre-wrap">{item.description || "Belum ada deskripsi."}</p>
                          <p className="whitespace-pre-wrap"><span className="font-medium">Hasil &amp; Progres: </span>{item.resultProgress || "—"}</p>
                          <p className="whitespace-pre-wrap"><span className="font-medium">Kendala: </span>{item.obstacles || "—"}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                  {entry.latestReview && (
                    <div className="rounded-lg bg-surface-container p-3 space-y-1">
                      <h3 className="font-semibold">Catatan tinjauan terakhir</h3>
                      <p className="text-muted-foreground">
                        {HISTORY_REVIEW_LABELS[entry.latestReview.decision]} · <time dateTime={entry.latestReview.decidedAt}>{historyDate(entry.latestReview.decidedAt, true)}</time>
                      </p>
                      <p className="whitespace-pre-wrap">{entry.latestReview.notes || "Tidak ada catatan."}</p>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {query.data?.nextCursor && (showOlder ? (
        <ReportHistoryPage key={query.data.nextCursor} historyVersion={historyVersion} before={query.data.nextCursor} statusFilter={statusFilter} sortOrder={sortOrder} />
      ) : (
        <button type="button" onClick={() => setShowOlder(true)}
          className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2"
          aria-label="Muat laporan lebih lama">
          Muat laporan lebih lama
        </button>
      ))}
    </div>
  );
}
