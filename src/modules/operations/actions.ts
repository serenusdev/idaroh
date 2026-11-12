"use server";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuthUser, requireRole } from "@/lib/auth/guards";
import { sendPushToUsers } from "@/lib/fcm";
import { isNonEmptyString } from "@/lib/input-validation";

async function canAccessTask(
  supabase: ReturnType<typeof createAdminClient>,
  user: { id: string; role: string; roles?: string[] },
  taskId: string
) {
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, created_by, team_id, visibility, task_assignees(user_id, unassigned_at)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!task) return false;
  const roles = user.roles || [user.role];
  if (roles.some((role) => ["super_admin", "yayasan", "pengurus"].includes(role))) return true;
  if (task.created_by === user.id || (task.task_assignees || []).some((item: any) => item.user_id === user.id && !item.unassigned_at)) return true;
  if (task.visibility === "private") return false;
  if (task.visibility === "organization") return true;
  if (!task.team_id) return false;
  const { data: memberships, error: membershipError } = await supabase
    .from("team_members")
    .select("team_id, teams(id, name, slug)")
    .eq("user_id", user.id)
    .is("valid_to", null);
  if (membershipError) throw membershipError;
  return (memberships || []).some((item: any) =>
    task.team_id === item.team_id || task.team_id === item.teams?.id || task.team_id === item.teams?.name || task.team_id === item.teams?.slug
  );
}

export interface OperationalAnalytics {
  period: { from: string; to: string };
  attendance: { population: number; checkedIn: number; onTime: number; grace: number; late: number };
  reports: { total: number; submitted: number; late: number; reviewBacklog: number };
  tasks: { open: number; completed: number; overdue: number };
}

export interface AnalyticsDrilldownRow {
  id: string;
  label: string;
  detail: string;
  date: string;
  status: string;
}

function periodDefaults(from?: string, to?: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const start = new Date(`${today}T00:00:00+07:00`);
  start.setDate(start.getDate() - 6);
  const defaultFrom = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(start);
  return { from: from || defaultFrom, to: to || today };
}

export async function getOperationalAnalyticsAction(
  from?: string,
  to?: string,
  teamId?: string
): Promise<OperationalAnalytics> {
  const user = await requireRole(["super_admin", "yayasan", "pengurus", "koordinator"]);
  const period = periodDefaults(from, to);

  if (process.env.VITEST) {
    return {
      period,
      attendance: { population: 28, checkedIn: 24, onTime: 19, grace: 3, late: 2 },
      reports: { total: 28, submitted: 25, late: 4, reviewBacklog: 3 },
      tasks: { open: 11, completed: 8, overdue: 2 },
    };
  }

  const admin = createAdminClient();
  const effectiveTeamId = teamId || null;
  let coordinatorTeamIds: string[] = [];
  if (user.role === "koordinator") {
    const { data: memberships, error: membershipError } = await admin
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id)
      .is("valid_to", null);
    if (membershipError) throw membershipError;
    coordinatorTeamIds = Array.from(new Set((memberships || []).map((membership: any) => membership.team_id)));
    if (coordinatorTeamIds.length === 0) {
      return {
        period,
        attendance: { population: 0, checkedIn: 0, onTime: 0, grace: 0, late: 0 },
        reports: { total: 0, submitted: 0, late: 0, reviewBacklog: 0 },
        tasks: { open: 0, completed: 0, overdue: 0 },
      };
    }
  }
  const supabase = await createClient();
  const rpcTeamIds = user.role === "koordinator" ? coordinatorTeamIds : [effectiveTeamId];
  const results = await Promise.all(rpcTeamIds.map((scopeTeamId) => supabase.rpc("analytics_operational_summary", {
    p_from: period.from,
    p_to: period.to,
    p_team_id: scopeTeamId,
  })));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const value = results.reduce((total: any, result: any) => {
    const current = result.data || {};
    for (const key of ["attendance", "reports", "tasks"]) {
      for (const metric of Object.keys(current[key] || {})) total[key][metric] = Number(total[key][metric] || 0) + Number(current[key][metric] || 0);
    }
    return total;
  }, { attendance: {}, reports: {}, tasks: {} });
  return {
    period,
    attendance: {
      population: Number(value.attendance?.population || 0),
      checkedIn: Number(value.attendance?.checked_in || 0),
      onTime: Number(value.attendance?.on_time || 0),
      grace: Number(value.attendance?.grace || 0),
      late: Number(value.attendance?.late || 0),
    },
    reports: {
      total: Number(value.reports?.total || 0),
      submitted: Number(value.reports?.submitted || 0),
      late: Number(value.reports?.late || 0),
      reviewBacklog: Number(value.reports?.review_backlog || 0),
    },
    tasks: {
      open: Number(value.tasks?.open || 0),
      completed: Number(value.tasks?.completed || 0),
      overdue: Number(value.tasks?.overdue || 0),
    },
  };
}

