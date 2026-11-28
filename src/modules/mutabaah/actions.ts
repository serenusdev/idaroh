"use server";

import { createClient } from "@/lib/supabase/server";
import { getJakartaTime, requireAuthUser } from "@/lib/auth/guards";

export type MutabaahChecklist = Record<string, boolean>;

export interface HalaqahInput {
  studentId: string;
  sessionDate: string;
  entryType: "ziyadah" | "murojaah";
  surahName: string;
  ayahFrom: number;
  ayahTo: number;
  qualityGrade: "mumtaz" | "jayyid_jiddan" | "jayyid" | "maqbul" | "needs_review";
  tajwidErrors: string;
  notes: string;
}

function requireUuid(value: string, field: string) {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error(`INVALID_${field.toUpperCase()}`);
}

export async function saveMutabaahLogAction(studentId: string, checklist: MutabaahChecklist) {
  await requireAuthUser();
  requireUuid(studentId, "student_id");
  const sanitized = Object.fromEntries(Object.entries(checklist).map(([key, value]) => [key, Boolean(value)]));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_mutabaah_log", { p_student_id: studentId, p_checklist: sanitized });
  if (error) throw error;
  return data;
}

export async function saveHalaqahLogAction(input: HalaqahInput) {
  await requireAuthUser();
  requireUuid(input.studentId, "student_id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate)) throw new Error("INVALID_SESSION_DATE");
  const todayWib = getJakartaTime().dateStr;
  const parsedDate = new Date(`${input.sessionDate}T00:00:00+07:00`);
  const normalizedDate = Number.isNaN(parsedDate.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(parsedDate);
  if (normalizedDate !== input.sessionDate) throw new Error("INVALID_SESSION_DATE");
  if (input.sessionDate > todayWib) throw new Error("SESSION_DATE_CANNOT_BE_FUTURE");
  if (!input.surahName.trim() || input.ayahFrom < 1 || input.ayahTo < input.ayahFrom) throw new Error("INVALID_HALAQAH_RANGE");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_halaqah_log", {
    p_student_id: input.studentId,
    p_session_date: input.sessionDate,
    p_entry_type: input.entryType,
    p_surah_name: input.surahName.trim(),
    p_ayah_from: input.ayahFrom,
    p_ayah_to: input.ayahTo,
    p_quality_grade: input.qualityGrade,
    p_tajwid_errors: input.tajwidErrors.trim(),
    p_notes: input.notes.trim(),
  });
  if (error) throw error;
  return data;
}

export async function todayWibDate() {
  return getJakartaTime().dateStr;
}
