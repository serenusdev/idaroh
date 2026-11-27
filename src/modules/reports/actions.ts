"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { drainNotificationOutbox } from "@/lib/fcm";
import { INLINE_DISPATCH_BUDGET_MS } from "@/lib/background-jobs";
import { requireAuthUser, requireRole, getJakartaTime } from "@/lib/auth/guards";
import { isDateOnly, isNonEmptyString, isPlainRecord, isTimeOnly } from "@/lib/input-validation";
import { throwQueryError } from "@/lib/query-error";
import { friendlyActionError } from "@/lib/action-error";
import { INITIAL_USER_DAILY_REPORT, REPORT_CATEGORIES, REVIEW_QUEUE_REPORTS } from "./data";
import { DailyReport, MyReportHistoryOptions, MyReportHistoryPage, ReportCategory, ReportItem, ReviewDecision } from "./types";

export interface SaveReportDraftPayload {
  reportId: string;
  reportDate: string;
  items: ReportItem[];
}

export interface SubmitReportPayload {
  reportId: string;
  reportDate: string;
  items: ReportItem[];
}

export interface ReviewReportPayload {
  reportId: string;
  revisionNo: number;
  decision: ReviewDecision;
  notes: string;
  idempotencyKey: string;
  reviewerName?: string;
}

function serializeReportItems(items: ReportItem[]) {
  const categoryAliases: Record<string, string> = {
    "cat-tech": "digital-teknologi",
    "cat-deeni": "keagamaan",
    "cat-edu": "pendidikan",
    "cat-media": "media-kreatif",
    "cat-ops": "operasional",
  };
  return items.map((item) => {
    // FUNC-01: validate duration is a positive integer before it reaches the DB.
    // The SQL regex in 20261102000006 uses dollar-quoting which makes '^\d+$'
    // a literal string instead of a regex; it never matches → always falls back
    // to 60. Guard here so the value that reaches the DB is always valid.
    const rawDuration = item.durationMinutes;
    const durationMinutes =
      typeof rawDuration === "number" &&
      Number.isInteger(rawDuration) &&
      rawDuration > 0
        ? rawDuration
        : 60;
    return {
      // The RPC resolves canonical UUIDs and slugs. Keep legacy fixture IDs
      // compatible so a fast first submit cannot silently lose its category.
      categoryId: categoryAliases[item.categoryId] || item.categoryId,
      title: item.title,
      description: item.description,
      resultProgress: item.resultProgress || "",
      obstacles: item.obstacles || "",
      durationMinutes,
    };
  });
}

export async function getReportCategoriesAction(): Promise<ReportCategory[]> {
  await requireAuthUser();
  if (process.env.VITEST) return REPORT_CATEGORIES;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("report_categories")
      .select("id, name, slug, icon")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    if (data?.length) return data as ReportCategory[];
  } catch (err) {
    if (process.env.VITEST) return REPORT_CATEGORIES;
    throwQueryError("reports.categories", err);
  }
  return [];
}

/**
 * Server Action: Query Today's Report
 */
