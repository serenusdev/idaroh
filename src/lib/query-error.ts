export class QueryError extends Error {
  readonly correlationId: string;

  constructor(message: string, correlationId: string) {
    super(`${message} (ID: ${correlationId})`);
    this.name = "QueryError";
    this.correlationId = correlationId;
  }
}

// OPS-04: console.error already lands in Vercel logs; this optional hook lets an
// operator forward production errors to an alerting drain (Slack webhook, Sentry
// store endpoint, log drain) by setting OPS_ERROR_WEBHOOK_URL. No-op without it.
function forwardToDrain(scope: string, correlationId: string, error: unknown): void {
  const url = process.env.OPS_ERROR_WEBHOOK_URL;
  if (!url) return;
  const payload = JSON.stringify({
    kind: "query_error",
    scope,
    correlationId,
    message: errorToMessage(error),
    at: new Date().toISOString(),
  });
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

export function throwQueryError(scope: string, error: unknown): never {
  const correlationId = `QRY-${Date.now().toString(36).toUpperCase()}`;
  console.error(`[${correlationId}] ${scope}`, error);
  forwardToDrain(scope, correlationId, error);
  throw new QueryError("Data gagal dimuat. Coba lagi atau hubungi administrator", correlationId);
}
import { errorToMessage } from "@/lib/action-error";

