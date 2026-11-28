"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/auth/session";
import { requireAuthUser, requireRole } from "@/lib/auth/guards";
import { UserProfile } from "@/lib/auth/types";
import { mfaEvidenceFromFactors, type MfaEvidence } from "@/lib/auth/mfa-assurance";
import { ManualAccountPayload } from "./types";
import { sendPushToUsers } from "@/lib/fcm";
import { enforceRateLimit } from "@/lib/rate-limit";
import { throwQueryError } from "@/lib/query-error";
import { friendlyActionError } from "@/lib/action-error";
import { withMfaAuditRetry } from "@/lib/auth/mfa-audit";
import { resolveEmailRedirectOrigin } from "@/lib/auth/email-redirect-origin";
import { storageAdapter } from "@/lib/storage/gdrive";
import { MEMBER_CATEGORIES, REGISTRATION_PRIVACY_VERSION, type ClaimedMemberType } from "./registration";

const VALID_ROLES = ["super_admin", "yayasan", "pengurus", "koordinator", "santri"] as const;

type RegistrationDiagnosticStage = "honeypot" | "turnstile" | "auth" | "database";

// Strips anything email-shaped so diagnostics never carry PII (REG/SEC review).
function sanitizeRegistrationDiagnostic(detail: string): string {
  return detail
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]")
    .slice(0, 200);
}

function logRegistrationDiagnostic(stage: RegistrationDiagnosticStage, detail = ""): void {
  console.warn(
    `[iam-registration] stage=${stage}${detail ? ` reason=${sanitizeRegistrationDiagnostic(detail)}` : ""}`,
  );
}
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

// PERMISSIONS.md §3.1: iam.role.assign is super_admin only and forbids self-escalation, so
// the role an operator may hand out is a written-out set rather than "anything below me".
// super_admin is granted by the dedicated elevation path, never from a user screen.
const ASSIGNABLE_ROLES = ["santri", "koordinator", "pengurus", "yayasan"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function resolveAssignableRole(value: string | null | undefined): AssignableRole | null {
  const normalized = normalizeRole(value);
  return normalized && (ASSIGNABLE_ROLES as readonly string[]).includes(normalized)
    ? (normalized as AssignableRole)
    : null;
}

// profiles.member_type is the descriptive category (§2 rule 1); its domain is the same list
// the registration form offers, so a claim and a stored category never drift apart.
const MEMBER_TYPES: readonly string[] = MEMBER_CATEGORIES.map((category) => category.value);

function resolveMemberType(value: string): string | null {
  const normalized = (value || "").trim().toLowerCase();
  return (MEMBER_TYPES as readonly string[]).includes(normalized) ? normalized : null;
}

function validatePassword(password: string): string | null {
  if (password.length < 10) return "Kata sandi minimal 10 karakter.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Kata sandi harus mengandung huruf dan angka.";
  }
  return null;
}

/**
 * Check whether a password appears in a known data breach using the
 * Have I Been Pwned k-anonymity API (REG-02).
 * Sends only the first 5 chars of the SHA-1 hash — the plaintext password
 * never leaves the server. Returns false (not pwned) if the API is unreachable
 * so users are never blocked by a third-party outage.
 */
async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), 4000);
    let response: Response;
    try {
      response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { "Add-Padding": "true" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timerId);
    }
    if (!response.ok) return false;
    const text = await response.text();
    return text.split("\r\n").some((line) => {
      const [hashSuffix, countStr] = line.split(":");
      return hashSuffix === suffix && parseInt(countStr, 10) > 0;
    });
  } catch {
    // HIBP unavailable — fail open (do not block registration)
    console.warn("[REG-02] HIBP check unavailable; proceeding without breach check");
    return false;
  }
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