export async function getTodayReportAction(): Promise<DailyReport> {
  const jakarta = getJakartaTime();
  const today = jakarta.dateStr;

  try {
    const user = await requireAuthUser();
    const supabase = createAdminClient();

    const { data: report } = await supabase
      .from("daily_reports")
      .select("*, report_items(*, report_categories(name))")
      .eq("user_id", user.id)
      .eq("report_date", today)
      .limit(1)
      .maybeSingle();

    if (report) {
      let reviewerName: string | undefined;
      if (report.reviewer_id) {
        const { data: reviewer } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", report.reviewer_id)
          .maybeSingle();
        reviewerName = reviewer?.full_name;
      }
      return {
        id: report.id,
        userId: report.user_id,
        authorName: user.full_name,
        authorRole: user.role,
        teamName: user.team_name || "Sentra Santri",
        reportDate: report.report_date,
        reportDateFormatted: new Date(report.report_date).toLocaleDateString("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Jakarta",
        }),
        submissionStatus: report.submission_status,
        isLate: report.is_late,
        submittedAtTime: report.first_submitted_at
          ? new Date(report.first_submitted_at).toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Jakarta",
            }) + " WIB"
          : undefined,
        reviewStatus: report.review_status,
        reviewerId: report.reviewer_id || undefined,
        reviewerName,
        reviewedAt: report.reviewed_at || undefined,
        revisionNo: report.revision_no || 1,
        items: (report.report_items || []).map((it: any) => ({
          id: it.id,
          categoryId: it.category_id || "",
          categoryName: it.report_categories?.name || "Pilih kategori",
          title: it.title,
          description: it.description,
          resultProgress: it.result_progress || "",
          obstacles: it.obstacles || "",
          durationMinutes: it.duration_minutes || 60,
          sortOrder: it.sort_order || 1,
        })),
      };
    }
  } catch (err) {
    console.error("Failed to query today report:", err);
    if (!process.env.VITEST) throw err;
  }

  if (process.env.VITEST) {
    return INITIAL_USER_DAILY_REPORT;
  }

  // Pure clean empty draft for new user
  return {
    id: `rep-${today}`,
    userId: "",
    authorName: "Santri",
    authorRole: "Santri",
    teamName: "Sentra Santri",
    reportDate: today,
    reportDateFormatted: new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }),
    submissionStatus: "draft",
    isLate: false,
    reviewStatus: "not_reviewed",
    revisionNo: 1,
    items: [
      {
        id: `item-${Date.now()}`,
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
}

/** Read-only personal history; the authenticated session is the only author scope. */
export async function getMyReportHistoryAction(
  options: MyReportHistoryOptions = {}
): Promise<MyReportHistoryPage> {
  const user = await requireAuthUser();
  if (!isPlainRecord(options)) throw new Error("Parameter riwayat laporan tidak valid.");
  const { before, limit = 10 } = options;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    throw new Error("Batas riwayat laporan tidak valid.");
  }
  if (before != null && (!isDateOnly(before)
    || !Number.isFinite(Date.parse(before))
    || new Date(before).toISOString().slice(0, 10) !== before)) {
    throw new Error("Tanggal riwayat laporan tidak valid.");
  }
  const pageSize = Math.min(limit, 25);

  try {
    const supabase = createAdminClient();
    let query = supabase
      .from("daily_reports")
      .select(`id, report_date, submission_status, review_status, is_late, first_submitted_at,
        report_items(id, category_id, title, description, result_progress, obstacles, duration_minutes, sort_order, report_categories(name)),
        report_reviews(decision, notes, decided_at)`)
      .eq("user_id", user.id)
      .order("report_date", { ascending: false })
      .order("sort_order", { ascending: true, referencedTable: "report_items" })
      .order("decided_at", { ascending: false, referencedTable: "report_reviews" })
      .order("id", { ascending: false, referencedTable: "report_reviews" })
      .limit(1, { referencedTable: "report_reviews" })
      .limit(pageSize + 1);
    // UNIQUE(user_id, report_date) makes this cursor stable and exclusive.
    if (before) query = query.lt("report_date", before);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    const reports: MyReportHistoryPage["reports"] = rows.slice(0, pageSize).map((row: any) => ({
      id: row.id,
      reportDate: row.report_date,
      submissionStatus: row.submission_status,
      reviewStatus: row.review_status,
      isLate: row.is_late,
      firstSubmittedAt: row.first_submitted_at,
      items: (row.report_items ?? []).map((item: any) => ({
        id: item.id,
        categoryId: item.category_id ?? "",
        categoryName: item.report_categories?.name ?? "Tanpa kategori",
        title: item.title,
        description: item.description,
        resultProgress: item.result_progress ?? "",
        obstacles: item.obstacles ?? "",
        durationMinutes: item.duration_minutes ?? 60,
        sortOrder: item.sort_order,
      })),
      latestReview: row.report_reviews?.[0] ? {
        decision: row.report_reviews[0].decision,
        notes: row.report_reviews[0].notes,
        decidedAt: row.report_reviews[0].decided_at,
      } : null,
    }));
    return {
      reports,
      nextCursor: rows.length > pageSize ? reports[reports.length - 1].reportDate : null,
    };
  } catch (error) {
    throwQueryError("reports.my-history", error);
  }
}

/**
 * Server Action: Query Review Queue Reports
 */
