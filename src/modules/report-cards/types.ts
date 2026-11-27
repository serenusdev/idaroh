export type ReportCardStatus = "draft" | "verified" | "published";

export interface ParsedReportRow {
  nis?: string;
  fullName?: string;
  tahfidzData?: Record<string, unknown>;
  diniyahScores?: unknown[];
  adabScores?: Record<string, unknown>;
  attendanceSummary?: Record<string, unknown>;
  confidence: number;
  sourceRow: number;
}

export interface ReportCardBatchItem {
  id: string;
  studentId: string;
  nis: string;
  fullName: string;
  dormRoom: string | null;
  halaqahGroup: string | null;
  verificationHash: string;
  tahfidzData: Record<string, unknown>;
  diniyahScores: unknown[];
  adabScores: Record<string, unknown>;
  attendanceSummary: Record<string, unknown>;
}
