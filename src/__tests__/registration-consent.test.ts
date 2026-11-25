import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MEMBER_CATEGORIES, REGISTRATION_PRIVACY_VERSION } from "@/modules/iam/registration";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), insert: vi.fn(), update: vi.fn(), select: vi.fn(), eq: vi.fn(),
  maybeSingle: vi.fn(), order: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
  deleteUser: vi.fn(), updateUserById: vi.fn(), requireRole: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: mocks.from, auth: { admin: { deleteUser: mocks.deleteUser, updateUserById: mocks.updateUserById } },
}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { signUp: mocks.signUp, signOut: mocks.signOut },
}) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUserProfile: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireRole: mocks.requireRole, requireAuthUser: vi.fn(),
}));
vi.mock("@/lib/fcm", () => ({ sendPushToUsers: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));

import { getAccountRequestsAction, submitAccountApplicationAction } from "@/modules/iam/actions";

const payload = {
  fullName: "Pendaftar Uji", email: "new@example.test", phoneNumber: "081234567890",
  claimedMemberType: "santri", privacyConsent: true,
  privacyConsentVersion: REGISTRATION_PRIVACY_VERSION, teamRequested: "Tim Uji",
  password: "Test-Password-123", notes: "Catatan uji",
  turnstileToken: "test-turnstile-token",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITEST", "");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret-for-unit-tests");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T02:30:00.000Z"));
  const chain = {
    select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle,
    insert: mocks.insert, update: mocks.update, order: mocks.order,
    then: (resolve: (result: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
  };
  mocks.from.mockReturnValue(chain);
  mocks.select.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.update.mockReturnValue(chain);
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.order.mockResolvedValue({ data: [], error: null });
  mocks.signUp.mockResolvedValue({ data: { user: { id: "auth-new", identities: [{ id: "identity-new" }] }, session: null }, error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.updateUserById.mockResolvedValue({ error: null });
  mocks.requireRole.mockResolvedValue({ id: "admin", role: "super_admin" });
  mocks.rateLimit.mockResolvedValue(true);
  // SEC-11 + TRC-01: mock fetch to return Turnstile success so existing tests pass
  // through the fail-closed validation path with the test secret set above.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("turnstile")) {
      return { ok: true, json: async () => ({ success: true }) };
    }
    // HIBP check
    return { ok: true, text: async () => "" };
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("registration membership claim and versioned consent", () => {
  it.each(MEMBER_CATEGORIES)("stores $value as a claim, never as a granted role", async ({ value }) => {
    const result = await submitAccountApplicationAction({ ...payload, claimedMemberType: value });
    expect(result.success).toBe(true);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      claimed_member_type: value, role_requested: "santri", status: "pending",
      privacy_consent_version: REGISTRATION_PRIVACY_VERSION,
      privacy_consent_at: "2026-11-13T02:30:00.000Z",
    }));
    expect(mocks.from.mock.calls.every(([table]) => table === "account_requests")).toBe(true);
    expect(mocks.signUp.mock.calls[0][0].options.data).toEqual({ full_name: payload.fullName });
  });

  it.each(["super_admin", "koordinator", "Santri", "pengurus super_admin", "", null])("rejects invalid membership claim %s before writes", async (claimedMemberType) => {
    const result = await submitAccountApplicationAction({ ...payload, claimedMemberType: claimedMemberType as string });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Kategori");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it.each([false, undefined, "true", 1])("rejects missing or non-boolean consent %s", async (privacyConsent) => {
    const result = await submitAccountApplicationAction({ ...payload, privacyConsent: privacyConsent as boolean });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Persetujuan");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("requires consent to the currently displayed version", async () => {
    const result = await submitAccountApplicationAction({ ...payload, privacyConsentVersion: "old" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Muat ulang");
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("ignores forged client time and role fields", async () => {
    const forged = { ...payload, claimedMemberType: "yayasan", roleRequested: "super_admin", privacyConsentAt: "2000-01-01" };
    expect((await submitAccountApplicationAction(forged)).success).toBe(true);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      role_requested: "santri", claimed_member_type: "yayasan", privacy_consent_at: "2026-11-13T02:30:00.000Z",
    }));
  });

  it("validates notes at the server boundary", async () => {
    const result = await submitAccountApplicationAction({ ...payload, notes: "x".repeat(501) });
    expect(result.success).toBe(false);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("records fresh consent when a rejected application is resubmitted", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "request-old", status: "rejected", auth_user_id: "auth-old" }, error: null });
    expect((await submitAccountApplicationAction({ ...payload, claimedMemberType: "ustadz" })).success).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      claimed_member_type: "ustadz", role_requested: "santri", status: "pending",
      privacy_consent_version: REGISTRATION_PRIVACY_VERSION, privacy_consent_at: "2026-11-13T02:30:00.000Z",
    }));
    expect(mocks.eq).toHaveBeenCalledWith("id", "request-old");
    expect(mocks.eq).toHaveBeenCalledWith("status", "rejected");
  });

  it("does not report success when the consent write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.insert.mockResolvedValue({ error: new Error("write failed") });
    expect((await submitAccountApplicationAction(payload)).success).toBe(false);
    expect(mocks.deleteUser).toHaveBeenCalledWith("auth-new");
  });

  it("does not change data for existing pending requests", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "request-old", status: "pending", auth_user_id: "auth-old" }, error: null });
    expect((await submitAccountApplicationAction(payload)).success).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});

