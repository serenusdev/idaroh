export type SubmissionStatus = "draft" | "submitted";

export type ReviewStatus =
  | "not_reviewed"
  | "under_review"
  | "revision_required"
  | "approved";

export type ReviewDecision = "approved" | "revision_required";

export interface ReportCategory {
  id: string;
  name: string;
  slug: string;
  icon?: string;
}

export interface ReportItem {
  id: string;
  reportId?: string;
  categoryId: string;
  categoryName?: string;
  title: string;
  description: string;
  resultProgress?: string;
  obstacles?: string;
  durationMinutes: number;
  sortOrder: number;
}

export interface ReportReviewRecord {
  id: string;
  reportId: string;
  revisionNo: number;
  reviewerId: string;
  reviewerName: string;
  decision: ReviewDecision;
  notes: string;
  decidedAt: string;
}

export interface DailyReport {
  id: string;
  userId: string;
  authorName: string;
  authorRole: string;
  authorAvatar?: string;
  teamName: string;
  reportDate: string; // "YYYY-MM-DD"
  reportDateFormatted: string; // e.g. "Senin, 18 Nov 2026"
  submissionStatus: SubmissionStatus;
  isLate: boolean;
  submittedAtTime?: string;
  reviewStatus: ReviewStatus;
  reviewerId?: string;
  reviewerName?: string;
  reviewerRole?: string;
  reviewedAt?: string; // ISO timestamp when the report was reviewed/approved
  revisionNo: number;
  items: ReportItem[];
  reviews?: ReportReviewRecord[];
  isBeingInspected?: boolean;
}

export interface MyReportHistoryEntry {
  id: string;
  reportDate: string;
  submissionStatus: SubmissionStatus;
  reviewStatus: ReviewStatus;
  isLate: boolean;
  firstSubmittedAt: string | null;
  items: ReportItem[];
  latestReview: {
    decision: ReviewDecision;
    notes: string;
    decidedAt: string;
  } | null;
}

export interface MyReportHistoryOptions {
  before?: string | null; // Exclusive report_date cursor (YYYY-MM-DD).
  limit?: number;
}

export interface MyReportHistoryPage {
  reports: MyReportHistoryEntry[];
  nextCursor: string | null;
}

export interface ReportQueueFilterCounts {
  pending: number;
  revision: number;
  resubmitted: number;
  approved: number;
  unassigned: number;
}

