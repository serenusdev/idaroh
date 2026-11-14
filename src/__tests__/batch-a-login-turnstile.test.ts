/**
 * Batch A — SEC-11 + TRC-01: Turnstile fail-closed for POST /api/auth/login
 *
 * Covers the four scenarios required by BLOCKER-2 of batch-a-review.json:
 *   (a) rejects when TURNSTILE_SECRET_KEY is unset (503)
 *   (b) rejects when turnstileToken is missing (400)
 *   (c) rejects when Cloudflare returns success=false (400)
 *   (d) allows when token validates (200)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock rate-limit and enforceRateLimit so the route never hits real storage
// ---------------------------------------------------------------------------
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => true),
}));

// ---------------------------------------------------------------------------
// Mock @supabase/ssr so signInWithPassword can be controlled per test
// ---------------------------------------------------------------------------
const supabaseMocks = vi.hoisted(() => ({
  signInWithPasswordResult: {
    data: { user: { id: "user-1" }, session: {} },
    error: null,
  } as { data: { user: { id: string } | null; session: unknown }; error: { message: string } | null },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn(async () => supabaseMocks.signInWithPasswordResult),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Import the route handler AFTER mocks are registered
// ---------------------------------------------------------------------------
import { POST } from "@/app/api/auth/login/route";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3001/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.unstubAllEnvs();
  // Restore fetch to avoid cross-test pollution
  vi.restoreAllMocks();
  supabaseMocks.signInWithPasswordResult = {
    data: { user: { id: "user-1" }, session: {} },
    error: null,
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SEC-11 + TRC-01 — POST /api/auth/login Turnstile fail-closed", () => {
  it("(a) rejects with 503 when TURNSTILE_SECRET_KEY is not set", async () => {
    // Clear VITEST so the route's Turnstile guard executes, then do NOT set key
    vi.stubEnv("VITEST", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    const req = makeRequest({
      email: "user@test.com",
      password: "StrongPass123",
      turnstileToken: "some-token",
    });

    const response = await POST(req);
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("belum dikonfigurasi");
  });

  it("(b) rejects with 400 when turnstileToken is missing", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret-key");

    const req = makeRequest({
      email: "user@test.com",
      password: "StrongPass123",
      // No turnstileToken field
    });

    const response = await POST(req);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("Verifikasi keamanan wajib diselesaikan");
  });

  it("(c) rejects with 400 when Cloudflare returns success=false", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret-key");

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false }),
    } as Response);

    const req = makeRequest({
      email: "user@test.com",
      password: "StrongPass123",
      turnstileToken: "invalid-token",
    });

    const response = await POST(req);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("Verifikasi keamanan gagal");
  });

  it("(d) allows login through when Turnstile token validates successfully", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret-key");

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    const req = makeRequest({
      email: "user@test.com",
      password: "StrongPass123",
      turnstileToken: "valid-token",
    });

    const response = await POST(req);
    // Should reach Supabase auth and succeed (mocked to return user)
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
  });
});
