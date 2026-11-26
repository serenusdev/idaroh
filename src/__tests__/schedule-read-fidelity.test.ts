/**
 * SCH-03 / SCH-05 / SCH-07 — the read paths and the audience an edit is allowed to write.
 *
 * SCH-05: a failed agenda query used to fall through to `return []`, so an outage looked
 * exactly like "no agenda this week", and the cancellation-exception and team-membership
 * reads were ignored entirely — a cancelled day then rendered as active and an
 * audience-scoped list rendered short. The pages already distinguish the two states
 * (UX-08 banner), they just never received an error.
 *
 * SCH-03: an expanded recurring row is keyed `<event uuid>:<WIB date>`. Every write must
 * resolve that reference back to the series row, and a day-level cancellation must be felt
 * by the attendance guard that is handed the same reference.
 *
 * SCH-07: rows written before §3.6 can still carry a `member_type` or `users` audience the
 * picker cannot represent. Defaulting such a row to "Seluruh pondok" made an unrelated edit
 * widen its audience, so the form has to say "kept" and the RPC has to receive no audience
 * key at all — app.event_upsert() then inherits the stored config.
 *
 * SCH-08/SCH-09 add the operator's decision about the cancelled day itself: a day the
 * manager called off is a fact the restore button needs, and a lie the santri does not.
 * So one read serves two views, and the extra days must not leak into the user list.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  requireAuthUser: vi.fn(),
  requireRole: vi.fn(),
  sendPushToUsers: vi.fn(),
  hashCalendarToken: vi.fn(() => "token-hash"),
  drainNotificationOutbox: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth/guards", () => ({
  requireAuthUser: mocks.requireAuthUser,
  requireRole: mocks.requireRole,
  getJakartaTime: () => new Date("2027-01-10T02:00:00Z"),
}));
vi.mock("@/lib/fcm", () => ({
  sendPushToUsers: mocks.sendPushToUsers,
  hashCalendarToken: mocks.hashCalendarToken,
  drainNotificationOutbox: mocks.drainNotificationOutbox,
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertEventNotCancelled } from "@/modules/attendance/actions";
import { getAnnouncementsAction, getEventsAction, updateEventAction } from "@/modules/schedules/actions";

const SERIES_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const TEAM_ID = "33333333-3333-4333-8333-333333333333";

type Table = { rows?: unknown[]; error?: unknown };

// A thenable PostgREST chain per table that actually applies the collected filters, so a test
// can prove which row a composite reference resolved to instead of trusting call order.
function database(tables: Record<string, Table>, seen: Array<{ table: string; filters: unknown[] }> = []) {
  const from = (table: string) => {
    const config = tables[table] || { rows: [] };
    const filters: Array<[string, unknown, string]> = [];
    const cell = (row: unknown, column: string) =>
      row && typeof row === "object" ? (row as Record<string, unknown>)[column] : undefined;
    const matching = () => (config.rows || []).filter((row) => filters.every(([column, value, op]) => {
      if (op === "or") return true;
      if (op === "in") return (value as unknown[]).map(String).includes(String(cell(row, column)));
      if (op === "neq") return String(cell(row, column)) !== String(value);
      if (op === "is") return value === null ? cell(row, column) == null : String(cell(row, column)) === String(value);
      return String(cell(row, column)) === String(value);
    }));
    const record = (column: string, value: unknown, op: string) => {
      if (column !== "or") filters.push([column, value, op]);
    };
    const settle = (): { data: unknown[]; error: unknown } => {
      seen.push({ table, filters: filters.map(([column, value]) => [column, value]) });
      return { data: config.error ? [] : matching(), error: config.error ?? null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (column: string, value: unknown) => { record(column, value, "eq"); return chain; },
      neq: (column: string, value: unknown) => { record(column, value, "neq"); return chain; },
      is: (column: string, value: unknown) => { record(column, value, "is"); return chain; },
      in: (column: string, value: unknown) => { record(column, value, "in"); return chain; },
      or: (expression: unknown) => { filters.push(["or", expression, "or"]); return chain; },
      maybeSingle: () => { const { data } = settle(); return Promise.resolve({ data: data[0] ?? null, error: config.error ?? null }); },
      then: (resolveChain: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve(settle()).then(resolveChain),
    };
    return chain;
  };
  return { from, seen };
}

const eventRow = (overrides: Record<string, unknown> = {}) => ({
  id: SERIES_ID,
  title: "Kajian Mingguan",
  description: "Kajian rutin.",
  starts_at: "2027-01-10T01:00:00.000Z",
  ends_at: "2027-01-10T02:00:00.000Z",
  location: "Musala Besar",
  category: "keagamaan",
  status: "scheduled",
  team_id: null,
  audience_config: { scope: "all" },
  recurrence_rule: "none",
  recurrence_until: null,
  organizer_id: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // The empty-string stub is this repo's way of reaching a real (non-fixture) code path.
  vi.stubEnv("VITEST", "");
  mocks.requireAuthUser.mockResolvedValue({ id: "user-a", role: "santri", member_type: "santri", team_name: null });
  mocks.requireRole.mockResolvedValue({ id: "user-a", role: "pengurus" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The admin list keeps the cancelled day because that is where the restore control lives;
 * the user list hides it. The cast is only needed until this fix adds the option, and keeps
 * `tsc --noEmit` honest about the signature it is compiled against today.
 */
