"use client";

import * as React from "react";
import { Illustration } from "@/components/ui/illustration";
import { DailyReport, ReportCategory, ReportItem } from "@/modules/reports/types";
import {
  saveReportDraftAction,
  submitReportAction,
  getTodayReportAction,
  getReportCategoriesAction,
} from "@/modules/reports/actions";
import { getActivePolicyAction } from "@/modules/analytics/actions";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { invalidateCache } from "@/lib/data-cache";

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
  const todayQuery = useCachedData(`reports:today:${user.id}`, getTodayReportAction);
  const categoriesQuery = useCachedData("reports:categories", getReportCategoriesAction);
  const policyQuery = useCachedData("policy:active", getActivePolicyAction);
  const reportCategories: ReportCategory[] = React.useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const policy = policyQuery.data ?? null;

  const [report, setReport] = React.useState<DailyReport>(todayQuery.data ?? BLANK_REPORT);
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isDrafting, setIsDrafting] = React.useState(false);

  React.useEffect(() => {
    if (todayQuery.data) setReport(todayQuery.data);
  }, [todayQuery.data]);

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
  const handleSaveDraft = async () => {
    setIsDrafting(true);
    setFeedback(null);
    try {
      const res = await saveReportDraftAction({
        reportId: report.id,
        reportDate: report.reportDate,
        items: report.items,
      });
      if (res.success) {
        setFeedback({ type: "info", message: res.message });
        todayQuery.refresh();
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Terjadi kesalahan saat menyimpan draft laporan.",
      });
    } finally {
      setIsDrafting(false);
    }
  };

  // Handle Submit Report
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const res = await submitReportAction({
        reportId: report.id,
        reportDate: report.reportDate,
        items: report.items,
      });

      if (res.success) {
        setReport((prev) => ({
          ...prev,
          submissionStatus: "submitted",
          isLate: res.isLate,
          submittedAtTime: res.submittedAtTime,
          reviewStatus: "not_reviewed",
        }));
        setFeedback({ type: "success", message: res.message });
        todayQuery.refresh();
        invalidateCache("review:queue");
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Terjadi gangguan koneksi saat mengirim laporan.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalMinutes = report.items.reduce(
    (acc, curr) => acc + (Number(curr.durationMinutes) || 0),
    0
  );
  const totalHours = (totalMinutes / 60).toFixed(1);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-24">
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
          <form onSubmit={handleSubmitReport} className="space-y-4">
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
                    <label className="font-label-sm text-label-sm text-muted-foreground">
                      Kategori Aktivitas
                    </label>
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
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
                    <label className="font-label-md text-label-md text-on-surface block">
                      Judul Aktivitas <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) =>
                        handleUpdateItem(item.id, "title", e.target.value)
                      }
                      placeholder="Contoh: Mengikuti kajian kitab kuning atau implementasi modul"
                      className="w-full h-12 px-3.5 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all border border-transparent focus:border-primary"
                      required
                    />
                  </div>

                  {/* Field: Deskripsi Kegiatan */}
                  <div className="space-y-1.5">
                    <label className="font-label-md text-label-md text-on-surface block">
                      Deskripsi Kegiatan <span className="text-error">*</span>
                    </label>
                    <textarea
                      value={item.description}
                      onChange={(e) =>
                        handleUpdateItem(item.id, "description", e.target.value)
                      }
                      rows={3}
                      placeholder="Jelaskan alur, materi, atau proses kegiatan yang Anda laksanakan..."
                      className="w-full p-3 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all border border-transparent focus:border-primary"
                      required
                    />
                  </div>

                  {/* Field: Hasil & Progres */}
                  <div className="space-y-1.5">
                    <label className="font-label-md text-label-md text-on-surface block">
                      Hasil & Progres (Output)
                    </label>
                    <textarea
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
                      <label className="font-label-md text-label-md text-on-surface block">
                        Kendala / Hambatan (Bila Ada)
                      </label>
                      <input
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
                      <label className="font-label-md text-label-md text-on-surface block">
                        Durasi (Menit)
                      </label>
                      <input
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
                >
                  <span className="material-symbols-outlined text-[18px]">
                    send
                  </span>
                  <span>
                    {isSubmitting
                      ? "Mengirim..."
                      : `Kirim Laporan (${report.items.length})`}
                  </span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
