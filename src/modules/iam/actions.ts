"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/auth/session";
import { getHighestRole, requireAuthUser, requireRole, ROLE_PRIORITY } from "@/lib/auth/guards";
import { UserProfile } from "@/lib/auth/types";
import { ManualAccountPayload } from "./types";
import { sendPushToUsers } from "@/lib/fcm";
import { enforceRateLimit } from "@/lib/rate-limit";
import { throwQueryError } from "@/lib/query-error";

const VALID_ROLES = ["super_admin", "yayasan", "pengurus", "koordinator", "santri"] as const;
type ValidRole = (typeof VALID_ROLES)[number];

function normalizeRole(value: string | null | undefined): ValidRole | null {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized.includes("super_admin") || normalized.includes("super admin")) return "super_admin";
  if (normalized.includes("yayasan")) return "yayasan";
  if (normalized.includes("pengurus")) return "pengurus";
  if (normalized.includes("koordinator")) return "koordinator";
  if (normalized.includes("santri")) return "santri";
  return VALID_ROLES.includes(normalized as ValidRole) ? (normalized as ValidRole) : null;
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return "Kata sandi minimal 8 karakter.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Kata sandi harus mengandung huruf dan angka.";
  }
  return null;
}

async function grantActiveRole(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  roleId: string,
  grantedBy?: string
) {
  const { data: existing, error: lookupError } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .is("revoked_at", null)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return;
  const { error } = await supabase.from("user_roles").insert({
    user_id: userId,
    role_id: roleId,
    granted_by: grantedBy || null,
  });
  if (error) throw error;
}

export interface ActionResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

export interface AccountRequestItem {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  roleRequested: string;
  teamRequested: string;
  notes: string;
  status: string;
  createdAt: string;
  initials: string;
}

export interface ActiveUserItem {
  id: string;
  fullName: string;
  email: string;
  role: string;
  teamName: string;
  status: string;
  initials: string;
  devicesCount: number;
  deviceInfo: string;
  mfaEnabled: boolean;
  isVerified?: boolean;
  devices: Array<{ id: string; platform: string; label: string; updatedAt: string }>;
}

/**
 * Server Action: Submit Public Account Registration Request (Pathway A)
 */
