"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guards";
import { errorToMessage } from "@/lib/action-error";

export async function createAcademicTermAction(input: { code: string; name: string; startDate: string; endDate: string }) {
  await requireRole(["pengurus", "super_admin"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) return { success: false, message: "Tanggal term tidak valid." };
  const { data, error } = await (await createClient()).rpc("create_academic_term", { p_code: input.code, p_name: input.name, p_start_date: input.startDate, p_end_date: input.endDate });
  return error ? { success: false, message: errorToMessage(error) } : { success: true, term: data };
}