describe("administrator sees claims separately from permissions", () => {
  it("leaves old/imported requests with no consent explicitly unknown", async () => {
    mocks.order.mockResolvedValue({ data: [{ id: "legacy", full_name: "Legacy", email: "legacy@example.test", created_at: "2026-11-01T00:00:00Z", role_requested: "santri", status: "pending" }], error: null });
    const [request] = await getAccountRequestsAction();
    expect(request.claimedMemberType).toBeNull();
    expect(request.privacyConsentVersion).toBeNull();
    expect(request.privacyConsentAt).toBeNull();
  });

  it("returns persisted category and consent to the authorized queue", async () => {
    mocks.order.mockResolvedValue({ data: [{ id: "new", full_name: "New", email: "new@example.test", created_at: "2026-11-13T02:30:00Z", claimed_member_type: "ustadz", privacy_consent_version: REGISTRATION_PRIVACY_VERSION, privacy_consent_at: "2026-11-13T02:30:00Z", status: "pending" }], error: null });
    const [request] = await getAccountRequestsAction();
    expect(request.claimedMemberType).toBe("ustadz");
    expect(request.privacyConsentVersion).toBe(REGISTRATION_PRIVACY_VERSION);
    // §3.1 (ROLE-SYNC): the queue is a super_admin surface, not a shared admin one.
    expect(mocks.requireRole).toHaveBeenCalledWith(["super_admin"]);
  });

  it("rejects an unauthorized queue read before accessing data", async () => {
    mocks.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(getAccountRequestsAction()).rejects.toThrow("FORBIDDEN");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("REG-02: password minimum 10 characters", () => {
  it("rejects password shorter than 10 characters before any DB write", async () => {
    const result = await submitAccountApplicationAction({ ...payload, password: "Ab123456" }); // 8 chars
    expect(result.success).toBe(false);
    expect(result.message).toContain("10");
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects exactly 9-character password", async () => {
    const result = await submitAccountApplicationAction({ ...payload, password: "Ab1234567" });
    expect(result.success).toBe(false);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("accepts password of exactly 10 characters with letter and digit", async () => {
    const result = await submitAccountApplicationAction({ ...payload, password: "Ab12345678" });
    expect(result.success).toBe(true);
  });
});

describe("SEC-07: uniform registration messages (anti-enumeration)", () => {
  it("does not reveal email status when re-registering a pending account", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "request-old", status: "pending", auth_user_id: "auth-old" }, error: null });
    const result = await submitAccountApplicationAction(payload);
    expect(result.success).toBe(false);
    expect(result.message).not.toMatch(/Status:/i);
    expect(result.message).not.toContain("pending");
    expect(result.message).not.toContain(payload.email);
  });
});
