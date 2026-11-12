import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
import { drainNotificationOutbox, hashCalendarToken, sendPushToUsers } from "@/lib/fcm";

type InboxRow = {
  id: string; user_id: string; notification_type: string; title: string; body: string;
  url: string; reference_id: string;
};
type Job = {
  notification_id: string; status: string; attempt_count: number; lease_token: string | null;
  lease_until: number; next_attempt_at: number; delivered_token_hashes: string[]; last_error: string | null;
};
const message = { type: "TEST", title: "Test", body: "Body", url: "/jadwal", referenceId: "ref" };
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const credentials = JSON.stringify({ project_id: "test-project", client_email: "test@example.com", private_key: privateKey });
let inbox: InboxRow[];
let jobs: Job[];
let devices: Array<{ user_id: string; token: string }>;
let persistError: Error | null;
let lookupError: Error | null;
let removeError: Error | null;
let checkpointFails: boolean;
let throwPersist: boolean;
let serial: number;
let rpc: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function query(table: string) {
  let operation = "select";
  let payload: InboxRow[] = [];
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  const chain = {
    select: () => chain,
    upsert: (rows: InboxRow[]) => { operation = "upsert"; payload = rows; return chain; },
    delete: () => { operation = "delete"; return chain; },
    eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return chain; },
    in: (field: string, values: unknown[]) => { filters.push((row) => values.includes(row[field])); return chain; },
    then: (resolve: (result: { data: unknown; error: Error | null }) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve().then(() => {
        if (table === "notifications") {
          if (operation === "upsert") {
            if (throwPersist) throw new Error("persist exception");
            if (persistError) return { data: null, error: persistError };
            for (const row of payload) {
              if (inbox.some((n) => n.user_id === row.user_id && n.notification_type === row.notification_type && n.reference_id === row.reference_id)) continue;
              const id = `notification-${++serial}`;
              inbox.push({ ...row, id });
              jobs.push({ notification_id: id, status: "pending", attempt_count: 0, lease_token: null,
                lease_until: 0, next_attempt_at: Date.now(), delivered_token_hashes: [], last_error: null });
            }
            return { data: null, error: null };
          }
          return { data: inbox.filter((row) => filters.every((f) => f(row))), error: null };
        }
        if (operation === "delete") {
          if (removeError) return { data: null, error: removeError };
          devices = devices.filter((row) => !filters.every((f) => f(row)));
          return { data: null, error: null };
        }
        return { data: devices.filter((row) => filters.every((f) => f(row))), error: lookupError };
      }).then(resolve, reject),
  };
  return chain;
}

function emulateRpc(name: string, args: Record<string, unknown>) {
  if (name === "claim_notification_push") {
    for (const job of jobs) {
      if (job.status === "processing" && job.lease_until <= Date.now() && job.attempt_count >= 8) {
        job.status = "dead_letter"; job.lease_token = null; job.last_error = "lease_expired";
      }
    }
    const job = jobs.find((j) => {
      const n = inbox.find((row) => row.id === j.notification_id)!;
      return j.attempt_count < 8 && ((j.status === "pending" && j.next_attempt_at <= Date.now())
        || (j.status === "processing" && j.lease_until <= Date.now()))
        && (!args.p_notification_ids || (args.p_notification_ids as string[]).includes(j.notification_id))
        && (!args.p_notification_type || n.notification_type === args.p_notification_type)
        && (args.p_reference_id == null || n.reference_id === args.p_reference_id);
    });
    if (!job) return { data: [], error: null };
    job.status = "processing"; job.attempt_count += 1; job.lease_token = `lease-${++serial}`;
    job.lease_until = Date.now() + 90_000;
    return { data: [{ ...inbox.find((n) => n.id === job.notification_id), ...job,
      delivered_token_hashes: [...job.delivered_token_hashes] }], error: null };
  }
  const job = jobs.find((j) => j.notification_id === args.p_notification_id);
  if (!job || job.status !== "processing" || job.lease_token !== args.p_lease_token || job.lease_until <= Date.now()) {
    return { data: false, error: null };
  }
  if (name === "checkpoint_notification_push") {
    if (checkpointFails) return { data: false, error: null };
    job.lease_until = Date.now() + 90_000;
    const hash = args.p_delivered_token_hash as string | null;
    if (hash && !job.delivered_token_hashes.includes(hash)) job.delivered_token_hashes.push(hash);
  } else {
    job.status = args.p_retry ? job.attempt_count >= 8 ? "dead_letter" : "pending" : "delivered";
    job.next_attempt_at = Date.now() + Math.min(3600, 30 * 2 ** (job.attempt_count - 1)) * 1000;
    job.last_error = args.p_error_code as string | null;
    job.lease_token = null;
  }
  return { data: true, error: null };
}

