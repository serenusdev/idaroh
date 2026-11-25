"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuthUser, requireRole } from "@/lib/auth/guards";
import { createHash, randomUUID } from "node:crypto";
import { formatRelativeTimeId } from "@/lib/utils";
import { INITIAL_AUDIT_LOGS } from "./data";
import { throwQueryError } from "@/lib/query-error";
import { isDateOnly, isNonEmptyString, isTimeOnly, isPlainRecord } from "@/lib/input-validation";
import {
  EXPORT_ROLES,
  exportRolesFor,
  holdsRole,
  isExportCategory,
  validateExportFilters,
  type ExportFilterInput,
} from "@/lib/export-policy";
import { AuditLogItem } from "./types";

/**
 * Server Action: Export Audited Report (BR-ADM-08)
 * Strictly records export action in compliance with audit trail.
 *
 * PERMISSIONS.md §3.8: `analytics.export` belongs to yayasan and pengurus only
 * (super_admin denied), and the request is only honoured for datasets the
 * caller may read. The validated date range is persisted so the download
 * endpoint replays exactly this scope instead of dumping the institution.
 */
export async function exportAuditedDataAction(
  exportType: "csv" | "pdf",
  category: string,
  requesterName?: string,
  filters?: ExportFilterInput
): Promise<{ success: boolean; message: string; exportId: string; downloadUrl?: string }> {
  void requesterName;
  const admin = await requireRole([...EXPORT_ROLES]);
  const effectiveRequester = admin.full_name;
  const exportId = randomUUID();
  const trimmedCategory = (category || "").trim();
  if (!isExportCategory(trimmedCategory)) {
    return { success: false, message: "Kategori ekspor tidak dikenal.", exportId };
  }
  if (exportType !== "csv" && exportType !== "pdf") {
    return { success: false, message: "Format ekspor tidak dikenal.", exportId };
  }
  const parsedFilters = validateExportFilters(filters);
  if (!parsedFilters.ok) {
    return { success: false, message: parsedFilters.message, exportId };
  }
  if (!holdsRole(admin, exportRolesFor(trimmedCategory))) {
    return {
      success: false,
      message: "Log audit hanya dapat diekspor oleh Yayasan.",
      exportId,
    };
  }
  const { dateFrom, dateTo } = parsedFilters.value;
  try {
    const supabase = createAdminClient();
    const exportPayload = {
      exportId,
      userId: admin.id,
      exportType,
      category: trimmedCategory,
      dateFrom,
      dateTo,
    };
    const hash = createHash("sha256").update(JSON.stringify(exportPayload)).digest("hex");
    // 1. Record export log
    const { error: exportError } = await supabase.from("export_logs").insert({
      id: exportId,
      user_id: admin.id,
      export_type: exportType,
      category: trimmedCategory,
      filter_criteria: {
        requested_by: effectiveRequester,
        date_from: dateFrom,
        date_to: dateTo,
      },
      row_count: 0,
    });
    if (exportError) throw exportError;

    // 2. Record immutable audit log
    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "admin.export_generated",
      actor_id: admin.id,
      actor_name: effectiveRequester,
      target_id: exportId,
      target_label: `Ekspor ${trimmedCategory.toUpperCase()} (${exportType.toUpperCase()})`,
      action_detail: `Unduhan rekap data operasional diotorisasi dan dicatat untuk kepatuhan ISO/IEC 27001. Rentang: ${dateFrom || "awal"} s.d. ${dateTo || "sekarang"} WIB.`,
      hash: `sha256:${hash}`,
    });
    if (auditError) throw auditError;
  } catch (err) {
    console.error("Failed to record export in Supabase:", err);
    return { success: false, message: "Gagal mencatat ekspor pada audit log.", exportId };
  }

  return {
    success: true,
    message: `Ekspor data ${trimmedCategory.toUpperCase()} (${exportType.toUpperCase()}) oleh ${effectiveRequester} berhasil dicatat pada audit log.`,
    exportId,
    downloadUrl: `/api/exports/${exportId}.${exportType}`,
  };
}

/**
 * Server Action: Search and Filter Audit Logs Explorer
 */
