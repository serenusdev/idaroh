import { createAdminClient } from "@/lib/supabase/admin";
import { drainNotificationOutbox } from "@/lib/fcm";
import { drainEmailOutbox } from "@/lib/email-outbox";

type AdminClient = ReturnType<typeof createAdminClient>;

interface JobLease {
  job_key: string;
  lease_token: string;
  attempt_count: number;
}

export interface JobContext {
  admin: AdminClient;
  deadline: number;
}

export type JobOutcome = {
  job: BackgroundJobKey;
  status: "completed" | "failed" | "skipped" | "dead_letter";
  reason?: "lease_held" | "claim_failed" | "handler_failed" | "lease_lost" | "completion_failed";
  attempts?: number;
  maxAttempts?: number;
  detail?: unknown;
};

/**
 * The steps that used to live only inside /api/cron/notifications, one row per name in
 * background_job_runs. The reminder pair is deliberately absent: their due window depends on the
 * admin schedule plus the database day rule, so they stay with the cron that already asks the
 * database before sending anything.
 */
export const BACKGROUND_JOBS = [
  "push-outbox",
  "email-outbox",
  "publish-scheduled",
  "expire-announcements",
  "attendance-snapshot",
  "prune-device-tokens",
] as const;

export type BackgroundJobKey = (typeof BACKGROUND_JOBS)[number];

export function isBackgroundJob(value: unknown): value is BackgroundJobKey {
  return typeof value === "string" && (BACKGROUND_JOBS as readonly string[]).includes(value);
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

/**
 * One claim, one attempt, one ledger write. The lease is what makes the same job safe to run from
 * two places at once (the fallback cron and an external orchestrator, or a slow tick still running
 * when the next one starts): a runner that cannot claim simply reports `skipped` and never touches
 * the queue, so the concurrency limit for every job here is one.
 */
export async function runBackgroundJob(
  admin: AdminClient,
  options: {
    job: BackgroundJobKey;
    leaseSeconds?: number;
    maxAttempts?: number;
    budgetMs?: number;
    handler: (context: JobContext) => Promise<unknown>;
  },
): Promise<JobOutcome> {
  const leaseSeconds = options.leaseSeconds ?? 60;
  const maxAttempts = options.maxAttempts ?? 5;
  let leaseRows: JobLease[] | null = null;
  let claimFailed = false;
  try {
    const claim = await admin.rpc("claim_background_job", {
      p_job_key: options.job,
      p_lease_seconds: leaseSeconds,
      p_max_attempts: maxAttempts,
    });
    claimFailed = Boolean(claim.error);
    leaseRows = claim.data as JobLease[] | null;
  } catch {
    claimFailed = true;
  }
  if (claimFailed) return { job: options.job, status: "failed", reason: "claim_failed" };
  const lease = leaseRows?.[0];
  if (!lease) return { job: options.job, status: "skipped", reason: "lease_held" };

  const deadline = Date.now() + (options.budgetMs ?? 20_000);
  let failure: unknown = null;
  let detail: unknown = null;
  try {
    detail = await options.handler({ admin, deadline });
  } catch (error) {
    failure = error;
  }

  let verdict: string | null = null;
  try {
    const completion = await admin.rpc("complete_background_job", {
      p_job_key: options.job,
      p_lease_token: lease.lease_token,
      p_ok: failure === null,
      p_error: failure === null ? null : shortError(failure),
      p_max_attempts: maxAttempts,
    });
    verdict = completion.error ? null : (completion.data as string | null);
  } catch {
    verdict = null;
  }

  if (verdict === "lease_lost") {
    // A newer runner owns the row now; this attempt's result is not ours to record.
    return { job: options.job, status: "skipped", reason: "lease_lost", attempts: lease.attempt_count, maxAttempts };
  }
  if (failure !== null) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[JOB] Background step failed", { job: options.job, verdict, reason: shortError(failure) });
    }
    return {
      job: options.job,
      status: verdict === "dead_letter" ? "dead_letter" : "failed",
      reason: "handler_failed",
      attempts: lease.attempt_count,
      maxAttempts,
      detail: { error: shortError(failure) },
    };
  }
  if (verdict !== "completed") return { job: options.job, status: "failed", reason: "completion_failed", attempts: lease.attempt_count, maxAttempts };
  return { job: options.job, status: "completed", attempts: lease.attempt_count, maxAttempts, detail };
}

