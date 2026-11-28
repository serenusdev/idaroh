"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuthUser, getJakartaTime } from "@/lib/auth/guards";
import { hasAnyRole } from "@/lib/auth/role-utils";
import { errorToMessage } from "@/lib/action-error";
import { parseWibLocal } from "@/lib/time/wib";

export async function requestGatePassAction(studentId: string, reason: string, destination: string, dueBackAt: string) {
  const user = await requireAuthUser();
  if ((hasAnyRole(user, ["pengurus", "super_admin"]) && !studentId) || reason.trim().length < 3 || destination.trim().length < 2 || !dueBackAt) return { success: false, message: "Data izin keluar belum lengkap." };
  const supabase = await createClient();
  try {
    const operator = hasAnyRole(user, ["pengurus", "super_admin"]);
    const effectiveStudent = operator
      ? /^[0-9a-f-]{36}$/i.test(studentId)
        ? await supabase.from("students").select("id").eq("id", studentId).maybeSingle()
        : await supabase.from("students").select("id").eq("nis", studentId.trim()).maybeSingle()
      : await supabase.from("students").select("id").eq("profile_id", user.id).maybeSingle();
    if (effectiveStudent.error || !effectiveStudent.data) return { success: false, message: "Santri dengan NIS tersebut tidak ditemukan." };
    const parsedDueBackAt = parseWibLocal(dueBackAt).toISOString();
    const { data, error } = await supabase.rpc("request_gate_pass", { p_student_id: effectiveStudent.data.id, p_reason: reason.trim(), p_destination: destination.trim(), p_due_back_at: parsedDueBackAt });
    return error ? { success: false, message: errorToMessage(error) } : { success: true, gatePass: data };
  } catch (error) {
    return { success: false, message: errorToMessage(error) };
  }
}

export async function approveGatePassAction(id: string, approved: boolean, note?: string) {
  await requireAuthUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_gate_pass_v2", { p_gate_pass_id: id, p_approved: approved, p_note: note ?? null });
  return error ? { success: false, message: errorToMessage(error) } : { success: true, gatePass: data };
}

export async function scanGatePassAction(qrToken: string, direction: "out" | "back") {
  const user = await requireAuthUser();
  if (!hasAnyRole(user, ["pengurus", "super_admin"])) return { success: false, message: "Anda tidak memiliki izin memindai surat izin." };
  const { data, error } = await (await createClient()).rpc("scan_gate_pass", { p_qr_token: qrToken, p_direction: direction });
  return error ? { success: false, message: errorToMessage(error) } : { success: true, gatePass: data };
}

export async function getGatePassDashboardAction() {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("gate_passes").select("id, student_id, reason, destination, out_at, due_back_at, actual_back_at, status, qr_token, created_at, returned_late, late_minutes, students(full_name, nis)").in("status", ["pending", "approved", "out", "overdue", "returned", "rejected", "cancelled"]).order("due_back_at", { ascending: true });
  return { rows: data ?? [], message: error ? errorToMessage(error) : undefined, nowWib: getJakartaTime().timeFormatted, operator: hasAnyRole(user, ["pengurus", "super_admin"]) };
}

export async function resolveGatePassTokenAction(qrToken: string) {
  const user = await requireAuthUser();
  if (!hasAnyRole(user, ["pengurus", "super_admin"])) return { success: false, message: "Anda tidak memiliki izin memindai surat izin." };
  const { data, error } = await (await createClient()).rpc("resolve_gate_pass_token", { p_qr_token: qrToken.trim() });
  return error ? { success: false, message: errorToMessage(error) } : { success: true, gatePass: data?.[0] ?? null };
}

export async function cancelGatePassAction(id: string) {
  await requireAuthUser();
  const { data, error } = await (await createClient()).rpc("cancel_gate_pass", { p_id: id });
  return error ? { success: false, message: errorToMessage(error) } : { success: true, gatePass: data };
}
