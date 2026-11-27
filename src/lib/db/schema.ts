/**
 * DX-01 — the read model for the analytics, audit and export paths.
 *
 * Column names, nullability and the CHECK/enum domains were taken from the live project catalog
 * (`information_schema.columns` + `pg_type`) and agree with the applied migrations, so the same
 * types describe the disposable database CI builds with `supabase db reset`.
 *
 * Two deliberate choices:
 *   - `timestamp with time zone` and `date` are typed as `string`. The reader renders them with
 *     `to_jsonb(col) #>> '{}'`, which yields the exact ISO-8601 text PostgREST used to return.
 *     Letting `pg` parse them into a `Date` would change CSV output and drop microseconds.
 *   - `jsonb` is `unknown`, never `any`: a caller that wants a payload must validate it, which is
 *     what `parseStoredExportFilters()` already does for `export_logs.filter_criteria`.
 *
 * This module describes tables only. It grants nothing: every statement still runs through the
 * read-only reader under the service role, and the permission decisions stay in the Server Action
 * guards and RLS policies (PERMISSIONS.md).
 */

/** public.account_status_type */
export type AccountStatus =
  | "pending"
  | "active"
  | "rejected"
  | "suspended"
  | "deactivated"
  | "approved";

/** public.attendance_classification_type */
export type AttendanceClassification =
  | "on_time"
  | "grace"
  | "late"
  | "excused"
  | "sick"
  | "no_checkin";

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type SubmissionStatus = "draft" | "submitted";
export type ReviewStatus = "not_reviewed" | "under_review" | "revision_required" | "approved";
export type PushOutboxStatus = "pending" | "processing" | "delivered" | "dead_letter";
export type EmailOutboxStatus = "pending" | "processing" | "sent" | "failed";
export type CronRunStatus = "started" | "completed" | "failed";
export type BackgroundJobStatus = "idle" | "running" | "completed" | "failed" | "dead_letter";

export interface ProfilesTable {
  id: string;
  email: string;
  full_name: string;
  phone_number: string | null;
  avatar_url: string | null;
  status: AccountStatus;
  /** Descriptive only — PERMISSIONS.md forbids deriving a role from it. */
  member_type: string | null;
  team_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  session_revoked_at: string | null;
  last_seen_at: string | null;
  attendance_reminder_enabled: boolean;
  username: string | null;
  bio: string;
}

export interface AttendanceRecordsTable {
  id: string;
  user_id: string;
  attendance_date: string;
  checked_in_at: string;
  classification: AttendanceClassification;
  minutes_after_deadline: number;
  policy_version_id: string;
  client_meta: unknown;
  created_at: string;
  updated_at: string;
}

export interface AttendanceExceptionsTable {
  id: string;
  user_id: string;
  date_from: string;
  date_to: string;
  type: "excused" | "sick" | "duty";
  reason: string;
  evidence_url: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface DailyReportsTable {
  id: string;
  user_id: string;
  report_date: string;
  submission_status: SubmissionStatus;
  is_late: boolean;
  first_submitted_at: string | null;
  last_submitted_at: string | null;
  review_status: ReviewStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  revision_no: number;
  policy_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TasksTable {
  id: string;
  project_id: string | null;
  team_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  requires_review: boolean;
  reviewer_id: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  position: number;
  deleted_at: string | null;
  visibility: string;
}

export interface AuditLogsTable {
  id: string;
  event_name: string;
  actor_id: string | null;
  actor_name: string;
  target_id: string | null;
  target_label: string | null;
  action_detail: string;
  payload: unknown;
  ip_address: string | null;
  created_at: string;
  hash: string | null;
  previous_hash: string | null;
}

export interface ExportLogsTable {
  id: string;
  user_id: string | null;
  export_type: "csv" | "pdf";
  category: string;
  filter_criteria: unknown;
  row_count: number;
  created_at: string;
}

export interface EmailOutboxTable {
  id: string;
  recipient: string;
  subject: string;
  body_text: string;
  status: EmailOutboxStatus;
  attempt_count: number;
  last_error: string | null;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
  /** JOB-01 backoff: a failed email is retried only once this instant passes. */
  next_attempt_at: string;
}

export interface NotificationPushOutboxTable {
  notification_id: string;
  status: PushOutboxStatus;
  attempt_count: number;
  next_attempt_at: string;
  lease_token: string | null;
  lease_until: string | null;
  delivered_token_hashes: string[];
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface CronJobRunsTable {
  job_key: string;
  started_at: string;
  completed_at: string | null;
  status: CronRunStatus;
  error_message: string | null;
}

export interface AccountRequestsTable {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone_number: string;
  role_requested: string;
  team_requested: string | null;
  notes: string | null;
  status: AccountStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  turnstile_verified: boolean;
  created_at: string;
  updated_at: string;
  auth_user_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  claimed_member_type: string | null;
  privacy_consent_version: string | null;
  privacy_consent_at: string | null;
}

export interface BackgroundJobRunsTable {
  job_key: string;
  status: BackgroundJobStatus;
  attempt_count: number;
  max_attempts: number;
  consecutive_failures: number;
  lease_token: string | null;
  lease_until: string | null;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  last_started_at: string | null;
  last_success_at: string | null;
  updated_at: string;
}

export interface StudentsTable {
  id: string;
  nis: string;
  full_name: string;
  gender: "L" | "P";
  dorm_room: string | null;
  halaqah_group: string | null;
  profile_id: string | null;
  guardian_profile_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AcademicTermsTable {
  id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_locked: boolean;
  rubric_schema: unknown;
  created_at: string;
}

export interface ReportCardsTable {
  id: string;
  student_id: string;
  term_id: string;
  tahfidz_data: unknown;
  diniyah_scores: unknown;
  adab_scores: unknown;
  attendance_summary: unknown;
  status: "draft" | "verified" | "published";
  verification_hash: string;
  gdrive_file_id: string | null;
  published_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface BatchJobsTable {
  id: string;
  job_type: "REPORT_CARD_BATCH_PDF" | "REPORT_RAW_IMPORT";
  term_id: string | null;
  status: "queued" | "running" | "completed" | "failed";
  total_items: number;
  processed_items: number;
  failed_items: number;
  zip_gdrive_file_id: string | null;
  error_summary: unknown;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

export interface StoredFilesTable {
  id: string;
  gdrive_file_id: string;
  folder_category: "avatars" | "reports" | "resources" | "raw-imports" | "rapor";
  original_name: string;
  mime_type: string;
  byte_size: number;
  visibility: "public_cached" | "private_sensitive";
  owner_profile_id: string | null;
  related_student_id: string | null;
  created_at: string;
}

/**
 * Only the relations the read-only path queries. A table absent from this map cannot be named in
 * a Kysely query, so the surface the reader can reach stays as small as the audited read paths.
 */
export interface Database {
  profiles: ProfilesTable;
  attendance_records: AttendanceRecordsTable;
  attendance_exceptions: AttendanceExceptionsTable;
  daily_reports: DailyReportsTable;
  tasks: TasksTable;
  audit_logs: AuditLogsTable;
  export_logs: ExportLogsTable;
  email_outbox: EmailOutboxTable;
  notification_push_outbox: NotificationPushOutboxTable;
  cron_job_runs: CronJobRunsTable;
  account_requests: AccountRequestsTable;
  background_job_runs: BackgroundJobRunsTable;
  students: StudentsTable;
  academic_terms: AcademicTermsTable;
  report_cards: ReportCardsTable;
  batch_jobs: BatchJobsTable;
  stored_files: StoredFilesTable;
}