/**
 * Draft rows whose scheduled instant arrived. The conditional update is the claim: a second runner
 * sees zero transitioned rows, and the publication trigger enqueues the audience atomically.
 */
export async function publishDueAnnouncements(admin: AdminClient, nowIso: string): Promise<{ published: number }> {
  const { data: due, error } = await admin
    .from("announcements")
    .select("id")
    .eq("status", "draft")
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", nowIso);
  if (error) throw error;
  let published = 0;
  for (const announcement of (due || []) as Array<{ id: string }>) {
    const { data: transitioned, error: publishError } = await admin
      .from("announcements")
      .update({ status: "published", published_at: nowIso, updated_at: nowIso })
      .eq("id", announcement.id)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (publishError) throw publishError;
    if (transitioned) published += 1;
  }
  return { published };
}

export async function expirePublishedAnnouncements(admin: AdminClient, nowIso: string): Promise<{ archived: number }> {
  const { data, error } = await admin
    .from("announcements")
    .update({ status: "archived", archived_at: nowIso, updated_at: nowIso })
    .eq("status", "published")
    .not("expires_at", "is", null)
    .lte("expires_at", nowIso)
    .select("id");
  if (error) throw error;
  return { archived: (data as Array<{ id: string }> | null)?.length || 0 };
}

export async function refreshAttendanceSnapshot(admin: AdminClient, today: string): Promise<{ refreshed: boolean }> {
  const { error } = await admin.rpc("refresh_attendance_effective", { p_date: today });
  if (error) throw error;
  return { refreshed: true };
}

/** Unseen tokens expire in FCM anyway; the row only inflates every audience read. */
export async function pruneStaleDeviceTokens(admin: AdminClient, cutoff: string): Promise<{ pruned: boolean }> {
  const { error } = await admin.from("device_tokens").delete().lt("updated_at", cutoff);
  if (error) throw error;
  return { pruned: true };
}

export const DEVICE_TOKEN_RETENTION_DAYS = 90;

/**
 * How long a user-initiated action may wait on FCM before returning. The rows stay in the queue, so
 * a short slice is enough to cover the one notification the person just created; the worker's own
 * budget (jobExecutionProfile) is what drains the backlog.
 */
export const INLINE_DISPATCH_BUDGET_MS = 4_000;

/**
 * The worker's view of every job: lease length, attempt ceiling and dispatch budget are all chosen
 * per job here so the HTTP layer stays a thin trigger and the fallback cron keeps its own ordering.
 */
export function jobExecutionProfile(job: BackgroundJobKey): { leaseSeconds: number; maxAttempts: number; budgetMs: number } {
  switch (job) {
    case "push-outbox": return { leaseSeconds: 120, maxAttempts: 5, budgetMs: 20_000 };
    case "email-outbox": return { leaseSeconds: 120, maxAttempts: 5, budgetMs: 20_000 };
    case "publish-scheduled": return { leaseSeconds: 60, maxAttempts: 5, budgetMs: 10_000 };
    case "expire-announcements": return { leaseSeconds: 60, maxAttempts: 5, budgetMs: 10_000 };
    case "attendance-snapshot": return { leaseSeconds: 90, maxAttempts: 3, budgetMs: 10_000 };
    case "prune-device-tokens": return { leaseSeconds: 60, maxAttempts: 3, budgetMs: 10_000 };
  }
}

export function createWorkerJobs(admin: AdminClient, clock: { nowIso: string; today: string }) {
  return {
    "push-outbox": async ({ deadline }: JobContext) => drainNotificationOutbox({ budgetMs: Math.max(0, deadline - Date.now()) }),
    "email-outbox": async ({ deadline }: JobContext) => drainEmailOutbox({ budgetMs: Math.max(0, deadline - Date.now()) }),
    "publish-scheduled": () => publishDueAnnouncements(admin, clock.nowIso),
    "expire-announcements": () => expirePublishedAnnouncements(admin, clock.nowIso),
    "attendance-snapshot": () => refreshAttendanceSnapshot(admin, clock.today),
    "prune-device-tokens": () => pruneStaleDeviceTokens(
      admin,
      new Date(Date.now() - DEVICE_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    ),
  } as Record<BackgroundJobKey, (context: JobContext) => Promise<unknown>>;
}