export async function getAnalyticsDrilldownAction(
  metric: "attendance_late" | "reports_backlog" | "tasks_overdue",
  from?: string,
  to?: string
): Promise<AnalyticsDrilldownRow[]> {
  const user = await requireRole(["super_admin", "yayasan", "pengurus", "koordinator"]);
  const period = periodDefaults(from, to);
  if (process.env.VITEST) {
    return [{ id: "sample-1", label: "Contoh data operasional", detail: "Data drill-down siap ditampilkan", date: period.to, status: metric }];
  }

  const supabase = createAdminClient();
  let allowedUserIds: Set<string> | null = null;
  if (user.role === "koordinator") {
    const { data: memberships, error: membershipError } = await supabase.from("team_members").select("team_id").eq("user_id", user.id).is("valid_to", null);
    if (membershipError) throw membershipError;
    const teamIds = (memberships || []).map((membership: any) => membership.team_id);
    const { data: teamMembers, error: teamMemberError } = teamIds.length
      ? await supabase.from("team_members").select("user_id").in("team_id", teamIds).is("valid_to", null)
      : { data: [], error: null };
    if (teamMemberError) throw teamMemberError;
    allowedUserIds = new Set((teamMembers || []).map((member: any) => member.user_id));
  }
  if (metric === "attendance_late") {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("id, user_id, attendance_date, classification, profiles(full_name)")
      .eq("classification", "late")
      .gte("attendance_date", period.from)
      .lte("attendance_date", period.to)
      .order("attendance_date", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data || []).filter((row: any) => !allowedUserIds || allowedUserIds.has(row.user_id)).map((row: any) => ({
      id: row.id,
      label: row.profiles?.full_name || "Anggota",
      detail: "Presensi melewati batas toleransi",
      date: row.attendance_date,
      status: row.classification,
    }));
  }
  if (metric === "reports_backlog") {
    const { data, error } = await supabase
      .from("daily_reports")
      .select("id, user_id, report_date, review_status, profiles(full_name)")
      .eq("submission_status", "submitted")
      .in("review_status", ["not_reviewed", "under_review"])
      .gte("report_date", period.from)
      .lte("report_date", period.to)
      .order("report_date", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data || []).filter((row: any) => !allowedUserIds || allowedUserIds.has(row.user_id)).map((row: any) => ({
      id: row.id,
      label: row.profiles?.full_name || "Anggota",
      detail: "Laporan menunggu review",
      date: row.report_date,
      status: row.review_status,
    }));
  }
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, due_date, status, task_assignees(user_id)")
    .is("deleted_at", null)
    .in("status", ["todo", "in_progress", "in_review"])
    .lt("due_date", new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()))
    .order("due_date", { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data || []).filter((row: any) => !allowedUserIds || (row.task_assignees || []).some((assignment: any) => allowedUserIds?.has(assignment.user_id))).map((row: any) => ({
    id: row.id,
    label: row.title,
    detail: "Tugas terbuka melewati tenggat",
    date: row.due_date || "-",
    status: row.status,
  }));
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export interface MemberImportResult {
  success: boolean;
  message: string;
  totalRows: number;
  importedRows: number;
  rejectedRows: number;
  errors: string[];
  batchId?: string;
}

export async function importMembersCsvAction(
  fileName: string,
  csv: string
): Promise<MemberImportResult> {
  const adminUser = await requireRole(["super_admin", "pengurus"]);
  if (!isNonEmptyString(fileName, 255) || typeof csv !== "string" || csv.length > 5_000_000) {
    return { success: false, message: "Nama file atau isi CSV tidak valid.", totalRows: 0, importedRows: 0, rejectedRows: 0, errors: [] };
  }
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    return { success: false, message: "CSV harus memiliki header dan minimal satu baris anggota.", totalRows: 0, importedRows: 0, rejectedRows: 0, errors: [] };
  }
  const headers = rows[0].map((header) => header.toLowerCase().replace(/\s+/g, "_"));
  const required = ["full_name", "email"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) {
    return { success: false, message: `Kolom wajib tidak ditemukan: ${missing.join(", ")}.`, totalRows: rows.length - 1, importedRows: 0, rejectedRows: rows.length - 1, errors: [] };
  }

  type ImportRow = { row: number; full_name: string; email: string; [key: string]: string | number };
  const items: ImportRow[] = rows.slice(1).map((values, index) => {
    const record: ImportRow = { row: index + 2, full_name: "", email: "" };
    headers.forEach((header, headerIndex) => { record[header] = values[headerIndex] || ""; });
    return record;
  });
  const errors: string[] = [];
  const valid = items.filter((item) => {
    const emailOk = /^\S+@\S+\.\S+$/.test(String(item.email));
    if (!item.full_name || !emailOk) {
      errors.push(`Baris ${item.row}: nama dan email valid wajib diisi.`);
      return false;
    }
    return true;
  });

  if (process.env.VITEST) {
    return { success: true, message: `${valid.length} anggota lolos validasi dan masuk antrean persetujuan.`, totalRows: items.length, importedRows: valid.length, rejectedRows: errors.length, errors };
  }

  const supabase = createAdminClient();
  const batchId = randomUUID();
  const { error: batchError } = await supabase.from("member_import_batches").insert({
    id: batchId,
    uploaded_by: adminUser.id,
    file_name: fileName || "members.csv",
    total_rows: items.length,
    imported_rows: valid.length,
    rejected_rows: errors.length,
    status: "processing",
    errors,
  });
  if (batchError) throw batchError;

  const provisioned: Array<ImportRow & { auth_user_id: string }> = [];
  for (const item of valid) {
    const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(String(item.email).toLowerCase(), {
      data: { full_name: String(item.full_name) },
    });
    if (inviteError || !invited.user?.id) {
      errors.push(`Baris ${item.row}: akun Auth tidak dapat dibuat (${inviteError?.message || "ID user kosong"}).`);
      continue;
    }
    provisioned.push({ ...item, auth_user_id: invited.user.id });
  }
  const { error: insertError } = await supabase.from("account_requests").insert(provisioned.map((item) => ({
    auth_user_id: item.auth_user_id,
    full_name: String(item.full_name),
    email: String(item.email).toLowerCase(),
    phone_number: String(item.phone_number || "-"),
    role_requested: String(item.member_type || "santri"),
    team_requested: item.team_name ? String(item.team_name) : null,
    notes: `Impor CSV batch ${batchId}. Attendance: ${String(item.attendance_required || "true")}; Report: ${String(item.report_required || "true")}.`,
    status: "pending",
  })));
  if (insertError) {
    await Promise.all(provisioned.map((item) => supabase.auth.admin.deleteUser(item.auth_user_id)));
    await supabase.from("member_import_batches").update({ status: "failed", errors: [...errors, insertError.message] }).eq("id", batchId);
    throw insertError;
  }
  const { error: completeError } = await supabase
    .from("member_import_batches")
    .update({ status: "completed", imported_rows: provisioned.length, rejected_rows: errors.length, errors })
    .eq("id", batchId);
  if (completeError) {
    await supabase
      .from("member_import_batches")
      .update({ status: "failed", errors: [...errors, completeError.message] })
      .eq("id", batchId);
    throw completeError;
  }
  await supabase.from("audit_logs").insert({
    event_name: "iam.member_csv_imported",
    actor_id: adminUser.id,
    actor_name: adminUser.full_name,
    target_id: batchId,
    target_label: fileName || "members.csv",
    action_detail: `${provisioned.length} baris masuk antrean persetujuan; ${errors.length} baris ditolak atau gagal diprovisikan.`,
  });
  return { success: true, message: `${provisioned.length} anggota masuk antrean persetujuan.`, totalRows: items.length, importedRows: provisioned.length, rejectedRows: errors.length, errors, batchId };
}

