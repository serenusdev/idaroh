/**
 * ROLE-SYNC — PERMISSIONS.md §3.1 (operator decision 2026-11-25), §3.3, §3.7 and §5.2-§5.4.
 *
 * The IAM mutation surface (the request queue, decide, suspend, role.assign, session.revoke)
 * belongs to super_admin alone, and the checks that guard it are evaluated over the whole
 * roles[] set — never a role rank, never a value derived from profiles.member_type. Only
 * `iam.user.read` keeps its wider reader set, and its payload has to report the roles from
 * user_roles next to the descriptive category.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  caller: null as null | { id: string; role: string; roles: string[] },
  requireRoleCalls: [] as string[][],
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  eqCalls: [] as Array<{ table: string; column: string; value: string }>,
  writes: [] as Array<{ table: string; op: string; payload: Record<string, unknown> }>,
  tables: {} as Record<string, unknown[]>,
}));

function callerRecord() {
  if (!mocks.caller) throw new Error("UNAUTHORIZED: Anda harus masuk (login) terlebih dahulu.");
  return {
    id: mocks.caller.id,
    role: mocks.caller.role,
    roles: mocks.caller.roles,
    full_name: "Caller",
    status: "active",
    email: "caller@example.test",
    member_type: "santri",
    team_name: "Tim",
    avatar_url: null,
    phone_number: null,
    created_at: "",
    updated_at: "",
  };
}

function fakeGuard(allowed: string[]): void {
  mocks.requireRoleCalls.push(allowed);
  const held = new Set<string>(
    mocks.caller ? [mocks.caller.role, ...mocks.caller.roles] : []
  );
  if (held.size === 0) {
    throw new Error("UNAUTHORIZED: Anda harus masuk (login) terlebih dahulu.");
  }
  if (!allowed.some((role) => held.has(role))) {
    throw new Error(`FORBIDDEN: Anda tidak memiliki izin (${allowed.join(", ")}).`);
  }
}

vi.mock("@/lib/auth/guards", () => ({
  // requireRole hands the caller back to the action, so the stub has to as well: several
  // mutations read adminUser.id for the audit row.
  requireRole: vi.fn(async (allowed: string[]) => {
    fakeGuard(allowed);
    return callerRecord();
  }),
  requireAuthUser: vi.fn(async () => callerRecord()),
  getJakartaTime: () => ({
    dateStr: "2027-03-01",
    timeFormatted: "07:30:00 WIB",
    timeOnly: "07:30",
    hours: 7,
    minutes: 30,
    seconds: 0,
    totalMinutes: 450,
    now: new Date("2027-03-01T00:30:00Z"),
  }),
}));

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select", "neq", "is", "in", "order", "limit", "delete", "update",
  ]) {
    chain[method] = (..._args: unknown[]) => chain;
  }
  chain.eq = (column: string, value: unknown) => {
    mocks.eqCalls.push({ table, column, value: String(value) });
    return chain;
  };
  chain.upsert = (payload: Record<string, unknown>) => {
    mocks.writes.push({ table, op: "upsert", payload });
    return chain;
  };
  chain.insert = (payload: Record<string, unknown>) => {
    mocks.writes.push({ table, op: "insert", payload });
    return chain;
  };
  const firstRow = () => {
    const rows = mocks.tables[table];
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  };
  chain.maybeSingle = async () => ({ data: firstRow(), error: null });
  chain.single = async () => ({ data: firstRow(), error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: mocks.tables[table] ?? [], error: null }).then(resolve);
  return chain;
}

function makeClient() {
  return {
    from: (table: string) => makeChain(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push({ fn, args });
      return { data: { success: true, message: "ok" }, error: null };
    },
    auth: {
      admin: {
        inviteUserByEmail: async () => ({ data: { user: { id: "invited-001" } }, error: null }),
        deleteUser: async () => ({ error: null }),
        listFactors: async () => ({ data: { factors: [] }, error: null }),
        mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }) },
        updateUserById: async () => ({ data: null, error: null }),
      },
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null, data: { path: "mock/path" } }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeClient() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => makeClient() }));
vi.mock("@/lib/fcm", () => ({
  sendPushToUsers: vi.fn(async () => ({ sent: 0, skipped: false })),
  drainNotificationOutbox: vi.fn(async () => ({ sent: 0 })),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import {
  adminUpdateUserAction,
  approveAccountApplicationAction,
  createManualAccountAction,
  getAccountRequestsAction,
  getActiveUsersAction,
  rejectAccountApplicationAction,
  resetUserSessionAction,
  revokeDeviceTokenAction,
} from "@/modules/iam/actions";
import { getAttendanceHistoryAction } from "@/modules/attendance/actions";
import { updatePersonalBioAction } from "@/modules/people/actions";

const IAM_MUTATIONS: Array<[string, () => Promise<unknown>]> = [
  ["approveAccountApplicationAction", () => approveAccountApplicationAction("req-1", "santri")],
  ["rejectAccountApplicationAction", () => rejectAccountApplicationAction("req-1", "tidak sesuai")],
  [
    "createManualAccountAction",
    () =>
      createManualAccountAction({
        fullName: "Ahmad Baru",
        email: "baru@pondok.id",
        phone: "081234567890",
        role: "santri",
        teamName: "Sentra Digitalpreneur",
      } as never),
  ],
  ["resetUserSessionAction", () => resetUserSessionAction("target-001")],
  ["revokeDeviceTokenAction", () => revokeDeviceTokenAction("device-001")],
  ["adminUpdateUserAction", () => adminUpdateUserAction("target-002", { status: "suspended" })],
];

function asCaller(role: string, roles: string[] = [role]): void {
  mocks.caller = { id: `caller-${role}`, role, roles };
}

// Some IAM actions let requireRole throw, others catch it and return a failed ActionResult.
// Both are refusals; what must never happen is the mutation reaching the database.
async function expectRefusal(run: () => Promise<unknown>): Promise<void> {
  try {
    await expect(run()).resolves.toMatchObject({ success: false });
  } catch (error) {
    expect(String(error)).toMatch(/FORBIDDEN/);
  }
  expect(mocks.rpcCalls).toHaveLength(0);
  expect(mocks.writes).toHaveLength(0);
}

// Whether an action lets the guard's FORBIDDEN escape or converts it into a failed ActionResult
// is a UX choice; the permission decision is that the caller never reaches the data.
async function settle(run: () => Promise<unknown>): Promise<void> {
  await run().catch(() => undefined);
}

beforeEach(() => {
  // "false" is a truthy string, and several actions branch on the presence of VITEST for their
  // mock fast path — these tests need the real bodies, so the flag has to read as unset.
  vi.stubEnv("VITEST", "");
  mocks.caller = null;
  mocks.requireRoleCalls.length = 0;
  mocks.rpcCalls.length = 0;
  mocks.eqCalls.length = 0;
  mocks.writes.length = 0;
  mocks.tables = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§3.1 IAM mutations are reserved for super_admin", () => {
  it.each(IAM_MUTATIONS)("%s asks the guard for super_admin only", async (_name, run) => {
    asCaller("super_admin");
    await run();
    expect(mocks.requireRoleCalls[0]).toEqual(["super_admin"]);
  });

  it.each(IAM_MUTATIONS)("%s refuses a pengurus caller", async (_name, run) => {
    asCaller("pengurus", ["pengurus"]);
    await expectRefusal(run);
    expect(mocks.requireRoleCalls[0]).toEqual(["super_admin"]);
  });

  it.each(IAM_MUTATIONS)("%s refuses a yayasan caller", async (_name, run) => {
    asCaller("yayasan", ["yayasan"]);
    await expectRefusal(run);
  });

  it("the registration queue is a super_admin surface too", async () => {
    asCaller("pengurus", ["pengurus"]);
    await expect(getAccountRequestsAction()).rejects.toThrow("FORBIDDEN");
    expect(mocks.requireRoleCalls[0]).toEqual(["super_admin"]);
  });

  it("an account holding super_admin among several roles still passes", async () => {
    mocks.tables = {
      profiles: [{ id: "target-001", full_name: "Santri Satu", member_type: "santri" }],
      device_tokens: [],
      audit_logs: [],
    };
    asCaller("santri", ["santri", "super_admin"]);
    const result = await resetUserSessionAction("target-001");
    expect(result.success).toBe(true);
  });

  it("a multi-role pengurus is still refused", async () => {
    asCaller("koordinator", ["koordinator", "pengurus"]);
    const result = await rejectAccountApplicationAction("req-1", "tidak sesuai");
    expect(result.success).toBe(false);
  });
});

describe("iam.user.read keeps its §3.1 readers and reports real roles", () => {
  it("pengurus still receives the user list", async () => {
    mocks.tables = {
      profiles: [{ id: "u1", full_name: "Farhan", member_type: "ustadz", status: "active" }],
      user_roles: [],
      device_tokens: [],
    };
    asCaller("pengurus", ["pengurus"]);
    await expect(getActiveUsersAction()).resolves.toHaveLength(1);
    expect(mocks.requireRoleCalls[0]).toContain("pengurus");
  });

  it("roles come from user_roles while member_type stays descriptive", async () => {
    mocks.tables = {
      profiles: [
        {
          id: "u1",
          full_name: "Farhan",
          email: "f@example.test",
          status: "active",
          member_type: "ustadz",
          team_name: "Tim Sinkronisasi",
          created_at: "2027-01-01T00:00:00Z",
        },
      ],
      user_roles: [
        { user_id: "u1", roles: { key: "pengurus" } },
        { user_id: "u1", roles: { key: "koordinator" } },
      ],
      device_tokens: [],
    };
    asCaller("super_admin");
    const [user] = await getActiveUsersAction();
    expect(user.roles).toEqual(expect.arrayContaining(["pengurus", "koordinator"]));
    expect(user.memberType).toBe("ustadz");
    expect(user.role).not.toBe("ustadz");
  });
});

describe("roles are validated against the role list, not guessed from a category", () => {
  it("an ustadz cannot be approved as the ustadz role", async () => {
    asCaller("super_admin");
    const result = await approveAccountApplicationAction("req-1", "ustadz");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/peran/i);
    expect(mocks.rpcCalls).toHaveLength(0);
  });

  it("the registration queue cannot mint a super_admin", async () => {
    asCaller("super_admin");
    const result = await approveAccountApplicationAction("req-9", "super_admin");
    expect(result.success).toBe(false);
    expect(mocks.rpcCalls).toHaveLength(0);
  });

  it("manual account creation rejects a category offered as a role", async () => {
    asCaller("super_admin");
    const result = await createManualAccountAction({
      fullName: "Ustadz Baru",
      email: "ustadz.baru@pondok.id",
      phone: "081234500000",
      role: "ustadz",
      teamName: "Sentra Digitalpreneur",
    } as never);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/peran/i);
  });

  it("manual account creation records the category beside the role", async () => {
    mocks.tables = {
      profiles: [],
      account_requests: [],
      roles: [{ id: "role-pengurus" }],
      user_roles: [],
      audit_logs: [],
    };
    asCaller("super_admin");
    const result = await createManualAccountAction({
      fullName: "Ustadz Farhan",
      email: "farhan@pondok.id",
      phone: "081234500001",
      role: "pengurus",
      memberType: "ustadz",
      teamName: "Sentra Digitalpreneur",
    } as never);
    expect(result.success).toBe(true);
    const profileWrite = mocks.writes.find((entry) => entry.table === "profiles");
    expect(profileWrite?.payload.member_type).toBe("ustadz");
    const roleGrant = mocks.writes.find((entry) => entry.table === "user_roles");
    expect(roleGrant?.payload.role_id).toBe("role-pengurus");
  });

  it("admin_update_user separates the role from the member category", async () => {
    asCaller("super_admin");
    const result = await adminUpdateUserAction("11111111-1111-1111-1111-111111111111", {
      roleKey: "pengurus",
      memberType: "ustadz",
    });
    expect(result.success).toBe(true);
    const call = mocks.rpcCalls.find((entry) => entry.fn === "admin_update_user");
    expect(call?.args.p_new_role_key).toBe("pengurus");
    expect(call?.args.p_member_type).toBe("ustadz");
  });

  it("admin_update_user will not promote through the users screen", async () => {
    asCaller("super_admin");
    const result = await adminUpdateUserAction("11111111-1111-1111-1111-111111111111", {
      roleKey: "super_admin",
    });
    expect(result.success).toBe(false);
    expect(mocks.rpcCalls.filter((entry) => entry.fn === "admin_update_user")).toHaveLength(0);
  });
});

describe("attendance history scope lives in the database", () => {
  it("without a target the caller's own rows are the only question asked", async () => {
    asCaller("santri", ["santri"]);
    await getAttendanceHistoryAction();
    const scoped = mocks.eqCalls.filter(
      (entry) => entry.table === "attendance_records" && entry.column === "user_id"
    );
    expect(scoped.map((entry) => entry.value)).toEqual(["caller-santri"]);
  });

  it("a target is passed through to RLS instead of being ranked in TypeScript", async () => {
    asCaller("pengurus", ["pengurus"]);
    await getAttendanceHistoryAction("11111111-1111-1111-1111-111111111111");
    const scoped = mocks.eqCalls.filter(
      (entry) => entry.table === "attendance_records" && entry.column === "user_id"
    );
    expect(scoped.map((entry) => entry.value)).toEqual(["11111111-1111-1111-1111-111111111111"]);
    const profileReads = mocks.eqCalls.filter((entry) => entry.table === "profiles");
    expect(profileReads).toHaveLength(0);
  });

  it("a koordinator is not special-cased out of the team scope", async () => {
    asCaller("koordinator", ["koordinator"]);
    await getAttendanceHistoryAction("11111111-1111-1111-1111-111111111111");
    const scoped = mocks.eqCalls.filter(
      (entry) => entry.table === "attendance_records" && entry.column === "user_id"
    );
    expect(scoped.map((entry) => entry.value)).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });
});

describe("§3.7 people.profile.update_self is own scope only", () => {
  it("a pengurus cannot write another member's bio", async () => {
    asCaller("pengurus", ["pengurus"]);
    await expect(updatePersonalBioAction("someone-else", "Bio orang lain")).rejects.toThrow(
      "FORBIDDEN"
    );
  });

  it("the account owner still writes their own bio", async () => {
    asCaller("santri", ["santri"]);
    const result = await updatePersonalBioAction("caller-santri", "Bio saya");
    expect(result.success).toBe(true);
  });
});
