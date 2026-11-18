import { describe, expect, it, vi } from "vitest";
import { withMfaAuditRetry } from "@/lib/auth/mfa-audit";

describe("MFA audit retry", () => {
  it("retries transient failures and returns the successful result", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("temporary-1"))
      .mockRejectedValueOnce(new Error("temporary-2"))
      .mockResolvedValue("recorded");

    await expect(withMfaAuditRetry(operation, { delayMs: 0 })).resolves.toBe("recorded");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("stops after the bounded attempt count", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("audit-unavailable"));

    await expect(withMfaAuditRetry(operation, { maxAttempts: 2, delayMs: 0 })).rejects.toThrow("audit-unavailable");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