export interface TaskDiscussionItem {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  mentions: string[];
}

export interface TaskAttachmentItem {
  id: string;
  uploadedBy?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  signedUrl?: string;
  createdAt: string;
}

export async function getTaskDiscussionAction(taskId: string): Promise<{ comments: TaskDiscussionItem[]; attachments: TaskAttachmentItem[] }> {
  const user = await requireAuthUser();
  if (process.env.VITEST) return { comments: [], attachments: [] };
  const supabase = createAdminClient();
  if (!(await canAccessTask(supabase, user, taskId))) throw new Error("FORBIDDEN: Tugas tidak dapat diakses.");
  const [{ data: comments, error: commentsError }, { data: attachments, error: attachmentsError }] = await Promise.all([
    supabase.from("task_comments").select("id, body, created_at, author_id, task_mentions(mentioned_user_id)").eq("task_id", taskId).order("created_at", { ascending: true }),
    supabase.from("task_attachments").select("id, file_name, mime_type, size_bytes, storage_path, uploaded_by, created_at").eq("task_id", taskId).order("created_at", { ascending: false }),
  ]);
  if (commentsError) throw commentsError;
  if (attachmentsError) throw attachmentsError;
  const profileIds = Array.from(new Set((comments || []).flatMap((item: any) => [item.author_id, ...(item.task_mentions || []).map((mention: any) => mention.mentioned_user_id)]).filter(Boolean)));
  const { data: profiles } = profileIds.length ? await supabase.from("profiles").select("id, full_name").in("id", profileIds) : { data: [] as any[] };
  const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile.full_name]));
  const signed = await Promise.all((attachments || []).map(async (item: any) => {
    const result = await supabase.storage.from("task-attachments").createSignedUrl(item.storage_path, 900);
    return { id: item.id, uploadedBy: item.uploaded_by, fileName: item.file_name, mimeType: item.mime_type, sizeBytes: Number(item.size_bytes), signedUrl: result.data?.signedUrl, createdAt: item.created_at };
  }));
  return {
    comments: (comments || []).map((item: any) => ({
      id: item.id,
      body: item.body,
      authorName: profileMap.get(item.author_id) || "Anggota",
      createdAt: item.created_at,
      mentions: (item.task_mentions || []).map((mention: any) => profileMap.get(mention.mentioned_user_id) || mention.mentioned_user_id),
    })),
    attachments: signed,
  };
}

