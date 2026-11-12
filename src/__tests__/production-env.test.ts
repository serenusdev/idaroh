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
  it("does not require production services in local development", () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });
  it("skips credential checks for CI compile-only builds but still rejects VITEST", () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: "production", CI: "true" })).not.toThrow();
    expect(() => validateProductionEnvironment({ NODE_ENV: "production", CI: "true", VITEST: "true" })).not.toThrow();
    expect(() => validateProductionEnvironment({ NODE_ENV: "production", CI: "false" })).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(() => validateProductionEnvironment({ ...valid, CI: "true", CRON_SECRET: "" })).not.toThrow();
  });
});
