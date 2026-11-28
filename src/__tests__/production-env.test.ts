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
  GDRIVE_SERVICE_ACCOUNT_JSON: '{"client_email":"drive@example.iam.gserviceaccount.com","private_key":"private-key"}',
  GDRIVE_ROOT_FOLDER_ID: "drive-root-folder",
  RESEND_API_KEY: "re_valid_resend_key",
  EMAIL_FROM: "IDAROH <no-reply@idaroh.sch.id>",
  // DX-01: the direct read-only connection the typed analytics path needs.
  SUPABASE_DB_URL: "postgresql://postgres:valid_db_password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
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
  it("requires Google Drive storage configuration", () => {
    expect(() => validateProductionEnvironment({ ...valid, GDRIVE_SERVICE_ACCOUNT_JSON: "" })).toThrow("GDRIVE_SERVICE_ACCOUNT_JSON");
    expect(() => validateProductionEnvironment({ ...valid, GDRIVE_ROOT_FOLDER_ID: "" })).toThrow("GDRIVE_ROOT_FOLDER_ID");
  });
  it("requires the Turnstile site key alongside the secret so the widget can render", () => {
    // Secret without site key would fail-closed every login/registration (no token).
    expect(() => validateProductionEnvironment({ ...valid, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" })).toThrow("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    expect(() => validateProductionEnvironment({ ...valid, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "placeholder-site-key" })).toThrow("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  });
  it("requires the direct read connection for the typed analytics path", () => {
    // Without it the reader fails closed at runtime; deployment must not discover that in production.
    expect(() => validateProductionEnvironment({ ...valid, SUPABASE_DB_URL: "" })).toThrow("SUPABASE_DB_URL");
    expect(() => validateProductionEnvironment({ ...valid, SUPABASE_DB_URL: "https://project.supabase.co" })).toThrow("postgresql://");
    expect(() => validateProductionEnvironment({ ...valid, SUPABASE_DB_URL: "postgresql://" })).toThrow("postgresql://");
    // An unknown TLS mode would silently fall back to verify-full instead of being configured.
    expect(() => validateProductionEnvironment({ ...valid, SUPABASE_DB_SSL_MODE: "prefer" })).toThrow("SUPABASE_DB_SSL_MODE");
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