function fcmFailure(status: number, code: string, definiteToken = false) {
  return new Response(JSON.stringify({ error: { status: code, message: "sensitive raw token value",
    details: definiteToken ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] : [] } }), { status });
}
function useResponses(responses: Array<Response | Error>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "oauth-secret" }));
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Unexpected FCM request");
    return response;
  });
}
function fcmCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("fcm.googleapis"));
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T00:00:00Z"));
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", credentials);
  inbox = []; jobs = []; devices = [{ user_id: "user-1", token: "device-secret" }];
  persistError = lookupError = removeError = null; checkpointFails = throwPersist = false; serial = 0;
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => emulateRpc(name, args));
  createAdminClient.mockReturnValue({ from: query, rpc });
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("durable push dispatcher", () => {
  it("propagates persistence errors and performs no network request", async () => {
    persistError = new Error("database insert failed");
    await expect(sendPushToUsers(["user-1"], message)).rejects.toBe(persistError);
    expect(fetchMock).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(jobs).toHaveLength(0);
  });

  it("propagates thrown persistence failures", async () => {
    throwPersist = true;
    await expect(sendPushToUsers(["user-1"], message)).rejects.toThrow("persist exception");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists once with missing credentials and leaves unclaimed pending work", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "");
    expect(await sendPushToUsers(["user-1", "user-1"], message)).toEqual({ sent: 0, removed: 0, skipped: true });
    expect(inbox).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "pending", attempt_count: 0, delivered_token_hashes: [] });
    expect(await drainNotificationOutbox()).toEqual({ sent: 0, removed: 0, skipped: true });
    expect(rpc).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checkpoints success using hashes, includes notificationId and never resends a duplicate event", async () => {
    useResponses([new Response("{}")]);
    expect(await sendPushToUsers(["user-1"], message)).toEqual({ sent: 1, removed: 0, skipped: false });
    expect(jobs[0]).toMatchObject({ status: "delivered", delivered_token_hashes: [hashCalendarToken("device-secret")] });
    const body = JSON.parse(fcmCalls()[0][1].body);
    expect(body.message.data.notificationId).toBe(inbox[0].id);
    expect(body.message.data.referenceId).toBe("ref");
    expect(fcmCalls()[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(await sendPushToUsers(["user-1"], message)).toEqual({ sent: 0, removed: 0, skipped: false });
    expect(fcmCalls()).toHaveLength(1); expect(inbox).toHaveLength(1);
  });

  it("completes no-device delivery without claiming an actual send or OAuth request", async () => {
    devices = [];
    expect(await sendPushToUsers(["user-1"], message)).toEqual({ sent: 0, removed: 0, skipped: false });
    expect(jobs[0]).toMatchObject({ status: "delivered", last_error: "no_device" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes only definite FCM UNREGISTERED tokens", async () => {
    useResponses([fcmFailure(404, "NOT_FOUND", true)]);
    expect(await sendPushToUsers(["user-1"], message)).toEqual({ sent: 0, removed: 1, skipped: false });
    expect(devices).toHaveLength(0); expect(jobs[0]).toMatchObject({ status: "delivered", last_error: "fcm_unregistered" });
  });

  it("retains INVALID_ARGUMENT tokens and redacts the retry error/log", async () => {
    useResponses([fcmFailure(400, "INVALID_ARGUMENT")]);
    expect(await sendPushToUsers(["user-1"], message)).toEqual({ sent: 0, removed: 0, skipped: false });
    expect(devices).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "pending", last_error: "fcm_invalid_argument", attempt_count: 1 });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/sensitive|device-secret|oauth-secret/);
    expect(vi.mocked(console.warn).mock.calls[0][1]).toMatchObject({ notificationId: inbox[0].id, code: "fcm_invalid_argument" });
  });

  it("checkpoints successful tokens and retries only failed tokens after backoff", async () => {
    devices.push({ user_id: "user-1", token: "second-device" });
    useResponses([new Response("{}"), fcmFailure(503, "UNAVAILABLE"), new Response("{}")]);
    expect(await sendPushToUsers(["user-1"], message)).toEqual({ sent: 1, removed: 0, skipped: false });
    expect(jobs[0]).toMatchObject({ status: "pending", attempt_count: 1, delivered_token_hashes: [hashCalendarToken("device-secret")] });
    await drainNotificationOutbox(); expect(fcmCalls()).toHaveLength(2);
    vi.advanceTimersByTime(30_000);
    expect(await drainNotificationOutbox()).toEqual({ sent: 1, removed: 0, skipped: false });
    expect(fcmCalls().map((call) => JSON.parse(call[1].body).message.token)).toEqual(["device-secret", "second-device", "second-device"]);
    expect(jobs[0]).toMatchObject({ status: "delivered", attempt_count: 2, last_error: null });
  });

  it("retains retry state for network timeouts", async () => {
    useResponses([new DOMException("token-secret", "TimeoutError")]);
    await sendPushToUsers(["user-1"], message);
    expect(jobs[0]).toMatchObject({ status: "pending", last_error: "network_timeout" });
    expect(devices).toHaveLength(1);
  });

  it("retains retry state for network failures", async () => {
    useResponses([new TypeError("fetch failed with sensitive token")]);
    await sendPushToUsers(["user-1"], message);
    expect(jobs[0]).toMatchObject({ status: "pending", last_error: "network_error" });
  });

  it("retains retry state on OAuth failures without exposing its body", async () => {
    fetchMock.mockResolvedValue(new Response("sensitive oauth response", { status: 401 }));
    await sendPushToUsers(["user-1"], message);
    expect(jobs[0]).toMatchObject({ status: "pending", last_error: "oauth_failed" });
    expect(fcmCalls()).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("sensitive");
  });

  it("retries lookup and token removal failures instead of completing", async () => {
    lookupError = new Error("device lookup failed");
    await sendPushToUsers(["user-1"], message);
    expect(jobs[0]).toMatchObject({ status: "pending", last_error: "device_lookup_failed" });
    lookupError = null; removeError = new Error("delete failed");
    useResponses([fcmFailure(404, "NOT_FOUND", true)]);
    vi.advanceTimersByTime(30_000); await drainNotificationOutbox();
    expect(jobs[0]).toMatchObject({ status: "pending", last_error: "token_remove_failed" });
    expect(devices).toHaveLength(1);
  });

  it("bounds retry attempts and backoff and stops at dead letter", async () => {
    useResponses(Array.from({ length: 8 }, () => fcmFailure(429, "RESOURCE_EXHAUSTED")));
    await sendPushToUsers(["user-1"], message);
    for (let attempt = 1; attempt < 8; attempt += 1) {
      expect(jobs[0].next_attempt_at - Date.now()).toBe(Math.min(3600, 30 * 2 ** (attempt - 1)) * 1000);
      vi.advanceTimersByTime(jobs[0].next_attempt_at - Date.now());
      await drainNotificationOutbox();
    }
    expect(jobs[0]).toMatchObject({ status: "dead_letter", attempt_count: 8, last_error: "fcm_transient" });
    vi.advanceTimersByTime(86_400_000); await drainNotificationOutbox();
    expect(fcmCalls()).toHaveLength(8);
  });

  it("leaves interrupted work reclaimable and fences a worker that lost its lease", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", ""); await sendPushToUsers(["user-1"], message);
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", credentials); checkpointFails = true;
    useResponses([new Response("{}")]);
    await expect(drainNotificationOutbox()).rejects.toThrow("lease lost");
    expect(jobs[0]).toMatchObject({ status: "processing", attempt_count: 1 });
    expect(fcmCalls()).toHaveLength(0);
    await drainNotificationOutbox(); expect(fcmCalls()).toHaveLength(0);
    checkpointFails = false; vi.advanceTimersByTime(90_000);
    await drainNotificationOutbox(); expect(jobs[0]).toMatchObject({ status: "delivered", attempt_count: 2 });
  });

  it("does not send a claimed job from a concurrent dispatcher", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", ""); await sendPushToUsers(["user-1"], message);
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", credentials);
    let release!: (response: Response) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "oauth-secret" }));
      started(); return new Promise<Response>((resolve) => { release = resolve; });
    });
    const first = drainNotificationOutbox();
    await requestStarted;
    expect(await drainNotificationOutbox()).toEqual({ sent: 0, removed: 0, skipped: false });
    expect(fcmCalls()).toHaveLength(1);
    release(new Response("{}"));
    expect(await first).toEqual({ sent: 1, removed: 0, skipped: false });
    expect(jobs[0].status).toBe("delivered");
  });

  it("preserves checkpointed hashes when reclaiming an interrupted partial attempt", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", ""); await sendPushToUsers(["user-1"], message);
    devices.push({ user_id: "user-1", token: "second-device" });
    const oldLease = "old-lease";
    Object.assign(jobs[0], { status: "processing", attempt_count: 1, lease_token: oldLease,
      lease_until: Date.now(), delivered_token_hashes: [hashCalendarToken("device-secret")] });
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", credentials); useResponses([new Response("{}")]);
    await drainNotificationOutbox();
    expect(fcmCalls().map((call) => JSON.parse(call[1].body).message.token)).toEqual(["second-device"]);
    expect(jobs[0]).toMatchObject({ status: "delivered", attempt_count: 2 });
    expect(emulateRpc("finish_notification_push", {
      p_notification_id: inbox[0].id, p_lease_token: oldLease, p_retry: true, p_error_code: "fcm_transient",
    }).data).toBe(false);
    expect(jobs[0].status).toBe("delivered");
  });

  it("treats malformed FCM error bodies as retryable without deleting tokens", async () => {
    useResponses([new Response("UNREGISTERED device-secret", { status: 404 })]);
    await sendPushToUsers(["user-1"], message);
    expect(jobs[0]).toMatchObject({ status: "pending", last_error: "fcm_rejected" });
    expect(devices).toHaveLength(1);
  });

  it("scopes immediate dispatch to the requested notification ids", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "");
    await sendPushToUsers(["user-1"], message);
    await sendPushToUsers(["user-1"], { ...message, referenceId: "other" });
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", credentials); useResponses([new Response("{}")]);
    await sendPushToUsers(["user-1"], message);
    expect(jobs.map((job) => job.status)).toEqual(["delivered", "pending"]);
  });

  it("assigns distinct references to reference-less events so repeats are not deduplicated", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "");
    const implicit = { type: message.type, title: message.title, body: message.body, url: message.url };
    await sendPushToUsers(["user-1"], implicit);
    await sendPushToUsers(["user-1"], implicit);
    expect(inbox).toHaveLength(2);
    expect(inbox[0].reference_id).not.toBe("");
    expect(inbox[0].reference_id).not.toBe(inbox[1].reference_id);
    expect(jobs).toHaveLength(2);
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", credentials); useResponses([new Response("{}"), new Response("{}")]);
    expect(await drainNotificationOutbox()).toEqual({ sent: 2, removed: 0, skipped: false });
    expect(fcmCalls().map((call) => JSON.parse(call[1].body).message.data.referenceId)).toEqual([inbox[0].reference_id, inbox[1].reference_id]);
  });
});

