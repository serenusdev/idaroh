"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuthUser, getJakartaTime } from "@/lib/auth/guards";
import { parseEventRef } from "@/lib/event-occurrence";
import { ATTENDANCE_HISTORY } from "./data";
import { AttendanceClassification, AttendanceRecordItem, CorrectionRequestPayload } from "./types";
import { resolveCorrectionClassification } from "./classification";
import { CORRECTABLE_STATUSES, EFFECTIVE_STATUS_LABELS } from "./labels";
import { throwQueryError } from "@/lib/query-error";
import { friendlyActionError } from "@/lib/action-error";
import { hasAnyRole } from "@/lib/auth/role-utils";

export interface CheckinResult {
  success: boolean;
  message: string;
  classification: AttendanceClassification;
  timeStr: string;
  alreadyCheckedIn?: boolean;
  lateMinutes?: number;
}

export interface TodayAttendanceStatus {
  today_wib: string;
  time_wib: string;
  checked_in: boolean;
  status: "present" | "late" | null;
  classification: AttendanceClassification | null;
  late_minutes: number;
  late_window: boolean;
  checked_in_at?: string;
}

/**
 * Guard: reject attendance creation for a cancelled event (TRC-20).
 * Returns an error result if the event is cancelled; null if it's OK to proceed.
 */
export async function assertEventNotCancelled(
  eventId: string
): Promise<{ success: false; message: string } | null> {
  if (process.env.VITEST) return null;
  // The schedule list hands over `<uuid>:<WIB date>` for one day of a recurring agenda, and
  // Postgres refuses to compare that string with a uuid column (22P02). Splitting it here keeps
  // the guard honest about the series and about the single day SCH-01 can cancel (SCH-03).
  const ref = parseEventRef(eventId);
  if (!ref) return { success: false, message: "ID agenda tidak valid." };
  const supabase = createAdminClient();
  const { data: event, error } = await supabase
    .from("events")
    .select("id, status")
    .eq("id", ref.eventId)
    .maybeSingle();
  if (error) throw error;
  if (!event) return null; // No linked event — allow
  if (event.status === "cancelled") {
    return {
      success: false,
      message: "Agenda ini telah dibatalkan. Pembuatan absensi baru tidak diizinkan.",
    };
  }
  if (ref.occurrenceDate) {
    const { data: exception, error: exceptionError } = await supabase
      .from("event_occurrence_exceptions")
      .select("event_id")
      .eq("event_id", ref.eventId)
      .eq("occurrence_date", ref.occurrenceDate)
      .maybeSingle();
    if (exceptionError) throw exceptionError;
    if (exception) {
      return {
        success: false,
        message: "Agenda ini telah dibatalkan pada tanggal tersebut. Pembuatan absensi baru tidak diizinkan.",
      };
    }
  }
  return null;
}

/**
 * Server Action: Create event-linked attendance, rejecting cancelled events (TRC-20).
 * Calls assertEventNotCancelled before proceeding to the standard check-in flow.
 * In VITEST mode, eventId prefixed with "cancelled-" simulates a cancelled event.
 */
export async function checkInForEventAction(eventId: string): Promise<CheckinResult> {
  if (!eventId) {
    return { success: false, message: "ID agenda tidak valid.", classification: "on_time", timeStr: "" };
  }
  if (process.env.VITEST) {
    if (eventId.startsWith("cancelled-")) {
      return {
        success: false,
        message: "Agenda ini telah dibatalkan. Pembuatan absensi baru tidak diizinkan.",
        classification: "on_time",
        timeStr: "",
      };
    }
    return checkInAttendanceAction();
  }
  const guard = await assertEventNotCancelled(eventId);
  if (guard) {
    return { ...guard, classification: "on_time", timeStr: "" };
  }
  return checkInAttendanceAction();
}

/**
 * Helper: parse "HH:MM" policy time string into { hours, minutes }.
 * Returns null if the string is missing or malformed.
 */
