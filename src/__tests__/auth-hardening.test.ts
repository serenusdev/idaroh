/**
 * Auth hardening: Turnstile CSP allowance, widget resilience wiring,
 * honeypot autofill resistance, and sanitized registration diagnostics.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

// ---------------------------------------------------------------------------
// CSP (next.config.mjs)
// ---------------------------------------------------------------------------

async function loadCsp(production: boolean): Promise<Record<string, string>> {
  vi.resetModules();
  if (production) vi.stubEnv("NODE_ENV", "production");
  const configPath = pathToFileURL(resolve(root, "next.config.mjs")).href;
  const configuration = (await import(`${configPath}?v=${production ? "prod" : "dev"}`)).default;
  const nextConfig = configuration("phase-development-server");
  const headers = await nextConfig.headers();
  const csp = headers[0].headers.find((h: { key: string }) => h.key === "Content-Security-Policy");
  expect(csp, "CSP header must be configured").toBeTruthy();
  const directives: Record<string, string> = {};
  for (const part of csp.value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...sources] = trimmed.split(/\s+/);
    directives[name] = sources.join(" ");
  }
  return directives;
}

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

describe("CSP authorizes Cloudflare Turnstile without loosening posture", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([false, true])("allows Turnstile in script/frame/connect-src (production=%s)", async (production) => {
    const directives = await loadCsp(production);
    expect(directives["script-src"]).toContain(TURNSTILE_ORIGIN);
    expect(directives["frame-src"]).toContain(TURNSTILE_ORIGIN);
    expect(directives["connect-src"]).toContain(TURNSTILE_ORIGIN);
  });

  it("keeps the strict baseline directives intact", async () => {
    const directives = await loadCsp(false);
    expect(directives["default-src"]).toBe("'self'");
    expect(directives["frame-ancestors"]).toBe("'none'");
    expect(directives["base-uri"]).toBe("'self'");
    expect(directives["form-action"]).toBe("'self'");
    expect(directives["connect-src"]).toContain("https://*.supabase.co");
  });

  it("never ships unsafe-eval in production script-src", async () => {
    const directives = await loadCsp(true);
    expect(directives["script-src"]).not.toContain("unsafe-eval");
  });
});

// ---------------------------------------------------------------------------
// Turnstile widget + page wiring (source-level contract)
// ---------------------------------------------------------------------------

const widgetSrc = readFileSync(resolve(root, "src/components/ui/turnstile-widget.tsx"), "utf8");
const loginSrc = readFileSync(resolve(root, "src/app/(auth)/login/page.tsx"), "utf8");
const registerSrc = readFileSync(resolve(root, "src/app/(auth)/register/page.tsx"), "utf8");

describe("Turnstile widget resilience", () => {
  it("handles challenge error and expiry callbacks", () => {
    expect(widgetSrc).toMatch(/"error-callback"/);
    expect(widgetSrc).toMatch(/"expired-callback"/);
  });

  it("detects script load failure and offers retry", () => {
    expect(widgetSrc).toMatch(/addEventListener\("error"/);
    expect(widgetSrc).toMatch(/scriptError/);
    expect(widgetSrc).toMatch(/Muat ulang verifikasi/);
  });

  it("resets token state through resetNonce re-render", () => {
    expect(widgetSrc).toMatch(/resetNonce/);
    for (const page of [loginSrc, registerSrc]) {
      expect(page).toMatch(/onScriptError=\{/);
      expect(page).toMatch(/resetNonce=\{turnstileResetNonce\}/);
      expect(page).toMatch(/setTurnstileResetNonce\(\(n\) => n \+ 1\)/);
    }
  });
});

// ---------------------------------------------------------------------------
// Registration honeypot autofill hardening
// ---------------------------------------------------------------------------

describe("registration honeypot autofill resistance", () => {
  const honeypotBlock = registerSrc.slice(
    registerSrc.indexOf('aria-hidden="true"'),
    registerSrc.indexOf("<Input"),
  );

  it("keeps the website field name and server-side check", () => {
    expect(honeypotBlock).toMatch(/name="website"/);
    expect(registerSrc).toMatch(/website: formData\.website/);
  });

  it("carries every autofill-resistance attribute", () => {
    expect(honeypotBlock).toMatch(/autoComplete="new-password"/);
    expect(honeypotBlock).toMatch(/data-lpignore="true"/);
    expect(honeypotBlock).toMatch(/data-1p-ignore="true"/);
    expect(honeypotBlock).toMatch(/data-form-type="other"/);
    expect(honeypotBlock).toMatch(/tabIndex=\{-1\}/);
    expect(honeypotBlock).toMatch(/aria-hidden="true"/);
    expect(honeypotBlock).toMatch(/left-\[-9999px\]/);
    expect(honeypotBlock).toMatch(/pointer-events-none/);
  });
});

// ---------------------------------------------------------------------------
// Sanitized registration diagnostics
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  from: vi.fn(), signUp: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: mocks.from, auth: { admin: { deleteUser: vi.fn(), updateUserById: vi.fn() } },
}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { signUp: mocks.signUp, signOut: vi.fn() },
}) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUserProfile: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireRole: vi.fn(), requireAuthUser: vi.fn(),
}));
vi.mock("@/lib/fcm", () => ({ sendPushToUsers: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));

import { submitAccountApplicationAction } from "@/modules/iam/actions";
import { REGISTRATION_PRIVACY_VERSION } from "@/modules/iam/registration";

const PII_EMAIL = "pendaftar-pii@example.test";
const basePayload = {
  fullName: "Pendaftar Uji", email: PII_EMAIL, phoneNumber: "081234567890",
  claimedMemberType: "santri", privacyConsent: true,
  privacyConsentVersion: REGISTRATION_PRIVACY_VERSION, teamRequested: "Tim Uji",
  password: "Test-Password-123", notes: "Catatan uji",
  turnstileToken: "test-turnstile-token",
};

describe("registration diagnostics", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VITEST", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret-for-unit-tests");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.rateLimit.mockResolvedValue(true);
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "auth-new", identities: [{ id: "i" }] }, session: null }, error: null,
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("turnstile")) return { ok: true, json: async () => ({ success: true }) };
      return { ok: true, text: async () => "" };
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const logged = () => warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");

  it("logs the honeypot trigger without leaking PII and writes nothing", async () => {
    const result = await submitAccountApplicationAction({ ...basePayload, website: "http://spam.example" });
    expect(result.success).toBe(false);
    expect(result.message).toBe("Permohonan tidak dapat diproses.");
    expect(logged()).toContain("[iam-registration] stage=honeypot");
    expect(logged()).not.toContain(PII_EMAIL);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("distinguishes a missing Turnstile token from other stages", async () => {
    const result = await submitAccountApplicationAction({ ...basePayload, turnstileToken: "" });
    expect(result.success).toBe(false);
    expect(result.message).toBe("Verifikasi keamanan wajib diselesaikan.");
    expect(logged()).toContain("stage=turnstile reason=token-missing");
    expect(logged()).not.toContain("stage=honeypot");
  });

  it("distinguishes siteverify rejection and reports error-codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    }));
    const result = await submitAccountApplicationAction(basePayload);
    expect(result.success).toBe(false);
    expect(logged()).toContain("stage=turnstile reason=siteverify-rejected");
    expect(logged()).toContain("codes=invalid-input-response");
  });

  it("logs auth-stage failures with sanitized signup error only", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: `An account for ${PII_EMAIL} already exists`, status: 422, error_code: "user_exists" },
    });
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    const result = await submitAccountApplicationAction(basePayload);
    expect(result.success).toBe(false);
    expect(logged()).toContain("stage=auth reason=signup-failed code=user_exists status=422");
    expect(logged()).not.toContain(PII_EMAIL);
  });
});
