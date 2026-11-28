import type { ReadOnlyDb } from "@/lib/db/reader";

export type DrilldownMetric = "attendance_late" | "reports_backlog" | "tasks_overdue";
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
  if (metric === "attendance_late") {
    let query = db.selectFrom("attendance_records").select(["id", "user_id", "attendance_date", "classification"]).where("classification", "=", "late").where("attendance_date", ">=", from).where("attendance_date", "<=", to);
    if (scope) query = query.where("user_id", "in", [...scope.userIds]);
    const rows = await query.orderBy("attendance_date", "asc").execute();
    const names = await profileNames(db, rows.map((row) => row.user_id));
    return rows.map((row) => ({ id: row.id, label: names.get(row.user_id) ?? "Anggota", detail: "Presensi melewati batas toleransi", date: row.attendance_date, status: row.classification }));
  }
  if (metric === "reports_backlog") {
    let query = db.selectFrom("daily_reports").select(["id", "user_id", "report_date", "review_status"]).where("submission_status", "=", "submitted").where("review_status", "in", ["not_reviewed", "under_review"]).where("report_date", ">=", from).where("report_date", "<=", to);
    if (scope) query = query.where("user_id", "in", [...scope.userIds]);
    const rows = await query.orderBy("report_date", "asc").execute();
    const names = await profileNames(db, rows.map((row) => row.user_id));
    return rows.map((row) => ({ id: row.id, label: names.get(row.user_id) ?? "Anggota", detail: "Laporan menunggu review", date: row.report_date, status: row.review_status }));
  }
  let query = db.selectFrom("tasks").select(["id", "title", "due_date", "status", "created_by"]).where("deleted_at", "is", null).where("status", "in", ["todo", "in_progress", "in_review"]).where("due_date", "<", to);
  if (scope) {
    query = query.where((expression) => expression.or([
      expression("created_by", "in", [...scope.userIds]),
      ...(scope.teamIds.length ? [expression("team_id", "in", scope.teamIds)] : []),
    ]));
  }
  const rows = await query.orderBy("due_date", "asc").execute();
  return rows.map((row) => ({ id: row.id, label: row.title, detail: "Tugas terbuka melewati tenggat", date: row.due_date ?? "-", status: row.status }));
}