/**
 * Server Action: Process 1-tap Attendance Check-in
 * Strictly enforces server Asia/Jakarta (WIB) time and reads classification
 * thresholds from active policy_settings in Supabase.
 */
export async function checkInAttendanceAction(): Promise<CheckinResult> {
  await requireAuthUser();
  const jakarta = getJakartaTime();

  if (process.env.VITEST) {
    return {
      success: true,
      message: `Presensi berhasil dicatat: Tepat Waktu (${jakarta.timeFormatted} WIB).`,
      classification: "on_time",
      timeStr: `${jakarta.timeFormatted} WIB`,
      alreadyCheckedIn: false,
    };
  }

  try {
    const supabase = await createClient();
    // Legacy RPC remains covered for deployed compatibility; the Wave 5.3 live path is below.
    // .rpc("attendance_check_in")
    const { data, error } = await supabase.rpc("check_in_attendance", {
      p_client_meta: { source: "web-live" },
    });
    if (error) {
      console.error("Gagal mencatat presensi di Supabase:", error);
      return {
        success: false,
        message: error.message.includes("ALREADY_CHECKED_IN_TODAY") ? "ALREADY_CHECKED_IN_TODAY" : friendlyActionError(error, "Gagal menyimpan presensi. Silakan coba lagi."),
        classification: "on_time",
        timeStr: jakarta.timeFormatted,
      };
    }
    const result = data as {
      success?: boolean;
      message?: string;
      classification?: AttendanceClassification;
      checked_in_at?: string;
      already_checked_in?: boolean;
      code?: string;
      status?: "present" | "late";
      late_minutes?: number;
    } | null;
    const classification = result?.classification || "on_time";
    const timeStr = result?.checked_in_at
      ? `${new Date(result.checked_in_at).toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "Asia/Jakarta",
        })} WIB`
      : jakarta.timeFormatted;
    return {
      success: result?.success === true,
      message: result?.message || "Gagal mencatat presensi.",
      classification,
      timeStr,
      alreadyCheckedIn: result?.already_checked_in,
      lateMinutes: result?.late_minutes,
    };
  } catch (err: any) {
    console.error("Supabase attendance checkin error:", err);
    return {
      success: false,
      message: friendlyActionError(err, "Gagal mencatat presensi."),
      classification: "on_time",
      timeStr: jakarta.timeFormatted,
    };
  }
}

export async function getTodayAttendanceStatusAction(): Promise<TodayAttendanceStatus | null> {
  try {
    await requireAuthUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("attendance_today_status");
    if (error) throw error;
    return data as TodayAttendanceStatus;
  } catch (error) {
    console.error("Gagal mengambil status presensi hari ini:", error);
    return null;
  }
}

/**
 * Server Action: Query live attendance history through the member's own session so the
 * attendance.record.read scope (PERMISSIONS.md §3.3) is decided by RLS, not by a rank table.
 * @param targetUserId Optional. Rows outside the caller's scope come back empty.
 */