function readEvents(options?: { includeCancelledOccurrences?: boolean }) {
  const action = getEventsAction as (
    o?: { includeCancelledOccurrences?: boolean },
  ) => ReturnType<typeof getEventsAction>;
  return action(options);
}

const managerView = () => readEvents({ includeCancelledOccurrences: true });

describe("SCH-05 — a failed schedule read is reported, not presented as an empty schedule", () => {
  it("rejects when the agenda query fails", async () => {
    mocks.createAdminClient.mockReturnValue(database({ events: { error: { message: "connection timeout" } } }));
    await expect(getEventsAction()).rejects.toThrow(/Data gagal dimuat/);
  });

  it("rejects when the per-occurrence cancellation read fails", async () => {
    mocks.createAdminClient.mockReturnValue(database({
      events: { rows: [eventRow({ recurrence_rule: "weekly", recurrence_until: "2027-02-01T00:00:00.000Z" })] },
      team_members: { rows: [] },
      event_occurrence_exceptions: { error: { message: "permission denied" } },
    }));
    await expect(getEventsAction()).rejects.toThrow(/Data gagal dimuat/);
  });

  it("rejects when the membership read behind audience filtering fails", async () => {
    mocks.createAdminClient.mockReturnValue(database({
      events: { rows: [eventRow({ audience_config: { scope: "team", teamIds: [TEAM_ID] }, team_id: TEAM_ID })] },
      team_members: { error: { message: "connection reset" } },
    }));
    await expect(getEventsAction()).rejects.toThrow(/Data gagal dimuat/);
  });

  it("rejects when the announcement query fails", async () => {
    // ANN-CMD: the inbox now reads on the caller's session and lets RLS do the audience filter.
    mocks.createClient.mockReturnValue(database({
      announcements: { error: { message: "connection timeout" } },
    }));
    await expect(getAnnouncementsAction()).rejects.toThrow(/Data gagal dimuat/);
  });

  it("still resolves an empty list when the read genuinely returned no rows", async () => {
    mocks.createAdminClient.mockReturnValue(database({ events: { rows: [] } }));
    await expect(getEventsAction()).resolves.toEqual([]);
  });

  it("maps a successful read unchanged", async () => {
    mocks.createAdminClient.mockReturnValue(database({
      events: { rows: [eventRow()] },
      team_members: { rows: [] },
      event_occurrence_exceptions: { rows: [] },
    }));
    const events = await getEventsAction();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: SERIES_ID, title: "Kajian Mingguan", statusLabel: "Sesuai Jadwal" });
  });

  it("marks a per-occurrence cancellation as cancelled rather than dropping it from the manager view", async () => {
    mocks.createAdminClient.mockReturnValue(database({
      events: { rows: [eventRow({ recurrence_rule: "weekly", recurrence_until: "2027-01-24T00:00:00.000Z" })] },
      team_members: { rows: [] },
      event_occurrence_exceptions: { rows: [{ event_id: SERIES_ID, occurrence_date: "2027-01-17" }] },
    }));
    const events = await managerView();
    const cancelled = events.find((evt) => evt.occurrenceDate === "2027-01-17");
    expect(cancelled?.cancelledOccurrence).toBe(true);
    expect(cancelled?.statusLabel).toBe("Dibatalkan");
  });
});

