import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  }),
}));
import { updateSession } from "@/lib/supabase/middleware";

function request(path: string) {
  return new NextRequest(new URL(path, "https://app.example.com"));
}
function location(response: Response) {
  return response.headers.get("location");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://real.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "real-anon-key");
  mocks.getUser.mockReset();
  mocks.profile.mockReset();
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.profile.mockResolvedValue({ data: { status: "active" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("updateSession destination handling", () => {
  it("preserves the protected destination when redirecting anonymous pages to login", async () => {
    const response = await updateSession(request("/tugas?tab=aktif#x"));
    expect(response.status).toBe(307);
    const target = new URL(location(response)!);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("next")).toBe("/tugas?tab=aktif");
  });

  it("does not attach a next parameter for the root destination", async () => {
    const target = new URL(location(await updateSession(request("/")))!);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.has("next")).toBe(false);
  });

  it("returns 401 for anonymous API access instead of redirecting", async () => {
    const response = await updateSession(request("/api/exports/x"));
    expect(response.status).toBe(401);
  });

  it("sends an authenticated active user from login to the safe next destination", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const target = new URL(location(await updateSession(request("/login?next=%2Fjadwal%3Fannouncement%3D1")))!);
    expect(target.pathname).toBe("/jadwal");
    expect(target.searchParams.get("announcement")).toBe("1");
  });

  it("falls back to root when the next destination is off-site", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    for (const next of ["https://evil.example/phish", "//evil.example/phish", "/\\evil.example", "javascript:alert(1)"]) {
      const target = new URL(location(await updateSession(request(`/login?next=${encodeURIComponent(next)}`)))!);
      expect(target.origin).toBe("https://app.example.com");
      expect(target.pathname).toBe("/");
    }
  });

  it("fails closed with 503 when configuration is missing or placeholder", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
    expect((await updateSession(request("/tugas"))).status).toBe(503);
    expect((await updateSession(request("/login"))).status).toBe(200);
  });

  it("returns 503 for APIs but lets pages reach the layout retry state during auth outages", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError" } });
    expect((await updateSession(request("/api/exports/x"))).status).toBe(503);
    expect((await updateSession(request("/tugas"))).status).toBe(200);
  });

  it("blocks inactive accounts from APIs while pages fall through to recovery", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mocks.profile.mockResolvedValue({ data: { status: "suspended" }, error: null });
    expect((await updateSession(request("/api/exports/x"))).status).toBe(403);
    expect((await updateSession(request("/tugas"))).status).toBe(200);
  });
});