import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getJakartaTime } from "@/lib/auth/guards";
import { isCronJobDue } from "@/lib/cron-schedule";
import { timingSafeEqual } from "node:crypto";
import { storageAdapter } from "@/lib/storage/gdrive";
import { BACKUP_TABLES, buildBackupFiles, verifyBackupArtifactStructure } from "@/lib/backup-artifact";

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
  const jakarta = getJakartaTime();
  const { data: schedule, error: scheduleError } = await supabase
    .from("cron_job_schedules")
    .select("time_wib, days_of_week, enabled")
    .eq("job_key", "backup_manifest")
    .maybeSingle();
  if (scheduleError) return NextResponse.json({ error: "Backup schedule could not be read" }, { status: 500 });
  if (!schedule || !isCronJobDue({ timeWib: schedule.time_wib, daysOfWeek: schedule.days_of_week, enabled: schedule.enabled }, jakarta)) {
    return NextResponse.json({ success: true, skipped: true, reason: "not_scheduled" });
  }
  const jobKey = `backup:${jakarta.dateStr}`;
  const { data: claim, error: claimError } = await supabase.from("cron_job_runs").insert({ job_key: jobKey }).select("job_key").maybeSingle();
  if (claimError && claimError.code !== "23505") return NextResponse.json({ error: "Backup job could not be claimed" }, { status: 500 });
  if (!claim?.job_key) return NextResponse.json({ success: true, skipped: true, reason: "already_processed" });
  const { data: run, error: startError } = await supabase.from("backup_runs").insert({ run_type: "database", status: "started", artifact_ref: null }).select("id").single();
  if (startError) {
    await supabase.from("cron_job_runs").update({ status: "failed", error_message: "Backup run could not be started", completed_at: new Date().toISOString() }).eq("job_key", jobKey);
    return NextResponse.json({ error: "Backup run could not be started" }, { status: 500 });
  }
  try {
    const rowsByTable: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from(table).select("*").range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      rowsByTable[table] = rows;
    }
    const { files, manifest } = buildBackupFiles(rowsByTable, new Date().toISOString());
    if (!verifyBackupArtifactStructure(files)) throw new Error("Struktur artifact backup tidak lengkap");
    const archive = await storageAdapter.createArchive({ category: "backups", path: `database/${jakarta.dateStr}/idaroh-${jakarta.dateStr}.zip`, files });
    const { data: storedFile, error: metadataError } = await supabase.from("stored_files").insert({
      gdrive_file_id: archive.id,
      folder_category: "backups",
      original_name: `idaroh-${jakarta.dateStr}.zip`,
      mime_type: "application/zip",
      byte_size: archive.byteSize,
      visibility: "private_sensitive",
    }).select("id").single();
    if (metadataError || !storedFile) {
      await storageAdapter.delete(archive.id);
      throw metadataError ?? new Error("Metadata artifact backup tidak dapat disimpan");
    }
    const rowCounts = Object.fromEntries(Object.entries(manifest.tables).map(([table, value]) => [table, value.row_count]));
    const { error } = await supabase.from("backup_runs").update({ status: "backup_verified", row_counts: rowCounts, artifact_ref: storedFile.id, completed_at: new Date().toISOString() }).eq("id", run.id);
    if (error) throw error;
    await supabase.from("cron_job_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("job_key", jobKey);
    return NextResponse.json({ success: true, runId: run.id, status: "backup_verified", artifactRef: storedFile.id, rowCounts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Backup manifest failed";
    await supabase.from("backup_runs").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).eq("id", run.id);
    await supabase.from("cron_job_runs").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).eq("job_key", jobKey);
    return NextResponse.json({ error: "Backup manifest failed" }, { status: 500 });
  }
}
