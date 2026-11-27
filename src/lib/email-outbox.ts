import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const DEFAULT_BUDGET_MS = 20_000;

/** Mirrors the push queue: a provider outage costs attempts slowly instead of within one tick. */
function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(attempts - 1, 0));
}

export function emailIdempotencyKey(row: { id: string; reference_id?: string | null; reference_type?: string | null }): string {
  const businessReference = row.reference_type && row.reference_id
    ? `${row.reference_type}:${row.reference_id}`
    : `row:${row.id}`;
  return `idaroh-email/${createHash("sha256").update(businessReference).digest("hex")}`;
}

export interface EmailDrainResult {
  sent: number;
  failed: number;
  /** The budget ran out with rows still due, so the next tick has work to do. */
  deferred?: boolean;
  skipped?: boolean;
  reason?: string;
}

export async function drainEmailOutbox(options: { budgetMs?: number; limit?: number } = {}): Promise<EmailDrainResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { sent: 0, failed: 0, skipped: true, reason: "email_provider_not_configured" };
  }
  const budget = options.budgetMs === undefined ? DEFAULT_BUDGET_MS : Math.max(0, options.budgetMs);
  const deadline = Date.now() + budget;
  if (deadline <= Date.now()) return { sent: 0, failed: 0, deferred: true };

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Requeue rows stuck in processing (e.g. a previous run died mid-send).
  const { error: staleRequeueError } = await admin
    .from("email_outbox")
    .update({ status: "pending", updated_at: now })
    .eq("status", "processing")
    .lt("updated_at", new Date(Date.now() - STALE_PROCESSING_MS).toISOString());
  if (staleRequeueError) throw staleRequeueError;

  const { data: rows, error } = await admin
    .from("email_outbox")
    .select("id, recipient, subject, body_text, attempt_count, reference_id, reference_type")
    .eq("status", "pending")
    .lt("attempt_count", MAX_ATTEMPTS)
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(options.limit || BATCH_SIZE, BATCH_SIZE)));
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  let deferred = false;
  for (const row of (rows || []) as Array<{
    id: string;
    recipient: string;
    subject: string;
    body_text: string;
    attempt_count: number;
    reference_id?: string | null;
    reference_type?: string | null;
  }>) {
    // A row that was not reached stays pending: the next tick, or the worker, picks it up.
    if (Date.now() >= deadline) {
      deferred = true;
      break;
    }
    const { data: claimed, error: claimError } = await admin
      .from("email_outbox")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": emailIdempotencyKey(row),
        },
        body: JSON.stringify({ from, to: [row.recipient], subject: row.subject, text: row.body_text }),
      });
      if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
      const { error: sentError } = await admin
        .from("email_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (sentError) throw new Error("email_outbox_mark_sent_failed");
      sent += 1;
    } catch (err) {
      const attempts = row.attempt_count + 1;
      const { error: failureStateError } = await admin
        .from("email_outbox")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempt_count: attempts,
          next_attempt_at: new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString(),
          last_error: err instanceof Error ? err.message : "send_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (failureStateError) throw new Error("email_outbox_failure_state_update_failed");
      failed += 1;
    }
  }
  return { sent, failed, deferred };
}
