import { sql } from "kysely";
import { countInt } from "@/lib/db/expressions";
import type { ReadOnlyDb } from "@/lib/db/reader";
import { wibDateString } from "@/lib/time/wib";

export interface TelemetryDay {
  date: string;
  present: number;
  grace: number;
  late: number;
  excused: number;
  sick: number;
  noCheckin: number;
  reportsSubmitted: number;
  reportsExpected: number;
  tasksCompleted: number;
}

export interface LiveTelemetry {
  timezone: "Asia/Jakarta";
  today: string;
  attendanceToday: {
    population: number;
    present: number;
    grace: number;
    late: number;
    excused: number;
    sick: number;
    noCheckin: number;
  };
  reports: {
    expectedToday: number;
    submittedToday: number;
    lateToday: number;
    reviewBacklog: number;
    compliance7Days: number;
    compliance30Days: number;
  };
  tasks: {
    open: number;
    completed7Days: number;
    completed30Days: number;
  };
  attendanceTrend: TelemetryDay[];
  attendanceTrend7Days: TelemetryDay[];
}

const asNumber = (value: unknown) => Number(value ?? 0);

function isoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

function dateDaysAgo(today: string, days: number) {
  const date = new Date(`${today}T00:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() - days);
  return isoDate(date);
}

export function toDateKey(value: unknown): string {
  if (value instanceof Date) return wibDateString(value);
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}

export async function fetchLiveTelemetry(db: ReadOnlyDb, today: string): Promise<LiveTelemetry> {
  const from30 = dateDaysAgo(today, 29);
  const from7 = dateDaysAgo(today, 6);
  const tomorrow = dateDaysAgo(today, -1);

  const [population, attendanceToday, exceptionsToday, reportsToday, reports7, reports30, reviewBacklog, openTasks, completed7, completed30, attendanceTrend, reportTrend, taskTrend] = await Promise.all([
    db.selectFrom("profiles").where("status", "=", "active").where("member_type", "=", "santri").select(countInt().as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("attendance_records").where("attendance_date", "=", today).select([
      "classification",
      countInt().as("count"),
    ]).groupBy("classification").execute(),
    db.selectFrom("attendance_exceptions").where("status", "=", "approved").where("date_from", "<=", today).where("date_to", ">=", today).select([
      "type",
      countInt().as("count"),
    ]).groupBy("type").execute(),
    db.selectFrom("daily_reports").where("report_date", "=", today).select([
      "submission_status",
      "is_late",
      countInt().as("count"),
    ]).groupBy(["submission_status", "is_late"]).execute(),
    db.selectFrom("daily_reports").where("report_date", ">=", from7).where("report_date", "<=", today).where("submission_status", "=", "submitted").select(countInt().as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("daily_reports").where("report_date", ">=", from30).where("report_date", "<=", today).where("submission_status", "=", "submitted").select(countInt().as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("daily_reports").where("submission_status", "=", "submitted").where("review_status", "in", ["not_reviewed", "under_review"]).select(countInt().as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("tasks").where("deleted_at", "is", null).where("status", "in", ["todo", "in_progress", "in_review"]).select(countInt().as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("tasks").where("deleted_at", "is", null).where("status", "=", "done").where("completed_at", ">=", `${from7}T00:00:00+07:00`).where("completed_at", "<", `${tomorrow}T00:00:00+07:00`).select(countInt().as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("tasks").where("deleted_at", "is", null).where("status", "=", "done").where("completed_at", ">=", `${from30}T00:00:00+07:00`).where("completed_at", "<", `${tomorrow}T00:00:00+07:00`).select(countInt().as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("attendance_records").where("attendance_date", ">=", from30).where("attendance_date", "<=", today).select([
      sql<string>`to_char(${sql.ref("attendance_date")}, 'YYYY-MM-DD')`.as("attendance_date"),
      "classification",
      countInt().as("count"),
    ]).groupBy(["attendance_date", "classification"]).execute(),
    db.selectFrom("daily_reports").where("report_date", ">=", from30).where("report_date", "<=", today).where("submission_status", "=", "submitted").select([
      sql<string>`to_char(${sql.ref("report_date")}, 'YYYY-MM-DD')`.as("report_date"),
      countInt().as("count"),
    ]).groupBy(sql<string>`to_char(${sql.ref("report_date")}, 'YYYY-MM-DD')`).execute(),
    db.selectFrom("tasks").where("deleted_at", "is", null).where("status", "=", "done").where("completed_at", ">=", `${from30}T00:00:00+07:00`).select([
      sql<string>`to_char(${sql.ref("completed_at")} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`.as("date"),
      countInt().as("count"),
    ]).groupBy(sql<string>`to_char(${sql.ref("completed_at")} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`).execute(),
  ]);

  const attendance = new Map<string, number>();
  for (const row of attendanceToday) attendance.set(row.classification, asNumber(row.count));
  const exceptions = new Map<string, number>();
  for (const row of exceptionsToday) exceptions.set(row.type, asNumber(row.count));
  const totalPopulation = asNumber(population.count);
  const checkedIn = ["on_time", "grace", "late"].reduce((sum, key) => sum + (attendance.get(key) ?? 0), 0);

  const trend = new Map<string, TelemetryDay>();
  for (let index = 0; index < 30; index += 1) {
    const date = dateDaysAgo(today, 29 - index);
    trend.set(date, { date, present: 0, grace: 0, late: 0, excused: 0, sick: 0, noCheckin: 0, reportsSubmitted: 0, reportsExpected: totalPopulation, tasksCompleted: 0 });
  }
  for (const row of attendanceTrend) {
    const day = trend.get(toDateKey(row.attendance_date));
    if (!day) continue;
    if (row.classification === "on_time") day.present += asNumber(row.count);
    if (row.classification === "grace") day.grace += asNumber(row.count);
    if (row.classification === "late") day.late += asNumber(row.count);
  }
  for (const row of reportTrend) {
    const day = trend.get(toDateKey(row.report_date));
    if (day) day.reportsSubmitted = asNumber(row.count);
  }
  for (const row of taskTrend) {
    const day = trend.get(toDateKey(row.date));
    if (day) day.tasksCompleted = asNumber(row.count);
  }
  for (const day of trend.values()) day.noCheckin = Math.max(0, day.reportsExpected - day.present - day.grace - day.late - day.excused - day.sick);

  const reportsSubmittedToday = reportsToday.filter((row) => row.submission_status === "submitted").reduce((sum, row) => sum + asNumber(row.count), 0);
  const reportsLateToday = reportsToday.filter((row) => row.submission_status === "submitted" && row.is_late).reduce((sum, row) => sum + asNumber(row.count), 0);
  return {
    timezone: "Asia/Jakarta",
    today,
    attendanceToday: {
      population: totalPopulation,
      present: attendance.get("on_time") ?? 0,
      grace: attendance.get("grace") ?? 0,
      late: attendance.get("late") ?? 0,
      excused: exceptions.get("excused") ?? 0,
      sick: exceptions.get("sick") ?? 0,
      noCheckin: Math.max(0, totalPopulation - checkedIn - (exceptions.get("excused") ?? 0) - (exceptions.get("sick") ?? 0)),
    },
    reports: {
      expectedToday: totalPopulation,
      submittedToday: reportsSubmittedToday,
      lateToday: reportsLateToday,
      reviewBacklog: asNumber(reviewBacklog.count),
      compliance7Days: asNumber(reports7.count),
      compliance30Days: asNumber(reports30.count),
    },
    tasks: {
      open: asNumber(openTasks.count),
      completed7Days: asNumber(completed7.count),
      completed30Days: asNumber(completed30.count),
    },
    attendanceTrend: [...trend.values()],
    attendanceTrend7Days: [...trend.values()].slice(-7),
  };
}