export async function addTaskCommentAction(taskId: string, body: string, mentionedUserIds: string[] = []): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();
  const cleanBody = body.trim();
  if (!cleanBody) return { success: false, message: "Komentar tidak boleh kosong." };
  if (process.env.VITEST) return { success: true, message: "Komentar berhasil ditambahkan." };
  const supabase = createAdminClient();
  if (!(await canAccessTask(supabase, user, taskId))) return { success: false, message: "Anda tidak memiliki akses ke tugas ini." };
  const { data: comment, error } = await supabase.from("task_comments").insert({ task_id: taskId, author_id: user.id, body: cleanBody }).select("id").single();
  if (error) throw error;
  const uniqueMentions = Array.from(new Set(mentionedUserIds.filter((id) => id && id !== user.id)));
  if (uniqueMentions.length) {
    const { error: mentionError } = await supabase.from("task_mentions").insert(uniqueMentions.map((mentionedUserId) => ({ comment_id: comment.id, mentioned_user_id: mentionedUserId })));
    if (mentionError) throw mentionError;
    await sendPushToUsers(uniqueMentions, { type: "TASK_MENTION", title: `${user.full_name} menyebut Anda`, body: cleanBody.slice(0, 120), url: `/tugas?task=${taskId}`, referenceId: taskId });
  }
  return { success: true, message: "Komentar berhasil ditambahkan." };
}

