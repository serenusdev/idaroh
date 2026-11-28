import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupManifestAction } from "@/modules/operations/actions";
import { GET } from "@/app/api/cron/backups/route";
import { BACKUP_TABLES } from "@/lib/backup-artifact";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireRole: vi.fn(),
  jakarta: vi.fn(),
  storageAdapter: {
    createArchive: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireRole: mocks.requireRole, requireAuthUser: vi.fn(), getJakartaTime: mocks.jakarta }));
vi.mock("@/lib/fcm", () => ({ sendPushToUsers: vi.fn() }));
vi.mock("@/lib/storage/gdrive", () => ({ storageAdapter: mocks.storageAdapter }));

const tables = [...BACKUP_TABLES];
const rowCounts = Object.fromEntries(tables.map((table) => [table, 7]));

let scheduleRow: { time_wib: string; days_of_week: number[]; enabled: boolean } | null;
let scheduleError: Error | null;
let claimTaken: boolean;

function mockDatabase() {
  const single = vi.fn().mockResolvedValue({ data: { id: "manifest-1" }, error: null });
  const startSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: startSelect }));
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq: updateEq }));
  const rangeSelect = vi.fn().mockResolvedValue({ data: Array.from({ length: 7 }, (_, index) => ({ id: `row-${index}` })), error: null });
  const scheduleMaybeSingle = vi.fn(async () => ({ data: scheduleRow, error: scheduleError }));
  const scheduleEq = vi.fn(() => ({ maybeSingle: scheduleMaybeSingle }));
  const scheduleSelect = vi.fn(() => ({ eq: scheduleEq }));
  const claimMaybeSingle = vi.fn(async () => claimTaken
    ? { data: null, error: { code: "23505" } }
    : { data: { job_key: "backup-manifest:2026-11-12" }, error: null });
  const claimInsert = vi.fn(() => ({ select: () => ({ maybeSingle: claimMaybeSingle }) }));
  const jobUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const jobUpdate = vi.fn(() => ({ eq: jobUpdateEq }));
  const from = vi.fn((table: string) => {
    if (table === "backup_runs") return { insert, update };
    if (table === "cron_job_schedules") return { select: scheduleSelect };
    if (table === "cron_job_runs") return { insert: claimInsert, update: jobUpdate };
    return { insert, select: () => ({ range: rangeSelect }) };
  });
  mocks.createAdminClient.mockReturnValue({ from });
  mocks.storageAdapter.createArchive.mockResolvedValue({ id: "drive-backup-1", path: "backup.zip", mimeType: "application/zip", byteSize: 123 });
  mocks.storageAdapter.delete.mockResolvedValue(undefined);
  return { single, insert, update, updateEq, rangeSelect, from, scheduleMaybeSingle, claimInsert, claimMaybeSingle, jobUpdate, jobUpdateEq };
}

let database: ReturnType<typeof mockDatabase>;

beforeEach(() => {
  vi.clearAllMocks();
  // Exercise the real manifest implementation, not the synthetic VITEST success branch.
  vi.stubEnv("VITEST", "");
  vi.stubEnv("CRON_SECRET", "local-test-secret");
  mocks.requireRole.mockResolvedValue({ id: "admin-1", role: "super_admin" });
  mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 0, minutes: 30 });
  scheduleRow = { time_wib: "00:30", days_of_week: [0, 1, 2, 3, 4, 5, 6], enabled: true };
  scheduleError = null;
  claimTaken = false;
  database = mockDatabase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function cronRequest(authorization = "Bearer local-test-secret", method = "GET") {
  return new Request("https://example.test/api/cron/backups", { method, headers: { authorization } });
}