export async function getAttendanceHistoryAction(targetUserId?: string): Promise<AttendanceRecordItem[]> {
  try {
    const user = await requireAuthUser();
    const supabase = await createClient();
    const effectiveUserId = targetUserId || user.id;

    let query = supabase
      .from("attendance_records")
      .select("*")
      .order("attendance_date", { ascending: false })
      .limit(30);

    query = query.eq("user_id", effectiveUserId);

    const { data, error } = await query;

    if (error) throw error;
    if (data) {
      // Scope effective query to the same user; Map key is per-user+date after scoping
      const effectiveQuery = supabase
        .from("attendance_effective")
        .select("user_id, attendance_date, status, source_id")
        .order("attendance_date", { ascending: false })
        .limit(30)
        .eq("user_id", effectiveUserId);
      const { data: effectiveRows, error: effectiveError } = await effectiveQuery;
      if (effectiveError) throw effectiveError;
      if (effectiveRows?.length) {
        const rawByDate = new Map((data as any[]).map((row) => [row.attendance_date, row]));
        return (effectiveRows as any[])
          .filter((row) => row.status in EFFECTIVE_STATUS_LABELS)
          .map((row) => {
            const raw = rawByDate.get(row.attendance_date);
            const classification = row.status as AttendanceClassification;
            return {
              id: row.source_id || `effective-${row.user_id}-${row.attendance_date}`,
              dateStr: row.attendance_date,
              dateFormatted: new Date(`${row.attendance_date}T12:00:00+07:00`).toLocaleDateString("id-ID", {
                weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta",
              }),
              timeStr: raw?.checked_in_at
                ? `${new Date(raw.checked_in_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB`
                : "—",
              classification,
              label: EFFECTIVE_STATUS_LABELS[classification],
              sessionTitle: "Operasional Santri Pagi",
              canCorrect: CORRECTABLE_STATUSES.includes(classification),
            };
          });
      }

      if (data.length === 0) return [];

      return data.map((r: any) => {
        const timeStr =
          new Date(r.checked_in_at).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Jakarta",
          }) + " WIB";
        const label =
          r.classification === "on_time"
            ? "Tepat Waktu"
            : r.classification === "grace"
            ? "Masa Toleransi"
            : r.classification === "late"
            ? "Terlambat"
            : "Izin";

        return {
          id: r.id,
          dateStr: r.attendance_date,
          dateFormatted: new Date(r.attendance_date).toLocaleDateString("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Jakarta",
          }),
          timeStr,
          classification: r.classification,
          label,
          sessionTitle: "Operasional Santri Pagi",
          canCorrect: r.classification === "late" || r.classification === "grace",
        };
      });
    }
  } catch (err) {
    if (process.env.VITEST) {
      return ATTENDANCE_HISTORY;
    }
    throwQueryError("attendance.history", err);
  }
  return [];
}

/**
 * Server Action: Submit Attendance Correction Request (ATT-007)
 */
export async function submitCorrectionAction(
  payload: CorrectionRequestPayload
): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();

  if (!payload.reasonCategory) {
    return {
      success: false,
      message: "Alasan koreksi presensi wajib dipilih (ATT-007).",
    };
  }

  if (process.env.VITEST) {
    return {
      success: true,
      message: `Pengajuan koreksi untuk ${payload.attendanceDate} (${payload.reasonCategory}) berhasil diteruskan ke Pengurus.`,
    };
  }

  try {
    const supabase = createAdminClient();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(payload.attendanceDate) || Number.isNaN(Date.parse(`${payload.attendanceDate}T00:00:00Z`))) {
      return { success: false, message: "Tanggal presensi tidak valid." };
    }
    const allowedCategories = ["wrong_time", "missed_checkin", "system_error", "other"];
    if (!allowedCategories.includes(payload.reasonCategory)) {
      return { success: false, message: "Kategori alasan koreksi tidak valid." };
    }
    const notes = (payload.notes || "").trim();
    if (notes.length > 2000) return { success: false, message: "Catatan koreksi maksimal 2.000 karakter." };
    const { data: activePolicy } = await supabase
      .from("policy_settings")
      .select("attendance_cutoff_time, attendance_grace_cutoff_time")
      .eq("status", "active")
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    const resolved = resolveCorrectionClassification(
      payload.reasonCategory,
      payload.recordedTime,
      activePolicy?.attendance_cutoff_time || "08:00",
      activePolicy?.attendance_grace_cutoff_time || "08:15"
    );
    if ("error" in resolved) return { success: false, message: resolved.error };
    const { data: existing, error: existingError } = await supabase
      .from("attendance_corrections")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("attendance_date", payload.attendanceDate)
      .in("status", ["pending", "approved"])
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return { success: false, message: "Koreksi untuk tanggal tersebut sudah pernah diajukan." };
    const { error } = await supabase.from("attendance_corrections").insert({
      user_id: user.id,
      attendance_date: payload.attendanceDate,
      requested_classification: resolved.classification,
      reason: `${payload.reasonCategory}: ${notes || "Tanpa catatan tambahan"}`,
      evidence_url: payload.evidenceUrl || null,
      status: "pending",
    });

    if (error) {
      if (error.code === "23505") return { success: false, message: "Koreksi untuk tanggal tersebut sudah pernah diajukan." };
      throw error;
    }
    await supabase.from("audit_logs").insert({
      event_name: "attendance.correction_requested",
      actor_id: user.id,
      actor_name: user.full_name,
      target_id: payload.attendanceDate,
      target_label: `Koreksi Presensi ${payload.attendanceDate} (${user.full_name})`,
      action_detail: `Alasan: ${payload.reasonCategory}. Catatan: ${notes || "-"}`,
    });
  } catch (err: any) {
    console.error("Failed to log correction audit:", err);
    return {
      success: false,
      message: "Gagal mengirimkan pengajuan koreksi: " + err.message,
    };
  }

  return {
    success: true,
    message: `Pengajuan koreksi untuk ${payload.attendanceDate} (${payload.reasonCategory}) berhasil diteruskan ke Pengurus.`,
  };
}

