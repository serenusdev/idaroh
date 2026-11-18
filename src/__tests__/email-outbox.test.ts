import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminMock = { from: vi.fn() };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminMock }));

import { drainEmailOutbox, emailIdempotencyKey } from "@/lib/email-outbox";

interface OutboxRow {
  id: string;
  recipient: string;
  subject: string;
  body_text: string;
  attempt_count: number;
  reference_id?: string | null;
  reference_type?: string | null;
}

function makeChain(opts: { rows?: OutboxRow[]; claim?: { id: string } | null; onUpdate?: (payload: Record<string, unknown>) => void }) {
  const state = { updated: false };
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    update: vi.fn((payload: Record<string, unknown>) => {
      state.updated = true;
      opts.onUpdate?.(payload);
      return chain;
    }),
    maybeSingle: vi.fn(async () => ({ data: opts.claim ?? null, error: null })),
    then: (resolve: (value: unknown) => void) =>
      resolve(state.updated ? { data: null, error: null } : { data: opts.rows ?? [], error: null }),
  };
  return chain;
}

const row = (overrides: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "mail-1",
  recipient: "santri@test.com",
  subject: "Keputusan akun",
  body_text: "Akun Anda disetujui.",
  attempt_count: 0,
  reference_id: "account-1",
  reference_type: "account_request_approved",
  ...overrides,
});

describe("drainEmailOutbox (TRC-04)", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "IDAROH <no-reply@idaroh.sch.id>");
    adminMock.from.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("skips honestly when the provider is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await drainEmailOutbox();
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true, reason: "email_provider_not_configured" });
    expect(adminMock.from).not.toHaveBeenCalled();
  });

  it("sends pending rows via Resend and marks them sent", async () => {
    const updates: Array<Record<string, unknown>> = [];
    adminMock.from.mockImplementation(() =>
      makeChain({ rows: [row()], claim: { id: "mail-1" }, onUpdate: (p) => updates.push(p) }),
    );
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({ id: "email_1" }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await drainEmailOutbox();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^idaroh-email\/[a-f0-9]{64}$/);
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["santri@test.com"]);
    expect(body.subject).toBe("Keputusan akun");
    expect(updates.some((u) => u.status === "processing")).toBe(true);
    expect(updates.some((u) => u.status === "sent" && typeof u.sent_at === "string")).toBe(true);
  });

  it("requeues stale processing rows before selecting", async () => {
    const updates: Array<Record<string, unknown>> = [];
    adminMock.from.mockImplementation(() => makeChain({ rows: [], onUpdate: (p) => updates.push(p) }));
    vi.stubGlobal("fetch", vi.fn());

    await drainEmailOutbox();

    expect(updates[0]).toMatchObject({ status: "pending" });
  });

  it("increments attempts and keeps pending on transient failure", async () => {
    const updates: Array<Record<string, unknown>> = [];
    adminMock.from.mockImplementation(() =>
      makeChain({ rows: [row()], claim: { id: "mail-1" }, onUpdate: (p) => updates.push(p) }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));

    const result = await drainEmailOutbox();

    expect(result.failed).toBe(1);
    const failure = updates.find((u) => typeof u.attempt_count === "number");
    expect(failure).toMatchObject({ status: "pending", attempt_count: 1 });
    expect(String(failure!.last_error)).toContain("500");
  });

  it("marks failed after MAX_ATTEMPTS", async () => {
    const updates: Array<Record<string, unknown>> = [];
    adminMock.from.mockImplementation(() =>
      makeChain({ rows: [row({ attempt_count: 4 })], claim: { id: "mail-1" }, onUpdate: (p) => updates.push(p) }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 422 }) as Response));

    await drainEmailOutbox();

    const failure = updates.find((u) => typeof u.attempt_count === "number");
    expect(failure).toMatchObject({ status: "failed", attempt_count: 5 });
  });

  it("skips rows claimed by another runner", async () => {
    adminMock.from.mockImplementation(() => makeChain({ rows: [row()], claim: null }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await drainEmailOutbox();

    expect(result.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ships a fail-closed business-reference idempotency migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261117000001_email_outbox_idempotency.sql"),
      "utf8",
    );
    expect(migration).toContain("GROUP BY reference_type, reference_id");
    expect(migration).toContain("HAVING count(*) > 1");
    expect(migration).toContain("uq_email_outbox_business_reference");
    expect(migration).toContain("ON public.email_outbox(reference_type, reference_id)");
  });

  it("derives stable provider keys from the canonical review event identity", () => {
    const first = emailIdempotencyKey({
      id: "mail-1",
      reference_type: "report_review_email",
      reference_id: "review-1",
    });
    const retry = emailIdempotencyKey({
      id: "mail-2",
      reference_type: "report_review_email",
      reference_id: "review-1",
    });
    const distinctDecision = emailIdempotencyKey({
      id: "mail-3",
      reference_type: "report_review_email",
      reference_id: "review-2",
    });

    expect(retry).toBe(first);
    expect(distinctDecision).not.toBe(first);
  });
});
