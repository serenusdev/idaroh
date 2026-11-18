import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IdentityState } from "@/lib/auth/session";
import type { UserProfile } from "@/lib/auth/types";
import type { MfaState } from "@/lib/auth/mfa-assurance";

const { resolveIdentityMock } = vi.hoisted(() => ({ resolveIdentityMock: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  resolveIdentity: resolveIdentityMock,
}));

import { requireAuthUser, requireRole } from "@/lib/auth/guards";

const profile: UserProfile = {
  id: "u-1",
  email: "admin@pondok.id",
  full_name: "Super Admin",
  role: "super_admin",
  roles: ["super_admin"],
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const challengeMfa: MfaState = {
  currentLevel: "aal1",
  nextLevel: "aal2",
  hasVerifiedFactor: true,
  isSuperAdmin: true,
  requirement: "needs_challenge",
};

function setState(state: IdentityState) {
  resolveIdentityMock.mockResolvedValue(state);
}

describe("requireAuthUser MFA enforcement (L2 hard gate)", () => {
  beforeEach(() => {
    resolveIdentityMock.mockReset();
  });

  it("returns the profile for an active AAL2 session", async () => {
    setState({ state: "active", profile });
    expect(await requireAuthUser()).toEqual(profile);
  });

  it("blocks mfa_required with MFA_REQUIRED when allowAal1 is not set", async () => {
    setState({ state: "mfa_required", profile, mfa: challengeMfa });
    await expect(requireAuthUser()).rejects.toThrow(/^MFA_REQUIRED:/);
  });

  it("permits mfa_required only for the scoped allowAal1 journey", async () => {
    setState({ state: "mfa_required", profile, mfa: challengeMfa });
    expect(await requireAuthUser({ allowAal1: true })).toEqual(profile);
  });

  it("fails closed on mfa_error with UNAVAILABLE and a trace code", async () => {
    setState({ state: "mfa_error", profile, traceId: "trace-abc" });
    await expect(requireAuthUser()).rejects.toThrow(/^UNAVAILABLE:.*trace-abc/);
  });

  it("permits mfa_error for allowAal1 so the user can still recover or sign out", async () => {
    setState({ state: "mfa_error", profile, traceId: "trace-abc" });
    expect(await requireAuthUser({ allowAal1: true })).toEqual(profile);
  });

  it("rejects unauthenticated callers", async () => {
    setState({ state: "unauthenticated" });
    await expect(requireAuthUser()).rejects.toThrow(/^UNAUTHORIZED:/);
  });

  it("rejects inactive accounts", async () => {
    setState({ state: "inactive", status: "suspended", email: profile.email, fullName: profile.full_name });
    await expect(requireAuthUser()).rejects.toThrow(/^FORBIDDEN:/);
  });

  it("reports identity_error as retryable UNAVAILABLE", async () => {
    setState({ state: "identity_error", traceId: "trace-xyz" });
    await expect(requireAuthUser()).rejects.toThrow(/^UNAVAILABLE:.*trace-xyz/);
  });
});

describe("requireRole under MFA enforcement", () => {
  beforeEach(() => {
    resolveIdentityMock.mockReset();
  });

  it("enforces the MFA gate before the role check", async () => {
    setState({ state: "mfa_required", profile, mfa: challengeMfa });
    await expect(requireRole(["super_admin"])).rejects.toThrow(/^MFA_REQUIRED:/);
  });

  it("allows a matching role through the scoped allowAal1 journey", async () => {
    setState({ state: "mfa_required", profile, mfa: challengeMfa });
    expect(await requireRole(["super_admin"], { allowAal1: true })).toEqual(profile);
  });

  it("does not let allowAal1 bypass role authorization", async () => {
    setState({ state: "mfa_required", profile, mfa: challengeMfa });
    await expect(requireRole(["yayasan"], { allowAal1: true })).rejects.toThrow(/^FORBIDDEN:/);
  });
});