/**
 * PROF-SELF — the profile save on /settings/profile must be a total function.
 *
 * The production symptom was the opaque banner "An error occurred in the Server Components
 * render...": a Server Action that throws (instead of returning { success: false }) has its
 * message replaced by Next.js in production builds, so the user sees nothing actionable and the
 * support team sees nothing actionable either. `updateProfileAction` dereferenced
 * payload.fullName before its try block, so any payload without a string name threw a TypeError
 * straight out of the action.
 *
 * The write also has to leave the service role behind: the action used to call
 * createAdminClient() and update profiles directly, which meant auth.uid() was NULL in the
 * database, no audit_logs row was written (SEC-10), and the caller's own claims decided which
 * avatar_url was stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  caller: null as null | {
    id: string;
    role: string;
    roles: string[];
    avatar_url: string | null;
  },
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  profileWrites: [] as string[],
  rpcData: null as Record<string, unknown> | null,
  rpcError: null as unknown,
}));

function callerRecord() {
  if (!mocks.caller) {
    throw new Error("UNAUTHORIZED: Anda harus masuk (login) terlebih dahulu.");
  }
  return {
    id: mocks.caller.id,
    role: mocks.caller.role,
    roles: mocks.caller.roles,
    full_name: "Lama",
    status: "active",
    email: "caller@example.test",
    member_type: "santri",
    team_name: "Tim",
    avatar_url: mocks.caller.avatar_url,
    phone_number: null,
    created_at: "",
    updated_at: "",
  };
}

vi.mock("@/lib/auth/guards", () => ({
  requireAuthUser: vi.fn(async () => callerRecord()),
  requireRole: vi.fn(async () => callerRecord()),
}));

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.update = (payload: Record<string, unknown>) => {
    if (table === "profiles") mocks.profileWrites.push(JSON.stringify(payload));
    return chain;
  };
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.single = async () => ({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

function makeClient() {
  return {
    from: (table: string) => makeChain(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push({ fn, args });
      return { data: mocks.rpcData ?? { success: true }, error: mocks.rpcError };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeClient() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => makeClient() }));

import { updateProfileAction } from "@/modules/iam/actions";

beforeEach(() => {
  mocks.caller = {
    id: "caller-santri",
    role: "santri",
    roles: ["santri"],
    avatar_url: "/storage/v1/object/public/avatars/caller-santri/1.png",
  };
  mocks.rpcCalls = [];
  mocks.profileWrites = [];
  mocks.rpcData = { success: true };
  mocks.rpcError = null;
});
afterEach(() => vi.clearAllMocks());

describe("updateProfileAction never throws (PROF-SELF / production banner)", () => {
  it("resolves to a structured failure for payloads that used to escape the try block", async () => {
    const payloads: unknown[] = [
      undefined,
      null,
      {},
      { fullName: undefined, phoneNumber: "08111" },
      { fullName: 123, phoneNumber: "08111" },
      { fullName: "Ada Nama" },
      { fullName: "Ada Nama", phoneNumber: null },
      { fullName: "Ada Nama", phoneNumber: 7 },
    ];
    for (const payload of payloads) {
      const attempt = updateProfileAction(payload as never);
      await expect(attempt).resolves.toMatchObject({ success: false });
    }
    // A malformed request must not reach the database at all.
    expect(mocks.rpcCalls).toHaveLength(0);
  });

  it("reports a session problem as a message instead of an uncaught guard error", async () => {
    mocks.caller = null;
    const result = await updateProfileAction({ fullName: "Ada Nama", phoneNumber: "08111" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("masuk (login)");
    expect(mocks.rpcCalls).toHaveLength(0);
  });
});

describe("updateProfileAction writes through the session RPC", () => {
  it("delegates the save to update_own_profile with trimmed values", async () => {
    const result = await updateProfileAction({
      fullName: "  Salman Al-Farisi  ",
      phoneNumber: " 081234567890 ",
    });
    expect(result.success).toBe(true);
    expect(mocks.rpcCalls).toHaveLength(1);
    expect(mocks.rpcCalls[0].fn).toBe("update_own_profile");
    expect(mocks.rpcCalls[0].args).toMatchObject({
      p_full_name: "Salman Al-Farisi",
      p_phone_number: "081234567890",
    });
  });

  it("performs no direct profiles write, so auth.uid() stays visible to the database", async () => {
    await updateProfileAction({ fullName: "Salman", phoneNumber: "081234567890" });
    expect(mocks.profileWrites).toEqual([]);
  });

  it("surfaces the RPC refusal message rather than claiming success", async () => {
    mocks.rpcData = { success: false, message: "Nama lengkap wajib diisi." };
    const result = await updateProfileAction({ fullName: "Salman", phoneNumber: "081234567890" });
    expect(result).toEqual({ success: false, message: "Nama lengkap wajib diisi." });
  });

  it("turns a transport failure into a structured error", async () => {
    mocks.rpcError = new Error("fetch failed");
    const result = await updateProfileAction({ fullName: "Salman", phoneNumber: "081234567890" });
    expect(result.success).toBe(false);
    expect(result.message).toBe("Koneksi ke server bermasalah. Silakan coba lagi.");
  });

  it("keeps a not-yet-applied migration (PGRST202) off the user's screen as raw English", async () => {
    mocks.rpcError = {
      code: "PGRST202",
      message: "Could not find the function public.update_own_profile(text, text, text) in the schema cache",
      details: null,
      hint: null,
    };
    const result = await updateProfileAction({ fullName: "Salman", phoneNumber: "081234567890" });
    expect(result).toEqual({ success: false, message: "Gagal memperbarui profil." });
  });

  it("passes null for an unchanged avatar so a stored external URL cannot block every save", async () => {
    mocks.caller = {
      id: "caller-santri",
      role: "santri",
      roles: ["santri"],
      avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    };
    const result = await updateProfileAction({
      fullName: "Salman",
      phoneNumber: "081234567890",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    });
    expect(result.success).toBe(true);
    expect(mocks.rpcCalls[0].args.p_avatar_url).toBeNull();
  });

  it("still refuses an avatar_url that was swapped for a foreign one (F-12)", async () => {
    const result = await updateProfileAction({
      fullName: "Salman",
      phoneNumber: "081234567890",
      avatarUrl: "https://malicious-site.com/track.png",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("URL avatar tidak valid");
    expect(mocks.rpcCalls).toHaveLength(0);
  });

  it("sends an owned avatar path when the caller actually uploaded one", async () => {
    const result = await updateProfileAction({
      fullName: "Salman",
      phoneNumber: "081234567890",
      avatarUrl: "/storage/v1/object/public/avatars/caller-santri/1700000000.png",
    });
    expect(result.success).toBe(true);
    expect(mocks.rpcCalls[0].args.p_avatar_url).toBe(
      "/storage/v1/object/public/avatars/caller-santri/1700000000.png"
    );
  });

  it("keeps super_admin on the same own-scope path (§3.7 update_self = own)", async () => {
    mocks.caller = {
      id: "caller-sa",
      role: "super_admin",
      roles: ["super_admin"],
      avatar_url: null,
    };
    const result = await updateProfileAction({ fullName: "Admin Utama", phoneNumber: "" });
    expect(result.success).toBe(true);
    expect(mocks.rpcCalls[0].args).toMatchObject({
      p_full_name: "Admin Utama",
      p_phone_number: "",
      p_avatar_url: null,
    });
  });
});
