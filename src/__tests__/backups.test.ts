import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupManifestAction } from "@/modules/operations/actions";
import { GET } from "@/app/api/cron/backups/route";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireRole: mocks.requireRole, requireAuthUser: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendPushToUsers: vi.fn() }));

const tables = ["profiles", "attendance_records", "daily_reports", "tasks", "events", "announcements"];
const rowCounts = Object.fromEntries(tables.map((table) => [table, 7]));

function mockDatabase() {
  const single = vi.fn().mockResolvedValue({ data: { id: "manifest-1" }, error: null });
  const startSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: startSelect }));
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq: updateEq }));
  const countSelect = vi.fn().mockResolvedValue({ count: 7, error: null });
  const from = vi.fn((table: string) => table === "backup_runs" ? { insert, update } : { select: countSelect });
  mocks.createAdminClient.mockReturnValue({ from });
  return { single, insert, update, updateEq, countSelect, from };
}

let database: ReturnType<typeof mockDatabase>;

beforeEach(() => {
  vi.clearAllMocks();
  // Exercise the real manifest implementation, not the synthetic VITEST success branch.
  vi.stubEnv("VITEST", "");
  vi.stubEnv("CRON_SECRET", "local-test-secret");
  mocks.requireRole.mockResolvedValue({ id: "admin-1", role: "super_admin" });
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

  it.each([undefined, "database"] as const)("records only a database manifest for %s", async (runType) => {
    const result = await createBackupManifestAction(runType);

    expect(database.insert).toHaveBeenCalledExactlyOnceWith({
      run_type: "database", status: "started", requested_by: "admin-1", artifact_ref: null,
    });
    expect(database.countSelect).toHaveBeenCalledTimes(6);
    expect(database.countSelect).toHaveBeenCalledWith("*", { count: "exact", head: true });
    expect(database.from.mock.calls.map(([table]) => table)).toEqual(["backup_runs", ...tables, "backup_runs"]);
    expect(database.update).toHaveBeenCalledExactlyOnceWith({
      status: "manifest_only", row_counts: rowCounts, artifact_ref: null, completed_at: expect.any(String),
    });
    expect(database.updateEq).toHaveBeenCalledWith("id", "manifest-1");
    expect(result).toEqual({ success: true, runId: "manifest-1", message: expect.any(String) });
    expect(result.message).toContain("Ini bukan backup");
    expect(result.message).toContain("Verifikasi backup dan uji restore melalui provider masih diperlukan");
  });

  it("records a failed run when table counts fail without claiming backup or restore verification", async () => {
    database.countSelect.mockResolvedValueOnce({ count: null, error: new Error("Count unavailable") });
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
  it("writes manifest_only with no artifact and explicitly requires provider verification", async () => {
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(database.insert).toHaveBeenCalledExactlyOnceWith({ run_type: "database", status: "started", artifact_ref: null });
    expect(database.countSelect).toHaveBeenCalledTimes(6);
    expect(database.from.mock.calls.map(([table]) => table)).toEqual(["backup_runs", ...tables, "backup_runs"]);
    expect(database.update).toHaveBeenCalledExactlyOnceWith({
      status: "manifest_only", row_counts: rowCounts, artifact_ref: null, completed_at: expect.any(String),
    });
    expect(body).toMatchObject({ success: true, runId: "manifest-1", status: "manifest_only", artifactRef: null, rowCounts });
    expect(body.note).toContain("not a backup");
    expect(body.note).toContain("No database/storage backup or restore was executed or verified");
    expect(body.note).toContain("Provider backup and restore verification is still required");
  });

  it("records failed counting without a completed or verified status", async () => {
    database.countSelect.mockResolvedValueOnce({ count: null, error: new Error("Count unavailable") });
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
    expect(database.countSelect).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
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
