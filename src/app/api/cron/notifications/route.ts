import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainNotificationOutbox, sendPushToUsers } from "@/lib/fcm";
import { drainEmailOutbox } from "@/lib/email-outbox";
import { getJakartaTime } from "@/lib/auth/guards";
import { isCronJobDue } from "@/lib/cron-schedule";
import { DEVICE_TOKEN_RETENTION_DAYS, expirePublishedAnnouncements, pruneStaleDeviceTokens, publishDueAnnouncements, refreshAttendanceSnapshot } from "@/lib/background-jobs";
import { timingSafeEqual } from "node:crypto";
import { dueAttendanceNotificationStages } from "@/lib/attendance/notification-stages";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
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
  const claimedKeys: string[] = [];
  let drainAttempted = false;
  try {
    const admin = createAdminClient();
    const jakarta = getJakartaTime();
    const today = jakarta.dateStr;
    const now = new Date().toISOString();
    // Same steps the durable worker owns, in the order this fallback has always used: publish, then
    // drain, then archive, so a publication made by this tick is delivered by this tick.
    const { published: scheduledPublished } = await publishDueAnnouncements(admin, now);
    // Drain after publication commits, even when no reminder is due or already claimed.
    drainAttempted = true;
    const outboxPush = await drainNotificationOutbox();
    const outboxEmail = await drainEmailOutbox();
    const { archived: expiredArchived } = await expirePublishedAnnouncements(admin, now);
    const { data: scheduleRows, error: scheduleError } = await admin
      .from("cron_job_schedules")
      .select("job_key, time_wib, days_of_week, enabled")
      .in("job_key", ["attendance_reminder", "report_reminder"]);
    if (scheduleError) throw scheduleError;
    const schedules = new Map<string, { time_wib: string; days_of_week: number[]; enabled: boolean }>(
      (scheduleRows || []).map((row: { job_key: string; time_wib: string; days_of_week: number[]; enabled: boolean }) => [row.job_key, row]),
    );
    const due = (key: string) => {
      const row = schedules.get(key);
      return row ? isCronJobDue({ timeWib: row.time_wib, daysOfWeek: row.days_of_week, enabled: row.enabled }, jakarta) : false;
    };
    // §3.3: pengingat presensi tidak boleh keluar pada hari non-operasional. Snapshot sudah
    // menyembunyikan hari itu selama refresh berhasil, tetapi jalur fallback di bawah dan jadwal
    // admin yang memilih "Min" tidak, jadi aturan hari ditanyakan ke database (20261122000012).
    const { data: operationalToday, error: dayError } = await admin.rpc("is_operational_day", { p_date: today });
    if (dayError) throw dayError;
    const sendAttendanceReminder = due("attendance_reminder") && operationalToday === true;
    const attendanceStages = operationalToday === true && !process.env.VITEST
      ? dueAttendanceNotificationStages(jakarta.totalMinutes)
      : [];
    const scheduledAttendance = sendAttendanceReminder && attendanceStages.length === 0;
    const sendReportReminder = due("report_reminder");
    // A snapshot failure must not abort the reminders: the audience falls back to the raw tables,
    // which is why the error is captured here instead of thrown like the other steps.
    let snapshotError: unknown = null;
    try {
      await refreshAttendanceSnapshot(admin, today);
    } catch (error) {
      snapshotError = error;
      console.error("Attendance effective snapshot failed:", error);
    }
    if (!scheduledAttendance && attendanceStages.length === 0 && !sendReportReminder) {
      return NextResponse.json({ success: true, today, skipped: true, scheduledPublished, expiredArchived, outboxPush, outboxEmail });
    }
    const jobKeys = [
      ...(scheduledAttendance ? [`attendance-reminder:${today}`] : []),
      ...(sendReportReminder ? [`report-reminder:${today}`] : []),
    ];
    for (const jobKey of jobKeys) {
      const { data: claim, error: claimError } = await admin
        .from("cron_job_runs")
        .insert({ job_key: jobKey })
        .select("job_key")
        .maybeSingle();
      if (claimError && claimError.code !== "23505") throw claimError;
      if (claim?.job_key) claimedKeys.push(claim.job_key);
    }
    if (claimedKeys.length === 0 && attendanceStages.length === 0) {
      return NextResponse.json({ success: true, today, skipped: true, reason: "already_processed", scheduledPublished, expiredArchived, outboxPush, outboxEmail });
    }
    const shouldSendAttendance = claimedKeys.includes(`attendance-reminder:${today}`) && attendanceStages.length === 0;
    const shouldSendReport = claimedKeys.includes(`report-reminder:${today}`);
    const { data: santri, error: santriError } = await admin
      .from("profiles")
      .select("id, attendance_reminder_enabled")
      .eq("status", "active")
      .eq("member_type", "santri");
    if (santriError) throw santriError;
    const ids: string[] = (santri || []).map((profile: { id: string }) => profile.id);
    const attendanceReminderEnabled = new Set<string>(
      (santri || [])
        .filter((profile: { attendance_reminder_enabled: boolean }) => profile.attendance_reminder_enabled === true)
        .map((profile: { id: string }) => profile.id),
    );

    let attendanceTargets: string[];
    if (!snapshotError) {
      const { data: missingAttendance, error: effectiveError } = await admin
        .from("attendance_effective")
        .select("user_id")
        .eq("attendance_date", today)
        .eq("status", "no_checkin");
      if (effectiveError) throw effectiveError;
      const missingIds = new Set((missingAttendance || []).map((row: { user_id: string }) => row.user_id));
      attendanceTargets = ids.filter((id) => missingIds.has(id));
    } else {
      const { data: attendance, error: attendanceError } = await admin
        .from("attendance_records")
        .select("user_id")
        .eq("attendance_date", today);
      if (attendanceError) throw attendanceError;
      const checkedIn = new Set((attendance || []).map((row: { user_id: string }) => row.user_id));
      attendanceTargets = ids.filter((id) => !checkedIn.has(id));
    }

    const { data: reports, error: reportError } = await admin
      .from("daily_reports")
      .select("user_id")
      .eq("report_date", today)
      .eq("submission_status", "submitted");
    if (reportError) throw reportError;
    const submitted = new Set((reports || []).map((row: { user_id: string }) => row.user_id));
    const reportTargets = ids.filter((id) => !submitted.has(id));

    const { data: approvedExceptions, error: exceptionError } = await admin
      .from("attendance_exceptions")
      .select("user_id")
      .eq("status", "approved")
      .lte("date_from", today)
      .gte("date_to", today);
    if (exceptionError) throw exceptionError;
    const excused = new Set((approvedExceptions || []).map((row: { user_id: string }) => row.user_id));
    // Apply after both effective and fallback paths; report eligibility is unchanged.
    const filteredAttendanceTargets = attendanceTargets.filter((id) => attendanceReminderEnabled.has(id) && !excused.has(id));
    const filteredReportTargets = reportTargets.filter((id) => !excused.has(id));

    const attendanceStagePush: Record<string, unknown> = {};
    for (const stage of attendanceStages) {
      const { data: claimedDispatches, error: dispatchError } = await admin
        .from("notification_dispatches")
        .upsert(
          filteredAttendanceTargets.map((userId) => ({ user_id: userId, dispatch_date: today, stage: stage.stage })),
          { onConflict: "user_id,dispatch_date,stage", ignoreDuplicates: true },
        )
        .select("user_id");
      if (dispatchError) throw dispatchError;
      const stageTargets = (claimedDispatches || []).map((row: { user_id: string }) => row.user_id);
      attendanceStagePush[stage.stage] = await sendPushToUsers(stageTargets, {
        type: "ATTENDANCE_REMINDER",
        title: "Pengingat Presensi",
        body: stage.body,
        url: "/kehadiran",
        referenceId: `${today}:${stage.stage}`,
      });
    }

    const attendancePush = shouldSendAttendance
      ? await sendPushToUsers(filteredAttendanceTargets, {
        type: "ATTENDANCE_REMINDER",
        title: "Pengingat Presensi",
        body: "Batas waktu presensi pagi hampir ditutup.",
        url: "/kehadiran",
        referenceId: today,
      })
      : { sent: 0, removed: 0, skipped: true };
    const reportPush = shouldSendReport
      ? await sendPushToUsers(filteredReportTargets, {
        type: "REPORT_DEADLINE_REMINDER",
        title: "Pengingat Laporan",
        body: "Jangan lupa setor laporan harian sebelum batas waktu.",
        url: "/laporan",
        referenceId: today,
      })
      : { sent: 0, removed: 0, skipped: true };

    // Housekeeping stays non-fatal: the reminders were already queued when it runs.
    try {
      await pruneStaleDeviceTokens(admin, new Date(Date.now() - DEVICE_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString());
    } catch (error) {
      console.error("Device token prune failed:", error);
    }
    await admin.from("cron_job_runs").update({ status: "completed", completed_at: new Date().toISOString() }).in("job_key", claimedKeys);
    return NextResponse.json({ success: true, today, attendancePush, attendanceStagePush, reportPush, scheduledPublished, expiredArchived, outboxPush, outboxEmail });
  } catch (error) {
    if (!drainAttempted) {
      try { await drainNotificationOutbox(); }
      catch { console.error("Notification outbox drain failed"); }
      try { await drainEmailOutbox(); }
      catch { console.error("Email outbox drain failed"); }
    }
    console.error("Notification cron failed:", error);
    const message = error instanceof Error ? error.message : "Notification job failed";
    const admin = createAdminClient();
    if (claimedKeys.length > 0) {
      await admin.from("cron_job_runs").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).in("job_key", claimedKeys);
    }
    return NextResponse.json({ error: "Notification job failed" }, { status: 500 });
  }
}