describe("local outbox migration contract (static, SQL is not applied)", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20261112000003_notification_outbox.sql", import.meta.url), "utf8");
  it("restricts outbox/RPC access to service_role with fixed search paths", () => {
    expect(migration).toMatch(/ALTER TABLE public.notification_push_outbox ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/REVOKE ALL ON public.notification_push_outbox FROM PUBLIC, anon, authenticated/);
    for (const name of ["claim_notification_push", "checkpoint_notification_push", "finish_notification_push"]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC, anon, authenticated`));
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role`));
    }
    expect(migration).not.toMatch(/GRANT[^;]+TO (?:anon|authenticated)|CREATE POLICY/);
    expect(migration.match(/SECURITY DEFINER SET search_path = pg_catalog, public/g)).toHaveLength(5);
  });
  it("enqueues inside insert/publication transactions and preserves audience filtering", () => {
    expect(migration).toMatch(/PRIMARY KEY REFERENCES public.notifications\(id\) ON DELETE CASCADE/);
    expect(migration).toMatch(/AFTER INSERT ON public.notifications/);
    expect(migration).toMatch(/AFTER INSERT OR UPDATE ON public.announcements/);
    expect(migration).toContain("IF NEW.status <> 'published' THEN RETURN NEW");
    expect(migration).toContain("IF OLD.status = 'published' THEN RETURN NEW");
    expect(migration).toContain("app.can_view_audience_for_user(NEW.audience_config, NULLIF(NEW.team_id, ''), p.id)");
    expect(migration).toContain("p.status = 'active'");
    expect(migration).toContain("'/jadwal?announcement=' || NEW.id::text");
    expect(migration).toContain("ON CONFLICT (user_id, notification_type, reference_id) DO NOTHING");
  });
  it("uses locked claims, expiry reclaim, bounded retries and fenced hash checkpoints", () => {
    expect(migration).toContain("LIMIT 1 FOR UPDATE OF o SKIP LOCKED");
    expect(migration).toContain("o.status = 'processing' AND o.lease_until <= now()");
    expect(migration).toContain("o.attempt_count < 8");
    expect(migration).toContain("LEAST(3600, 30 * power(2, o.attempt_count - 1))");
    expect(migration).toContain("array_append(o.delivered_token_hashes, p_delivered_token_hash)");
    expect(migration.match(/o.lease_token = p_lease_token AND o.lease_until > now\(\)/g)).toHaveLength(2);
  });
});