describe("SCH-03 — an occurrence reference resolves to the series row", () => {
  it("refuses attendance for a cancelled series given the dated list key", async () => {
    const seen: Array<{ table: string; filters: unknown[] }> = [];
    mocks.createAdminClient.mockReturnValue(database({
      events: { rows: [eventRow({ status: "cancelled" })] },
      event_occurrence_exceptions: { rows: [] },
    }, seen));

    const guard = await assertEventNotCancelled(`${SERIES_ID}:2027-01-10`);

    expect(guard?.message ?? "").toContain("dibatalkan");
    const eventsLookup = seen.find((query) => query.table === "events");
    expect(eventsLookup?.filters).toContainEqual(["id", SERIES_ID]);
  });

  it("refuses attendance for the single day an operator cancelled with SCH-01", async () => {
    mocks.createAdminClient.mockReturnValue(database({
      events: { rows: [eventRow()] },
      event_occurrence_exceptions: { rows: [{ event_id: SERIES_ID, occurrence_date: "2027-01-17" }] },
    }));

    const guard = await assertEventNotCancelled(`${SERIES_ID}:2027-01-17`);

    expect(guard?.message ?? "").toContain("dibatalkan");
  });

  it("allows attendance for an active series on a day nobody cancelled", async () => {
    mocks.createAdminClient.mockReturnValue(database({
      events: { rows: [eventRow()] },
      event_occurrence_exceptions: { rows: [{ event_id: SERIES_ID, occurrence_date: "2027-01-17" }] },
    }));

    await expect(assertEventNotCancelled(`${SERIES_ID}:2027-01-10`)).resolves.toBeNull();
  });

  it("keeps a plain series reference working and an unknown id permissive", async () => {
    mocks.createAdminClient.mockReturnValue(database({ events: { rows: [] } }));
    await expect(assertEventNotCancelled(OTHER_ID)).resolves.toBeNull();
  });

  it("refuses a reference that is not an agenda instead of querying a uuid column", async () => {
    const seen: Array<{ table: string; filters: unknown[] }> = [];
    mocks.createAdminClient.mockReturnValue(database({ events: { rows: [] } }, seen));

    const guard = await assertEventNotCancelled("saya-bukan-uuid");

    expect(guard).toMatchObject({ success: false, message: expect.stringContaining("tidak valid") });
    expect(seen.map((query) => query.table)).not.toContain("events");
  });
});

describe("a cancelled occurrence is a management fact, not a user fact", () => {
  // Weekly series on 2027-01-10 / 01-17 / 01-24 with the middle day called off.
  const recurringSeries = () => database({
    events: { rows: [eventRow({ recurrence_rule: "weekly", recurrence_until: "2027-01-25T00:00:00.000Z" })] },
    team_members: { rows: [] },
    event_occurrence_exceptions: { rows: [{ event_id: SERIES_ID, occurrence_date: "2027-01-17" }] },
  });

  it("shows the days the series does happen", async () => {
    mocks.createAdminClient.mockReturnValue(recurringSeries());
    const dates = (await readEvents()).map((evt) => evt.occurrenceDate);
    expect(dates).toContain("2027-01-10");
    expect(dates).toContain("2027-01-24");
  });

  it("hides the called-off day from the default read a santri gets", async () => {
    mocks.createAdminClient.mockReturnValue(recurringSeries());
    const dates = (await readEvents()).map((evt) => evt.occurrenceDate);
    expect(dates).not.toContain("2027-01-17");
  });

  it("keeps the called-off day in the read that carries the restore control", async () => {
    mocks.createAdminClient.mockReturnValue(recurringSeries());
    const cancelled = (await managerView()).find((evt) => evt.occurrenceDate === "2027-01-17");
    expect(cancelled).toMatchObject({ cancelledOccurrence: true, statusLabel: "Dibatalkan" });
  });

  it("does not hide a whole-series cancellation, which every schedule surface badges", async () => {
    mocks.createAdminClient.mockReturnValue(database({
      events: { rows: [eventRow({ status: "cancelled" })] },
      team_members: { rows: [] },
      event_occurrence_exceptions: { rows: [] },
    }));
    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ statusBadge: "cancelled", statusLabel: "Dibatalkan" });
  });

  it("wires the manager view to /admin/jadwal only", () => {
    const adminPage = readFileSync(resolve(__dirname, "../app/(app)/admin/jadwal/page.tsx"), "utf8");
    expect(adminPage).toMatch(/getEventsAction\(\{ includeCancelledOccurrences: true \}\)/);
    // A different row set under the same cache key would make the two surfaces overwrite
    // each other, so the manager fetch is keyed apart from the user surfaces. Since CACHE-01
    // Batch 1 the keys come from src/lib/cache-keys.ts, which keeps the admin:events:<uid>
    // prefix and adds the active role.
    expect(adminPage).toContain("cacheKeys.adminEvents(currentUser)");
    expect(adminPage).not.toContain("cacheKeys.events(currentUser)");
    for (const page of ["../app/(app)/jadwal/page.tsx", "../app/(app)/page.tsx"]) {
      expect(readFileSync(resolve(__dirname, page), "utf8")).not.toMatch(/includeCancelledOccurrences/);
    }
  });
});

