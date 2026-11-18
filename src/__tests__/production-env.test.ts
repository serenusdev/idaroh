import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateProductionEnvironment } = require("../../scripts/validate-production-env.mjs") as {
  validateProductionEnvironment: (env: Record<string, string>) => void;
};

const valid = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_valid",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_valid",
  NEXT_PUBLIC_APP_URL: "https://app.supabase.co",
  CRON_SECRET: "a".repeat(32),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA_valid_turnstile_site",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA_valid_turnstile_secret",
  RESEND_API_KEY: "re_valid_resend_key",
  EMAIL_FROM: "IDAROH <no-reply@idaroh.sch.id>",
};

describe("production environment", () => {
  it("accepts complete non-placeholder configuration", () => {
    expect(() => validateProductionEnvironment(valid)).not.toThrow();
  });
  it.each(["placeholder-key", "dummy-key", "change-me", "your-secret"])("rejects placeholder %s", (key) => {
    expect(() => validateProductionEnvironment({ ...valid, SUPABASE_SERVICE_ROLE_KEY: key })).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });
  it.each(["http://localhost:3000", "https://127.0.0.1", "https://example.test", "not-a-url"])("rejects production URL %s", (url) => {
    expect(() => validateProductionEnvironment({ ...valid, NEXT_PUBLIC_APP_URL: url })).toThrow();
  });
  it("requires cron authentication and disallows test bypass", () => {
    expect(() => validateProductionEnvironment({ ...valid, CRON_SECRET: "" })).toThrow("CRON_SECRET");
    expect(() => validateProductionEnvironment({ ...valid, VITEST: "true" })).toThrow("VITEST");
  });
  it("requires fail-closed Turnstile and the transactional email provider", () => {
    expect(() => validateProductionEnvironment({ ...valid, TURNSTILE_SECRET_KEY: "" })).toThrow("TURNSTILE_SECRET_KEY");
    expect(() => validateProductionEnvironment({ ...valid, RESEND_API_KEY: "" })).toThrow("RESEND_API_KEY");
    expect(() => validateProductionEnvironment({ ...valid, EMAIL_FROM: "" })).toThrow("EMAIL_FROM");
  });
  it("requires the Turnstile site key alongside the secret so the widget can render", () => {
    // Secret without site key would fail-closed every login/registration (no token).
    expect(() => validateProductionEnvironment({ ...valid, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" })).toThrow("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    expect(() => validateProductionEnvironment({ ...valid, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "placeholder-site-key" })).toThrow("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  });
  it("does not require production services in local development", () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });
  it("does not treat CI alone as a production validation bypass", () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: "production", CI: "true" })).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(() => validateProductionEnvironment({ NODE_ENV: "production", CI: "true", CRON_SECRET: "" })).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });
  it("allows only the explicit GitHub Actions compile-only context", () => {
    expect(() => validateProductionEnvironment({
      NODE_ENV: "production",
      CI: "true",
      GITHUB_ACTIONS: "true",
      IDAROH_BUILD_CONTEXT: "ci-compile",
    })).not.toThrow();
    expect(() => validateProductionEnvironment({
      NODE_ENV: "production",
      CI: "true",
      IDAROH_BUILD_CONTEXT: "ci-compile",
    })).toThrow("GitHub Actions");
    expect(() => validateProductionEnvironment({
      NODE_ENV: "production",
      CI: "true",
      GITHUB_ACTIONS: "true",
      IDAROH_BUILD_CONTEXT: "ci-compile",
      VITEST: "true",
    })).toThrow("VITEST");
  });
  it("still validates complete production configuration in CI", () => {
    expect(() => validateProductionEnvironment({ ...valid, CI: "true" })).not.toThrow();
  });
});