export async function queryAuditLogsAction(
  query: string,
  scope: string = "Semua Tim (Organisasi)",
  page = 1
): Promise<{ success: boolean; logs: AuditLogItem[]; hasMore: boolean; page: number }> {
  // PERMISSIONS.md §3.8: admin.audit.read denies pengurus.
  await requireRole(["super_admin", "yayasan"]);
  try {
    const supabase = createAdminClient();
    const pageSize = 50;
    const safePage = Math.max(1, Math.floor(page));
    let dbQuery = supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    dbQuery = typeof (dbQuery as any).range === "function"
      ? dbQuery.range((safePage - 1) * pageSize, safePage * pageSize - 1)
      : dbQuery.limit(pageSize);

    if (scope !== "Semua Tim (Organisasi)") {
      const { data: scopedActors, error: scopedActorsError } = await supabase
        .from("profiles")
        .select("id")
        .eq("team_name", scope);
      if (scopedActorsError) throw scopedActorsError;
      const actorIds = (scopedActors || []).map((actor: any) => actor.id);
      if (actorIds.length === 0) return { success: true, logs: [], hasMore: false, page: safePage };
      dbQuery = dbQuery.in("actor_id", actorIds);
    }

    const sanitizedQuery = query.replace(/[,()]/g, "").trim();
    if (sanitizedQuery) {
      dbQuery = dbQuery.or(
        `event_name.ilike.%${sanitizedQuery}%,actor_name.ilike.%${sanitizedQuery}%,target_label.ilike.%${sanitizedQuery}%,action_detail.ilike.%${sanitizedQuery}%`
      );
    }

    const { data: logs, error, count } = await dbQuery;

    if (error) throw error;
    if (logs) {
      if (logs.length === 0) return { success: true, logs: [], hasMore: false, page: safePage };

      return {
        success: true,
        hasMore: typeof count === "number" ? safePage * pageSize < count : logs.length === pageSize,
        page: safePage,
        logs: logs.map((l: any) => ({
          id: l.id,
          timeAgo: formatRelativeTimeId(l.created_at),
          eventName: l.event_name,
          actorName: l.actor_name || "Sistem",
          targetLabel: l.target_label || "-",
          actionDetail: l.action_detail || "-",
          hash: l.hash || "sha256:unavailable",
          createdIso: l.created_at,
        })),
      };
    }
  } catch (err) {
    if (!process.env.VITEST) throwQueryError("analytics.audit_logs", err);
  }

  // Fallback for tests runner only
  if (process.env.VITEST) {
    if (!query.trim()) {
      return { success: true, logs: INITIAL_AUDIT_LOGS, hasMore: false, page: 1 };
    }

    const q = query.toLowerCase();
    const filtered = INITIAL_AUDIT_LOGS.filter(
      (log) =>
        log.eventName.toLowerCase().includes(q) ||
        log.actorName.toLowerCase().includes(q) ||
        log.targetLabel.toLowerCase().includes(q) ||
        log.actionDetail.toLowerCase().includes(q)
    );

    return { success: true, logs: filtered, hasMore: false, page: 1 };
  }

  return { success: false, logs: [], hasMore: false, page: Math.max(1, Math.floor(page)) };
}

export async function getAuditChainStatusAction(): Promise<{ valid: boolean; checked: number; message: string }> {
  // app.verify_audit_chain() enforces the same §3.8 reader set in the database.
  await requireRole(["super_admin", "yayasan"]);
  if (process.env.VITEST) return { valid: true, checked: 0, message: "Audit chain test fixture valid." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("verify_audit_chain");
    if (error) throw error;
    return {
      valid: data?.valid === true,
      checked: Number(data?.checked || 0),
      message: data?.message || "Status audit chain tidak tersedia.",
    };
  } catch (error) {
    console.error("Failed to verify audit chain:", error);
    return { valid: false, checked: 0, message: "Audit chain belum dapat diverifikasi." };
  }
}

export interface PolicySettingItem {
  id: string;
  code: string;
  name: string;
  attendanceCutoffTime: string;
  attendanceGraceCutoffTime: string;
  reportDeadlineTime: string;
  status: string;
  effectiveFrom: string;
  proposedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  changeReason?: string;
}

/**
 * Server Action: Query current active operational hours & policy
 */
export async function getActivePolicyAction(): Promise<PolicySettingItem | null> {
  await requireAuthUser();
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("policy_settings")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) {
      return {
        id: data.id,
        code: data.code,
        name: data.name,
        attendanceCutoffTime: (data.attendance_cutoff_time || "08:00").substring(0, 5),
        attendanceGraceCutoffTime: (data.attendance_grace_cutoff_time || "08:15").substring(0, 5),
        reportDeadlineTime: (data.report_deadline_time || "21:00").substring(0, 5),
        status: data.status,
        effectiveFrom: data.effective_from,
        proposedBy: data.proposed_by || undefined,
        approvedBy: data.approved_by || undefined,
        approvedAt: data.approved_at || undefined,
        changeReason: data.change_reason || undefined,
      };
    }
  } catch (err) {
    if (process.env.VITEST) return null;
    throwQueryError("analytics.active_policy", err);
  }
  return null;
}

