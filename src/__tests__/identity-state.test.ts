import { describe, it, expect, vi, beforeEach } from "vitest";

type Result = { data: unknown; error: unknown };

const state: { profile: Result; roles: Result; authError: unknown; accessToken?: string; factors?: unknown[] } = {
  profile: { data: null, error: null },
  roles: { data: [], error: null },
  authError: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () =>
        state.authError
          ? { data: { user: null }, error: state.authError }
          : { data: { user: { id: "u-1", email: "u1@pondok.id", created_at: "2026-01-01T00:00:00Z", factors: state.factors ?? [] } }, error: null },
      getClaims: async () =>
        state.authError
          ? { data: { claims: null }, error: state.authError }
          : { data: { claims: { sub: "u-1", email: "u1@pondok.id" } }, error: null },
      getSession: async () => ({ data: { session: { access_token: state.accessToken, user: { factors: state.factors ?? [] } } } }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = table === "profiles" ? state.profile : state.roles;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
      };
      return chain;
    },
  }),
}));

const activeProfile = {
  id: "u-1",
  email: "u1@pondok.id",
  full_name: "Anggota Satu",
  status: "active",
  team_name: null,
  member_type: "santri",
  avatar_url: null,
  phone_number: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  session_revoked_at: null,
};

async function loadResolver() {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  return (await import("@/lib/auth/session")).resolveIdentity();
}