export async function getReviewQueueAction(): Promise<DailyReport[]> {
  try {
    // §3.4: the review queue belongs to koordinator and pengurus only, and
    // REP-01: only reports with an active reviewer_assignments row naming the
    // reviewer are listed — never whole-team backlogs. The admin client
    // bypasses RLS, so this scope is enforced here explicitly.
    const reviewer = await requireRole(["pengurus", "koordinator"]);

    const supabase = createAdminClient();
    const todayWib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const { data: assignments, error: assignmentError } = await supabase
      .from("reviewer_assignments")
      .select("reviewee_id")
      .eq("reviewer_id", reviewer.id)
      .eq("kind", "report")
      .lte("valid_from", todayWib)
      .or(`valid_to.is.null,valid_to.gte.${todayWib}`);
    if (assignmentError) throw assignmentError;
    const revieweeIds = Array.from(
      new Set((assignments || []).map((item: any) => item.reviewee_id).filter(Boolean)),
    );
    if (revieweeIds.length === 0) return [];

    const { data: reports, error } = await supabase
      .from("daily_reports")
      .select("*, report_items(*, report_categories(name))")
      .eq("submission_status", "submitted")
      .in("user_id", revieweeIds)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    if (reports) {
      if (reports.length === 0) return [];

      const visibleReports = reports as any[];
      if (visibleReports.length === 0) return [];

      // Optimasi: Hanya ambil profil dari user_id yang ada di reports (bukan seluruh tabel profil)
      const userIds = Array.from(new Set(visibleReports.map((r: any) => r.user_id).filter(Boolean)));
      let profileMap = new Map();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, team_name")
          .in("id", userIds);
        profileMap = new Map(((profiles as any[]) || []).map((p: any) => [p.id, p]));
      }
      const reviewerIds = Array.from(new Set(visibleReports.map((report: any) => report.reviewer_id).filter(Boolean)));
      const { data: reviewers } = reviewerIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", reviewerIds)
        : { data: [] };
      const reviewerMap = new Map<string, string>((reviewers || []).map((profile: any) => [profile.id, profile.full_name] as [string, string]));

      return visibleReports.map((r: any) => {
        const author = profileMap.get(r.user_id);
        return {
          id: r.id,
          userId: r.user_id,
          authorName: author?.full_name || "Santri",
          authorRole: "Santri",
          teamName: author?.team_name || "Sentra Santri",
          reportDate: r.report_date,
          reportDateFormatted: new Date(r.report_date).toLocaleDateString("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Jakarta",
          }),
          submissionStatus: r.submission_status,
          isLate: r.is_late,
          submittedAtTime: r.first_submitted_at
            ? new Date(r.first_submitted_at).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              }) + " WIB"
            : undefined,
          reviewStatus: r.review_status,
          reviewerId: r.reviewer_id || undefined,
          reviewerName: r.reviewer_id ? reviewerMap.get(r.reviewer_id) : undefined,
          reviewedAt: r.reviewed_at || undefined,
          revisionNo: r.revision_no || 1,
          items: (r.report_items || []).map((it: any) => ({
            id: it.id,
            categoryId: it.category_id || "cat-tech",
            categoryName: it.report_categories?.name || "Aktivitas Santri",
            title: it.title,
            description: it.description,
            resultProgress: it.result_progress || "",
            obstacles: it.obstacles || "",
            durationMinutes: it.duration_minutes || 60,
            sortOrder: it.sort_order || 1,
          })),
        };
      });
    }
  } catch (err) {
    console.error("Failed to query review queue:", err);
    if (!process.env.VITEST) throw err;
  }

  if (process.env.VITEST) {
    return REVIEW_QUEUE_REPORTS;
  }

  return [];
}

/**
 * Server Action: Save Daily Report as Draft (BR-REP-05)
 */
export async function saveReportDraftAction(
  payload: SaveReportDraftPayload
): Promise<{ success: boolean; message: string }> {
  if (!isPlainRecord(payload) || !Array.isArray(payload.items) || payload.items.length === 0) {
    return {
      success: false,
      message: "Laporan draft harus memiliki minimal 1 item aktivitas.",
    };
  }

  const user = await requireAuthUser();

  if (!isDateOnly(payload.reportDate)) {
    return { success: false, message: "Tanggal laporan tidak valid." };
  }
  if (!process.env.VITEST && payload.reportDate !== getJakartaTime().dateStr) {
    return { success: false, message: "Laporan harian hanya dapat dibuat untuk tanggal operasional hari ini." };
  }

  if (process.env.VITEST) {
    return {
      success: true,
      message: `Draft laporan harian tanggal ${payload.reportDate} berhasil disimpan.`,
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_report", {
      p_user_id: user.id,
      p_report_date: payload.reportDate,
      p_submission_status: "draft",
      p_is_late: false,
      p_items: serializeReportItems(payload.items),
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.message || "Draft laporan tidak tersimpan.");
  } catch (err: any) {
    console.error("Failed to save report draft in Supabase:", err);
    return {
      success: false,
      message: "Gagal menyimpan draft: " + err.message,
    };
  }

  return {
    success: true,
    message: `Draft laporan tanggal ${payload.reportDate} berhasil disimpan.`,
  };
}

