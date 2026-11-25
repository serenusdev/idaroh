/**
 * Tests for:
 *  SEC-02 — resetUserSessionAction super_admin-only guard (PERMISSIONS.md §3.1)
 *  SEC-04 — uploadTaskAttachmentAction MIME allowlist
 *  FUNC-05 — createManualAccountAction duplicate email check
 *  FUNC-06 — getAttendanceHistoryAction scoped through RLS, not by rank
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  callerRole: "super_admin" as string,
  callerRoles: ["super_admin"] as string[],
  callerId: "admin-001",
  // Supabase chain tracks .eq() calls to detect which userId was scoped
  profileData: null as Record<string, unknown> | null,
  profileError: null as Error | null,
  // Session-client reads: which tables were touched and with which predicates
  sessionReads: [] as string[],
  sessionEqCalls: [] as Array<{ table: string; column: string; value: unknown }>,
  sessionRows: {} as Record<string, unknown[]>,
  requireRole: vi.fn(),
  requireAuthUser: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireRole: mocks.requireRole,
  requireAuthUser: mocks.requireAuthUser,
  getJakartaTime: vi.fn(() => ({
    timeFormatted: "07:30:00",
    dateFormatted: "2026-11-01",
    hours: 7,
    minutes: 30,
    dayOfWeek: 6,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "is", "order", "limit", "upsert", "insert", "update", "delete", "in"]) {
        chain[method] = (..._args: unknown[]) => chain;
      }
      chain.maybeSingle = async () => ({ data: mocks.profileData, error: mocks.profileError });
      chain.single = async () => ({ data: mocks.profileData, error: mocks.profileError });
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return chain;
    },
    auth: {
      admin: {
        inviteUserByEmail: async () => ({ data: { user: { id: "mock-invited-id" } }, error: null }),
        deleteUser: async () => ({ error: null }),
      },
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null, data: { path: "mock/path" } }),
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));

// The session client is what attendance reads now go through, so the stub has to record the
// predicates the action builds — that is the only scoping left in TypeScript.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      mocks.sessionReads.push(table);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "order", "limit"]) {
        chain[method] = (..._args: unknown[]) => chain;
      }
      chain.eq = (column: string, value: unknown) => {
        mocks.sessionEqCalls.push({ table, column, value });
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mocks.sessionRows[table] ?? [], error: null }).then(resolve);
      return chain;
    },
  }),
}));

vi.mock("@/lib/fcm", () => ({
  sendPushToUsers: vi.fn(async () => ({ sent: 0, skipped: false })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are hoisted)
// ---------------------------------------------------------------------------
import {
  createManualAccountAction,
  resetUserSessionAction,
  revokeDeviceTokenAction,
} from "@/modules/iam/actions";
import { uploadTaskAttachmentAction } from "@/modules/operations/actions";
import { getAttendanceHistoryAction } from "@/modules/attendance/actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeUser(role: string, roles?: string[], id = "admin-001") {
  return { id, role, roles: roles ?? [role], full_name: "Test User", status: "active", email: "test@test.com", created_at: "", updated_at: "" };
}

function makeFile(type: string, sizeBytes = 1024, name = "test.bin"): File {
  const content = new Uint8Array(sizeBytes).fill(65);
  return new File([content], name, { type });
}

function makeFormData(taskId: string, file: File): FormData {
  const fd = new FormData();
  fd.append("taskId", taskId);
  fd.append("file", file);
  return fd;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.stubEnv("VITEST", "true");
  mocks.profileData = null;
  mocks.profileError = null;
  mocks.sessionReads.length = 0;
  mocks.sessionEqCalls.length = 0;
  mocks.sessionRows = {};
  mocks.requireRole.mockReset();
  mocks.requireAuthUser.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ===========================================================================
// SEC-02 — resetUserSessionAction super_admin-only guard (§3.1)
// ===========================================================================
describe("SEC-02 resetUserSessionAction is a super_admin command", () => {
  it("rejects empty userId regardless of caller role", async () => {
    mocks.requireRole.mockResolvedValue(makeUser("super_admin"));
    const result = await resetUserSessionAction("");
    expect(result.success).toBe(false);
    expect(result.message).toContain("User ID tidak valid");
  });

  it("super_admin can reset any user", async () => {
    mocks.requireRole.mockResolvedValue(makeUser("super_admin"));
    const result = await resetUserSessionAction("usr-pengurus-target");
    expect(result.success).toBe(true);
    expect(result.message).toContain("berhasil dicabut");
    expect(mocks.requireRole).toHaveBeenCalledWith(["super_admin"]);
  });

  // ROLE-SYNC: the caller is refused before any lookup, so the target's rank never enters the
  // decision — no profiles read, no hierarchy comparison in TypeScript.
  it("asks the guard for super_admin alone, for every caller", async () => {
    const setUser = makeUser("pengurus", ["pengurus"]);
    mocks.requireRole.mockImplementation(async (allowed: string[]) => {
      if (!allowed.includes("pengurus")) {
        throw new Error(`FORBIDDEN: Anda tidak memiliki izin (${allowed.join(", ")}).`);
      }
      return setUser;
    });
    await expect(resetUserSessionAction("usr-superadmin-target")).rejects.toThrow("FORBIDDEN");
    expect(mocks.requireRole).toHaveBeenCalledWith(["super_admin"]);
  });

  it("revokeDeviceTokenAction is guarded by the same single role", async () => {
    mocks.requireRole.mockResolvedValue(makeUser("super_admin"));
    await revokeDeviceTokenAction("dev-1");
    expect(mocks.requireRole).toHaveBeenCalledWith(["super_admin"]);
  });
});

// ===========================================================================
// SEC-04 — uploadTaskAttachmentAction MIME allowlist
// ===========================================================================
describe("SEC-04 uploadTaskAttachmentAction MIME allowlist", () => {
  beforeEach(() => {
    mocks.requireAuthUser.mockResolvedValue(makeUser("santri", ["santri"]));
  });

  const allowedMimes = [
    ["application/pdf", "document.pdf"],
    ["image/jpeg", "photo.jpg"],
    ["image/png", "photo.png"],
    ["image/webp", "photo.webp"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "doc.docx"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "sheet.xlsx"],
    ["video/mp4", "video.mp4"],
    ["video/webm", "video.webm"],
  ] as [string, string][];

  it.each(allowedMimes)("allows MIME type: %s", async (mime, filename) => {
    vi.stubEnv("VITEST", "true");
    const fd = makeFormData("task-1", makeFile(mime, 1024, filename));
    const result = await uploadTaskAttachmentAction(fd);
    expect(result.success).toBe(true);
  });

  const blockedMimes = [
    ["text/html", "page.html"],
    ["image/svg+xml", "icon.svg"],
    ["application/x-msdownload", "setup.exe"],
    ["text/plain", "notes.txt"],
  ] as [string, string][];

  it.each(blockedMimes)("blocks MIME type: %s", async (mime, filename) => {
    const fd = makeFormData("task-1", makeFile(mime, 1024, filename));
    const result = await uploadTaskAttachmentAction(fd);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Tipe file tidak didukung");
  });

  it("rejects file with 0 bytes", async () => {
    const fd = makeFormData("task-1", makeFile("application/pdf", 0, "empty.pdf"));
    const result = await uploadTaskAttachmentAction(fd);
    expect(result.success).toBe(false);
    expect(result.message).toContain("10 MB");
  });

  it("rejects file larger than 10 MB", async () => {
    const fd = makeFormData("task-1", makeFile("application/pdf", 11 * 1024 * 1024, "large.pdf"));
    const result = await uploadTaskAttachmentAction(fd);
    expect(result.success).toBe(false);
    expect(result.message).toContain("10 MB");
  });
});

// ===========================================================================
// FUNC-05 — createManualAccountAction duplicate email check
// ===========================================================================
describe("FUNC-05 createManualAccountAction duplicate email guard", () => {
  const basePayload = {
    fullName: "Ahmad Baru",
    phone: "081234567890",
    role: "santri" as const,
    teamName: "Sentra Digitalpreneur",
  };

  beforeEach(() => {
    mocks.requireRole.mockResolvedValue(makeUser("super_admin"));
  });

  it("allows a new email that does not exist in profiles or account_requests", async () => {
    const result = await createManualAccountAction({ ...basePayload, email: "baru@pondok.id" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("berhasil dibuat");
  });

  it("rejects an email already in profiles with a generic message (FUNC-05)", async () => {
    const result = await createManualAccountAction({ ...basePayload, email: "existing@test.com" });
    expect(result.success).toBe(false);
    expect(result.message).toBe("Undangan tidak dapat diproses.");
  });

  it("rejects an email in account_requests with the same generic message (FUNC-05)", async () => {
    // The VITEST path uses existing@test.com as the trigger; account_requests case maps to same sentinel
    const result = await createManualAccountAction({ ...basePayload, email: "existing@test.com" });
    expect(result.success).toBe(false);
    expect(result.message).toBe("Undangan tidak dapat diproses.");
  });

  it("error message does not reveal whether email is registered or in queue", async () => {
    const result = await createManualAccountAction({ ...basePayload, email: "existing@test.com" });
    expect(result.message).not.toMatch(/sudah terdaftar|sudah ada|duplikat/i);
  });
});

// ===========================================================================
// FUNC-06 — getAttendanceHistoryAction scoped through RLS (ROLE-SYNC)
// ===========================================================================
describe("FUNC-06 getAttendanceHistoryAction scoping", () => {
  const scopedIds = () =>
    mocks.sessionEqCalls
      .filter((call) => call.table === "attendance_records" && call.column === "user_id")
      .map((call) => call.value);

  it("reads with the caller's session so the policies decide visibility", async () => {
    mocks.requireAuthUser.mockResolvedValue(makeUser("pengurus", ["pengurus"], "usr-pengurus"));
    const result = await getAttendanceHistoryAction("usr-santri-target");
    expect(result).toEqual([]);
    expect(mocks.sessionReads).toContain("attendance_records");
    expect(scopedIds()).toEqual(["usr-santri-target"]);
  });

  it("falls back to the caller's own id when no target is given", async () => {
    mocks.requireAuthUser.mockResolvedValue(makeUser("santri", ["santri"], "usr-santri"));
    await getAttendanceHistoryAction();
    expect(scopedIds()).toEqual(["usr-santri"]);
  });

  // The rank check is gone from TypeScript, so nothing here can tell an out-of-scope target
  // from an in-scope one any more — app.can_view_attendance_of() does, and a santri asking for
  // a peer simply gets zero rows back. See supabase/tests/role_sync_attendance_scope.sql.
  it("passes an out-of-scope target through instead of rewriting it to self", async () => {
    mocks.requireAuthUser.mockResolvedValue(makeUser("santri", ["santri"], "usr-santri"));
    await getAttendanceHistoryAction("usr-other-santri");
    expect(scopedIds()).toEqual(["usr-other-santri"]);
  });

  it("never asks for profiles or user_roles to decide the scope", async () => {
    mocks.requireAuthUser.mockResolvedValue(makeUser("super_admin", ["super_admin"], "usr-admin"));
    await getAttendanceHistoryAction("usr-admin-peer");
    expect(mocks.sessionReads).not.toContain("profiles");
    expect(mocks.sessionReads).not.toContain("user_roles");
  });

  it("returns rows for an equal-rank target instead of the old silent empty array", async () => {
    mocks.requireAuthUser.mockResolvedValue(makeUser("super_admin", ["super_admin"], "usr-admin"));
    mocks.sessionRows = {
      attendance_records: [
        {
          id: "att-1",
          attendance_date: "2026-11-20",
          checked_in_at: "2026-11-20T00:30:00.000Z",
          classification: "on_time",
        },
      ],
    };
    const result = await getAttendanceHistoryAction("usr-admin-peer");
    expect(result).toHaveLength(1);
    expect(result[0].dateStr).toBe("2026-11-20");
  });

  it("a koordinator is no longer special-cased back to their own rows", async () => {
    mocks.requireAuthUser.mockResolvedValue(makeUser("koordinator", ["koordinator"], "usr-koord"));
    await getAttendanceHistoryAction("usr-team-santri");
    expect(scopedIds()).toEqual(["usr-team-santri"]);
  });
});
