import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const migrations = readdirSync(resolve(root, "supabase/migrations")).sort();
const migrationText = migrations.map((name) => read(`supabase/migrations/${name}`)).join("\n");

const adminMock = { from: vi.fn(), rpc: vi.fn() };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminMock }));

// ---------------------------------------------------------------------------
// Zero-trust enqueue: the database trigger is the only writer of the push queue
// ---------------------------------------------------------------------------

describe("JOB-01 — the queue stays trigger-owned", () => {
  const appSources = [
    "src/lib/fcm.ts",
    "src/lib/email-outbox.ts",
    "src/lib/background-jobs.ts",
    "src/modules/reports/actions.ts",
    "src/modules/schedules/actions.ts",
    "src/modules/iam/actions.ts",
    "src/modules/notifications/actions.ts",
    "src/modules/analytics/actions.ts",
    "src/app/api/cron/notifications/route.ts",
    "src/app/api/worker/jobs/route.ts",
  ];

  it("no application module inserts, updates or deletes push-queue rows", () => {
    for (const file of appSources) {
      if (!existsSync(resolve(root, file))) continue;
      const src = read(file);
      expect(src, `${file} must not write the push queue`).not.toMatch(
        /from\(\s*["']notification_push_outbox["']\s*\)\s*\.(insert|upsert|update|delete)/,
      );
      expect(src, `${file} must not read a phantom alias of the push queue`).not.toMatch(
        /from\(\s*["']notification_outbox["']\s*\)/,
      );
    }
  });

  it("enqueues through the AFTER INSERT trigger, and the dispatcher only writes the inbox row", () => {
    expect(migrationText).toMatch(
      /CREATE TRIGGER trg_enqueue_notification_push AFTER INSERT ON public\.notifications[\s\S]{0,140}enqueue_notification_push/,
    );
    expect(migrationText).toMatch(
      /INSERT INTO public\.notification_push_outbox\(notification_id\)[\s\S]{0,90}ON CONFLICT \(notification_id\) DO NOTHING/,
    );
    const fcm = read("src/lib/fcm.ts");
    expect(fcm).toMatch(/from\("notifications"\)\.upsert\(/);
    expect(fcm).toMatch(/\.rpc\("claim_notification_push"/);
    expect(fcm).toMatch(/\.rpc\("checkpoint_notification_push"/);
    expect(fcm).toMatch(/\.rpc\("finish_notification_push"/);
  });
});

// ---------------------------------------------------------------------------
// The durable job ledger: migration contract
// ---------------------------------------------------------------------------

describe("JOB-01 — background_job_runs migration contract", () => {
  const file = migrations.find((name) => name.includes("background_job")) ?? "";

  it("ships one replay-safe migration with a rollback beside it", () => {
    expect(file).not.toBe("");
    expect(existsSync(resolve(root, `supabase/rollback/${file.replace(".sql", "_down.sql")}`))).toBe(true);
    const sql = read(`supabase/migrations/${file}`);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.background_job_runs");
    expect(sql).toContain("ALTER TABLE public.background_job_runs ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/REVOKE ALL ON public\.background_job_runs FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT, UPDATE ON public\.background_job_runs TO service_role/);
    // The email queue gains the backoff column the push queue already had.
    expect(sql).toMatch(/ALTER TABLE public\.email_outbox ADD COLUMN IF NOT EXISTS next_attempt_at/);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("keeps every job RPC fenced, search_path-locked and service_role-only", () => {
    const sql = read(`supabase/migrations/${file}`);
    for (const fn of ["claim_background_job", "complete_background_job"]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(sql).toMatch(new RegExp(`public\\.${fn}\\([^)]*\\)[\\s\\S]{0,400}SECURITY DEFINER SET search_path = pg_catalog, public`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`));
    }
    // A claim must be non-blocking and lease-bounded, so two runners never share a job.
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/lease_until = now\(\) \+ make_interval\(secs => p_lease_seconds\)/);
    // An expired lease from a crashed runner is claimable again.
    expect(sql).toMatch(/status = 'running' AND r?\.?lease_until <= now\(\)/);
    // A failed attempt defers instead of hot-looping, and dead-letter is durable state.
    expect(sql).toMatch(/'dead_letter'/);
    expect(sql).toMatch(/next_attempt_at = [\s\S]{0,80}now\(\) \+ make_interval\(secs =>/);
  });
});

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeRunner(overrides: {
  claim?: Array<Record<string, unknown>> | null;
  claimError?: Error | null;
  complete?: string;
} = {}) {
  const calls: RpcCall[] = [];
  const admin = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_background_job") {
        if (overrides.claimError) return { data: null, error: overrides.claimError };
        return {
          data: overrides.claim === null
            ? []
            : (overrides.claim ?? [{ job_key: "push-outbox", lease_token: "lease-1", attempt_count: 1 }]),
          error: null,
        };
      }
      return { data: overrides.complete ?? "completed", error: null };
    }),
  };
  return { admin, calls };
}

describe("JOB-01 — runBackgroundJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T00:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("claims a lease, runs the handler and reports the ledger outcome", async () => {
    const { runBackgroundJob } = await import("@/lib/background-jobs");
    const { admin, calls } = fakeRunner();
    const handler = vi.fn(async () => ({ sent: 3 }));
    const outcome = await runBackgroundJob(admin as never, { job: "push-outbox", handler });
    expect(outcome).toMatchObject({ job: "push-outbox", status: "completed", detail: { sent: 3 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual({ name: "claim_background_job", args: { p_job_key: "push-outbox", p_lease_seconds: 60, p_max_attempts: 5 } });
    expect(calls[1]).toEqual({ name: "complete_background_job", args: { p_job_key: "push-outbox", p_lease_token: "lease-1", p_ok: true, p_error: null, p_max_attempts: 5 } });
  });

  it("never runs the handler while another lease is held", async () => {
    const { runBackgroundJob } = await import("@/lib/background-jobs");
    const { admin, calls } = fakeRunner({ claim: null });
    const handler = vi.fn();
    const outcome = await runBackgroundJob(admin as never, { job: "email-outbox", handler });
    expect(outcome).toMatchObject({ job: "email-outbox", status: "skipped", reason: "lease_held" });
    expect(handler).not.toHaveBeenCalled();
    expect(calls.map((call) => call.name)).toEqual(["claim_background_job"]);
  });

  it("does not guess a lease when the ledger is unreadable", async () => {
    const { runBackgroundJob } = await import("@/lib/background-jobs");
    const { admin, calls } = fakeRunner({ claimError: new Error("ledger unavailable") });
    const handler = vi.fn();
    const outcome = await runBackgroundJob(admin as never, { job: "push-outbox", handler });
    expect(outcome).toMatchObject({ job: "push-outbox", status: "failed", reason: "claim_failed" });
    expect(handler).not.toHaveBeenCalled();
    expect(calls.map((call) => call.name)).toEqual(["claim_background_job"]);
  });

  it("records a handler failure instead of swallowing it", async () => {
    const { runBackgroundJob } = await import("@/lib/background-jobs");
    const { admin, calls } = fakeRunner({ complete: "failed" });
    const outcome = await runBackgroundJob(admin as never, {
      job: "email-outbox",
      handler: async () => { throw new Error("resend_unreachable"); },
    });
    expect(outcome).toMatchObject({ job: "email-outbox", status: "failed", reason: "handler_failed" });
    expect(calls[1].args).toMatchObject({ p_ok: false, p_error: "resend_unreachable" });
  });

  it("surfaces the ledger's dead_letter verdict instead of reporting a retry", async () => {
    const { runBackgroundJob } = await import("@/lib/background-jobs");
    const { admin } = fakeRunner({
      claim: [{ job_key: "push-outbox", lease_token: "lease-5", attempt_count: 5 }],
      complete: "dead_letter",
    });
    const outcome = await runBackgroundJob(admin as never, {
      job: "push-outbox",
      maxAttempts: 5,
      handler: async () => { throw new Error("fcm_transient"); },
    });
    expect(outcome).toMatchObject({ status: "dead_letter", reason: "handler_failed", attempts: 5, maxAttempts: 5 });
  });

  it("treats a lost lease as skipped so a stale worker cannot mark fresh work", async () => {
    const { runBackgroundJob } = await import("@/lib/background-jobs");
    const { admin } = fakeRunner({ complete: "lease_lost" });
    const outcome = await runBackgroundJob(admin as never, { job: "push-outbox", handler: async () => "done" });
    expect(outcome).toMatchObject({ status: "skipped", reason: "lease_lost" });
  });

  it("gives the handler a deadline derived from its own dispatch budget", async () => {
    const { runBackgroundJob } = await import("@/lib/background-jobs");
    const { admin } = fakeRunner();
    let seen = 0;
    await runBackgroundJob(admin as never, {
      job: "push-outbox",
      budgetMs: 8000,
      handler: async ({ deadline }) => { seen = deadline; return null; },
    });
    expect(seen).toBe(Date.now() + 8000);
  });

  it("keeps one bounded, named job list the cron and the worker share", async () => {
    const { BACKGROUND_JOBS, isBackgroundJob } = await import("@/lib/background-jobs");
    expect(BACKGROUND_JOBS).toEqual([
      "push-outbox",
      "email-outbox",
      "publish-scheduled",
      "expire-announcements",
      "attendance-snapshot",
      "prune-device-tokens",
    ]);
    expect(isBackgroundJob("push-outbox")).toBe(true);
    expect(isBackgroundJob("attendance-reminder")).toBe(false);
    expect(isBackgroundJob(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shared steps, used by both the worker and the fallback cron
// ---------------------------------------------------------------------------

describe("JOB-01 — shared steps", () => {
  afterEach(() => vi.restoreAllMocks());

  it("publishes only draft rows and counts the rows it actually transitioned", async () => {
    const transitions: string[] = [];
    const dueRows = [{ id: "a-1" }, { id: "a-2" }];
    const admin = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            not: () => ({ lte: () => Promise.resolve({ data: table === "announcements" ? dueRows : [], error: null }) }),
          }),
          // the per-row conditional update reads back the transitioned row
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
        update: () => ({
          eq: (key: string, value: string) => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  if (key === "id") transitions.push(value);
                  return { data: { id: value }, error: null };
                },
              }),
            }),
          }),
        }),
      }),
    };
    const { publishDueAnnouncements } = await import("@/lib/background-jobs");
    const result = await publishDueAnnouncements(admin as never, "2026-11-27T00:00:00Z");
    expect(transitions).toEqual(["a-1", "a-2"]);
    expect(result).toEqual({ published: 2 });
  });

  it("fails loudly instead of reporting an empty success", async () => {
    const admin = {
      from: () => ({ select: () => ({ eq: () => ({ not: () => ({ lte: () => Promise.resolve({ data: null, error: new Error("announcement read failed") }) }) }) }) }),
    };
    const { publishDueAnnouncements } = await import("@/lib/background-jobs");
    await expect(publishDueAnnouncements(admin as never, "2026-11-27T00:00:00Z")).rejects.toThrow("announcement read failed");
  });

  it("expires, snapshots and prunes through the same calls the cron already makes", async () => {
    const src = read("src/lib/background-jobs.ts");
    const cron = read("src/app/api/cron/notifications/route.ts");
    expect(src).toMatch(/status: "archived"/);
    expect(src).toMatch(/\.rpc\("refresh_attendance_effective", \{ p_date: today \}\)/);
    expect(src).toMatch(/from\("device_tokens"\)\.delete\(\)\.lt\("updated_at", cutoff\)/);
    expect(cron).toContain("publishDueAnnouncements");
    expect(cron).toContain("expirePublishedAnnouncements");
    expect(cron).toContain("refreshAttendanceSnapshot");
    expect(cron).toContain("pruneStaleDeviceTokens");
    expect(cron).not.toMatch(/status: "archived"/);
  });
});

// ---------------------------------------------------------------------------
// Dispatch budgets: no long synchronous send inside a user request
// ---------------------------------------------------------------------------

describe("JOB-01 — request paths stay bounded", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("drainNotificationOutbox honors an explicit budget and claims nothing", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", JSON.stringify({ project_id: "p", client_email: "c@e.test", private_key: "k" }));
    adminMock.rpc.mockReset();
    const { drainNotificationOutbox } = await import("@/lib/fcm");
    expect(await drainNotificationOutbox({ budgetMs: 0 })).toEqual({ sent: 0, removed: 0, skipped: false });
    expect(adminMock.rpc).not.toHaveBeenCalled();
  });

  it("keeps the inline dispatch after a publish or review bounded", () => {
    const reports = read("src/modules/reports/actions.ts");
    const schedules = read("src/modules/schedules/actions.ts");
    expect(reports).toMatch(/drainNotificationOutbox\(\{[\s\S]{0,220}budgetMs:/);
    expect(schedules.match(/drainNotificationOutbox\(\{[^)]*budgetMs:/g)?.length).toBe(2);
  });

  it("selects only due email rows, so a backoff actually defers them", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("EMAIL_FROM", "IDAROH <no-reply@idaroh.test>");
    const filters: Array<Record<string, unknown>> = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.push({ eq: [key, value] }); return chain; },
      lte: (key: string, value: unknown) => { filters.push({ lte: [key, value] }); return chain; },
      lt: () => chain,
      order: () => chain,
      limit: () => chain,
      update: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res: (v: unknown) => unknown) => res({ data: [], error: null }),
    };
    adminMock.from.mockImplementation(() => chain);
    const { drainEmailOutbox } = await import("@/lib/email-outbox");
    const result = await drainEmailOutbox();
    expect(result).toMatchObject({ sent: 0, failed: 0, deferred: false });
    expect(filters).toContainEqual({ lte: ["next_attempt_at", expect.any(String)] });
  });

  it("defers without touching the queue when its budget is already gone", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("EMAIL_FROM", "IDAROH <no-reply@idaroh.test>");
    adminMock.from.mockReset();
    const { drainEmailOutbox } = await import("@/lib/email-outbox");
    expect(await drainEmailOutbox({ budgetMs: 0 })).toMatchObject({ sent: 0, failed: 0, deferred: true });
    expect(adminMock.from).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dead-letter visibility (decision D3: super_admin receives technical metrics)
// ---------------------------------------------------------------------------

describe("JOB-01 — systemHealth reads the real relations", () => {
  const analytics = read("src/modules/analytics/actions.ts");
  const block = analytics.slice(
    analytics.indexOf('if (holdsRole(user, ["super_admin"]))'),
    analytics.indexOf("result.systemHealth = {"),
  );

  it("never reads the phantom notification_outbox relation again", () => {
    expect(analytics).not.toMatch(/from\(\s*"notification_outbox"\s*\)/);
    expect(block).toContain('from("notification_push_outbox")');
  });

  it("counts every dead-letter state the worker can reach", () => {
    expect(block).toMatch(/from\("notification_push_outbox"\)[\s\S]*eq\("status", "dead_letter"\)/);
    expect(block).toMatch(/from\("email_outbox"\)[\s\S]*eq\("status", "failed"\)/);
    expect(block).toContain('from("background_job_runs")');
    expect(analytics).toMatch(/result\.systemHealth = \{[\s\S]*deadLetterOutbox[\s\S]*deadLetterEmail[\s\S]*lastWorkerTick/);
  });

  it("pins that every relation the health block reads exists in the applied schema", () => {
    const tables = [...block.matchAll(/from\(\s*"([a-z_]+)"\s*\)/g)].map((match) => match[1]);
    expect(tables.length).toBeGreaterThan(3);
    for (const table of tables) {
      expect(migrationText, `${table} is not created by any migration`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
      );
    }
  });

  it("shows the dead-letter counters on the beranda card", () => {
    const page = read("src/app/(app)/page.tsx");
    expect(page).toContain("adminStats.systemHealth.deadLetterOutbox");
    expect(page).toContain("adminStats.systemHealth.deadLetterEmail");
    expect(page).toContain("adminStats.systemHealth.lastWorkerTick");
  });
});