describe("SCH-07 — an edit cannot widen an audience the picker cannot represent", () => {
  function sessionWithRpc(rpcResult: unknown = { success: true, schedule_changed: false, message: "ok" }) {
    const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null });
    const client = database({ events: { rows: [eventRow({ audience_config: { scope: "member_type", memberTypes: ["santri"] } })] } });
    return { rpc, client: { ...client, from: client.from, rpc } };
  }

  it("sends no audience key at all when the caller has no new audience", async () => {
    const { rpc, client } = sessionWithRpc();
    mocks.createClient.mockResolvedValue(client);

    const res = await updateEventAction(SERIES_ID, {
      title: "Kajian Mingguan",
      category: "keagamaan",
      startsAt: "2027-01-10T08:00",
      endsAt: "2027-01-10T09:00",
      location: "Musala Besar",
    } as never);

    expect(res.success).toBe(true);
    const call = rpc.mock.calls.find(([name]) => name === "event_upsert");
    const payload = (call?.[1] as { p_payload: Record<string, unknown> }).p_payload;
    expect(Object.keys(payload)).not.toContain("audience");
  });

  it("still sends the audience the operator actually chose", async () => {
    const { rpc, client } = sessionWithRpc();
    mocks.createClient.mockResolvedValue(client);

    await updateEventAction(SERIES_ID, {
      title: "Kajian Mingguan",
      category: "keagamaan",
      startsAt: "2027-01-10T08:00",
      endsAt: "2027-01-10T09:00",
      location: "Musala Besar",
      audienceConfig: { scope: "team", teamIds: [TEAM_ID] },
      teamId: TEAM_ID,
    } as never);

    const call = rpc.mock.calls.find(([name]) => name === "event_upsert");
    const payload = (call?.[1] as { p_payload: Record<string, unknown> }).p_payload;
    expect(payload.audience).toEqual({ scope: "team", teamIds: [TEAM_ID] });
  });

  it("represents a legacy audience as an explicit keep, never as the whole pondok", () => {
    const page = readFileSync(resolve(__dirname, "../app/(app)/admin/jadwal/page.tsx"), "utf8");
    const audienceStart = page.indexOf("const audienceTeamValue");
    const editStart = page.indexOf("const handleEditEvent");
    const submitStart = page.indexOf("const handleCreateEvent");
    expect(audienceStart).toBeGreaterThan(-1);
    expect(editStart).toBeGreaterThan(-1);
    expect(submitStart).toBeGreaterThan(-1);

    // The picker value for a stored scope the form cannot show is a sentinel, not "".
    expect(page.slice(audienceStart, editStart)).toMatch(/KEEP_STORED_AUDIENCE/);
    // and the submit omits audienceConfig for it, so app.event_upsert() inherits the row.
    expect(page.slice(submitStart, page.indexOf("const handleDeleteEvent"))).toMatch(
      /eventForm\.audienceTeamId === KEEP_STORED_AUDIENCE \? undefined/,
    );
    expect(page).toMatch(/Audiens agenda ini memakai konfigurasi lama/);
  });

  it("still routes day-level writes through the composite reference", () => {
    const page = readFileSync(resolve(__dirname, "../app/(app)/admin/jadwal/page.tsx"), "utf8");
    expect(page).toMatch(/setEditingEventId\(evt\.baseEventId \|\| evt\.id\)/);
    expect(page).toMatch(/handleDeleteEvent\(evt\.baseEventId \|\| evt\.id/);
    expect(page).toMatch(/setEventOccurrenceCancelledAction\(evt\.id/);
  });
});