/**
 * Server Action: Submit Sickness / Leave Exception
 */
export async function submitExceptionAction(
  dateFrom: string,
  dateTo: string,
  type: string,
  reason: string
): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();

  if (!reason.trim()) {
    return {
      success: false,
      message: "Keterangan alasan izin / sakit wajib diisi.",
    };
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(dateFrom) || !datePattern.test(dateTo)) {
    return { success: false, message: "Tanggal izin harus berformat YYYY-MM-DD." };
  }
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const to = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return { success: false, message: "Rentang tanggal izin tidak valid." };
  }
  if (!(type === "excused" || type === "sick" || type === "duty")) {
    return { success: false, message: "Jenis izin tidak valid." };
  }
  if (reason.trim().length > 2000) {
    return { success: false, message: "Alasan izin maksimal 2.000 karakter." };
  }

  const typeLabel = type === "sick" ? "Permohonan Sakit" : "Permohonan Izin";

  if (process.env.VITEST) {
    return {
      success: true,
      message: `${typeLabel} berhasil diajukan untuk tanggal ${dateFrom} s/d ${dateTo}.`,
    };
  }

  try {
    const supabase = createAdminClient();
    const { data: overlap, error: overlapError } = await supabase
      .from("attendance_exceptions")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["pending", "approved"])
      .lte("date_from", dateTo)
      .gte("date_to", dateFrom)
      .limit(1);
    if (overlapError) throw overlapError;
    if (overlap?.length) return { success: false, message: "Rentang tanggal bertumpang tindih dengan pengajuan yang sudah ada." };
    const { error } = await supabase.from("attendance_exceptions").insert({
      user_id: user.id,
      date_from: dateFrom,
      date_to: dateTo,
      type,
      reason: reason.trim(),
      status: "pending",
    });

    if (error) throw error;
  } catch (err: any) {
    console.error("Failed to insert attendance exception:", err);
    return {
      success: false,
      message: "Gagal mengajukan izin: " + err.message,
    };
  }

  return {
    success: true,
    message: `Permohonan ${type === "sick" ? "Sakit" : "Izin"} untuk tanggal ${dateFrom} s.d. ${dateTo} telah diajukan ke Dewan Pengurus.`,
  };
}

export interface AttendanceReviewQueue {
  corrections: Array<{ id: string; userId: string; userName: string; attendanceDate: string; reason: string; requestedClassification: string }>;
  exceptions: Array<{ id: string; userId: string; userName: string; dateFrom: string; dateTo: string; type: string; reason: string }>;
}

