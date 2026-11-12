import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendPushToUsers: vi.fn(),
  requireRole: vi.fn(async () => ({ id: "admin-1", role: "super_admin" })),
}));
vi.mock("@/lib/fcm", () => ({ sendPushToUsers: mocks.sendPushToUsers }));
vi.mock("@/lib/auth/guards", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { sendTestPushAction } from "@/modules/operations/actions";

beforeEach(() => {
  vi.stubEnv("VITEST", "");
  mocks.sendPushToUsers.mockReset();
  mocks.requireRole.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("test push honesty", () => {
  it("reports success only when FCM actually accepted a send", async () => {
    mocks.sendPushToUsers.mockResolvedValue({ sent: 2, removed: 0, skipped: false });
    const result = await sendTestPushAction();
    expect(result).toMatchObject({ success: true, sent: 2, skipped: false });
    expect(result.message).toContain("FCM menerima");
    expect(result.message).toContain("perangkat");
    expect(mocks.requireRole).toHaveBeenCalledWith(["super_admin", "yayasan", "pengurus"]);
    expect(mocks.sendPushToUsers.mock.calls[0][0]).toEqual(["admin-1"]);
  });

  it("does not claim success when no device was accepted", async () => {
    mocks.sendPushToUsers.mockResolvedValue({ sent: 0, removed: 0, skipped: false });
    const result = await sendTestPushAction();
    expect(result).toMatchObject({ success: false, sent: 0, skipped: false });
    expect(result.message).toContain("Belum ada push yang diterima FCM");
  });

  it("does not claim success when credentials are missing", async () => {
    mocks.sendPushToUsers.mockResolvedValue({ sent: 0, removed: 0, skipped: true });
    const result = await sendTestPushAction();
    expect(result).toMatchObject({ success: false, sent: 0, skipped: true });
    expect(result.message).toContain("Firebase");
  });

  it("propagates dispatcher failures instead of reporting a sent push", async () => {
    mocks.sendPushToUsers.mockRejectedValue(new Error("persist failed"));
    await expect(sendTestPushAction()).rejects.toThrow("persist failed");
  });
});