describe("Database manifest action", () => {
  it.each([
    { runType: "storage", vitest: "" },
    { runType: "restore_test", vitest: "" },
    { runType: "storage", vitest: "true" },
    { runType: "restore_test", vitest: "true" },
  ] as const)("rejects $runType before any rows are created (VITEST=$vitest)", async ({ runType, vitest }) => {
    vi.stubEnv("VITEST", vitest);
    const result = await createBackupManifestAction(runType);

    expect(result.success).toBe(false);
    expect(result.runId).toBeUndefined();
    expect(result.message).toContain("belum didukung");
    expect(result.message).toContain("Tidak ada backup atau pemulihan yang dijalankan");
    expect(mocks.requireRole).toHaveBeenCalledWith(["super_admin"]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.from).not.toHaveBeenCalled();
  });

  it.each([undefined, "database"] as const)("creates a verified database artifact for %s", async (runType) => {
    const result = await createBackupManifestAction(runType);

    expect(database.insert).toHaveBeenNthCalledWith(1, {
      run_type: "database", status: "started", requested_by: "admin-1", artifact_ref: null,
    });
    expect(database.insert).toHaveBeenNthCalledWith(2, expect.objectContaining({ gdrive_file_id: "drive-backup-1", folder_category: "backups" }));
    expect(database.rangeSelect).toHaveBeenCalledTimes(tables.length);
    expect(database.from.mock.calls.map(([table]) => table)).toEqual(["backup_runs", ...tables, "stored_files", "backup_runs"]);
    expect(database.update).toHaveBeenCalledExactlyOnceWith({
      status: "backup_verified", row_counts: rowCounts, artifact_ref: "manifest-1", completed_at: expect.any(String),
    });
    expect(database.updateEq).toHaveBeenCalledWith("id", "manifest-1");
    expect(result).toEqual({ success: true, runId: "manifest-1", message: expect.any(String) });
    expect(result.message).toContain("Artifact backup database terstruktur");
  });

  it("records a failed run when table counts fail without claiming backup or restore verification", async () => {
    database.rangeSelect.mockResolvedValueOnce({ data: null, error: new Error("Count unavailable") });
    const result = await createBackupManifestAction();

    expect(result.success).toBe(false);
    expect(database.update).toHaveBeenCalledExactlyOnceWith({
      status: "failed", error_message: "Count unavailable", completed_at: expect.any(String),
    });
  });

  it("does not mark a manifest as successful if its update fails", async () => {
    database.updateEq.mockResolvedValueOnce({ error: new Error("Write unavailable") });
    const result = await createBackupManifestAction();

    expect(result.success).toBe(false);
    expect(database.update).toHaveBeenLastCalledWith({
      status: "failed", error_message: "Write unavailable", completed_at: expect.any(String),
    });
  });

  it("checks super-admin authorization before accessing the database", async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(createBackupManifestAction()).rejects.toThrow("FORBIDDEN");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("Scheduled database manifest", () => {
  it("writes a verified artifact and its metadata reference", async () => {
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(database.claimInsert).toHaveBeenCalledExactlyOnceWith({ job_key: "backup:2026-11-12" });
    expect(database.insert).toHaveBeenNthCalledWith(1, { run_type: "database", status: "started", artifact_ref: null });
    expect(database.insert).toHaveBeenNthCalledWith(2, expect.objectContaining({ gdrive_file_id: "drive-backup-1", folder_category: "backups" }));
    expect(database.rangeSelect).toHaveBeenCalledTimes(tables.length);
    expect(database.from.mock.calls.map(([table]) => table)).toEqual(["cron_job_schedules", "cron_job_runs", "backup_runs", ...tables, "stored_files", "backup_runs", "cron_job_runs"]);
    expect(database.update).toHaveBeenCalledExactlyOnceWith({
      status: "backup_verified", row_counts: rowCounts, artifact_ref: "manifest-1", completed_at: expect.any(String),
    });
    expect(database.jobUpdate).toHaveBeenCalledExactlyOnceWith({ status: "completed", completed_at: expect.any(String) });
    expect(database.jobUpdateEq).toHaveBeenCalledWith("job_key", "backup:2026-11-12");
    expect(body).toMatchObject({ success: true, runId: "manifest-1", status: "backup_verified", artifactRef: "manifest-1", rowCounts });
  });

  it("records failed counting without a completed or verified status", async () => {
    database.rangeSelect.mockResolvedValueOnce({ data: null, error: new Error("Count unavailable") });
    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    expect(database.update).toHaveBeenCalledExactlyOnceWith({
      status: "failed", error_message: "Count unavailable", completed_at: expect.any(String),
    });
  });

  it("does not count or update after an insert failure", async () => {
    database.single.mockResolvedValueOnce({ data: null, error: new Error("Insert unavailable") });
    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    expect(database.rangeSelect).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.jobUpdate).toHaveBeenCalledExactlyOnceWith({
      status: "failed", error_message: "Backup run could not be started", completed_at: expect.any(String),
    });
  });

  it("skips outside the admin-configured window without claiming or counting", async () => {
    mocks.jakarta.mockReturnValue({ dateStr: "2026-11-12", hours: 12, minutes: 0 });
    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, skipped: true, reason: "not_scheduled" });
    expect(database.claimInsert).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.rangeSelect).not.toHaveBeenCalled();
  });

  it("skips when the schedule is disabled or missing", async () => {
    scheduleRow = { ...scheduleRow!, enabled: false };
    expect(await (await GET(cronRequest())).json()).toMatchObject({ skipped: true, reason: "not_scheduled" });
    scheduleRow = null;
    expect(await (await GET(cronRequest())).json()).toMatchObject({ skipped: true, reason: "not_scheduled" });
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("runs at most once per day even when the heartbeat ticks twice in the window", async () => {
    expect((await GET(cronRequest())).status).toBe(200);
    claimTaken = true;
    const response = await GET(cronRequest());
    expect(await response.json()).toMatchObject({ success: true, skipped: true, reason: "already_processed" });
    expect(database.insert).toHaveBeenCalledTimes(2);
    expect(database.rangeSelect).toHaveBeenCalledTimes(tables.length);
  });

  it("fails closed when the schedule cannot be read", async () => {
    scheduleError = new Error("Schedule unavailable");
    const response = await GET(cronRequest());
    expect(response.status).toBe(500);
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("rejects unauthorized requests before creating a run", async () => {
    const response = await GET(cronRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("rejects non-GET requests before creating a run", async () => {
    const response = await GET(cronRequest("Bearer local-test-secret", "POST"));
    expect(response.status).toBe(405);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });
});
