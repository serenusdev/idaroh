import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), admin: vi.fn(),
  profiles: new Map<string, boolean>(),
  calls: [] as Array<[string, unknown[]]>,
  dbError: null as unknown,
  thrownError: null as Error | null,
}));
vi.mock("@/lib/auth/guards", () => ({ requireAuthUser: mocks.auth }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(() => { throw new Error("Unexpected session client"); }) }));

import { getAttendanceReminderPreferenceAction, updateAttendanceReminderPreferenceAction } from "@/modules/notifications/actions";

beforeEach(() => {
  // These actions must execute the real persistence path even under Vitest.
  vi.stubEnv("VITEST", "true");
  mocks.auth.mockReset().mockResolvedValue({ id: "caller" });
  mocks.profiles = new Map([["caller", true], ["other", false]]);
  mocks.calls = [];
  mocks.dbError = null;
  mocks.thrownError = null;
  mocks.admin.mockReset().mockImplementation(() => ({
    from: (table: string) => {
      mocks.calls.push(["from", [table]]);
      let id: string | undefined;
      let update: { attendance_reminder_enabled: boolean } | undefined;
      const chain = {
        select: (columns: string) => { mocks.calls.push(["select", [columns]]); return chain; },
        eq: (key: string, value: string) => {
          mocks.calls.push(["eq", [key, value]]);
          if (key === "id") id = value;
          return chain;
        },
        update: (payload: { attendance_reminder_enabled: boolean }) => {
          mocks.calls.push(["update", [payload]]); update = payload; return chain;
        },
        maybeSingle: async () => {
          if (mocks.thrownError) throw mocks.thrownError;
          if (mocks.dbError) return { data: null, error: mocks.dbError };
          if (!id || !mocks.profiles.has(id)) return { data: null, error: null };
          if (update) mocks.profiles.set(id, update.attendance_reminder_enabled);
          return { data: { attendance_reminder_enabled: mocks.profiles.get(id) }, error: null };
        },
      };
      return chain;
    },
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("OPS-12 caller-only attendance reminder preference", () => {
  it.each([true, false])("reads persisted %s rather than assuming the default", async (enabled) => {
    mocks.profiles.set("caller", enabled);
    expect(await getAttendanceReminderPreferenceAction()).toMatchObject({ success: true, enabled });
    expect(mocks.auth).toHaveBeenCalledWith();
    expect(mocks.calls).toEqual([
      ["from", ["profiles"]], ["select", ["attendance_reminder_enabled"]], ["eq", ["id", "caller"]],
    ]);
  });

  it.each([false, true])("persists %s on the caller only and reads it back", async (enabled) => {
    mocks.profiles.set("caller", !enabled);
    expect(await updateAttendanceReminderPreferenceAction(enabled)).toMatchObject({ success: true, enabled });
    expect(mocks.calls).toEqual([
      ["from", ["profiles"]], ["update", [{ attendance_reminder_enabled: enabled }]],
      ["eq", ["id", "caller"]], ["select", ["attendance_reminder_enabled"]],
    ]);
    expect(mocks.profiles.get("caller")).toBe(enabled);
    expect(mocks.profiles.get("other")).toBe(false);
    expect(await getAttendanceReminderPreferenceAction()).toMatchObject({ success: true, enabled });
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.admin.mock.invocationCallOrder[0]);
  });

  it("resolves the caller again on each request without accepting an account id", async () => {
    await updateAttendanceReminderPreferenceAction(false);
    mocks.auth.mockResolvedValue({ id: "other" });
    await updateAttendanceReminderPreferenceAction(true);
    expect(await getAttendanceReminderPreferenceAction()).toMatchObject({ success: true, enabled: true });
    expect(mocks.profiles.get("caller")).toBe(false);
    expect(mocks.profiles.get("other")).toBe(true);
    expect(mocks.calls).toContainEqual(["eq", ["id", "other"]]);
    expect(getAttendanceReminderPreferenceAction.length).toBe(0);
    expect(updateAttendanceReminderPreferenceAction.length).toBe(1);
  });

  it.each(["false", "true", 0, 1, null, undefined, {}, [], { enabled: false, userId: "other" }])(
    "rejects non-boolean input %j before database access", async (value) => {
      expect(await updateAttendanceReminderPreferenceAction(value)).toMatchObject({ success: false });
      expect(mocks.auth).toHaveBeenCalledOnce();
      expect(mocks.admin).not.toHaveBeenCalled();
    },
  );

  it.each(["UNAUTHORIZED: Login required", "FORBIDDEN: Inactive account", "UNAVAILABLE: Identity unresolved"])(
    "returns %s without creating an admin client", async (message) => {
      mocks.auth.mockRejectedValue(new Error(message));
      expect(await getAttendanceReminderPreferenceAction()).toEqual({ success: false, message });
      expect(await updateAttendanceReminderPreferenceAction(false)).toEqual({ success: false, message });
      expect(mocks.admin).not.toHaveBeenCalled();
    },
  );

  it("reports database read/write failures without leaking details or changing state", async () => {
    mocks.dbError = { message: "private database details", code: "42501" };
    for (const result of [await getAttendanceReminderPreferenceAction(), await updateAttendanceReminderPreferenceAction(false)]) {
      expect(result).toMatchObject({ success: false });
      expect(result).not.toHaveProperty("enabled");
      expect(result.message).not.toContain("private database details");
    }
    expect(mocks.profiles.get("caller")).toBe(true);
  });

  it("returns proper results for rejected queries and client configuration failures", async () => {
    mocks.thrownError = new Error("private transport details");
    expect(await getAttendanceReminderPreferenceAction()).toMatchObject({ success: false });
    expect(await updateAttendanceReminderPreferenceAction(false)).toMatchObject({ success: false });
    mocks.admin.mockImplementation(() => { throw new Error("private admin config"); });
    expect(await getAttendanceReminderPreferenceAction()).toMatchObject({ success: false });
    expect(await updateAttendanceReminderPreferenceAction(true)).toMatchObject({ success: false });
  });

  it("does not invent a default or report a successful write when the caller row is missing", async () => {
    mocks.profiles.delete("caller");
    expect(await getAttendanceReminderPreferenceAction()).toMatchObject({ success: false });
    expect(await updateAttendanceReminderPreferenceAction(false)).toMatchObject({ success: false });
    expect(mocks.profiles.get("other")).toBe(false);
  });

  it("does not treat malformed stored data as a loaded preference", async () => {
    mocks.profiles.set("caller", null as unknown as boolean);
    expect(await getAttendanceReminderPreferenceAction()).toMatchObject({ success: false });
  });
});

describe("OPS-12 additive migration contract (static, not applied)", () => {
  it("adds only the repeat-safe default-true NOT NULL column without changing RLS or grants", () => {
    const migration = readFileSync(new URL("../../supabase/migrations/20261113000002_attendance_reminder_preference.sql", import.meta.url), "utf8");
    const sql = migration.replace(/--[^\n]*/g, "").trim();
    expect(sql).toMatch(/^ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS attendance_reminder_enabled boolean NOT NULL DEFAULT true;$/i);
  });
});
