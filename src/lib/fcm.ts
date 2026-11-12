import { createHash, createSign, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PushMessage {
  type: string;
  title: string;
  body: string;
  url: string;
  referenceId?: string;
}

interface FirebaseCredentials {
  project_id: string;
  client_email: string;
  private_key: string;
}

function readCredentials(): FirebaseCredentials | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as FirebaseCredentials;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function getAccessToken(credentials: FirebaseCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = encodeBase64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`FCM OAuth token request failed (${response.status})`);
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("FCM OAuth response did not contain an access token");
  return data.access_token;
}

type PushResult = { sent: number; removed: number; skipped: boolean };
type AdminClient = ReturnType<typeof createAdminClient>;
interface ClaimedPush {
  notification_id: string;
  lease_token: string;
  attempt_count: number;
  delivered_token_hashes: string[];
  user_id: string;
  notification_type: string;
  title: string;
  body: string;
  url: string;
  reference_id: string;
}

function networkErrorCode(error: unknown): string {
  return error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
    ? "network_timeout" : "network_error";
}

async function checkpoint(admin: AdminClient, job: ClaimedPush, tokenHash?: string) {
  const { data, error } = await admin.rpc("checkpoint_notification_push", {
    p_notification_id: job.notification_id,
    p_lease_token: job.lease_token,
    p_delivered_token_hash: tokenHash || null,
  });
  // A stale worker must stop, not overwrite a reclaimed lease or send more tokens.
  if (error || data !== true) throw new Error("Push checkpoint failed or lease lost");
}

async function finish(admin: AdminClient, job: ClaimedPush, retry: boolean, code: string | null) {
  const { data, error } = await admin.rpc("finish_notification_push", {
    p_notification_id: job.notification_id,
    p_lease_token: job.lease_token,
    p_retry: retry,
    p_error_code: code,
  });
  if (error || data !== true) throw new Error("Push completion failed or lease lost");
  if (retry) console.warn("[FCM] Delivery deferred", { notificationId: job.notification_id, code });
}

/** Dispatch due work only. Credentials absent: do not claim or consume attempts.
 * FCM acceptance is at-least-once; checkpoint each accepted token before continuing. */
export async function drainNotificationOutbox(options: {
  notificationIds?: string[];
  notificationType?: string;
  referenceId?: string;
  limit?: number;
} = {}): Promise<PushResult> {
  const result: PushResult = { sent: 0, removed: 0, skipped: false };
  const credentials = readCredentials();
  if (!credentials) return { ...result, skipped: true };
  if (options.notificationIds?.length === 0) return result;

  const admin = createAdminClient();
  let accessToken: string | undefined;
  const deadline = Date.now() + 20_000;
  const limit = Math.max(1, Math.min(options.limit || 50, 100));
  for (let attempt = 0; attempt < limit && Date.now() < deadline; attempt += 1) {
    const { data, error } = await admin.rpc("claim_notification_push", {
      p_notification_ids: options.notificationIds || null,
      p_notification_type: options.notificationType || null,
      p_reference_id: options.referenceId ?? null,
    });
    if (error) throw new Error("Push claim failed");
    const job = (data as ClaimedPush[] | null)?.[0];
    if (!job) break;
    const { data: devices, error: deviceError } = await admin.from("device_tokens")
      .select("token").eq("user_id", job.user_id);
    if (deviceError) {
      await finish(admin, job, true, "device_lookup_failed");
      continue;
    }
    if (!devices?.length) {
      await finish(admin, job, false, "no_device");
      continue;
    }
    const delivered = new Set(job.delivered_token_hashes);
    const tokens = Array.from(new Set((devices as Array<{ token: string }>).map((device) => device.token)))
      .filter((token) => !delivered.has(hashCalendarToken(token)));
    if (tokens.length > 0 && !accessToken) {
      try {
        accessToken = await getAccessToken(credentials);
      } catch {
        await finish(admin, job, true, "oauth_failed");
        break;
      }
    }
    let retryCode: string | null = null;
    let terminalCode: string | null = null;
    for (const token of tokens) {
      if (Date.now() >= deadline) {
        retryCode = "dispatch_budget";
        break;
      }
      await checkpoint(admin, job);
      let response: Response;
      let failure: { error?: { status?: string; details?: Array<{ "@type"?: string; errorCode?: string }> } } = {};
      try {
        response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.project_id)}/messages:send`,
          {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: job.title, body: job.body },
                data: {
                  type: job.notification_type, url: job.url, route: job.url,
                  referenceId: job.reference_id, notificationId: job.notification_id,
                },
              },
            }),
          }
        );
        if (!response.ok) {
          // Parse only structured codes. Never log a response, token, or OAuth payload.
          try { failure = await response.json(); } catch { /* Unknown errors are retryable. */ }
        }
      } catch (error) {
        retryCode = networkErrorCode(error);
        continue;
      }
      if (response.ok) {
        result.sent += 1;
        await checkpoint(admin, job, hashCalendarToken(token));
        continue;
      }
      const details = failure?.error?.details;
      const unregistered = Array.isArray(details) && details.some((detail) =>
        detail?.["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError"
        && detail.errorCode === "UNREGISTERED"
      );
      if (unregistered) {
        const { error: removeError } = await admin.from("device_tokens").delete()
          .eq("user_id", job.user_id).eq("token", token);
        if (removeError) retryCode = "token_remove_failed";
        else {
          result.removed += 1;
          terminalCode = "fcm_unregistered";
        }
      } else {
        retryCode = failure?.error?.status === "INVALID_ARGUMENT" ? "fcm_invalid_argument"
          : response.status === 429 || response.status >= 500 ? "fcm_transient" : "fcm_rejected";
      }
    }
    await finish(admin, job, retryCode !== null, retryCode || terminalCode);
  }
  return result;
}

/** Persist inbox rows (trigger enqueues atomically) before attempting push.
 * Persistence errors deliberately propagate to the business caller. */
export async function sendPushToUsers(userIds: string[], message: PushMessage): Promise<PushResult> {
  const recipients = Array.from(new Set(userIds));
  if (recipients.length === 0) return { sent: 0, removed: 0, skipped: !readCredentials() };
  const admin = createAdminClient();
  const referenceId = message.referenceId || randomUUID();
  const { error } = await admin.from("notifications").upsert(
    recipients.map((userId) => ({
      user_id: userId, notification_type: message.type, title: message.title, body: message.body,
      url: message.url || "/", reference_id: referenceId,
    })),
    { onConflict: "user_id,notification_type,reference_id", ignoreDuplicates: true }
  );
  if (error) throw error;
  // Include previously persisted duplicates, but never resend completed work.
  const { data: notifications, error: readError } = await admin.from("notifications").select("id")
    .in("user_id", recipients).eq("notification_type", message.type).eq("reference_id", referenceId);
  if (readError) throw readError;
  return drainNotificationOutbox({
    notificationIds: (notifications || []).map((row: { id: string }) => row.id),
  });
}

export async function sendBroadcastPush(message: PushMessage) {
  const admin = createAdminClient();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id")
    .eq("status", "active");
  if (error) throw error;
  return sendPushToUsers((profiles || []).map((profile: { id: string }) => profile.id), message);
}

export function hashCalendarToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
