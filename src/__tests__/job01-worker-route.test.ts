import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  drains: [] as string[],
  failPublish: true,
}));

vi.mock("@/lib/fcm", () => ({
  drainNotificationOutbox: vi.fn(async () => { h.drains.push("push"); return { sent: 0, removed: 0, skipped: false }; }),
  sendPushToUsers: vi.fn(),
}));
vi.mock("@/lib/email-outbox", () => ({
  drainEmailOutbox: vi.fn(async () => { h.drains.push("email"); return { sent: 0, failed: 0, deferred: false }; }),
}));
vi.mock("@/lib/auth/guards", () => ({
  getJakartaTime: () => ({ dateStr: "2026-11-27", hours: 12, minutes: 0 }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      if (name === "claim_background_job") return { data: [{ job_key: args.p_job_key, lease_token: `lease-${args.p_job_key}`, attempt_count: 1 }], error: null };
      if (name === "complete_background_job") return { data: args.p_ok ? "completed" : "failed", error: null };
      return { data: null, error: null };
    }),
    from: (table: string) => {
      if (table === "announcements") {
        return {
          select: () => ({
            eq: () => ({ not: () => ({ lte: () => Promise.resolve(h.failPublish
              ? { data: null, error: new Error("announcement read failed") }
              : { data: [{ id: "a-1" }], error: null }) }) }),
          }),
          update: () => ({
            eq: () => ({ not: () => ({ lte: () => ({ select: () => Promise.resolve({ data: [{ id: "a-1" }], error: null }) }) }),
              select: () => ({ maybeSingle: async () => ({ data: { id: "a-1" }, error: null }) }) }),
          }),
        };
      }
      return {
        delete: () => ({ lt: () => Promise.resolve({ data: [], error: null }) }),
      };
    },
  })),
}));

import { GET, POST } from "@/app/api/worker/jobs/route";

const request = (url: string, auth?: string) =>
  new Request(url, auth ? { headers: { authorization: auth } } : undefined);

beforeEach(() => {
  h.rpcCalls.length = 0;
  h.drains.length = 0;
  h.failPublish = true;
  vi.stubEnv("CRON_SECRET", "cron-secret-value");
  vi.stubEnv("WORKER_SECRET", "worker-secret-value");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("JOB-01 — /api/worker/jobs", () => {
  it("refuses an unauthenticated invocation without touching the queue", async () => {
    const response = await GET(request("http://localhost/api/worker/jobs"));
    expect(response.status).toBe(401);
    expect(h.rpcCalls).toEqual([]);
    expect(h.drains).toEqual([]);
  });

  it("refuses a wrong secret even though it is the same length", async () => {
    const response = await GET(request("http://localhost/api/worker/jobs", "Bearer xxxxxxxxxxxxxxxxxxxxxxxx"));
    expect(response.status).toBe(401);
    expect(h.rpcCalls).toEqual([]);
  });

  it("only accepts GET, so the external scheduler keeps one verb", async () => {
    const response = await POST(request("http://localhost/api/worker/jobs", "Bearer worker-secret-value"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("runs one named job under its own lease", async () => {
    h.failPublish = false;
    const response = await GET(request("http://localhost/api/worker/jobs?job=push-outbox", "Bearer worker-secret-value"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, results: [{ job: "push-outbox", status: "completed" }] });
    expect(h.drains).toEqual(["push"]);
    expect(h.rpcCalls.map((call) => call.name)).toEqual(["claim_background_job", "complete_background_job"]);
    expect(h.rpcCalls[0].args).toMatchObject({ p_job_key: "push-outbox" });
    expect(h.rpcCalls[1].args).toMatchObject({ p_job_key: "push-outbox", p_ok: true, p_lease_token: "lease-push-outbox" });
  });

  it("answers the cron secret too, so the operator keeps one credential", async () => {
    vi.stubEnv("WORKER_SECRET", "");
    const response = await GET(request("http://localhost/api/worker/jobs?job=email-outbox", "Bearer cron-secret-value"));
    expect(response.status).toBe(200);
    expect(h.drains).toEqual(["email"]);
  });

  it("refuses an unknown job instead of widening to everything", async () => {
    const response = await GET(request("http://localhost/api/worker/jobs?job=drop-database", "Bearer worker-secret-value"));
    expect(response.status).toBe(400);
    expect(h.drains).toEqual([]);
    expect(h.rpcCalls).toEqual([]);
  });

  it("isolates every step so one failure cannot strand the rest", async () => {
    const response = await GET(request("http://localhost/api/worker/jobs?job=all", "Bearer worker-secret-value"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results.map((row: { job: string }) => row.job)).toEqual([
      "push-outbox", "email-outbox", "publish-scheduled", "expire-announcements", "attendance-snapshot", "prune-device-tokens",
    ]);
    expect(body.results.find((row: { job: string }) => row.job === "publish-scheduled")).toMatchObject({ status: "failed", reason: "handler_failed" });
    expect(body.results.filter((row: { status: string }) => row.status === "completed").length).toBe(5);
    expect(h.drains).toEqual(["push", "email"]);
  });

  it("skips a job another runner already holds", async () => {
    const held = vi.fn(async (name: string) => (
      name === "claim_background_job" ? { data: [], error: null } : { data: "completed", error: null }
    ));
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValueOnce({ rpc: held, from: () => ({ select: () => ({ eq: () => ({ not: () => ({ lte: () => Promise.resolve({ data: [], error: null }) }) }) }) }) } as never);
    const response = await GET(request("http://localhost/api/worker/jobs?job=push-outbox", "Bearer worker-secret-value"));
    expect(await response.json()).toMatchObject({ ok: true, results: [{ job: "push-outbox", status: "skipped", reason: "lease_held" }] });
    expect(h.drains).toEqual([]);
  });
});
