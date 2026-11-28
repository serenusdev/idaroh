import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/guards";
import { buildPdf } from "@/lib/pdf";
import { jsonText, jsonTextOrNull } from "@/lib/db/expressions";
import { getReadOnlyDb } from "@/lib/db/reader";
import {
  EXPORT_ROLES,
  exportRolesFor,
  holdsRole,
  isExportCategory,
  parseStoredExportFilters,
  wibDateRange,
  type ExportFileFormat,
  type ResolvedExportFilters,
} from "@/lib/export-policy";

export const dynamic = "force-dynamic";

/**
 * DX-01 — the dataset reads run on the typed read-only reader. The export_logs lookup and the
 * row_count write below stay on the audited service-role path.
 */
type RangeCapable<T> = {
  where(column: string, operator: ">=" | "<=" | "<", value: string): T;
};

/**
 * PostgREST silently capped every read at the project's db-max-rows (1000). A raw SELECT has no such
 * ceiling, so the bound moves here rather than turning an export into an unbounded table dump.
 */
const EXPORT_ROW_CAP = 1000;
const AUDIT_ROW_CAP = 500;

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Every dataset is narrowed by the filters stored with the export request
 * (PERMISSIONS.md §3.8). A date column takes calendar values; a timestamp
 * column takes WIB day boundaries so the operational day is not split by UTC.
 */
function withDateRange<T extends RangeCapable<T>>(
  query: T,
  column: string,
  kind: "date" | "timestamp",
  filters: ResolvedExportFilters,
): T {
  if (kind === "date") {
    if (filters.dateFrom) query = query.where(column, ">=", filters.dateFrom);
    if (filters.dateTo) query = query.where(column, "<=", filters.dateTo);
    return query;
  }
  const range = wibDateRange(filters);
  if (!range) return query;
  return query.where(column, ">=", range.startIso).where(column, "<", range.endExclusiveIso);
}

function guardFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/^UNAUTHORIZED:/.test(message)) {
    return NextResponse.json({ error: "Sesi Anda tidak valid. Silakan masuk kembali." }, { status: 401 });
  }
  return NextResponse.json({ error: "Anda tidak memiliki izin ekspor data." }, { status: 403 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ exportId: string }> },
) {
  let user;
  try {
    user = await requireRole([...EXPORT_ROLES]);
  } catch (error) {
    return guardFailure(error);
  }

  try {
    const { exportId } = await params;
    const exportType: ExportFileFormat = new URL(request.url).pathname.endsWith(".pdf")
      ? "pdf"
      : "csv";
    const id = exportId.replace(/\.(csv|pdf)$/i, "");
    const supabase = createAdminClient();
    const { data: log, error: logError } = await supabase
      .from("export_logs")
      .select("id, user_id, category, export_type, filter_criteria")
      .eq("id", id)
      .maybeSingle();
    if (logError) throw logError;
    // An export id is only materializable by the admin who requested it; no
    // role, super_admin included, may download another admin's dataset.
    if (!log || log.user_id !== user.id) {
      return NextResponse.json({ error: "Ekspor tidak ditemukan atau tidak diizinkan." }, { status: 404 });
    }
    if (!isExportCategory(log.category)) {
      return NextResponse.json({ error: "Kategori ekspor tidak dikenal." }, { status: 400 });
    }
    if (log.export_type !== exportType) {
      return NextResponse.json(
        { error: "Format berkas berbeda dari permintaan ekspor yang tercatat." },
        { status: 400 },
      );
    }
    if (!holdsRole(user, exportRolesFor(log.category))) {
      return NextResponse.json({ error: "Anda tidak memiliki izin untuk kategori ekspor ini." }, { status: 403 });
    }
    const filters = parseStoredExportFilters(log.filter_criteria);
    if (!filters) {
      return NextResponse.json({ error: "Filter ekspor tersimpan tidak valid." }, { status: 400 });
    }

    const db = getReadOnlyDb();
    let headers: string[] = ["id", "created_at"];
    let rows: unknown[][] = [];
    // Timestamp and date columns are rendered by Postgres (jsonText), so the CSV keeps the exact text
    // PostgREST produced instead of a JS Date string. Each row is mapped field by field: a header that
    // no longer matches the select list is a compile error, not an empty column.
    if (log.category === "presensi_laporan") {
      headers = ["record_type", "id", "user_id", "date", "status", "review_status"];
      const attendance = await withDateRange(
        db
          .selectFrom("attendance_records")
          .select([
            "id",
            "user_id",
            jsonText("attendance_records.attendance_date").as("attendance_date"),
            "classification",
          ]),
        "attendance_date",
        "date",
        filters,
      )
        .orderBy("attendance_date", "desc")
        .limit(EXPORT_ROW_CAP)
        .execute();
      rows = attendance.map((row) => ["attendance", row.id, row.user_id, row.attendance_date, row.classification, ""]);
      const reports = await withDateRange(
        db
          .selectFrom("daily_reports")
          .select([
            "id",
            "user_id",
            jsonText("daily_reports.report_date").as("report_date"),
            "submission_status",
            "review_status",
          ]),
        "report_date",
        "date",
        filters,
      )
        .orderBy("report_date", "desc")
        .limit(EXPORT_ROW_CAP)
        .execute();
      rows = rows.concat(reports.map((row) => ["report", row.id, row.user_id, row.report_date, row.submission_status, row.review_status]));
    } else if (log.category === "presensi") {
      headers = ["id", "user_id", "attendance_date", "checked_in_at", "classification"];
      const result = await withDateRange(
        db.selectFrom("attendance_records").select([
          "id",
          "user_id",
          jsonText("attendance_records.attendance_date").as("attendance_date"),
          jsonText("attendance_records.checked_in_at").as("checked_in_at"),
          "classification",
        ]),
        "attendance_date",
        "date",
        filters,
      )
        .orderBy("attendance_date", "desc")
        .limit(EXPORT_ROW_CAP)
        .execute();
      rows = result.map((row) => [row.id, row.user_id, row.attendance_date, row.checked_in_at, row.classification]);
    } else if (log.category === "laporan") {
      headers = ["id", "user_id", "report_date", "submission_status", "review_status", "is_late"];
      const result = await withDateRange(
        db.selectFrom("daily_reports").select([
          "id",
          "user_id",
          jsonText("daily_reports.report_date").as("report_date"),
          "submission_status",
          "review_status",
          "is_late",
        ]),
        "report_date",
        "date",
        filters,
      )
        .orderBy("report_date", "desc")
        .limit(EXPORT_ROW_CAP)
        .execute();
      rows = result.map((row) => [row.id, row.user_id, row.report_date, row.submission_status, row.review_status, row.is_late]);
    } else if (log.category === "tugas" || log.category === "tugas_proyek") {
      headers = ["id", "title", "status", "priority", "due_date", "created_by"];
      const result = await withDateRange(
        db
          .selectFrom("tasks")
          .select([
            "id",
            "title",
            "status",
            "priority",
            jsonTextOrNull("tasks.due_date").as("due_date"),
            "created_by",
          ])
          .where("deleted_at", "is", null),
        "created_at",
        "timestamp",
        filters,
      )
        .orderBy("created_at", "desc")
        .limit(EXPORT_ROW_CAP)
        .execute();
      rows = result.map((row) => [row.id, row.title, row.status, row.priority, row.due_date, row.created_by]);
    } else if (log.category === "users") {
      headers = ["id", "email", "full_name", "status", "member_type", "team_name", "created_at"];
      const result = await withDateRange(
        db.selectFrom("profiles").select([
          "id",
          "email",
          "full_name",
          "status",
          "member_type",
          "team_name",
          jsonText("profiles.created_at").as("created_at"),
        ]),
        "created_at",
        "timestamp",
        filters,
      )
        .orderBy("created_at", "desc")
        .limit(EXPORT_ROW_CAP)
        .execute();
      rows = result.map((row) => [row.id, row.email, row.full_name, row.status, row.member_type, row.team_name, row.created_at]);
    } else {
      headers = ["id", "event_name", "actor_id", "target_id", "created_at"];
      const result = await withDateRange(
        db.selectFrom("audit_logs").select([
          "id",
          "event_name",
          "actor_id",
          "target_id",
          jsonText("audit_logs.created_at").as("created_at"),
        ]),
        "created_at",
        "timestamp",
        filters,
      )
        .orderBy("created_at", "desc")
        .limit(AUDIT_ROW_CAP)
        .execute();
      rows = result.map((row) => [row.id, row.event_name, row.actor_id, row.target_id, row.created_at]);
    }

    const title = `IDAROH - Ekspor ${log.category}`;
    const { error: rowCountError } = await supabase.from("export_logs").update({ row_count: rows.length }).eq("id", id);
    if (rowCountError) throw rowCountError;
    if (exportType === "pdf") {
      const lines = [headers.join(" | "), ...rows.map((row) => row.map((value) => String(value ?? "")).join(" | "))];
      return new Response(Buffer.from(await buildPdf(title, lines)), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="idaroh-${log.category}.pdf"`,
        },
      });
    }
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="idaroh-${log.category}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export download failed:", error);
    return NextResponse.json({ error: "Gagal menghasilkan ekspor." }, { status: 500 });
  }
}
