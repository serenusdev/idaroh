"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuthUser, getJakartaTime } from "@/lib/auth/guards";

export async function requestGatePassAction(studentId: string, reason: string, destination: string, dueBackAt: string) {
  await requireAuthUser();
  if (!studentId || reason.trim().length < 3 || destination.trim().length < 2 || !dueBackAt) return { success: false, message: "Data izin keluar belum lengkap." };
  const supabase = await createClient();
  const studentQuery = /^[0-9a-f-]{36}$/i.test(studentId)
    ? supabase.from("students").select("id").eq("id", studentId).maybeSingle()
    : supabase.from("students").select("id").eq("nis", studentId.trim()).maybeSingle();
  const { data: student, error: studentError } = await studentQuery;
  if (studentError || !student) return { success: false, message: "Santri dengan NIS tersebut tidak ditemukan." };
  const { data, error } = await supabase.rpc("request_gate_pass", { p_student_id: student.id, p_reason: reason, p_destination: destination, p_due_back_at: dueBackAt });
  return error ? { success: false, message: error.message } : { success: true, gatePass: data };
}

export async function approveGatePassAction(id: string, approved: boolean) {
  await requireAuthUser();
  const { data, error } = await (await createClient()).rpc("approve_gate_pass", { p_gate_pass_id: id, p_approved: approved });
  return error ? { success: false, message: error.message } : { success: true, gatePass: data };
}

export async function scanGatePassAction(qrToken: string, direction: "out" | "back") {
  await requireAuthUser();
  const { data, error } = await (await createClient()).rpc("scan_gate_pass", { p_qr_token: qrToken, p_direction: direction });
  return error ? { success: false, message: error.message } : { success: true, gatePass: data };
}

export async function getGatePassDashboardAction() {
  const user = await requireAuthUser();
  const supabase = await createClient();
  if (user.roles?.some((role) => role === "pengurus" || role === "super_admin") || user.role === "pengurus" || user.role === "super_admin") await supabase.rpc("refresh_gate_pass_overdue");
  const { data, error } = await supabase.from("gate_passes").select("id, student_id, reason, destination, out_at, due_back_at, actual_back_at, status, qr_token, created_at").in("status", ["pending", "approved", "out", "overdue"]).order("due_back_at", { ascending: true });
  return { rows: data ?? [], message: error?.message, nowWib: getJakartaTime().timeFormatted };
}