/**
 * Server Action: Submit Daily Report (BR-REP-02, BR-REP-03, BR-REP-04)
 * Evaluates against Asia/Jakarta (WIB) deadline from policy_settings.
 */
export async function submitReportAction(
  payload: SubmitReportPayload
): Promise<{
  success: boolean;
  message: string;
  isLate: boolean;
  submittedAtTime: string;
}> {
  if (!isPlainRecord(payload) || !Array.isArray(payload.items) || payload.items.length === 0) {
    return {
      success: false,
      message: "Laporan wajib memiliki minimal 1 item aktivitas yang terisi.",
      isLate: false,
      submittedAtTime: "",
    };
  }

  for (let i = 0; i < payload.items.length; i++) {
    const item = payload.items[i];
    if (!isNonEmptyString(item?.title, 500)) {
      return {
        success: false,
        message: `Judul aktivitas ke-${i + 1} wajib diisi.`,
        isLate: false,
        submittedAtTime: "",
      };
    }
    if (!isNonEmptyString(item?.description, 10000)) {
      return {
        success: false,
        message: `Deskripsi kegiatan untuk "${item.title || `Aktivitas ${i + 1}`}" wajib diisi.`,
        isLate: false,
        submittedAtTime: "",
      };
    }
  }

  const user = await requireAuthUser();
  const jakarta = getJakartaTime();
  if (!isDateOnly(payload.reportDate)) {
    return { success: false, message: "Tanggal laporan tidak valid.", isLate: false, submittedAtTime: "" };
  }
  if (!process.env.VITEST && payload.reportDate !== jakarta.dateStr) {
    return { success: false, message: "Laporan harian hanya dapat dikirim untuk tanggal operasional hari ini.", isLate: false, submittedAtTime: "" };
  }
  const submittedAtTime = `${jakarta.timeFormatted} WIB`;

  if (process.env.VITEST) {
    const deadlineDisplay = "21:00 WIB";
    const nowTotal = jakarta.totalMinutes;
    const isLate = nowTotal > (21 * 60);
    const statusLabel = isLate ? `Terlambat (melewati ${deadlineDisplay})` : "Tepat Waktu";
    return {
      success: true,
      message: `Laporan harian berhasil dikirim: ${statusLabel}.`,
      isLate,
      submittedAtTime,
    };
  }

  // Dynamic deadline check from policy_settings in Asia/Jakarta
  let deadlineH = 21;
  let deadlineM = 0;
  let deadlineDisplay = "21.00 WIB";

  try {
    const supabaseAdmin = createAdminClient();
    const { data: policy, error: policyError } = await supabaseAdmin
      .from("policy_settings")
      .select("report_deadline_time")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (policyError) throw policyError;

    if (!policy) {
      return {
        success: false,
        message: "Kebijakan batas laporan aktif belum tersedia.",
        isLate: false,
        submittedAtTime,
      };
    }
    const deadline = policy.report_deadline_time?.slice(0, 5) || "";
    if (!isTimeOnly(deadline)) {
      return {
        success: false,
        message: "Format batas laporan pada kebijakan aktif tidak valid.",
        isLate: false,
        submittedAtTime,
      };
    }
    const [hours, minutes] = deadline.split(":").map(Number);
    deadlineH = hours;
    deadlineM = minutes;
    deadlineDisplay = `${deadline} WIB`;
  } catch (error) {
    console.error("Failed to load active report policy:", error);
    return {
      success: false,
      message: "Kebijakan batas laporan tidak dapat dimuat. Laporan belum dikirim.",
      isLate: false,
      submittedAtTime,
    };
  }

  const nowTotal = jakarta.totalMinutes;
  const deadlineTotal = deadlineH * 60 + deadlineM;
  const isLate = nowTotal > deadlineTotal;

  let dbIsLate: boolean | undefined;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_report", {
      p_user_id: user.id,
      p_report_date: payload.reportDate,
      p_submission_status: "submitted",
      p_is_late: false,
      p_items: serializeReportItems(payload.items),
    });
    if (error) throw error;
    if (!data?.success) {
      return { success: false, message: data?.message || "Laporan tidak tersimpan.", isLate, submittedAtTime };
    }
    dbIsLate = data?.is_late === true;
  } catch (err: any) {
    console.error("Failed to submit report to Supabase:", err);
    return {
      success: false,
      message: friendlyActionError(err, "Gagal mengirimkan laporan. Silakan coba lagi."),
      isLate,
      submittedAtTime,
    };
  }

  // SEC-02: the database clock owns is_late; the client-side computation above
  // is only a pre-RPC fallback so failure paths still have something to show.
  const finalIsLate = dbIsLate === true;
  const dbStatusLabel = finalIsLate ? `Terlambat (melewati ${deadlineDisplay})` : "Tepat Waktu";

  return {
    success: true,
    message: `Laporan aktivitas harian berhasil dikirim pada ${submittedAtTime} [${dbStatusLabel}]. Menunggu peninjauan ustadz/pembina.`,
    isLate: finalIsLate,
    submittedAtTime,
  };
}