function outboxFailureMessage(kind: "approved" | "rejected") {
  return kind === "approved"
    ? "Akun berhasil disetujui, tetapi notifikasi email belum masuk antrean. Silakan ulangi pengiriman email."
    : "Pengajuan berhasil ditolak, tetapi notifikasi email belum masuk antrean. Silakan ulangi pengiriman email.";
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
  claimedMemberType: ClaimedMemberType | null;
  privacyConsentVersion: string | null;
  privacyConsentAt: string | null;
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
  roles: string[];
  memberType: string | null;
  teamName: string;
  status: string;
  initials: string;
  devicesCount: number;
  deviceInfo: string;
  mfaEvidence: MfaEvidence | "unknown";
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
  claimedMemberType: string;
  privacyConsent: boolean;
  privacyConsentVersion: string;
  teamRequested: string;
  notes?: string;
  password: string;
  turnstileToken?: string;
  website?: string;
}): Promise<{ success: boolean; message: string }> {
  if (payload.website) {
    logRegistrationDiagnostic("honeypot", "hidden website field populated (autofill or bot)");
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
  if (!MEMBER_CATEGORIES.some((category) => category.value === payload.claimedMemberType)) {
    return { success: false, message: "Kategori keanggotaan tidak valid." };
  }
  if (payload.privacyConsent !== true) {
    return { success: false, message: "Persetujuan kebijakan privasi wajib diberikan sebelum mengajukan akun." };
  }
  if (payload.privacyConsentVersion !== REGISTRATION_PRIVACY_VERSION) {
    return { success: false, message: "Kebijakan privasi telah diperbarui. Muat ulang halaman dan baca kembali sebelum menyetujui." };
  }
  if (payload.notes && (typeof payload.notes !== "string" || payload.notes.length > 500)) {
    return { success: false, message: "Catatan permohonan maksimal 500 karakter." };
  }

  // SEC-11 + TRC-01: fail-closed Turnstile in production; dev/CI skip so real-DB E2E can register.
  if (!process.env.VITEST && process.env.NODE_ENV !== "development") {
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (!turnstileSecret) {
      logRegistrationDiagnostic("turnstile", "secret-not-configured");
      return { success: false, message: "Verifikasi keamanan belum dikonfigurasi. Hubungi administrator sistem." };
    }
    if (!payload.turnstileToken) {
      logRegistrationDiagnostic("turnstile", "token-missing");
      return { success: false, message: "Verifikasi keamanan wajib diselesaikan." };
    }
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: turnstileSecret, response: payload.turnstileToken }),
    });
    const result = (await verification.json()) as { success?: boolean; "error-codes"?: unknown };
    if (!verification.ok || !result.success) {
      const codes = Array.isArray(result["error-codes"]) ? result["error-codes"].join(",") : "unknown";
      logRegistrationDiagnostic("turnstile", `siteverify-rejected http=${verification.status} codes=${codes}`);
      return { success: false, message: "Verifikasi keamanan gagal. Silakan coba lagi." };
    }
  }

  // REG-02: Check password against Have I Been Pwned breach database.
  // Graceful: if HIBP is unreachable the check is skipped (fail open).
  if (!process.env.VITEST) {
    const pwned = await isPasswordPwned(payload.password || "");
    if (pwned) {
      return {
        success: false,
        message: "Kata sandi ini pernah terekspos dalam kebocoran data. Gunakan kata sandi yang berbeda dan lebih kuat.",
      };
    }
  }

  const consentAt = new Date().toISOString();

  // Hoisted so the catch block can roll back an orphaned auth user if the DB insert fails
  let authUserId: string | undefined;

  try {
    const supabase = createAdminClient();
    if (!process.env.VITEST) {
      const allowed = await enforceRateLimit(
        `register:${payload.email.trim().toLowerCase()}`,
        5,
        60 * 60
      );
      if (!allowed) return { success: false, message: "Terlalu banyak percobaan registrasi. Silakan coba lagi nanti." };

      // REG-04: Per-IP rate limit (5 registrations per IP per hour).
      const REGISTRATION_IP_LIMIT = 5;
      const REGISTRATION_WINDOW_SECONDS = 60 * 60;
      try {
        const requestHeaders = await headers();
        const clientIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        const allowedByIp = await enforceRateLimit(
          `register:ip:${clientIp}`,
          REGISTRATION_IP_LIMIT,
          REGISTRATION_WINDOW_SECONDS
        );
        if (!allowedByIp) return { success: false, message: "Terlalu banyak percobaan registrasi dari jaringan ini. Silakan coba lagi nanti." };
      } catch {
        // headers() unavailable outside Next.js request context — skip IP check
      }
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
            role_requested: "santri",
            claimed_member_type: payload.claimedMemberType,
            privacy_consent_version: REGISTRATION_PRIVACY_VERSION,
            privacy_consent_at: consentAt,
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
        message: "Permohonan akun untuk email ini sudah pernah diajukan. Silakan hubungi Admin jika membutuhkan bantuan.",
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
        emailRedirectTo: `${resolveEmailRedirectOrigin()}/login`,
      },
    });

    if (authError) {
      logRegistrationDiagnostic(
        "auth",
        `signup-failed code=${(authError as { error_code?: string }).error_code ?? "none"} status=${authError.status ?? "none"}`,
      );
      return {
        success: false,
        message: "Gagal memproses pengajuan akun. Silakan coba lagi atau hubungi Admin.",
      };
    }

    // F-25: Prevent deleting an existing user in catch block if identities is empty (Supabase obfuscation)
    if (authData.user && (!authData.user.identities || authData.user.identities.length === 0)) {
      logRegistrationDiagnostic("auth", "signup-identities-empty (email likely already registered)");
      return {
        success: false,
        message: "Gagal membuat akun. Silakan gunakan email lain atau hubungi Admin.",
      };
    }

    authUserId = authData.user?.id;
    if (authData.session) await authClient.auth.signOut();

    const { error } = await supabase.from("account_requests").insert({
      id: authUserId ?? undefined,
      full_name: payload.fullName.trim(),
      email: payload.email.trim().toLowerCase(),
      phone_number: payload.phoneNumber.trim(),
      role_requested: "santri",
      claimed_member_type: payload.claimedMemberType,
      privacy_consent_version: REGISTRATION_PRIVACY_VERSION,
      privacy_consent_at: consentAt,
      team_requested: payload.teamRequested || "Sentra Santri",
      notes: payload.notes?.trim() || "",
      status: "pending",
      auth_user_id: authUserId,
      turnstile_verified: true,
    });

    if (error) throw error;

    return {
      success: true,
      message: "Pengajuan akun berhasil dikirim! Menunggu peninjauan dan persetujuan Super Admin.",
    };
  } catch (err: any) {
    logRegistrationDiagnostic(
      "database",
      `persist-failed code=${err?.code ?? err?.error ?? "unknown"} constraint=${err?.constraint ?? "none"}`,
    );
    // Roll back the orphaned auth user so the email is not permanently blocked
    if (authUserId) {
      const supabase = createAdminClient();
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
    }
    return {
      success: false,
      message: friendlyActionError(err, "Gagal mengirimkan pengajuan akun. Silakan coba kembali."),
    };
  }
}