describe("resolveIdentity", () => {
  beforeEach(() => {
    state.profile = { data: activeProfile, error: null };
    state.roles = { data: [], error: null };
    state.authError = null;
    state.accessToken = undefined;
    state.factors = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["unknown", "__proto__", "constructor", "toString"])("rejects unrecognized assigned role %s", async (key) => {
    state.roles = { data: [{ roles: { key } }], error: null };
    expect((await loadResolver()).state).toBe("role_missing");
  });

  it("never grants santri when an active profile has no role rows", async () => {
    const identity = await loadResolver();
    expect(identity.state).toBe("role_missing");
  });

  it("reports a retryable identity error instead of logging out on DB failure", async () => {
    state.profile = { data: null, error: { message: "connection refused" } };
    const identity = await loadResolver();
    expect(identity.state).toBe("identity_error");
    if (identity.state === "identity_error") expect(identity.traceId).toMatch(/[0-9a-f-]{36}/);
  });

  it("distinguishes a missing profile row", async () => {
    state.profile = { data: null, error: null };
    expect((await loadResolver()).state).toBe("profile_missing");
  });

  it("returns inactive status for suspended accounts", async () => {
    state.profile = { data: { ...activeProfile, status: "suspended" }, error: null };
    const identity = await loadResolver();
    expect(identity).toMatchObject({ state: "inactive", status: "suspended" });
  });

  it("reports role query failure without assigning a default role", async () => {
    state.roles = { data: null, error: { message: "private database detail" } };
    expect((await loadResolver()).state).toBe("identity_error");
    expect(console.error).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it.each([undefined, "malformed", `header.${Buffer.from(JSON.stringify({})).toString("base64url")}.sig`])("fails closed on revoked profiles with unverifiable token %s", async (token) => {
    state.profile = { data: { ...activeProfile, session_revoked_at: "2026-11-01T00:00:00Z" }, error: null };
    state.accessToken = token;
    expect((await loadResolver()).state).toBe("unauthenticated");
  });

  it.each([[1793491200, "unauthenticated"], [1793491201, "active"]])("compares verified session issuance %s against revocation", async (iat, expectedState) => {
    state.profile = { data: { ...activeProfile, session_revoked_at: "2026-11-01T00:00:00Z" }, error: null };
    state.roles = { data: [{ roles: { key: "santri" } }], error: null };
    state.accessToken = `header.${Buffer.from(JSON.stringify({ iat })).toString("base64url")}.sig`;
    expect((await loadResolver()).state).toBe(expectedState);
  });

  it("preserves a retryable authentication outage state", async () => {
    vi.stubEnv("VITEST", "");
    state.authError = { name: "AuthRetryableFetchError" };
    expect((await loadResolver()).state).toBe("identity_error");
  });

  it("rejects production test-mode authentication bypass", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "true");
    vi.resetModules();
    await expect(import("@/lib/auth/session")).rejects.toThrow("VITEST must never be enabled in production");
  });

  it("resolves the highest assigned role for a provisioned account", async () => {
    state.roles = { data: [{ roles: { key: "santri" } }, { roles: { key: "pengurus" } }], error: null };
    const identity = await loadResolver();
    expect(identity.state).toBe("active");
    if (identity.state === "active") {
      expect(identity.profile.role).toBe("pengurus");
      expect(identity.profile.roles).toEqual(["pengurus", "santri"]);
    }
  });
});

describe("resolveIdentity MFA enforcement (TRC-10 / IAM-012, owner decision B + Q3)", () => {
  const aalToken = (aal: string) => `header.${Buffer.from(JSON.stringify({ aal })).toString("base64url")}.sig`;
  const verifiedTotp = { status: "verified", factor_type: "totp" };

  beforeEach(() => {
    state.profile = { data: activeProfile, error: null };
    state.roles = { data: [{ roles: { key: "super_admin" } }], error: null };
    state.authError = null;
    state.accessToken = aalToken("aal1");
    state.factors = [];
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("requires super_admin without a factor to enroll", async () => {
    const identity = await loadResolver();
    expect(identity.state).toBe("mfa_required");
    if (identity.state === "mfa_required") {
      expect(identity.mfa.requirement).toBe("needs_enroll");
      expect(identity.profile.role).toBe("super_admin");
    }
  });

  it("requires super_admin with a verified factor below AAL2 to challenge", async () => {
    state.factors = [verifiedTotp];
    const identity = await loadResolver();
    expect(identity.state).toBe("mfa_required");
    if (identity.state === "mfa_required") expect(identity.mfa.requirement).toBe("needs_challenge");
  });

  it("admits super_admin with a verified factor at AAL2", async () => {
    state.factors = [verifiedTotp];
    state.accessToken = aalToken("aal2");
    expect((await loadResolver()).state).toBe("active");
  });

  it("treats an unverified factor as not enrolled for super_admin", async () => {
    state.factors = [{ status: "unverified", factor_type: "totp" }];
    const identity = await loadResolver();
    expect(identity.state).toBe("mfa_required");
    if (identity.state === "mfa_required") expect(identity.mfa.requirement).toBe("needs_enroll");
  });

  it("forces challenge when a verified factor exists but the token carries no aal claim", async () => {
    state.factors = [verifiedTotp];
    state.accessToken = `header.${Buffer.from(JSON.stringify({})).toString("base64url")}.sig`;
    const identity = await loadResolver();
    expect(identity.state).toBe("mfa_required");
    if (identity.state === "mfa_required") expect(identity.mfa.requirement).toBe("needs_challenge");
  });

  it("does not force enrollment on non-super_admin without a factor", async () => {
    state.roles = { data: [{ roles: { key: "santri" } }], error: null };
    expect((await loadResolver()).state).toBe("active");
  });

  it("challenges non-super_admin who has a verified factor below AAL2", async () => {
    state.roles = { data: [{ roles: { key: "pengurus" } }], error: null };
    state.factors = [verifiedTotp];
    const identity = await loadResolver();
    expect(identity.state).toBe("mfa_required");
    if (identity.state === "mfa_required") expect(identity.mfa.requirement).toBe("needs_challenge");
  });

  it("admits non-super_admin with a verified factor at AAL2", async () => {
    state.roles = { data: [{ roles: { key: "pengurus" } }], error: null };
    state.factors = [verifiedTotp];
    state.accessToken = aalToken("aal2");
    expect((await loadResolver()).state).toBe("active");
  });
});