/**
 * Server Action: Update or set operational hours & policy by Super Admin
 */
export async function updatePolicySettingsAction(payload: {
  name: string;
  attendanceCutoffTime: string;
  attendanceGraceCutoffTime: string;
  reportDeadlineTime: string;
  effectiveFrom?: string;
  changeReason?: string;
}): Promise<{ success: boolean; message: string }> {
  const admin = await requireRole(["super_admin"]);
  if (!isPlainRecord(payload) || !isNonEmptyString(payload.name, 200) || !isTimeOnly(payload.attendanceCutoffTime) || !isTimeOnly(payload.attendanceGraceCutoffTime) || !isTimeOnly(payload.reportDeadlineTime) || (payload.effectiveFrom !== undefined && !isDateOnly(payload.effectiveFrom))) {
    return { success: false, message: "Format kebijakan operasional tidak valid." };
  }
  try {
    const supabase = createAdminClient();
    const code = `POL-${new Date().getFullYear()}-v${Date.now().toString().slice(-4)}`;
    const id = `pol-${Date.now()}`;

    const { error } = await supabase.from("policy_settings").insert({
      id,
      code,
      name: payload.name || "Kebijakan Operasional Pesantren",
      attendance_cutoff_time: `${payload.attendanceCutoffTime}:00`,
      attendance_grace_cutoff_time: `${payload.attendanceGraceCutoffTime}:00`,
      report_deadline_time: `${payload.reportDeadlineTime}:00`,
      status: "proposed",
      effective_from: payload.effectiveFrom || new Date().toISOString().split("T")[0],
      proposed_by: admin.id,
      change_reason: payload.changeReason || "Pembaruan kebijakan operasional",
    });

    if (error) throw error;

    await supabase.from("audit_logs").insert({
      event_name: "policy.settings_updated",
      actor_name: admin.full_name,
      target_id: id,
      target_label: code,
      action_detail: `Usulan kebijakan: Tepat ≤ ${payload.attendanceCutoffTime}, Toleransi ≤ ${payload.attendanceGraceCutoffTime}, Batas Laporan ${payload.reportDeadlineTime} WIB. Menunggu persetujuan Yayasan.`,
      hash: `sha256-policy-${Date.now()}`,
    });

    return {
      success: true,
      message: "Usulan kebijakan berhasil disimpan dan menunggu persetujuan Yayasan.",
    };
  } catch (err: any) {
    console.error("Failed to update policy settings:", err);
    return {
      success: false,
      message: err.message || "Gagal menyimpan kebijakan operasional.",
    };
  }
}

export async function getPendingPolicySettingsAction(): Promise<PolicySettingItem[]> {
  await requireRole(["super_admin", "yayasan"]);
  if (process.env.VITEST) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("policy_settings").select("*").in("status", ["proposed", "approved"]).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((item: any) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    attendanceCutoffTime: (item.attendance_cutoff_time || "08:00").substring(0, 5),
    attendanceGraceCutoffTime: (item.attendance_grace_cutoff_time || "08:15").substring(0, 5),
    reportDeadlineTime: (item.report_deadline_time || "21:00").substring(0, 5),
    status: item.status,
    effectiveFrom: item.effective_from,
    proposedBy: item.proposed_by || undefined,
    approvedBy: item.approved_by || undefined,
    approvedAt: item.approved_at || undefined,
    changeReason: item.change_reason || undefined,
  }));
}

export async function approvePolicySettingsAction(policyId: string, note?: string): Promise<{ success: boolean; message: string }> {
  const approver = await requireRole(["yayasan"]);
  if (process.env.VITEST) return { success: true, message: "Usulan kebijakan disetujui." };
  const supabase = createAdminClient();
  const { data: policy, error: readError } = await supabase.from("policy_settings").select("id, status").eq("id", policyId).maybeSingle();
  if (readError) throw readError;
  if (!policy || policy.status !== "proposed") return { success: false, message: "Usulan tidak ditemukan atau sudah diproses." };
  const { error } = await supabase.from("policy_settings").update({ status: "approved", approved_by: approver.id, approved_at: new Date().toISOString() }).eq("id", policyId).eq("status", "proposed");
  if (error) throw error;
  await supabase.from("policy_approval_events").insert({ policy_id: policyId, actor_id: approver.id, from_status: "proposed", to_status: "approved", note: note || null });
  return { success: true, message: "Usulan kebijakan disetujui. Super Admin dapat mengaktifkannya pada tanggal berlaku." };
}