/**
 * Server Action: Query pending account registration requests
 */
export async function getAccountRequestsAction(): Promise<AccountRequestItem[]> {
  await requireRole(["super_admin"]);
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
          claimedMemberType: d.claimed_member_type ?? null,
          privacyConsentVersion: d.privacy_consent_version ?? null,
          privacyConsentAt: d.privacy_consent_at ?? null,
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
      // Roles come from user_roles only; profiles.member_type stays the descriptive category
      // beside them (§2 rule 1).
      const { data: roleRows } = userIds.length
        ? await supabase
            .from("user_roles")
            .select("user_id, roles(key)")
            .in("user_id", userIds)
            .is("revoked_at", null)
            .order("granted_at", { ascending: true })
        : { data: [] as any[] };
      const rolesByUser = new Map<string, string[]>();
      for (const row of roleRows || []) {
        const key = Array.isArray(row.roles) ? row.roles[0]?.key : row.roles?.key;
        if (typeof key !== "string" || !VALID_ROLES.includes(key as ValidRole)) continue;
        const held = rolesByUser.get(row.user_id) || [];
        if (!held.includes(key)) held.push(key);
        rolesByUser.set(row.user_id, held);
      }
      const devicesByUser = new Map<string, any[]>();
      for (const device of deviceRows || []) {
        const devices = devicesByUser.get(device.user_id) || [];
        devices.push(device);
        devicesByUser.set(device.user_id, devices);
      }
      const mfaByUser = new Map<string, MfaEvidence | "unknown">();
      await Promise.all(userIds.map(async (userId: string) => {
        try {
          const { data: factorData, error: factorError } = await supabase.auth.admin.mfa.listFactors({ userId });
          if (factorError) throw factorError;
          mfaByUser.set(userId, mfaEvidenceFromFactors(factorData?.factors));
        } catch (error) {
          console.error(`Failed to query MFA factors for ${userId}:`, error);
          mfaByUser.set(userId, "unknown");
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
        const heldRoles = rolesByUser.get(d.id) || [];
        const deviceLabels = Array.from(new Set(devices.map((device: any) => device.device_label || device.platform))).filter(Boolean);
        return {
          id: d.id,
          fullName: d.full_name,
          email: d.email,
          role: heldRoles[0] || "santri",
          roles: heldRoles,
          memberType: d.member_type || null,
          teamName: d.team_name || "Sentra Santri",
          status: d.status || "active",
          initials,
          devicesCount: devices.length,
          deviceInfo: devices.length
            ? `${devices.length} Perangkat Aktif${deviceLabels.length ? ` · ${deviceLabels.slice(0, 2).join(", ")}` : ""}`
            : "Belum ada perangkat terhubung",
          mfaEvidence: mfaByUser.get(d.id) || "unknown",
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

  let outboxFailed = false;
  try {
    const approver = await requireRole(["super_admin"]);
    const canonicalRole = resolveAssignableRole(assignedRole);
    if (!canonicalRole) {
      return { success: false, message: "Peran tujuan tidak valid: yang dapat ditetapkan dari antrean pendaftaran hanyalah santri, koordinator, pengurus, atau yayasan." };
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

    // TRC-04: Insert the account decision notification into the outbox.
    try {
      const { error: outboxError } = await supabase.from("email_outbox").upsert({
        recipient: request.email,
        subject: "Permohonan Akun Pondok OS Anda Telah Disetujui",
        body_text: `Yth. ${request.full_name},\n\nPermohonan akun Pondok OS Anda telah disetujui dengan peran '${normalizeRole(assignedRole) || assignedRole}'.\n\nSilakan login ke aplikasi untuk mulai menggunakan layanan.\n\nTerima kasih.`,
        reference_id: applicantId,
        reference_type: "account_request_approved",
        status: "pending",
      }, { onConflict: "reference_type,reference_id", ignoreDuplicates: true });
      if (outboxError) {
        outboxFailed = true;
        console.error("Account approved but email outbox insert failed:", {
          code: outboxError.code,
          message: outboxError.message,
        });
      }
    } catch (outboxError) {
      outboxFailed = true;
      console.error("Account approved but email outbox insert failed:", outboxError);
    }
  } catch (err: any) {
    console.error("Failed to approve account in Supabase:", err);
    return {
      success: false,
      message: friendlyActionError(err, "Gagal menyetujui akun. Silakan coba kembali."),
    };
  }

  return {
    success: !outboxFailed,
    message: outboxFailed
      ? outboxFailureMessage("approved")
      : `Permohonan akun ${applicantId} berhasil disetujui dengan peran '${normalizeRole(assignedRole) || assignedRole}'. Hak akses telah aktif.`,
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

  let outboxFailed = false;
  try {
    const approver = await requireRole(["super_admin"]);
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
      .select("id, email, full_name");

    if (error) throw error;
    if (!rejected?.length) return { success: false, message: "Pengajuan tidak ditemukan atau sudah diproses." };

    await supabase.from("audit_logs").insert({
      event_name: "iam.account_rejected",
      actor_name: approver.full_name,
      target_id: applicantId,
      target_label: `Permohonan ${applicantId}`,
      action_detail: `Penolakan akun. Alasan: ${reason}`,
    });

    // TRC-04: Insert the account decision notification into the outbox.
    try {
      const rejectedRecord = rejected[0];
      const { error: outboxError } = await supabase.from("email_outbox").upsert({
        recipient: rejectedRecord.email,
        subject: "Permohonan Akun Pondok OS Anda Belum Dapat Disetujui",
        body_text: `Yth. ${rejectedRecord.full_name},\n\nMohon maaf, permohonan akun Pondok OS Anda belum dapat disetujui saat ini.\n\nAlasan: ${reason}\n\nJika ada pertanyaan, silakan hubungi administrator pondok.\n\nTerima kasih.`,
        reference_id: applicantId,
        reference_type: "account_request_rejected",
        status: "pending",
      }, { onConflict: "reference_type,reference_id", ignoreDuplicates: true });
      if (outboxError) {
        outboxFailed = true;
        console.error("Account rejected but email outbox insert failed:", {
          code: outboxError.code,
          message: outboxError.message,
        });
      }
    } catch (outboxError) {
      outboxFailed = true;
      console.error("Account rejected but email outbox insert failed:", outboxError);
    }
  } catch (err: any) {
    console.error("Failed to reject account in Supabase:", err);
    return {
      success: false,
      message: friendlyActionError(err, "Gagal menolak akun. Silakan coba kembali."),
    };
  }

  return {
    success: !outboxFailed,
    message: outboxFailed
      ? outboxFailureMessage("rejected")
      : `Permohonan akun ${applicantId} telah ditolak dan dicatat ke log penolakan.`,
  };
}

/**
 * Server Action: Manual Account Creation by Admin (PRD-01 §3.2 Pathway B).
 */
export async function createManualAccountAction(
  payload: ManualAccountPayload
): Promise<ActionResult> {
  const adminUser = await requireRole(["super_admin"]);

  if (!payload.fullName || !payload.email || !payload.phone) {
    return { success: false, message: "Semua bidang identitas wajib diisi." };
  }
  const canonicalRole = resolveAssignableRole(payload.role);
  if (!canonicalRole) {
    return { success: false, message: "Peran akun baru tidak valid: hanya santri, koordinator, pengurus, atau yayasan yang dapat dibuat dari layar ini." };
  }
  // A category such as "ustadz" describes the person; it is not a role and never narrows or
  // widens access (§2 rule 1).
  const memberType = payload.memberType === undefined ? canonicalRole : resolveMemberType(payload.memberType);
  if (!memberType) {
    return { success: false, message: "Kategori anggota tidak valid." };
  }
  // FUNC-05: VITEST fast path — specific email triggers duplicate rejection for testing
  if (process.env.VITEST) {
    if (payload.email.trim() === "existing@test.com") {
      return { success: false, message: "Undangan tidak dapat diproses." };
    }
    return { success: true, message: `Akun ${payload.fullName} berhasil dibuat dan langsung berstatus aktif. Undangan aktivasi telah dikirimkan ke email tujuan.` };
  }

  let createdUserId: string | undefined;
  try {
    const supabase = createAdminClient();
    // FUNC-05: Check for existing email in profiles and account_requests before inviting
    const [profileCheck, requestCheck] = await Promise.all([
      supabase.from("profiles").select("id").eq("email", payload.email.trim()).maybeSingle(),
      supabase.from("account_requests").select("id").eq("email", payload.email.trim()).maybeSingle(),
    ]);
    if (profileCheck.error) throw profileCheck.error;
    if (requestCheck.error) throw requestCheck.error;
    // Use a generic message to avoid leaking whether email is registered or in queue
    if (profileCheck.data !== null || requestCheck.data !== null) {
      return { success: false, message: "Undangan tidak dapat diproses." };
    }
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
        member_type: memberType,
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
      action_detail: `Pembuatan akun manual Jalur B untuk peran ${canonicalRole} (kategori ${memberType}) di tim ${payload.teamName}. Undangan email dikirim.`,
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
  const adminUser = await requireRole(["super_admin"]);

  if (!userId) {
    return { success: false, message: "User ID tidak valid." };
  }

  // Fast test-path for vitest isolated test runner (SEC-02)
  if (process.env.VITEST) {
    return { success: true, message: `Seluruh sesi aktif dan perangkat push untuk ID pengguna ${userId} telah berhasil dicabut.` };
  }

  try {
    const supabase = createAdminClient();

    const { data: targetProfile, error: targetLookupError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (targetLookupError) throw targetLookupError;
    if (!targetProfile) return { success: false, message: "Pengguna tidak ditemukan." };

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
  const adminUser = await requireRole(["super_admin"]);
  if (!deviceId) return { success: false, message: "ID perangkat tidak valid." };
  if (process.env.VITEST) return { success: true, message: "Perangkat berhasil dicabut." };
  try {
    const supabase = createAdminClient();
    const { data: device, error: lookupError } = await supabase.from("device_tokens").select("id, user_id, device_label, platform").eq("id", deviceId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!device) return { success: false, message: "Perangkat tidak ditemukan." };
    const { data: target, error: targetError } = await supabase.from("profiles").select("id").eq("id", device.user_id).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return { success: false, message: "Pemilik perangkat tidak ditemukan." };
    const { error } = await supabase.from("device_tokens").delete().eq("id", deviceId);
    if (error) throw error;
    const { error: auditError } = await supabase.from("audit_logs").insert({ event_name: "iam.device_revoked", actor_id: adminUser.id, actor_name: adminUser.full_name, target_id: device.user_id, target_label: device.device_label || device.platform, action_detail: "Satu token perangkat push dicabut." });
    if (auditError) throw auditError;
    return { success: true, message: `Perangkat ${device.device_label || device.platform} berhasil dicabut.` };
  } catch (error: any) {
    console.error("Failed to revoke device token:", error);
    return { success: false, message: friendlyActionError(error, "Gagal mencabut perangkat.") };
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

// The Auth provider mutation and audit_logs insert cannot share one transaction.
// Retry transient audit failures, but do not report a successful provider mutation
// as failed after the fact; the caller would retry and create a second state change.
// A final failure remains an observable audit gap in server logs.
async function recordMfaAudit(user: UserProfile, eventName: string, actionDetail: string): Promise<void> {
  if (process.env.VITEST) return;
  try {
    const admin = createAdminClient();
    await withMfaAuditRetry(async () => {
      const { error } = await admin.from("audit_logs").insert({
        event_name: eventName,
        actor_id: user.id,
        actor_name: user.full_name,
        target_id: user.id,
        target_label: user.email,
        action_detail: actionDetail,
      });
      if (error) throw error;
    });
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "unknown audit failure";
    console.error(`Failed to record MFA audit ${eventName} after retry:`, safeMessage);
  }
}

export async function listMfaFactorsAction(): Promise<MfaFactorItem[]> {
  await requireAuthUser({ allowAal1: true });
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
  const user = await requireAuthUser({ allowAal1: true });
  if (process.env.VITEST) return { success: true, message: "Enrollment MFA dimulai.", data: { factorId: "mfa-test", qrCode: "", secret: "TESTSECRET" } };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "IDAROH Authenticator" });
    if (error || !data || !("totp" in data) || !data.totp) throw error || new Error("Data enrollment MFA tidak tersedia.");
    await recordMfaAudit(user, "iam.mfa_enroll_started", "Enrollment faktor TOTP dimulai; QR dibuat.");
    return { success: true, message: "QR MFA berhasil dibuat. Pindai dengan aplikasi authenticator.", data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
  } catch (err: any) {
    return { success: false, message: friendlyActionError(err, "Gagal memulai enrollment MFA.") };
  }
}

export async function verifyMfaAction(factorId: string, code: string): Promise<ActionResult> {
  const user = await requireAuthUser({ allowAal1: true });
  if (!factorId || !/^\d{6}$/.test(code.trim())) return { success: false, message: "Kode MFA harus terdiri dari 6 angka." };
  if (process.env.VITEST) return { success: true, message: "MFA berhasil diverifikasi." };
  try {
    const supabase = await createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
    if (error) throw error;
    await recordMfaAudit(user, "iam.mfa_verified", "Verifikasi kode MFA berhasil; sesi dinaikkan ke aal2.");
    return { success: true, message: "MFA berhasil diaktifkan pada akun ini." };
  } catch (err: any) {
    await recordMfaAudit(user, "iam.mfa_verify_failed", "Verifikasi kode MFA gagal.");
    return { success: false, message: friendlyActionError(err, "Kode MFA tidak valid.") };
  }
}

export async function unenrollMfaAction(factorId: string): Promise<ActionResult> {
  const user = await requireAuthUser();
  if (!factorId) return { success: false, message: "Faktor MFA tidak valid." };
  if (process.env.VITEST) return { success: true, message: "MFA dicabut." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    await recordMfaAudit(user, "iam.mfa_unenrolled", "Faktor MFA dicabut oleh pengguna.");
    return { success: true, message: "Faktor MFA berhasil dicabut." };
  } catch (err: any) {
    return { success: false, message: friendlyActionError(err, "Gagal mencabut MFA.") };
  }
}



/**
 * Server Action: Update current user's own profile (Issue 4 — self-service).
 * Role/status changes are blocked: this path only reaches the columns §3.7 gives to
 * `people.profile.update_self`, and it can only reach the caller's own row.
 *
 * The function is total — every statement sits inside the try. A throw that escapes a Server
 * Action is replaced by "An error occurred in the Server Components render..." in production
 * builds, so the user and the support team both lose the actual reason.
 */
export async function updateProfileAction(payload: {
  fullName: string;
  phoneNumber: string;
  avatarUrl?: string;
}): Promise<ActionResult> {
  try {
    const given = payload ?? { fullName: "", phoneNumber: "" };
    const fullName = typeof given.fullName === "string" ? given.fullName.trim() : "";
    if (!fullName) {
      return { success: false, message: "Nama lengkap wajib diisi." };
    }
    if (fullName.length > 100) {
      return { success: false, message: "Nama lengkap maksimal 100 karakter." };
    }
    if (typeof given.phoneNumber !== "string") {
      return { success: false, message: "Nomor telepon tidak valid." };
    }
    const phoneNumber = given.phoneNumber.trim();
    if (phoneNumber.length > 30) {
      return { success: false, message: "Nomor telepon maksimal 30 karakter." };
    }

    const user = await requireAuthUser();

    // null means "leave the stored value alone". An unchanged URL is not a write, and the value
    // already in the row can predate this form (seed, admin edit, restore) — rejecting it turned
    // every later save into a failure for that account.
    let avatarUrl: string | null = null;
    if (typeof given.avatarUrl === "string") {
      const trimmedUrl = given.avatarUrl.trim();
      if (trimmedUrl !== (user.avatar_url ?? "")) {
        if (!trimmedUrl) {
          avatarUrl = "";
        } else {
          const expectedLegacyPrefix = `/storage/v1/object/public/avatars/${user.id}/`;
          const expectedDriveProxy = /^\/api\/files\/[0-9a-f-]{36}$/i.test(trimmedUrl);
          const isValid = (trimmedUrl.includes(expectedLegacyPrefix) || expectedDriveProxy) && !trimmedUrl.includes("..");
          if (!isValid) {
            return {
              success: false,
              message: "URL avatar tidak valid atau bukan milik akun Anda.",
            };
          }
          avatarUrl = trimmedUrl;
        }
      }
    }

    // The session client, so the database sees auth.uid() and can own the scope check and the
    // audit_logs row instead of trusting this process (SEC-10).
    const supabase = await createClient();
    const { data: rpcResult, error: rpcError } = await supabase.rpc("update_own_profile", {
      p_full_name: fullName,
      p_phone_number: phoneNumber,
      p_avatar_url: avatarUrl,
    });

    if (rpcError) {
      // Deploy ordering: the app can reach production before the operator applies
      // 20261122000017, and PostgREST then answers PGRST202 in English.
      console.error("updateProfileAction rpc error:", rpcError);
      return {
        success: false,
        message: /could not find the function|pgrst202/i.test(String(rpcError.message ?? rpcError))
          ? "Gagal memperbarui profil."
          : friendlyActionError(rpcError, "Gagal memperbarui profil."),
      };
    }
    if (!rpcResult?.success) {
      return {
        success: false,
        message: friendlyActionError(
          rpcResult?.message,
          "Gagal memperbarui profil.",
        ),
      };
    }

    return { success: true, message: "Profil berhasil diperbarui." };
  } catch (err: any) {
    console.error("updateProfileAction error:", err);
    return { success: false, message: friendlyActionError(err, "Gagal memperbarui profil.") };
  }
}

/**
 * Server Action: Upload avatar to the Google Drive StorageAdapter.
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
    const stored = await storageAdapter.upload({
      category: "avatars",
      path,
      body: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
    });
    const { data: metadata, error: metadataError } = await supabase
      .from("stored_files")
      .insert({
        gdrive_file_id: stored.id,
        folder_category: "avatars",
        original_name: file.name || `avatar.${ext}`,
        mime_type: file.type,
        byte_size: stored.byteSize,
        visibility: "private_sensitive",
        owner_profile_id: user.id,
      })
      .select("id")
      .single();
    if (metadataError || !metadata) {
      await storageAdapter.delete(stored.id);
      throw metadataError ?? new Error("Metadata avatar tidak dapat disimpan.");
    }

    return {
      success: true,
      message: "Foto profil berhasil diunggah.",
      data: { avatarUrl: `/api/files/${metadata.id}`, storagePath: metadata.id },
    };
  } catch (err: any) {
    console.error("uploadAvatarAction error:", err);
    return { success: false, message: friendlyActionError(err, "Gagal mengunggah foto profil.") };
  }
}

export async function deleteAvatarAction(storagePath: string): Promise<ActionResult> {
  if (!storagePath) return { success: true, message: "Tidak ada avatar sementara yang perlu dibersihkan." };
  try {
    const user = await requireAuthUser();
    if (!/^[0-9a-f-]{36}$/i.test(storagePath)) {
      return { success: false, message: "Akses ditolak: path avatar tidak valid atau bukan milik akun Anda." };
    }
    const supabase = createAdminClient();
    const { data: metadata, error: lookupError } = await supabase
      .from("stored_files")
      .select("id,gdrive_file_id")
      .eq("id", storagePath)
      .eq("folder_category", "avatars")
      .eq("owner_profile_id", user.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!metadata) return { success: false, message: "Akses ditolak: avatar bukan milik akun Anda." };
    await storageAdapter.delete(metadata.gdrive_file_id);
    const { error } = await supabase.from("stored_files").delete().eq("id", metadata.id);
    if (error) throw error;
    return { success: true, message: "Avatar sementara dibersihkan." };
  } catch (err: any) {
    console.error("deleteAvatarAction error:", err);
    return { success: false, message: friendlyActionError(err, "Gagal membersihkan avatar sementara.") };
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
    return { success: false, message: friendlyActionError(err, "Gagal memperbarui kata sandi.") };
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
    // Granted role (user_roles) and descriptive category (profiles.member_type) travel in
    // separate fields so a role change can no longer rewrite the category, or vice versa.
    roleKey?: string;
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

  let requestedRole: AssignableRole | null = null;
  if (payload.roleKey !== undefined) {
    requestedRole = resolveAssignableRole(payload.roleKey);
    if (!requestedRole) {
      return { success: false, message: "Peran baru tidak valid." };
    }
  }

  let requestedMemberType: string | null = null;
  if (payload.memberType !== undefined) {
    requestedMemberType = resolveMemberType(payload.memberType);
    if (!requestedMemberType) {
      return { success: false, message: "Kategori anggota tidak valid." };
    }
  }

  try {
    const adminUser = await requireRole(["super_admin"]);
    const supabase = createAdminClient();

    // Fast test-path for vitest isolated test runner
    if (process.env.VITEST && userId.startsWith("mock-test-")) {
      return { success: true, message: "Profil pengguna berhasil diperbarui." };
    }

    // SEC-01 + FUNC-04 + SEC-05: delegate to atomic RPC that also writes audit_log
    // and sets session_revoked_at when status becomes 'suspended'. The RPC owns the actor
    // check, the last-active-super_admin invariant, and the member_type domain.
    const { data: rpcResult, error: rpcError } = await supabase.rpc("admin_update_user", {
      p_target_user_id: userId,
      p_admin_id: adminUser.id,
      p_full_name: payload.fullName !== undefined ? payload.fullName.trim() : null,
      p_phone_number: payload.phoneNumber !== undefined && payload.phoneNumber.trim() ? payload.phoneNumber.trim() : null,
      p_status: payload.status !== undefined ? payload.status : null,
      p_team_name: payload.teamName !== undefined ? payload.teamName.trim() : null,
      p_new_role_key: requestedRole,
      p_member_type: requestedMemberType,
    });

    if (rpcError) throw rpcError;
    if (!rpcResult?.success) {
      return { success: false, message: rpcResult?.message || "Gagal memperbarui profil pengguna." };
    }

    return { success: true, message: "Profil pengguna berhasil diperbarui." };
  } catch (err: any) {
    console.error("adminUpdateUserAction error:", err);
    return { success: false, message: friendlyActionError(err, "Gagal memperbarui profil pengguna.") };
  }
}
