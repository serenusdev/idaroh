import { createAdminClient } from "@/lib/supabase/admin";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const STALE_PROCESSING_MS = 10 * 60 * 1000;

export interface EmailDrainResult {
  sent: number;
  failed: number;
  skipped?: boolean;
  reason?: string;
}

export async function drainEmailOutbox(): Promise<EmailDrainResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { sent: 0, failed: 0, skipped: true, reason: "email_provider_not_configured" };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Requeue rows stuck in processing (e.g. a previous run died mid-send).
  await admin
    .from("email_outbox")
    .update({ status: "pending", updated_at: now })
    .eq("status", "processing")
    .lt("updated_at", new Date(Date.now() - STALE_PROCESSING_MS).toISOString());

  const { data: rows, error } = await admin
    .from("email_outbox")
    .select("id, recipient, subject, body_text, attempt_count")
    .eq("status", "pending")
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const row of (rows || []) as Array<{ id: string; recipient: string; subject: string; body_text: string; attempt_count: number }>) {
    const { data: claimed } = await admin
      .from("email_outbox")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [row.recipient], subject: row.subject, text: row.body_text }),
      });
      if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
      await admin
        .from("email_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id);
      sent += 1;
    } catch (err) {
      const attempts = row.attempt_count + 1;
      await admin
        .from("email_outbox")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempt_count: attempts,
          last_error: err instanceof Error ? err.message : "send_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
    }
  }
  return { sent, failed };
}