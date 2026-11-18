export const MFA_AUDIT_MAX_ATTEMPTS = 3;

export async function withMfaAuditRetry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? MFA_AUDIT_MAX_ATTEMPTS);
  const delayMs = Math.max(0, options.delayMs ?? 25);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("MFA audit write failed.");
}