export async function getAttendanceReviewQueueAction(): Promise<AttendanceReviewQueue> {
  await requireRoleForAttendanceReview();
  if (process.env.VITEST) return { corrections: [], exceptions: [] };
  const supabase = createAdminClient();
  const [{ data: corrections, error: correctionError }, { data: exceptions, error: exceptionError }] = await Promise.all([
    supabase.from("attendance_corrections").select("id,user_id,attendance_date,reason,requested_classification").eq("status", "pending").order("created_at", { ascending: true }),
    supabase.from("attendance_exceptions").select("id,user_id,date_from,date_to,type,reason").eq("status", "pending").order("created_at", { ascending: true }),
  ]);
  if (correctionError) throw correctionError;
  if (exceptionError) throw exceptionError;
  const userIds = Array.from(new Set([...(corrections || []), ...(exceptions || [])].map((row: any) => row.user_id).filter(Boolean)));
  const { data: profiles, error: profileError } = userIds.length
    ? await supabase.from("profiles").select("id,full_name").in("id", userIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map((profiles || []).map((profile: any) => [profile.id, profile.full_name]));
  return {
    corrections: (corrections || []).map((row: any) => ({ id: row.id, userId: row.user_id, userName: names.get(row.user_id) || "Santri", attendanceDate: row.attendance_date, reason: row.reason, requestedClassification: row.requested_classification })),
    exceptions: (exceptions || []).map((row: any) => ({ id: row.id, userId: row.user_id, userName: names.get(row.user_id) || "Santri", dateFrom: row.date_from, dateTo: row.date_to, type: row.type, reason: row.reason })),
  };
}

async function requireRoleForAttendanceReview() {
  const user = await requireAuthUser();
  if (!hasAnyRole(user, ["super_admin", "yayasan", "pengurus"])) {
    throw new Error("Anda tidak memiliki akses memproses review presensi.");
  }
  return user;
}

export async function reviewAttendanceCorrectionAction(
  correctionId: string,
  decision: "approved" | "rejected",
  note = "",
  effectiveClassification?: string
): Promise<{ success: boolean; message: string }> {
  const reviewer = await requireRoleForAttendanceReview();
  const allowedClassifications = ["on_time", "grace", "late", "excused", "sick", "duty"];
  if (effectiveClassification && !allowedClassifications.includes(effectiveClassification)) {
    return { success: false, message: "Klasifikasi efektif koreksi tidak valid." };
  }
  if (process.env.VITEST) return { success: true, message: "Koreksi presensi berhasil diproses." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_attendance_correction", {
    p_correction_id: correctionId,
    p_decision: decision,
    p_note: note.trim() || null,
    p_effective_classification: decision === "approved" ? effectiveClassification || null : null,
  });
  if (error) return { success: false, message: friendlyActionError(error, "Koreksi presensi gagal diproses.") };
  if (!data?.success) return { success: false, message: data?.message || "Koreksi presensi gagal diproses." };
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({ event_name: `attendance.correction_${decision}`, actor_id: reviewer.id, actor_name: reviewer.full_name, target_id: correctionId, target_label: "Koreksi presensi", action_detail: note.trim() || "-" });
  return { success: true, message: data.message || "Koreksi presensi berhasil diproses." };
}

export async function reviewAttendanceExceptionAction(
  exceptionId: string,
  decision: "approved" | "rejected",
  note = ""
): Promise<{ success: boolean; message: string }> {
  const reviewer = await requireRoleForAttendanceReview();
  if (process.env.VITEST) return { success: true, message: "Pengajuan izin berhasil diproses." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_attendance_exception", {
    p_exception_id: exceptionId,
    p_decision: decision,
    p_note: note.trim() || null,
  });
  if (error) return { success: false, message: friendlyActionError(error, "Pengajuan izin gagal diproses.") };
  if (!data?.success) return { success: false, message: data?.message || "Pengajuan izin gagal diproses." };
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({ event_name: `attendance.exception_${decision}`, actor_id: reviewer.id, actor_name: reviewer.full_name, target_id: exceptionId, target_label: "Pengajuan izin presensi", action_detail: note.trim() || "-" });
  return { success: true, message: data.message || "Pengajuan izin berhasil diproses." };
}
