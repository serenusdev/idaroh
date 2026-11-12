import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || !provided) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (request.method !== "GET") return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET" } });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createAdminClient();
  const { data: run, error: startError } = await supabase.from("backup_runs").insert({ run_type: "database", status: "started", artifact_ref: null }).select("id").single();
  if (startError) return NextResponse.json({ error: "Backup run could not be started" }, { status: 500 });
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
    return NextResponse.json({ success: true, runId: run.id, status: "manifest_only", artifactRef: null, rowCounts, note: "Database metadata manifest only, not a backup. No database/storage backup or restore was executed or verified. Provider backup and restore verification is still required." });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Backup manifest failed";
    await supabase.from("backup_runs").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ error: "Backup manifest failed" }, { status: 500 });
  }
}