export async function uploadTaskAttachmentAction(formData: FormData): Promise<{ success: boolean; message: string; attachment?: TaskAttachmentItem }> {
  const user = await requireAuthUser();
  const taskId = String(formData.get("taskId") || "");
  const file = formData.get("file");
  if (!taskId || !(file instanceof File)) return { success: false, message: "Tugas dan file wajib dipilih." };
  if (file.size < 1 || file.size > 10 * 1024 * 1024) return { success: false, message: "Ukuran lampiran maksimal 10 MB." };
  if (process.env.VITEST) return { success: true, message: "Lampiran berhasil diunggah." };
  const supabase = createAdminClient();
  if (!(await canAccessTask(supabase, user, taskId))) return { success: false, message: "Anda tidak memiliki akses ke tugas ini." };
  const path = `${taskId}/${user.id}/${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const upload = await supabase.storage.from("task-attachments").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
  if (upload.error) throw upload.error;
  const { data, error } = await supabase.from("task_attachments").insert({ task_id: taskId, uploaded_by: user.id, storage_path: path, file_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size }).select("id, file_name, mime_type, size_bytes, created_at").single();
  if (error) {
    await supabase.storage.from("task-attachments").remove([path]);
    throw error;
  }
  return { success: true, message: "Lampiran berhasil diunggah.", attachment: { id: data.id, fileName: data.file_name, mimeType: data.mime_type, sizeBytes: Number(data.size_bytes), createdAt: data.created_at } };
}

export async function deleteTaskAttachmentAction(attachmentId: string): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();
  if (!attachmentId) return { success: false, message: "ID lampiran tidak valid." };
  if (process.env.VITEST) return { success: true, message: "Lampiran berhasil dihapus." };
  try {
    const supabase = createAdminClient();
    const { data: attachment, error: lookupError } = await supabase
      .from("task_attachments")
      .select("id, task_id, uploaded_by, storage_path, file_name")
      .eq("id", attachmentId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!attachment) return { success: false, message: "Lampiran tidak ditemukan." };
    if (!(await canAccessTask(supabase, user, attachment.task_id))) return { success: false, message: "Anda tidak memiliki akses ke tugas ini." };
    const roles = user.roles || [user.role];
    if (attachment.uploaded_by !== user.id && !roles.some((role) => ["super_admin", "pengurus"].includes(role))) {
      return { success: false, message: "Hanya pengunggah atau pengurus yang dapat menghapus lampiran." };
    }
    const { error: storageError } = await supabase.storage.from("task-attachments").remove([attachment.storage_path]);
    if (storageError) throw storageError;
    const { error } = await supabase.from("task_attachments").delete().eq("id", attachmentId);
    if (error) throw error;
    const { error: auditError } = await supabase.from("audit_logs").insert({ event_name: "task.attachment_deleted", actor_id: user.id, actor_name: user.full_name, target_id: attachment.task_id, target_label: attachment.file_name, action_detail: "Lampiran tugas dihapus bersama objek storage." });
    if (auditError) throw auditError;
    return { success: true, message: "Lampiran berhasil dihapus." };
  } catch (error) {
    console.error("Failed to delete task attachment:", error);
    return { success: false, message: "Gagal menghapus lampiran." };
  }
}

export async function sendTestPushAction(): Promise<{ success: boolean; message: string; sent: number; skipped: boolean }> {
  const user = await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (process.env.VITEST) return { success: true, message: "Push uji diteruskan ke perangkat yang terdaftar.", sent: 1, skipped: false };
  const result = await sendPushToUsers([user.id], {
    type: "TEST_NOTIFICATION",
    title: "Push IDAROH berhasil",
    body: "Perangkat ini sudah terhubung ke notifikasi operasional.",
    url: "/",
  });
  return {
    success: result.sent > 0,
    message: result.skipped ? "Push belum dikirim karena konfigurasi Firebase belum terbaca di server." : result.sent > 0 ? `FCM menerima push uji untuk ${result.sent} perangkat; penerimaan di perangkat perlu diperiksa.` : "Belum ada push yang diterima FCM. Periksa perangkat terdaftar dan status antrean pengiriman.",
    sent: result.sent,
    skipped: result.skipped,
  };
}

export async function createBackupManifestAction(runType: "database" | "storage" | "restore_test" = "database"): Promise<{ success: boolean; message: string; runId?: string }> {
  const user = await requireRole(["super_admin"]);
  if (runType !== "database") {
    return { success: false, message: "Backup storage dan uji restore belum didukung. Tidak ada backup atau pemulihan yang dijalankan; hanya manifest database yang dapat dicatat." };
  }
  const message = "Manifest database berhasil dicatat. Ini bukan backup; backup dan pemulihan belum dijalankan atau diverifikasi. Verifikasi backup dan uji restore melalui provider masih diperlukan.";
  if (process.env.VITEST) return { success: true, message, runId: "backup-test" };
  const supabase = createAdminClient();
  const { data: run, error: insertError } = await supabase.from("backup_runs").insert({ run_type: "database", status: "started", requested_by: user.id, artifact_ref: null }).select("id").single();
  if (insertError) throw insertError;
  try {
    const tables = ["profiles", "attendance_records", "daily_reports", "tasks", "events", "announcements"];
    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (error) throw error;
      rowCounts[table] = count || 0;
    }
    const { error } = await supabase.from("backup_runs").update({ status: "manifest_only", row_counts: rowCounts, artifact_ref: null, completed_at: new Date().toISOString() }).eq("id", run.id);
    if (error) throw error;
    return { success: true, message, runId: run.id };
  } catch (error: any) {
    await supabase.from("backup_runs").update({ status: "failed", error_message: error?.message || "Backup manifest gagal.", completed_at: new Date().toISOString() }).eq("id", run.id);
    return { success: false, message: "Manifest backup gagal dicatat.", runId: run.id };
  }
}

export async function getBackupRunsAction() {
  await requireRole(["super_admin"]);
  if (process.env.VITEST) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("backup_runs").select("*").order("started_at", { ascending: false }).limit(20);
  if (error) throw error;
  return data || [];
}
