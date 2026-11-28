import type { ReadOnlyDb } from "@/lib/db/reader";

export type DrilldownMetric =
  | "attendance_on_time" | "attendance_grace" | "attendance_late" | "attendance_no_checkin"
  | "reports_submitted" | "reports_late" | "reports_backlog"
  | "tasks_open" | "tasks_completed" | "tasks_overdue";
export interface DrilldownRow { id: string; label: string; detail: string; date: string; status: string }

async function scopedMembership(db: ReadOnlyDb, userId: string, isCoordinator: boolean): Promise<{ userIds: Set<string>; teamIds: string[] } | null> {
  if (!isCoordinator) return null;
  const ownTeams = await db.selectFrom("team_members").select("team_id").where("user_id", "=", userId).where("valid_to", "is", null).execute();
  const teamIds = ownTeams.map((row) => row.team_id);
  if (!teamIds.length) return { userIds: new Set([userId]), teamIds: [] };
  const members = await db.selectFrom("team_members").select("user_id").where("team_id", "in", teamIds).where("valid_to", "is", null).execute();
  return { userIds: new Set(members.map((row) => row.user_id)), teamIds };
}

async function profileNames(db: ReadOnlyDb, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.selectFrom("profiles").select(["id", "full_name"]).where("id", "in", ids).execute();
  return new Map(rows.map((row) => [row.id, row.full_name]));
}

export async function fetchAnalyticsDrilldown(db: ReadOnlyDb, metric: DrilldownMetric, from: string, to: string, userId: string, isCoordinator: boolean): Promise<DrilldownRow[]> {
  const scope = await scopedMembership(db, userId, isCoordinator);
  if (["attendance_on_time", "attendance_grace", "attendance_late"].includes(metric)) {
    const classification = metric.replace("attendance_", "") as "on_time" | "grace" | "late";
    let query = db.selectFrom("attendance_records").select(["id", "user_id", "attendance_date", "checked_in_at", "classification"]).where("classification", "=", classification).where("attendance_date", ">=", from).where("attendance_date", "<=", to);
    if (scope) query = query.where("user_id", "in", [...scope.userIds]);
    const rows = await query.orderBy("attendance_date", "asc").execute();
    const names = await profileNames(db, rows.map((row) => row.user_id));
    return rows.map((row) => ({ id: row.id, label: names.get(row.user_id) ?? "Anggota", detail: `Check-in WIB ${new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(row.checked_in_at))}`, date: row.attendance_date, status: row.classification }));
  }
  if (metric === "attendance_no_checkin") {
    const profiles = await db.selectFrom("profiles").select(["id", "full_name"]).where("status", "=", "active").execute();
    const exceptions = await db.selectFrom("attendance_exceptions").select(["user_id", "date_from", "date_to"]).where("status", "=", "approved").where("date_from", "<=", to).where("date_to", ">=", from).execute();
    const checked = await db.selectFrom("attendance_records").select(["user_id", "attendance_date"]).where("attendance_date", ">=", from).where("attendance_date", "<=", to).execute();
    const checkedKeys = new Set(checked.map((row) => `${row.user_id}:${row.attendance_date}`));
    return profiles.flatMap((profile) => {
      const rows: DrilldownRow[] = [];
      for (const date = new Date(`${from}T12:00:00+07:00`); date <= new Date(`${to}T12:00:00+07:00`); date.setDate(date.getDate() + 1)) {
        const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
        const excluded = exceptions.some((item) => item.user_id === profile.id && item.date_from <= dateKey && item.date_to >= dateKey);
        if (!excluded && date.getDay() !== 0 && !checkedKeys.has(`${profile.id}:${dateKey}`)) rows.push({ id: `${profile.id}:${dateKey}`, label: profile.full_name, detail: "Tidak ada pengecualian presensi disetujui", date: dateKey, status: "Belum check-in" });
      }
      return rows;
    });
  }
  if (["reports_submitted", "reports_late", "reports_backlog"].includes(metric)) {
    let query = db.selectFrom("daily_reports").select(["id", "user_id", "report_date", "submission_status", "is_late", "review_status"]).where("report_date", ">=", from).where("report_date", "<=", to);
    if (metric === "reports_submitted") query = query.where("submission_status", "=", "submitted");
    if (metric === "reports_late") query = query.where("is_late", "=", true);
    if (metric === "reports_backlog") query = query.where("submission_status", "=", "submitted").where("review_status", "in", ["not_reviewed", "under_review"]);
    if (scope) query = query.where("user_id", "in", [...scope.userIds]);
    const rows = await query.orderBy("report_date", "asc").execute();
    const names = await profileNames(db, rows.map((row) => row.user_id));
    return rows.map((row) => ({ id: row.id, label: names.get(row.user_id) ?? "Anggota", detail: metric === "reports_backlog" ? "Laporan menunggu review" : "Laporan harian", date: row.report_date, status: metric === "reports_backlog" ? row.review_status : row.submission_status }));
  }
  let query = db.selectFrom("tasks").select(["id", "title", "due_date", "status", "created_by", "team_id"]).where("deleted_at", "is", null);
  if (metric === "tasks_open") query = query.where("status", "in", ["todo", "in_progress", "in_review"]);
  if (metric === "tasks_completed") query = query.where("status", "=", "done").where("due_date", ">=", from).where("due_date", "<=", to);
  if (metric === "tasks_overdue") query = query.where("status", "in", ["todo", "in_progress", "in_review"]).where("due_date", "<", to);
  if (scope) {
    query = query.where((expression) => expression.or([
      expression("created_by", "in", [...scope.userIds]),
      ...(scope.teamIds.length ? [expression("team_id", "in", scope.teamIds)] : []),
    ]));
  }
  const rows = await query.orderBy("due_date", "asc").execute();
  return rows.map((row) => ({ id: row.id, label: row.title, detail: metric === "tasks_overdue" ? "Tugas terbuka melewati tenggat" : "Tugas operasional", date: row.due_date ?? "-", status: row.status }));
}
