import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { isPublicRoute, updateSession } from "@/lib/supabase/middleware";

const ssrState: {
  user: { id: string; factors?: unknown[] } | null;
  profile: { status: string } | null;
  profileError: unknown;
  token: string | null;
} = { user: null, profile: { status: "active" }, profileError: null, token: null };

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: ssrState.user }, error: null }),
      getSession: async () => ({ data: { session: ssrState.token ? { access_token: ssrState.token } : null } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ssrState.profile, error: ssrState.profileError }) }) }),
    }),
  }),
}));

const aalToken = (aal: string) => `header.${Buffer.from(JSON.stringify({ aal })).toString("base64url")}.sig`;
const verifiedTotp = { status: "verified", factor_type: "totp" };

describe("Middleware Route Protection (F-01, F-02, F-07)", () => {
  it("allows authentication and recovery routes without requiring login", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/register")).toBe(true);
    expect(isPublicRoute("/forgot-password")).toBe(true);
    expect(isPublicRoute("/reset-password")).toBe(true);
  });

  it("allows the MFA journey route without requiring a prior AAL2 session", () => {
    expect(isPublicRoute("/mfa")).toBe(true);
    expect(isPublicRoute("/mfa/")).toBe(true);
  });

  it("allows auth API endpoints without 307 redirect", () => {
    expect(isPublicRoute("/api/auth/login")).toBe(true);
  });

  it("allows calendar feed and cron endpoints", () => {
    expect(isPublicRoute("/api/calendar/feed")).toBe(true);
    expect(isPublicRoute("/api/cron/backups")).toBe(true);
    expect(isPublicRoute("/api/cron/notifications")).toBe(true);
  });

  it("allows PWA and offline shell without requiring login", () => {
    expect(isPublicRoute("/sw.js")).toBe(true);
    expect(isPublicRoute("/manifest.webmanifest")).toBe(true);
    expect(isPublicRoute("/offline")).toBe(true);
  });

  it("correctly identifies protected application routes", () => {
    expect(isPublicRoute("/")).toBe(false);
    expect(isPublicRoute("/kehadiran")).toBe(false);
    expect(isPublicRoute("/laporan")).toBe(false);
    expect(isPublicRoute("/tugas")).toBe(false);
    expect(isPublicRoute("/jadwal")).toBe(false);
    expect(isPublicRoute("/review")).toBe(false);
    expect(isPublicRoute("/tim")).toBe(false);
    expect(isPublicRoute("/resources")).toBe(false);
    expect(isPublicRoute("/settings/profile")).toBe(false);
    expect(isPublicRoute("/admin/users")).toBe(false);
    expect(isPublicRoute("/admin/analytics")).toBe(false);
    expect(isPublicRoute("/admin/audit")).toBe(false);
  });

  it("blocks unauthenticated access to protected API endpoints", () => {
    expect(isPublicRoute("/api/exports/export-123")).toBe(false);
  });

  it("handles trailing slashes gracefully", () => {
    expect(isPublicRoute("/login/")).toBe(true);
    expect(isPublicRoute("/forgot-password/")).toBe(true);
    expect(isPublicRoute("/api/auth/login/")).toBe(true);
    expect(isPublicRoute("/kehadiran/")).toBe(false);
  });
});

describe("updateSession L3 MFA challenge defense", () => {
  beforeEach(() => {
    ssrState.user = { id: "u-1", factors: [verifiedTotp] };
    ssrState.profile = { status: "active" };
    ssrState.profileError = null;
    ssrState.token = aalToken("aal1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://real.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "real-anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects a verified-factor AAL1 page request to /mfa?mode=challenge with next", async () => {
    const res = await updateSession(new NextRequest("https://idaroh.test/kehadiran"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/mfa");
    expect(location.searchParams.get("mode")).toBe("challenge");
    expect(location.searchParams.get("next")).toBe("/kehadiran");
  });

  it("blocks a verified-factor AAL1 API request with 403 MFA_REQUIRED", async () => {
    const res = await updateSession(new NextRequest("https://idaroh.test/api/exports/export-123"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/^MFA_REQUIRED:/);
  });

  it("lets an AAL2 session through without an MFA redirect", async () => {
    ssrState.token = aalToken("aal2");
    const res = await updateSession(new NextRequest("https://idaroh.test/kehadiran"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not force enrollment at the middleware layer (no verified factor)", async () => {
    ssrState.user = { id: "u-1", factors: [] };
    const res = await updateSession(new NextRequest("https://idaroh.test/kehadiran"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("routes an authenticated AAL1 user away from /login to the challenge", async () => {
    const res = await updateSession(new NextRequest("https://idaroh.test/login"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/mfa");
    expect(location.searchParams.get("mode")).toBe("challenge");
  });

  it("does not impose MFA on an inactive account (handled by account recovery)", async () => {
    ssrState.profile = { status: "suspended" };
    const res = await updateSession(new NextRequest("https://idaroh.test/api/exports/export-123"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/^FORBIDDEN:/);
  });
});