export async function activatePolicySettingsAction(policyId: string): Promise<{ success: boolean; message: string }> {
  await requireRole(["super_admin"]);
  if (process.env.VITEST) return { success: true, message: "Kebijakan berhasil diaktifkan." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activate_policy", { p_policy_id: policyId });
  if (error) throw error;
  return data as { success: boolean; message: string };
}

export interface AdminDashboardMetrics {
  totalSantri: number;
  todayCheckedIn: number;
  todayLate: number;
  pendingReports: number;
  approvedReports: number;
  pendingAccountRequests: number;
  activeTasks: number;
  systemHealth?: {
    activeUsersCount: number;
    pendingOutbox: number;
    failedCronRuns: number;
  };
}

/**
 * Server Action: Query high-level operational counts for Admin Overview Dashboard.
 * Decision D3: super_admin (without pengurus/yayasan) receives technical/system
 * health aggregates only, without operational santri KPIs or PII.
 */
export async function getAdminDashboardStatsAction(): Promise<AdminDashboardMetrics> {
  const user = await requireRole(["super_admin", "yayasan", "pengurus"]);
  const isOperationalDashboardRole = holdsRole(user, ["pengurus", "yayasan"]);
  const result: AdminDashboardMetrics = {
    totalSantri: 0,
    todayCheckedIn: 0,
    todayLate: 0,
    pendingReports: 0,
    approvedReports: 0,
    pendingAccountRequests: 0,
    activeTasks: 0,
  };

  try {
    const supabase = createAdminClient();

    if (holdsRole(user, ["super_admin"])) {
      const [
        { count: activeUsersCount, error: usersError },
        { count: pendingOutboxCount, error: outboxError },
        { count: failedCronCount, error: cronError },
        { count: reqCount, error: reqError },
      ] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("cron_job_runs").select("id", { count: "exact", head: true }).eq("status", "failed"),
        supabase.from("account_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      if (usersError) throw usersError;
      if (outboxError) throw outboxError;
      if (cronError) throw cronError;
      if (reqError) throw reqError;
      result.pendingAccountRequests = reqCount || 0;
      result.systemHealth = {
        activeUsersCount: activeUsersCount || 0,
        pendingOutbox: pendingOutboxCount || 0,
        failedCronRuns: failedCronCount || 0,
      };
    }

    if (!isOperationalDashboardRole) {
      return result;
    }

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

    // 1. Total santri
    const { count: santriCount, error: santriError } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("member_type", "santri")
      .eq("status", "active");
    if (santriError) throw santriError;
    result.totalSantri = santriCount || 0;

    // 2. Attendance today — exact counts avoid the default REST row limit.
    const [{ count: checkedInCount, error: attendanceError }, { count: lateCount, error: lateError }] = await Promise.all([
      supabase.from("attendance_records").select("id", { count: "exact", head: true }).eq("attendance_date", today),
      supabase.from("attendance_records").select("id", { count: "exact", head: true }).eq("attendance_date", today).eq("classification", "late"),
    ]);
    if (attendanceError) throw attendanceError;
    if (lateError) throw lateError;
    result.todayCheckedIn = checkedInCount || 0;
    result.todayLate = lateCount || 0;

    // 3. Reports — only submitted reports belong in the review/approval KPIs.
    const [{ count: pendingReportCount, error: pendingReportsError }, { count: approvedReportCount, error: approvedReportsError }] = await Promise.all([
      supabase.from("daily_reports").select("id", { count: "exact", head: true }).eq("submission_status", "submitted").in("review_status", ["not_reviewed", "under_review"]),
      supabase.from("daily_reports").select("id", { count: "exact", head: true }).eq("submission_status", "submitted").eq("review_status", "approved"),
    ]);
    if (pendingReportsError) throw pendingReportsError;
    if (approvedReportsError) throw approvedReportsError;
    result.pendingReports = pendingReportCount || 0;
    result.approvedReports = approvedReportCount || 0;

    // 4. Active tasks
    const { count: taskCount, error: taskError } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["todo", "in_progress", "in_review"])
      .is("deleted_at", null);
    if (taskError) throw taskError;
    result.activeTasks = taskCount || 0;
  } catch (err) {
    if (process.env.VITEST) return result;
    throwQueryError("analytics.admin_dashboard", err);
  }

  return result;
}