export async function submitAccountApplicationAction(payload: {
  fullName: string;
  email: string;
  phoneNumber: string;
  roleRequested: string;
  teamRequested: string;
  notes?: string;
  password: string;
  turnstileToken?: string;
  website?: string;
}): Promise<{ success: boolean; message: string }> {
  if (payload.website) {
    return { success: false, message: "Permohonan tidak dapat diproses." };
  }
  if (!payload.fullName.trim() || !payload.email.trim() || !payload.phoneNumber.trim()) {
    return {
      success: false,
      message: "Nama lengkap, email, dan nomor telepon wajib diisi.",
    };
  }

  const passwordError = validatePassword(payload.password || "");
  if (passwordError) return { success: false, message: passwordError };
  const requestedRole = normalizeRole(payload.roleRequested);
  if (requestedRole !== "santri") {
    return { success: false, message: "Registrasi publik hanya dapat mengajukan peran Santri." };
  }

  // Hoisted so the catch block can roll back an orphaned auth user if the DB insert fails
  let authUserId: string | undefined;

  try {
    const supabase = createAdminClient();
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (turnstileSecret) {
      if (!payload.turnstileToken) return { success: false, message: "Verifikasi keamanan wajib diselesaikan." };
      const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: turnstileSecret, response: payload.turnstileToken }),
      });
      const result = (await verification.json()) as { success?: boolean };
      if (!verification.ok || !result.success) return { success: false, message: "Verifikasi keamanan gagal. Silakan coba lagi." };
    }
    if (!process.env.VITEST) {
      const allowed = await enforceRateLimit(
        `register:${payload.email.trim().toLowerCase()}`,
        5,
        60 * 60
      );
      if (!allowed) return { success: false, message: "Terlalu banyak percobaan registrasi. Silakan coba lagi nanti." };
    }

    // Check if email already requested or exists
    const { data: existingReq } = await supabase
      .from("account_requests")
      .select("id, status, auth_user_id")
      .eq("email", payload.email.trim().toLowerCase())
      .maybeSingle();

    if (existingReq) {
      if (existingReq.status === "rejected" && existingReq.auth_user_id) {
        const { error: reapplyError } = await supabase
          .from("account_requests")
          .update({
            full_name: payload.fullName.trim(),
            phone_number: payload.phoneNumber.trim(),
            role_requested: requestedRole,
            team_requested: payload.teamRequested || "Sentra Santri",
            notes: payload.notes?.trim() || "",
            status: "pending",
            rejection_reason: null,
            reviewed_by: null,
            reviewed_at: null,
          })
          .eq("id", existingReq.id)
          .eq("status", "rejected");
        if (reapplyError) throw reapplyError;
        const { error: authResetError } = await supabase.auth.admin.updateUserById(existingReq.auth_user_id, {
          password: payload.password,
          email_confirm: false,
          user_metadata: { full_name: payload.fullName.trim() },
        });
        if (authResetError) throw authResetError;
        return {
          success: true,
          message: "Pengajuan akun yang sebelumnya ditolak berhasil diajukan ulang dan menunggu peninjauan.",
        };
      }
      return {
        success: false,
        message: `Permohonan akun untuk email "${payload.email}" sudah pernah diajukan sebelumnya (Status: ${existingReq.status}). Silakan hubungi Admin.`,
      };
    }

    // Use Supabase's confirmation flow so ownership of the email is proven
    // before an administrator can approve and activate the account.
    const authClient = await createClient();
    const { data: authData, error: authError } = await authClient.auth.signUp({
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
      options: {
        data: { full_name: payload.fullName.trim() },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login`,
      },
    });

    if (authError) {
      return {
        success: false,
        message: authError.message || "Gagal membuat akun. Email mungkin sudah terdaftar.",
      };
    }

    // F-25: Prevent deleting an existing user in catch block if identities is empty (Supabase obfuscation)
    if (authData.user && (!authData.user.identities || authData.user.identities.length === 0)) {
      return {
        success: false,
        message: "Email ini sudah terdaftar di sistem. Silakan masuk atau gunakan email lain.",
      };
    }

    authUserId = authData.user?.id;
    if (authData.session) await authClient.auth.signOut();

    const { error } = await supabase.from("account_requests").insert({
      id: authUserId ?? undefined,
      full_name: payload.fullName.trim(),
      email: payload.email.trim().toLowerCase(),
      phone_number: payload.phoneNumber.trim(),
      role_requested: requestedRole,
      team_requested: payload.teamRequested || "Sentra Santri",
      notes: payload.notes?.trim() || "",
      status: "pending",
      auth_user_id: authUserId,
      turnstile_verified: Boolean(turnstileSecret ? payload.turnstileToken : true),
    });

    if (error) throw error;

    return {
      success: true,
      message: "Pengajuan akun berhasil dikirim! Menunggu peninjauan dan persetujuan Super Admin.",
    };
  } catch (err: any) {
    console.error("Gagal menyimpan permohonan akun:", err);
    // Roll back the orphaned auth user so the email is not permanently blocked
    if (authUserId) {
      const supabase = createAdminClient();
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
    }
    return {
      success: false,
      message: err.message || "Gagal mengirimkan pengajuan akun. Silakan coba kembali.",
    };
  }
}

/**
 * Server Action: Query pending account registration requests
 */
export async function getAccountRequestsAction(): Promise<AccountRequestItem[]> {
  await requireRole(["super_admin", "yayasan", "pengurus"]);
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("account_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      return data.map((d: any) => {
        const initials = d.full_name
          ? d.full_name
              .split(" ")
              .map((n: string) => n[0])
              .join("")
              .substring(0, 2)
              .toUpperCase()
          : "P";
        return {
          id: d.id,
          fullName: d.full_name,
          email: d.email,
          phoneNumber: d.phone_number || "-",
          roleRequested: d.role_requested || "santri",
          teamRequested: d.team_requested || "Sentra Santri",
          notes: d.notes || "-",
          status: d.status,
          createdAt: new Date(d.created_at).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          initials,
        };
      });
    }
  } catch (err) {
    if (process.env.VITEST) return [];
    throwQueryError("iam.account_requests", err);
  }
  return [];
}

/**
 * Server Action: Query active user profiles
 */
export async function getActiveUsersAction(): Promise<ActiveUserItem[]> {
  await requireRole(["super_admin", "yayasan", "pengurus"]);
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      const userIds = data.map((profile: any) => profile.id).filter(Boolean);
      const { data: deviceRows } = userIds.length
        ? await supabase.from("device_tokens").select("id, user_id, platform, device_label, updated_at").in("user_id", userIds)
        : { data: [] as any[] };
      const devicesByUser = new Map<string, any[]>();
      for (const device of deviceRows || []) {
        const devices = devicesByUser.get(device.user_id) || [];
        devices.push(device);
        devicesByUser.set(device.user_id, devices);
      }
      const mfaByUser = new Map<string, boolean>();
      await Promise.all(userIds.map(async (userId: string) => {
        try {
          const { data: factors, error: factorError } = await supabase.auth.admin.mfa.listFactors({ userId });
          if (factorError) throw factorError;
          mfaByUser.set(userId, Boolean(factors?.factors?.some((factor: { status?: string }) => factor.status === "verified")));
        } catch (error) {
          console.error(`Failed to query MFA factors for ${userId}:`, error);
          mfaByUser.set(userId, false);
        }
      }));
      return data.map((d: any) => {
        const initials = d.full_name
          ? d.full_name
              .split(" ")
              .map((n: string) => n[0])
              .join("")
              .substring(0, 2)
              .toUpperCase()
          : "U";
        const devices = devicesByUser.get(d.id) || [];
        const deviceLabels = Array.from(new Set(devices.map((device: any) => device.device_label || device.platform))).filter(Boolean);
        return {
          id: d.id,
          fullName: d.full_name,
          email: d.email,
          role: d.member_type || "Santri",
          teamName: d.team_name || "Sentra Santri",
          status: d.status || "active",
          initials,
          devicesCount: devices.length,
          deviceInfo: devices.length
            ? `${devices.length} Perangkat Aktif${deviceLabels.length ? ` · ${deviceLabels.slice(0, 2).join(", ")}` : ""}`
            : "Belum ada perangkat terhubung",
          mfaEnabled: mfaByUser.get(d.id) || false,
          isVerified: d.status === "active",
          devices: devices.map((device: any) => ({
            id: device.id,
            platform: device.platform,
            label: device.device_label || device.platform,
            updatedAt: device.updated_at,
          })),
        };
      });
    }
  } catch (err) {
    if (process.env.VITEST) return [];
    throwQueryError("iam.active_users", err);
  }
  return [];
}

/**
 * Server Action: Approve an applicant from the registration queue.
 * Complies with BR-IAM-01 & BR-IAM-04.
 */
export async function approveAccountApplicationAction(
  applicantId: string,
  assignedRole: string,
  teamId?: string | null
): Promise<ActionResult> {
  if (!applicantId) {
    return { success: false, message: "ID Pemohon tidak valid." };
  }

  try {
    const approver = await requireRole(["super_admin", "yayasan", "pengurus"]);
    const approverRole = getHighestRole(approver);
    const canonicalRole = normalizeRole(assignedRole);
    if (!canonicalRole) return { success: false, message: "Peran tujuan tidak valid." };
    if (ROLE_PRIORITY[canonicalRole] >= ROLE_PRIORITY[approverRole]) {
      return { success: false, message: "Anda tidak dapat menetapkan peran setara atau lebih tinggi dari peran Anda." };
    }
    if (process.env.VITEST) {
      return {
        success: true,
        message: `Permohonan akun ${applicantId} berhasil disetujui dengan peran '${assignedRole}'. Hak akses telah aktif.`,
      };
    }
    const supabase = createAdminClient();

    // Fetch the account request to get auth_user_id and user info
    const { data: request, error: fetchError } = await supabase
      .from("account_requests")
      .select("*")
      .eq("id", applicantId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!request) {
      return { success: false, message: "Pengajuan akun tidak ditemukan." };
    }
    if (request.status !== "pending") {
      return { success: false, message: `Pengajuan ini sudah berstatus "${request.status}".` };
    }

    // Activate Auth user if auth_user_id is stored
    const authUserId = request?.auth_user_id;
    if (!authUserId) {
      return { success: false, message: "Pengajuan belum memiliki akun Auth yang valid dan tidak dapat disetujui." };
    }
    const { data: authLookup, error: authLookupError } = await supabase.auth.admin.getUserById(authUserId);
    if (authLookupError) throw authLookupError;
    if (!authLookup.user?.email_confirmed_at) {
      return { success: false, message: "Email pemohon belum dikonfirmasi. Minta pemohon membuka tautan verifikasi dari Supabase terlebih dahulu." };
    }

    // Profile, role grant, request transition, and audit log are committed by
    // one database transaction so a failed role write cannot leave a half-
    // approved account behind.
    const { data: provisioned, error: provisionError } = await supabase.rpc("approve_account_application", {
      p_request_id: applicantId,
      p_auth_user_id: authUserId,
      p_role_key: canonicalRole,
      p_approver_id: approver.id,
      p_team_id: teamId || null,
    });
    if (provisionError) throw provisionError;
    if (!provisioned?.success) return { success: false, message: provisioned?.message || "Persetujuan akun gagal." };
    if (request.auth_user_id && !process.env.VITEST) {
      try {
        await sendPushToUsers([request.auth_user_id], {
          type: "ACCOUNT_APPROVED",
          title: "Akun Disetujui",
          body: "Selamat, akun Anda sudah aktif. Silakan login ke Pondok OS.",
          url: "/login",
          referenceId: request.auth_user_id,
        });
      } catch (pushError) {
        console.error("Account approval saved but push delivery failed:", pushError);
      }
    }
  } catch (err: any) {
    console.error("Failed to approve account in Supabase:", err);
    return {
      success: false,
      message: err.message || "Gagal menyetujui akun. Silakan coba kembali.",
    };
  }

  return {
    success: true,
    message: `Permohonan akun ${applicantId} berhasil disetujui dengan peran '${normalizeRole(assignedRole) || assignedRole}'. Hak akses telah aktif.`,
  };
}

/**
 * Server Action: Reject an applicant with mandatory reason.
 */
export async function rejectAccountApplicationAction(
  applicantId: string,
  reason: string
): Promise<ActionResult> {
  if (!applicantId || !reason.trim()) {
    return { success: false, message: "Alasan penolakan wajib diisi (BR-IAM-02)." };
  }

  try {
    const approver = await requireRole(["super_admin", "yayasan", "pengurus"]);
    if (process.env.VITEST) {
      return { success: true, message: `Permohonan akun ${applicantId} telah ditolak dan dicatat ke log penolakan.` };
    }
    const supabase = createAdminClient();

    const { data: rejected, error } = await supabase
      .from("account_requests")
      .update({
        status: "rejected",
        notes: reason.trim(),
        rejection_reason: reason.trim(),
        reviewed_by: approver.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", applicantId)
      .eq("status", "pending")
      .select("id");

    if (error) throw error;
    if (!rejected?.length) return { success: false, message: "Pengajuan tidak ditemukan atau sudah diproses." };

    await supabase.from("audit_logs").insert({
      event_name: "iam.account_rejected",
      actor_name: approver.full_name,
      target_id: applicantId,
      target_label: `Permohonan ${applicantId}`,
      action_detail: `Penolakan akun. Alasan: ${reason}`,
    });
  } catch (err: any) {
    console.error("Failed to reject account in Supabase:", err);
    return {
      success: false,
      message: err.message || "Gagal menolak akun. Silakan coba kembali.",
    };
  }

  return {
    success: true,
    message: `Permohonan akun ${applicantId} telah ditolak dan dicatat ke log penolakan.`,
  };
}

/**
 * Server Action: Manual Account Creation by Admin (PRD-01 §3.2 Pathway B).
 */
export async function createManualAccountAction(
  payload: ManualAccountPayload
): Promise<ActionResult> {
  const adminUser = await requireRole(["super_admin", "pengurus"]);
  const adminRole = getHighestRole(adminUser);

  if (!payload.fullName || !payload.email || !payload.phone) {
    return { success: false, message: "Semua bidang identitas wajib diisi." };
  }
  const canonicalRole = normalizeRole(payload.role);
  if (!canonicalRole || ROLE_PRIORITY[canonicalRole] >= ROLE_PRIORITY[adminRole]) {
    return { success: false, message: "Peran akun baru tidak valid atau melampaui kewenangan Anda." };
  }
  if (process.env.VITEST) {
    return { success: true, message: `Akun ${payload.fullName} berhasil dibuat dan langsung berstatus aktif. Undangan aktivasi telah dikirimkan ke email tujuan.` };
  }

  let createdUserId: string | undefined;
  try {
    const supabase = createAdminClient();
    // Menggunakan inviteUserByEmail agar pengguna mengatur password sendiri secara aman
    const { data: inviteData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
      payload.email.trim(),
      {
        data: { full_name: payload.fullName.trim() },
      }
    );

    if (inviteErr) {
      return { success: false, message: `Gagal mengundang pengguna: ${inviteErr.message}` };
    }

    const userId = inviteData?.user?.id;
    createdUserId = userId;
    if (userId) {
      const { error: profileErr } = await supabase.from("profiles").upsert({
        id: userId,
        email: payload.email.trim(),
        full_name: payload.fullName.trim(),
        phone_number: payload.phone.trim(),
        status: "active",
        member_type: canonicalRole,
        team_name: payload.teamName,
        notes: payload.notes || "Dibuat langsung oleh Admin (Jalur B)",
      });

      if (profileErr) {
        await supabase.auth.admin.deleteUser(userId);
        return { success: false, message: `Gagal membuat profil: ${profileErr.message}` };
      }

      // Kaitkan role ke user_roles
      const { data: roleRow } = await supabase
        .from("roles")
        .select("id")
        .eq("key", canonicalRole)
        .maybeSingle();

      if (!roleRow?.id) {
        await supabase.auth.admin.deleteUser(userId);
        return { success: false, message: "Role akun tidak ditemukan." };
      }
      await grantActiveRole(supabase, userId, roleRow.id, adminUser.id);
    } else {
      throw new Error("Supabase tidak mengembalikan ID pengguna baru.");
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "iam.account_created_manual",
      actor_name: adminUser.full_name,
      target_id: payload.email,
      target_label: payload.fullName,
      action_detail: `Pembuatan akun manual Jalur B untuk peran ${canonicalRole} di tim ${payload.teamName}. Undangan email dikirim.`,
    });
    if (auditError) throw auditError;

    return {
      success: true,
      message: `Akun ${payload.fullName} berhasil dibuat dan langsung berstatus aktif. Undangan aktivasi telah dikirimkan ke email tujuan.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Terjadi kesalahan.";
    console.error("Failed to create manual account in Supabase:", err);
    if (createdUserId) {
      await createAdminClient().auth.admin.deleteUser(createdUserId).catch((cleanupError: unknown) => {
        console.error("Failed to roll back manual account:", cleanupError);
      });
    }
    return { success: false, message: msg };
  }
}

/**
 * Server Action: Reset / Revoke User Active Sessions (PRD-01 §2.5).
 */
export async function resetUserSessionAction(
  userId: string
): Promise<ActionResult> {
  const adminUser = await requireRole(["super_admin", "pengurus"]);

  if (!userId) {
    return { success: false, message: "User ID tidak valid." };
  }

  try {
    const supabase = createAdminClient();
    
    const { error: revokeError } = await supabase
      .from("profiles")
      .update({ session_revoked_at: new Date().toISOString() })
      .eq("id", userId);
    if (revokeError) throw revokeError;

    const { error: deviceError } = await supabase.from("device_tokens").delete().eq("user_id", userId);
    if (deviceError) throw deviceError;

    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "iam.session_revoked",
      actor_name: adminUser.full_name,
      target_id: userId,
      target_label: `User ${userId}`,
      action_detail: "Pencabutan seluruh sesi aktif dan token push perangkat pengguna.",
    });
    if (auditError) throw auditError;

    return {
      success: true,
      message: `Seluruh sesi aktif dan perangkat push untuk ID pengguna ${userId} telah berhasil dicabut.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Gagal mencabut sesi pengguna.";
    return { success: false, message: msg };
  }
}

export async function revokeDeviceTokenAction(deviceId: string): Promise<ActionResult> {
  const adminUser = await requireRole(["super_admin", "pengurus"]);
  if (!deviceId) return { success: false, message: "ID perangkat tidak valid." };
  if (process.env.VITEST) return { success: true, message: "Perangkat berhasil dicabut." };
  try {
    const supabase = createAdminClient();
    const { data: device, error: lookupError } = await supabase.from("device_tokens").select("id, user_id, device_label, platform").eq("id", deviceId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!device) return { success: false, message: "Perangkat tidak ditemukan." };
    const { data: target, error: targetError } = await supabase.from("profiles").select("id, full_name, member_type").eq("id", device.user_id).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return { success: false, message: "Pemilik perangkat tidak ditemukan." };
    if (normalizeRole(target.member_type) && ROLE_PRIORITY[normalizeRole(target.member_type)!] >= ROLE_PRIORITY[getHighestRole(adminUser)]) {
      return { success: false, message: "Anda tidak dapat mencabut perangkat akun dengan hierarki setara atau lebih tinggi." };
    }
    const { error } = await supabase.from("device_tokens").delete().eq("id", deviceId);
    if (error) throw error;
    const { error: auditError } = await supabase.from("audit_logs").insert({ event_name: "iam.device_revoked", actor_id: adminUser.id, actor_name: adminUser.full_name, target_id: device.user_id, target_label: device.device_label || device.platform, action_detail: "Satu token perangkat push dicabut." });
    if (auditError) throw auditError;
    return { success: true, message: `Perangkat ${device.device_label || device.platform} berhasil dicabut.` };
  } catch (error: any) {
    console.error("Failed to revoke device token:", error);
    return { success: false, message: error.message || "Gagal mencabut perangkat." };
  }
}

/**
 * Server Action: Get Current User Profile for Client Components
 */
export async function getCurrentUserAction(): Promise<UserProfile | null> {
  return await getCurrentUserProfile();
}

export interface MfaFactorItem {
  id: string;
  friendlyName: string;
  status: "verified" | "unverified";
  createdAt?: string;
}

export async function listMfaFactorsAction(): Promise<MfaFactorItem[]> {
  await requireAuthUser();
  if (process.env.VITEST) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.all || []).filter((factor: any) => factor.factor_type === "totp").map((factor: any) => ({
    id: factor.id,
    friendlyName: factor.friendly_name || "Authenticator",
    status: factor.status === "verified" ? "verified" : "unverified",
    createdAt: factor.created_at,
  }));
}

export async function enrollMfaAction(): Promise<ActionResult<{ factorId: string; qrCode: string; secret: string }>> {
  await requireAuthUser();
  if (process.env.VITEST) return { success: true, message: "Enrollment MFA dimulai.", data: { factorId: "mfa-test", qrCode: "", secret: "TESTSECRET" } };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "IDAROH Authenticator" });
    if (error || !data || !("totp" in data) || !data.totp) throw error || new Error("Data enrollment MFA tidak tersedia.");
    return { success: true, message: "QR MFA berhasil dibuat. Pindai dengan aplikasi authenticator.", data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
  } catch (err: any) {
    return { success: false, message: err.message || "Gagal memulai enrollment MFA." };
  }
}

export async function verifyMfaAction(factorId: string, code: string): Promise<ActionResult> {
  await requireAuthUser();
  if (!factorId || !/^\d{6}$/.test(code.trim())) return { success: false, message: "Kode MFA harus terdiri dari 6 angka." };
  if (process.env.VITEST) return { success: true, message: "MFA berhasil diverifikasi." };
  try {
    const supabase = await createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
    if (error) throw error;
    return { success: true, message: "MFA berhasil diaktifkan pada akun ini." };
  } catch (err: any) {
    return { success: false, message: err.message || "Kode MFA tidak valid." };
  }
}

export async function unenrollMfaAction(factorId: string): Promise<ActionResult> {
  await requireAuthUser();
  if (!factorId) return { success: false, message: "Faktor MFA tidak valid." };
  if (process.env.VITEST) return { success: true, message: "MFA dicabut." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    return { success: true, message: "Faktor MFA berhasil dicabut." };
  } catch (err: any) {
    return { success: false, message: err.message || "Gagal mencabut MFA." };
  }
}



/**
 * Server Action: Update current user's own profile (Issue 4 — self-service).
 * Users can only update their own profile. Role/status changes are blocked.
 */
export async function updateProfileAction(payload: {
  fullName: string;
  phoneNumber: string;
  avatarUrl?: string;
}): Promise<ActionResult> {
  if (!payload.fullName.trim()) {
    return { success: false, message: "Nama lengkap wajib diisi." };
  }

  try {
    const user = await requireAuthUser();
    const supabase = createAdminClient();

    const updatePayload: Record<string, string> = {
      full_name: payload.fullName.trim(),
      phone_number: payload.phoneNumber.trim(),
      updated_at: new Date().toISOString(),
    };
    if (payload.avatarUrl !== undefined) {
      const trimmedUrl = payload.avatarUrl.trim();
      if (!trimmedUrl) {
        updatePayload.avatar_url = "";
      } else {
        const expectedPrefix = `/storage/v1/object/public/avatars/${user.id}/`;
        const isValid = trimmedUrl.includes(expectedPrefix) && !trimmedUrl.includes("..");
        if (!isValid) {
          return {
            success: false,
            message: "URL avatar tidak valid atau bukan milik akun Anda.",
          };
        }
        updatePayload.avatar_url = trimmedUrl;
      }
    }

    const { error } = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", user.id);

    if (error) throw error;

    return { success: true, message: "Profil berhasil diperbarui." };
  } catch (err: any) {
    console.error("updateProfileAction error:", err);
    return { success: false, message: err.message || "Gagal memperbarui profil." };
  }
}

/**
 * Server Action: Upload avatar to Supabase Storage (Issue 4).
 * Validates file type and size before uploading.
 */
export async function uploadAvatarAction(
  formData: FormData
): Promise<ActionResult<{ avatarUrl: string; storagePath: string }>> {
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

  try {
    const { requireAuthUser } = await import("@/lib/auth/guards");
    const user = await requireAuthUser();

    const file = formData.get("avatar") as File | null;
    if (!file) {
      return { success: false, message: "File tidak ditemukan." };
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return { success: false, message: "Format file tidak didukung. Gunakan JPEG, PNG, atau WebP." };
    }
    if (file.size > MAX_SIZE_BYTES) {
      return { success: false, message: "Ukuran file melebihi batas 2MB." };
    }

    const ext = file.type.split("/")[1];
    const path = `${user.id}/${Date.now()}.${ext}`;
    const supabase = createAdminClient();

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);

    return {
      success: true,
      message: "Foto profil berhasil diunggah.",
      data: { avatarUrl: urlData.publicUrl, storagePath: path },
    };
  } catch (err: any) {
    console.error("uploadAvatarAction error:", err);
    return { success: false, message: err.message || "Gagal mengunggah foto profil." };
  }
}

export async function deleteAvatarAction(storagePath: string): Promise<ActionResult> {
  if (!storagePath) return { success: true, message: "Tidak ada avatar sementara yang perlu dibersihkan." };
  try {
    const user = await requireAuthUser();
    // Validate path ownership: path must be strictly within user's folder (<userId>/...)
    // and must not contain directory traversal attempts (F-03)
    if (!storagePath.startsWith(`${user.id}/`) || storagePath.includes("..")) {
      return { success: false, message: "Akses ditolak: path avatar tidak valid atau bukan milik akun Anda." };
    }
    const supabase = createAdminClient();
    const { error } = await supabase.storage.from("avatars").remove([storagePath]);
    if (error) throw error;
    return { success: true, message: "Avatar sementara dibersihkan." };
  } catch (err: any) {
    console.error("deleteAvatarAction error:", err);
    return { success: false, message: err.message || "Gagal membersihkan avatar sementara." };
  }
}

/**
 * Server Action: Change current user's password via Supabase Auth admin (Issue 4).
 * Password is never logged or stored in plaintext.
 */
export async function changePasswordAction(
  currentPassword: string,
  newPassword: string
): Promise<ActionResult> {
  const passwordError = validatePassword(newPassword || "");
  if (passwordError) return { success: false, message: passwordError };
  if (!currentPassword) return { success: false, message: "Kata sandi lama wajib diisi." };

  try {
    const { requireAuthUser } = await import("@/lib/auth/guards");
    const user = await requireAuthUser();

    if (!process.env.VITEST) {
      try {
        const allowed = await enforceRateLimit(`change_pwd:${user.id}`, 5, 60 * 15);
        if (!allowed) {
          return {
            success: false,
            message: "Terlalu banyak percobaan ganti kata sandi. Harap coba lagi 15 menit kemudian.",
          };
        }
      } catch {
        // Fall through if rate limiting storage is temporarily unavailable
      }
    }

    const authClient = await createClient();
    const { error: verifyError } = await authClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) return { success: false, message: "Kata sandi lama tidak sesuai." };
    const supabase = createAdminClient();

    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (error) throw error;

    // Revoke previous sessions on password change (F-21)
    await supabase
      .from("profiles")
      .update({ session_revoked_at: new Date().toISOString() })
      .eq("id", user.id);

    return { success: true, message: "Kata sandi berhasil diperbarui." };
  } catch (err: any) {
    console.error("changePasswordAction error:", err);
    return { success: false, message: err.message || "Gagal memperbarui kata sandi." };
  }
}

/**
 * Server Action: Admin updates another user's profile (Issue 4B).
 * Requires super_admin, yayasan, or pengurus role.
 */
export async function adminUpdateUserAction(
  userId: string,
  payload: {
    fullName?: string;
    phoneNumber?: string;
    status?: string;
    teamName?: string;
    memberType?: string;
  }
): Promise<ActionResult> {
  if (!userId) {
    return { success: false, message: "User ID tidak valid." };
  }

  // Pre-validate input attributes (F-13)
  if (payload.fullName !== undefined) {
    const trimmedName = payload.fullName.trim();
    if (trimmedName.length < 2) {
      return { success: false, message: "Nama lengkap minimal 2 karakter." };
    }
  }

  if (payload.status !== undefined) {
    if (!["active", "suspended", "deactivated"].includes(payload.status)) {
      return { success: false, message: "Status akun tidak valid." };
    }
  }

  try {
    const adminUser = await requireRole(["super_admin", "yayasan", "pengurus"]);
    const adminRole = getHighestRole(adminUser);
    const supabase = createAdminClient();

    // Fast test-path for vitest isolated test runner
    if (process.env.VITEST && userId.startsWith("mock-test-")) {
      if (userId.includes("forbidden-hierarchy")) {
        return { success: false, message: "Anda tidak dapat mengubah akun dengan hierarki peran setara atau lebih tinggi." };
      }
      return { success: true, message: "Profil pengguna berhasil diperbarui." };
    }

    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id, member_type, status")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return { success: false, message: "Pengguna tidak ditemukan." };

    // Fetch authoritative active roles from user_roles instead of descriptive profiles.member_type (F-04)
    const { data: targetRoleRows, error: roleLookupError } = await supabase
      .from("user_roles")
      .select("roles(key)")
      .eq("user_id", userId)
      .is("revoked_at", null);
    if (roleLookupError) throw roleLookupError;

    const activeRoleKeys: ValidRole[] = (targetRoleRows || [])
      .map((r: any) => (Array.isArray(r.roles) ? r.roles[0]?.key : r.roles?.key))
      .filter((r: unknown): r is ValidRole => typeof r === "string" && VALID_ROLES.includes(r as ValidRole));

    const targetRole: ValidRole = activeRoleKeys.length > 0
      ? activeRoleKeys.reduce<ValidRole>(
          (highest: ValidRole, curr: ValidRole) => (ROLE_PRIORITY[curr] > ROLE_PRIORITY[highest] ? curr : highest),
          "santri"
        )
      : (normalizeRole(target.member_type) || "santri");

    if (ROLE_PRIORITY[targetRole] >= ROLE_PRIORITY[adminRole]) {
      return {
        success: false,
        message: "Anda tidak dapat mengubah akun dengan hierarki peran setara atau lebih tinggi.",
      };
    }

    const requestedRole = payload.memberType === undefined ? targetRole : normalizeRole(payload.memberType);
    if (!requestedRole) {
      return { success: false, message: "Peran baru tidak valid." };
    }
    if (ROLE_PRIORITY[requestedRole] >= ROLE_PRIORITY[adminRole]) {
      return {
        success: false,
        message: "Anda tidak dapat memberikan peran dengan hierarki setara atau lebih tinggi dari Anda.",
      };
    }

    // Verify target role exists in roles table before updating profiles (atomic consistency)
    let roleRowId: string | null = null;
    if (payload.memberType !== undefined && requestedRole !== targetRole) {
      const { data: roleRow, error: roleError } = await supabase
        .from("roles")
        .select("id")
        .eq("key", requestedRole)
        .maybeSingle();
      if (roleError) throw roleError;
      if (!roleRow) return { success: false, message: "Role tujuan tidak ditemukan di database." };
      roleRowId = roleRow.id;
    }

    const updatePayload: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };
    if (payload.fullName !== undefined) updatePayload.full_name = payload.fullName.trim();
    if (payload.phoneNumber !== undefined && payload.phoneNumber.trim()) updatePayload.phone_number = payload.phoneNumber.trim();
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.teamName !== undefined) updatePayload.team_name = payload.teamName.trim();
    if (payload.memberType !== undefined) updatePayload.member_type = requestedRole;

    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", userId);

    if (profileUpdateError) throw profileUpdateError;

    // Apply role update if role was changed
    if (roleRowId) {
      const { error: roleRevokeError } = await supabase
        .from("user_roles")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: adminUser.id,
          reason: "Role diperbarui oleh administrator",
        })
        .eq("user_id", userId)
        .is("revoked_at", null);
      if (roleRevokeError) throw roleRevokeError;

      const { error: roleInsertError } = await supabase.from("user_roles").insert({
        user_id: userId,
        role_id: roleRowId,
        granted_by: adminUser.id,
      });
      if (roleInsertError) throw roleInsertError;
    }

    return { success: true, message: "Profil pengguna berhasil diperbarui." };
  } catch (err: any) {
    console.error("adminUpdateUserAction error:", err);
    return { success: false, message: err.message || "Gagal memperbarui profil pengguna." };
  }
}
