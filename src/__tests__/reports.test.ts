import { describe, it, expect } from "vitest";
import {
  saveReportDraftAction,
  submitReportAction,
  reviewReportAction,
} from "@/modules/reports/actions";
import {
  INITIAL_USER_DAILY_REPORT,
  REVIEW_QUEUE_REPORTS,
  QUEUE_FILTER_COUNTS,
  REPORT_CATEGORIES,
} from "@/modules/reports/data";

describe("Stage 5 — Daily Activity Reports & Review Queue (PRD-04)", () => {
  it("saves daily report draft successfully (BR-REP-05)", async () => {
    const draftRes = await saveReportDraftAction({
      reportId: INITIAL_USER_DAILY_REPORT.id,
      reportDate: INITIAL_USER_DAILY_REPORT.reportDate,
      items: INITIAL_USER_DAILY_REPORT.items,
    });
    expect(draftRes.success).toBe(true);
    expect(draftRes.message).toContain("berhasil disimpan");

    const emptyDraftRes = await saveReportDraftAction({
      reportId: "rep-empty",
      reportDate: "2026-11-18",
      items: [],
    });
    expect(emptyDraftRes.success).toBe(false);
    expect(emptyDraftRes.message).toContain("minimal 1 item aktivitas");
  });

  it("submits report with valid items and calculates submission timestamp (BR-REP-02, BR-REP-03)", async () => {
    const validSubmitRes = await submitReportAction({
      reportId: INITIAL_USER_DAILY_REPORT.id,
      reportDate: INITIAL_USER_DAILY_REPORT.reportDate,
      items: INITIAL_USER_DAILY_REPORT.items,
    });
    expect(validSubmitRes.success).toBe(true);
    expect(validSubmitRes.submittedAtTime).toMatch(/\d{2}:\d{2}:\d{2} WIB/);
    expect(validSubmitRes.message).toContain("berhasil dikirim");
  });

  it("rejects report submission when an item title or description is missing", async () => {
    const invalidItemsRes = await submitReportAction({
      reportId: "rep-invalid",
      reportDate: "2026-11-18",
      items: [
        {
          id: "item-bad",
          categoryId: "cat-tech",
          title: "",
          description: "Deskripsi ada tapi judul kosong",
          durationMinutes: 60,
          sortOrder: 1,
        },
      ],
    });
    expect(invalidItemsRes.success).toBe(false);
    expect(invalidItemsRes.message).toContain("Judul aktivitas ke-1 wajib diisi");
  });

  it("requires constructive feedback when requesting revision per BR-REP-06", async () => {
    const emptyNotesReview = await reviewReportAction({
      reportId: "rep-salman-01",
      revisionNo: 1,
      decision: "revision_required",
      notes: "   ",
      idempotencyKey: "reports-empty-notes",
    });
    expect(emptyNotesReview.success).toBe(false);
    expect(emptyNotesReview.message).toContain("Catatan evaluasi / alasan revisi wajib diisi");

    const validRevisionReview = await reviewReportAction({
      reportId: "rep-salman-01",
      revisionNo: 1,
      decision: "revision_required",
      notes: "Mohon uraikan progres endpoint RPC secara lebih spesifik.",
      idempotencyKey: "reports-revision",
    });
    expect(validRevisionReview.success).toBe(true);
    expect(validRevisionReview.message).toContain("Permintaan revisi berhasil dikirim");
  });

  it("approves report with positive confirmation feedback", async () => {
    const approveRes = await reviewReportAction({
      reportId: "rep-salman-01",
      revisionNo: 1,
      decision: "approved",
      notes: "Mumtaz! Target hari ini tercapai sangat baik.",
      idempotencyKey: "reports-approval",
      reviewerName: "Ustadz Ahmad Fauzi",
    });
    expect(approveRes.success).toBe(true);
    expect(approveRes.message).toContain("berhasil disetujui oleh Ustadz Ahmad Fauzi");
  });

  it("validates data consistency of report categories and queue counts", () => {
    expect(REPORT_CATEGORIES.length).toBeGreaterThanOrEqual(5);
    expect(QUEUE_FILTER_COUNTS.pending).toBe(6);
    expect(QUEUE_FILTER_COUNTS.approved).toBe(18);

    const salmanReport = REVIEW_QUEUE_REPORTS.find((r) => r.userId === "usr-salman");
    expect(salmanReport).toBeDefined();
    expect(salmanReport?.items.length).toBe(2);
    expect(salmanReport?.submissionStatus).toBe("submitted");
  });
});

