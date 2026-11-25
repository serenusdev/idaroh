export type AttendanceClassification =
  | "on_time"
  | "grace"
  | "late"
  | "excused"
  | "sick"
  | "duty"
  | "no_checkin"
  // §3.3: the two statuses the effective layer produces for a day nobody was expected to
  // attend. `non_operational` is what a Sunday or a calendar closure must read — before
  // 20261122000011 restored the clause those dates were snapshotted as `no_checkin`.
  | "non_operational"
  | "not_required";

export interface AttendanceRecordItem {
  id: string;
  dateStr: string;
  dateFormatted: string;
  timeStr: string;
  classification: AttendanceClassification;
  label: string;
  sessionTitle: string;
  canCorrect: boolean;
  notes?: string;
}

export interface DayAttendanceStatus {
  dayName: string;
  dateNum: number;
  fullDate: string;
  status: AttendanceClassification | "holiday";
  icon: string;
  label: string;
  isToday?: boolean;
}

export interface AttendanceStatsSummary {
  onTimeCount: number;
  graceCount: number;
  excusedCount: number;
  lateCount: number;
  unrecordedCount: number;
  attendanceRate: number;
}

export interface CorrectionRequestPayload {
  attendanceDate: string;
  recordedTime: string;
  reasonCategory: string;
  notes?: string;
  evidenceUrl?: string;
}

