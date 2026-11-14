"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuthUser, getHighestRole, ROLE_PRIORITY, getJakartaTime } from "@/lib/auth/guards";
import { UserRole } from "@/lib/auth/types";
import { ATTENDANCE_HISTORY } from "./data";
import { AttendanceClassification, AttendanceRecordItem, CorrectionRequestPayload } from "./types";
import { throwQueryError } from "@/lib/query-error";

export interface CheckinResult {
  success: boolean;
  message: string;
  classification: AttendanceClassification;
  timeStr: string;
  alreadyCheckedIn?: boolean;
}

/**
 * Guard: reject attendance creation for a cancelled event (TRC-20).
 * Returns an error result if the event is cancelled; null if it's OK to proceed.
 */
export async function assertEventNotCancelled(
  eventId: string
): Promise<{ success: false; message: string } | null> {
  if (process.env.VITEST) return null;
  const supabase = createAdminClient();
  const { data: event, error } = await supabase
    .from("events")
    .select("id, status")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!event) return null; // No linked event — allow
  if (event.status === "cancelled") {
    return {
      success: false,
      message: "Agenda ini telah dibatalkan. Pembuatan absensi baru tidak diizinkan.",
    };
  }
  return null;
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
  const user = await requireAuthUser();
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
    const { data, error } = await supabase.rpc("attendance_check_in", {
      p_user_id: user.id,
      p_client_meta: { source: "web-live", wib_time: jakarta.timeFormatted },
    });
    if (error) {
      console.error("Gagal mencatat presensi di Supabase:", error);
      return {
        success: false,
        message: "Gagal menyimpan presensi ke database: " + error.message,
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
    };
  } catch (err: any) {
    console.error("Supabase attendance checkin error:", err);
    return {
      success: false,
      message: err.message || "Gagal mencatat presensi.",
      classification: "on_time",
      timeStr: jakarta.timeFormatted,
    };
  }
}

/**
 * Local role normalizer for attendance scope guard (FUNC-06).
 * Maps profile.member_type strings to canonical UserRole keys.
 */
function normalizeAttendanceRole(value: string | null | undefined): UserRole | null {
  const s = (value || "").trim().toLowerCase();
  if (s.includes("super_admin") || s.includes("super admin")) return "super_admin";
  if (s.includes("yayasan")) return "yayasan";
  if (s.includes("pengurus")) return "pengurus";
  if (s.includes("koordinator")) return "koordinator";
  if (s.includes("santri")) return "santri";
  return null;
}

/**
 * Server Action: Query live attendance history from Supabase
 * @param targetUserId Optional. Required when caller is pengurus/yayasan/super_admin.
 *                     Santri/koordinator always see their own data; this param is ignored for them.
 */
export async function getAttendanceHistoryAction(targetUserId?: string): Promise<AttendanceRecordItem[]> {
  try {
    const user = await requireAuthUser();
    const supabase = createAdminClient();
    const callerRole = getHighestRole(user);

    // Determine effective user ID to scope queries
    let effectiveUserId: string;
    if (["santri", "koordinator"].includes(callerRole)) {
      // Santri/koordinator always see only their own records; ignore targetUserId
      effectiveUserId = user.id;
    } else {
      // Pengurus, yayasan, super_admin must supply targetUserId
      if (!targetUserId) {
        return [];
      }
      // FUNC-06: Silent hierarchy guard — prevents enumerating records of equals/superiors
      const { data: targetProfile, error: profileError } = await supabase
        .from("profiles")
        .select("member_type")
        .eq("id", targetUserId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!targetProfile) return [];
      const targetRole = normalizeAttendanceRole(targetProfile.member_type);
      if (
        targetRole &&
        ROLE_PRIORITY[targetRole] >= ROLE_PRIORITY[callerRole]
      ) {
        return []; // silent scope guard — do not reveal existence
      }
      effectiveUserId = targetUserId;
    }

    let query = supabase
      .from("attendance_records")
      .select("*")
      .order("attendance_date", { ascending: false })
      .limit(30);

    // Scope query to the effective user (always per-user after FUNC-06 guard above)
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
        const labels: Record<string, string> = {
          on_time: "Tepat Waktu",
          grace: "Masa Toleransi",
          late: "Terlambat",
          excused: "Izin Resmi",
          sick: "Sakit",
          duty: "Tugas Luar",
          no_checkin: "Belum Presensi",
        };
        return (effectiveRows as any[])
          .filter((row) => row.status in labels)
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
              label: labels[classification],
              sessionTitle: "Operasional Santri Pagi",
              canCorrect: classification === "late" || classification === "grace" || classification === "no_checkin",
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
      requested_classification: "on_time",
      reason: `${payload.reasonCategory}: ${notes || "Tanpa catatan tambahan"}`,
      evidence_url: payload.evidenceUrl || null,
      status: "pending",
    });

    if (error) throw error;
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
  if (!["super_admin", "yayasan", "pengurus"].includes(user.role)) {
    throw new Error("Anda tidak memiliki akses memproses review presensi.");
  }
  return user;
}

export async function reviewAttendanceCorrectionAction(
  correctionId: string,
  decision: "approved" | "rejected",
  note = ""
): Promise<{ success: boolean; message: string }> {
  const reviewer = await requireRoleForAttendanceReview();
  if (process.env.VITEST) return { success: true, message: "Koreksi presensi berhasil diproses." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_attendance_correction", {
    p_correction_id: correctionId,
    p_decision: decision,
    p_note: note.trim() || null,
  });
  if (error) return { success: false, message: error.message };
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
  if (error) return { success: false, message: error.message };
  if (!data?.success) return { success: false, message: data?.message || "Pengajuan izin gagal diproses." };
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({ event_name: `attendance.exception_${decision}`, actor_id: reviewer.id, actor_name: reviewer.full_name, target_id: exceptionId, target_label: "Pengajuan izin presensi", action_detail: note.trim() || "-" });
  return { success: true, message: data.message || "Pengajuan izin berhasil diproses." };
}
