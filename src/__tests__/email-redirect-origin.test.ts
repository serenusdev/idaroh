/**
 * Email redirect pinning: confirmation/reset links must never point at
 * ephemeral *.vercel.app preview deployments in production builds.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const helperPath = resolve(root, "src/lib/auth/email-redirect-origin.ts");

const PRODUCTION_ORIGIN = "https://idaroh.pondokabdurrahmanbinauf.web.id";

let loadCounter = 0;
async function loadHelper(): Promise<{
  resolveEmailRedirectOrigin: () => string;
  isEphemeralPreviewOrigin: (origin: string) => boolean;
}> {
  vi.resetModules();
  loadCounter += 1;
  return import(`${helperPath}?v=${loadCounter}`);
}

describe("resolveEmailRedirectOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps localhost usable outside production builds", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const { resolveEmailRedirectOrigin } = await loadHelper();
    expect(resolveEmailRedirectOrigin()).toBe("http://localhost:3000");
  });

  it("honors a configured origin in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3001");
    const { resolveEmailRedirectOrigin } = await loadHelper();
    expect(resolveEmailRedirectOrigin()).toBe("http://localhost:3001");
  });

  it("pins preview deployment URLs to the production origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://abba-os-financebudsteam-6621.vercel.app");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolveEmailRedirectOrigin } = await loadHelper();
    expect(resolveEmailRedirectOrigin()).toBe(PRODUCTION_ORIGIN);
    expect(warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).some((m) => m.includes("[auth]"))).toBe(true);
  });

  it("keeps an explicit non-preview origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", PRODUCTION_ORIGIN);
    const { resolveEmailRedirectOrigin } = await loadHelper();
    expect(resolveEmailRedirectOrigin()).toBe(PRODUCTION_ORIGIN);
  });

  it("falls back to the production origin when the URL is missing or invalid", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const value of ["", "bukan-url"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { resolveEmailRedirectOrigin } = await loadHelper();
      expect(resolveEmailRedirectOrigin()).toBe(PRODUCTION_ORIGIN);
    }
  });

  it("detects only *.vercel.app hostnames as ephemeral previews", async () => {
    const { isEphemeralPreviewOrigin } = await loadHelper();
    expect(isEphemeralPreviewOrigin("https://abba-os-financebudsteam-6621.vercel.app")).toBe(true);
    expect(isEphemeralPreviewOrigin(PRODUCTION_ORIGIN)).toBe(false);
    expect(isEphemeralPreviewOrigin("http://localhost:3000")).toBe(false);
    expect(isEphemeralPreviewOrigin("not-a-url")).toBe(false);
  });
});

describe("call sites use the pinned redirect helper", () => {
  it("signup emailRedirectTo no longer trusts raw NEXT_PUBLIC_APP_URL", () => {
    const source = readFileSync(resolve(root, "src/modules/iam/actions.ts"), "utf8");
    expect(source).toContain('import { resolveEmailRedirectOrigin } from "@/lib/auth/email-redirect-origin"');
    expect(source).toContain("emailRedirectTo: `${resolveEmailRedirectOrigin()}/login`");
    expect(source).not.toContain('emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL');
  });

  it("forgot-password no longer redirects to window.location.origin", () => {
    const source = readFileSync(resolve(root, "src/app/(auth)/forgot-password/page.tsx"), "utf8");
    expect(source).toContain('import { resolveEmailRedirectOrigin } from "@/lib/auth/email-redirect-origin"');
    expect(source).toContain("const redirectTo = `${resolveEmailRedirectOrigin()}/reset-password`");
    expect(source).not.toContain("window.location.origin");
  });
});
