import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/guards";
import { buildPdf } from "@/lib/pdf";
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

type RangeCapable<T> = {
  gte: (column: string, value: string) => T;
  lte: (column: string, value: string) => T;
  lt: (column: string, value: string) => T;
};

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
    if (filters.dateFrom) query = query.gte(column, filters.dateFrom);
    if (filters.dateTo) query = query.lte(column, filters.dateTo);
    return query;
  }
  const range = wibDateRange(filters);
  if (!range) return query;
  return query.gte(column, range.startIso).lt(column, range.endExclusiveIso);
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

    let headers: string[] = ["id", "created_at"];
    let rows: unknown[][] = [];
    if (log.category === "presensi_laporan") {
      headers = ["record_type", "id", "user_id", "date", "status", "review_status"];
      const attendanceQuery = withDateRange(
        supabase
          .from("attendance_records")
          .select("id,user_id,attendance_date,classification"),
        "attendance_date",
        "date",
        filters,
      ).order("attendance_date", { ascending: false });
      const result = await attendanceQuery;
      if (result.error) throw result.error;
      rows = (result.data || []).map((row: Record<string, unknown>) => ["attendance", row.id, row.user_id, row.attendance_date, row.classification, ""]);
      const reportQuery = withDateRange(
        supabase
          .from("daily_reports")
          .select("id,user_id,report_date,submission_status,review_status"),
        "report_date",
        "date",
        filters,
      ).order("report_date", { ascending: false });
      const reportResult = await reportQuery;
      if (reportResult.error) throw reportResult.error;
      rows = rows.concat((reportResult.data || []).map((row: Record<string, unknown>) => ["report", row.id, row.user_id, row.report_date, row.submission_status, row.review_status]));
    } else if (log.category === "presensi") {
      headers = ["id", "user_id", "attendance_date", "checked_in_at", "classification"];
      const result = await withDateRange(
        supabase.from("attendance_records").select(headers.join(",")),
        "attendance_date",
        "date",
        filters,
      ).order("attendance_date", { ascending: false });
      if (result.error) throw result.error;
      rows = (result.data || []).map((row: Record<string, unknown>) => headers.map((header) => row[header]));
    } else if (log.category === "laporan") {
      headers = ["id", "user_id", "report_date", "submission_status", "review_status", "is_late"];
      const result = await withDateRange(
        supabase.from("daily_reports").select(headers.join(",")),
        "report_date",
        "date",
        filters,
      ).order("report_date", { ascending: false });
      if (result.error) throw result.error;
      rows = (result.data || []).map((row: Record<string, unknown>) => headers.map((header) => row[header]));
    } else if (log.category === "tugas" || log.category === "tugas_proyek") {
      headers = ["id", "title", "status", "priority", "due_date", "created_by"];
      const result = await withDateRange(
        supabase.from("tasks").select(headers.join(",")).is("deleted_at", null),
        "created_at",
        "timestamp",
        filters,
      ).order("created_at", { ascending: false });
      if (result.error) throw result.error;
      rows = (result.data || []).map((row: Record<string, unknown>) => headers.map((header) => row[header]));
    } else if (log.category === "users") {
      headers = ["id", "email", "full_name", "status", "member_type", "team_name", "created_at"];
      const result = await withDateRange(
        supabase.from("profiles").select(headers.join(",")),
        "created_at",
        "timestamp",
        filters,
      ).order("created_at", { ascending: false });
      if (result.error) throw result.error;
      rows = (result.data || []).map((row: Record<string, unknown>) => headers.map((header) => row[header]));
    } else {
      const result = await withDateRange(
        supabase
          .from("audit_logs")
          .select("id,event_name,actor_id,target_id,created_at"),
        "created_at",
        "timestamp",
        filters,
      ).order("created_at", { ascending: false }).limit(500);
      if (result.error) throw result.error;
      headers = ["id", "event_name", "actor_id", "target_id", "created_at"];
      rows = (result.data || []).map((row: Record<string, unknown>) => headers.map((header) => row[header]));
    }

    const title = `Pondok OS - Ekspor ${log.category}`;
    const { error: rowCountError } = await supabase.from("export_logs").update({ row_count: rows.length }).eq("id", id);
    if (rowCountError) throw rowCountError;
    if (exportType === "pdf") {
      const lines = [headers.join(" | "), ...rows.map((row) => row.map((value) => String(value ?? "")).join(" | "))];
      return new Response(Buffer.from(await buildPdf(title, lines)), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="pondok-os-${log.category}.pdf"`,
        },
      });
    }
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pondok-os-${log.category}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export download failed:", error);
    return NextResponse.json({ error: "Gagal menghasilkan ekspor." }, { status: 500 });
  }
}
