import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const signInState: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      signInWithPassword: async () => ({ data: signInState.data, error: signInState.error }),
    },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => true }));

import { POST } from "@/app/api/auth/login/route";

const aalToken = (aal: string) => `header.${Buffer.from(JSON.stringify({ aal })).toString("base64url")}.sig`;

function loginRequest() {
  return new NextRequest("https://idaroh.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@pondok.id", password: "secret123" }),
  });
}

describe("POST /api/auth/login L1 MFA detection", () => {
  beforeEach(() => {
    signInState.error = null;
    signInState.data = {
      user: { id: "u-1", factors: [{ status: "verified", factor_type: "totp" }] },
      session: { access_token: aalToken("aal1") },
    };
  });

  it("flags mfaRequired challenge for a verified factor below AAL2", async () => {
    const res = await POST(loginRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, mfaRequired: true, mode: "challenge" });
  });

  it("does not flag MFA when the session is already AAL2", async () => {
    signInState.data = {
      user: { id: "u-1", factors: [{ status: "verified", factor_type: "totp" }] },
      session: { access_token: aalToken("aal2") },
    };
    const body = await (await POST(loginRequest())).json();
    expect(body.success).toBe(true);
    expect(body.mfaRequired).toBeUndefined();
  });

  it("does not flag MFA at login when no factor exists (enrollment is enforced downstream)", async () => {
    signInState.data = { user: { id: "u-1", factors: [] }, session: { access_token: aalToken("aal1") } };
    const body = await (await POST(loginRequest())).json();
    expect(body.success).toBe(true);
    expect(body.mfaRequired).toBeUndefined();
  });

  it("returns 401 on invalid credentials", async () => {
    signInState.data = { user: null, session: null };
    signInState.error = { message: "Invalid login credentials" };
    const res = await POST(loginRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
  });
});