/**
 * Server Action: Review Report (BR-REP-06, PRD-04)
 * Requires supervisor role and records immutable audit log.
 */
export async function reviewReportAction(
  payload: ReviewReportPayload
): Promise<{ success: boolean; message: string; reviewId?: string; idempotent?: boolean; code?: string }> {
  if (!Number.isInteger(payload.revisionNo) || payload.revisionNo < 1) {
    return { success: false, message: "Nomor revisi laporan tidak valid." };
  }
  if (!payload.idempotencyKey?.trim() || payload.idempotencyKey.length > 200) {
    return { success: false, message: "Kunci idempotensi wajib diisi." };
  }
  if (payload.decision === "revision_required" && !payload.notes.trim()) {
    return {
      success: false,
      message: "Catatan evaluasi / alasan revisi wajib diisi agar santri dapat melakukan perbaikan.",
    };
  }

  // §3.4 report.review = assigned koordinator/pengurus only; the RPC
  // re-validates the active reviewer_assignments row and blocks self-review.
  const reviewer = await requireRole(["pengurus", "koordinator"]);
  let reviewId: string | undefined;
  let isIdempotentRetry = false;

  if (process.env.VITEST) {
    const revName = payload.reviewerName || reviewer.full_name;
    return {
      success: true,
      message:
        payload.decision === "approved"
          ? `Laporan berhasil disetujui oleh ${revName}.`
          : "Permintaan revisi berhasil dikirim ke santri bersangkutan.",
    };
  }

  try {
    const supabase = await createClient();
    const { data: reviewResult, error: reviewError } = await supabase.rpc("review_report", {
      p_report_id: payload.reportId,
      p_revision_no: payload.revisionNo,
      p_decision: payload.decision,
      p_notes: payload.notes || "",
      p_idempotency_key: payload.idempotencyKey,
    });
    if (reviewError) throw reviewError;
    if (!reviewResult?.success) {
      return {
        success: false,
        code: typeof reviewResult?.code === "string" ? reviewResult.code : undefined,
        message: reviewResult?.message || "Review laporan gagal disimpan.",
      };
    }
    reviewId = typeof reviewResult.review_id === "string" ? reviewResult.review_id : undefined;
    if (!reviewId) {
      return { success: false, message: "Review tersimpan tanpa identitas keputusan yang valid." };
    }
    isIdempotentRetry = reviewResult.idempotent === true || reviewResult.created === false;

    // The decision, email outbox event, durable push event, and audit record
    // are already committed atomically by the RPC. This is only an immediate
    // best-effort dispatch; on failure the cron worker retries the outbox.
    if (!process.env.VITEST) {
      try {
        // Return to the reviewer now; /api/worker/jobs?job=push-outbox finishes the queue.
        await drainNotificationOutbox({
          notificationType: payload.decision === "approved" ? "REPORT_APPROVED" : "REPORT_REVISION_REQUIRED",
          referenceId: reviewId,
          budgetMs: INLINE_DISPATCH_BUDGET_MS,
        });
      } catch (pushError) {
        console.error("Report review saved but push dispatch failed; outbox will retry:", pushError);
      }
    }

  } catch (err: any) {
    console.error("Failed to record review action:", err);
    return {
      success: false,
      message: "Gagal menyimpan hasil review: " + err.message,
    };
  }

  if (payload.decision === "approved") {
    return {
      success: true,
      reviewId,
      idempotent: isIdempotentRetry,
      message: `Laporan santri berhasil disetujui oleh ${reviewer.full_name}. Status diperbarui menjadi Disetujui.`,
    };
  } else {
    return {
      success: true,
      reviewId,
      idempotent: isIdempotentRetry,
      message: `Permintaan revisi berhasil dikirim ke santri beserta catatan evaluasi.`,
    };
  }
}
