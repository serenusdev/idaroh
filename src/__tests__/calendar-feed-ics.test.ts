import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SCH-08: /api/calendar/feed is a subscription, not a page: a calendar client fetches
// it on its own schedule and renders whatever it gets. Today one events row becomes one
// VEVENT at the base interval, so a weekly kajian is published as a single appointment on
// its first day, the per-occurrence cancellations SCH-01 introduced are invisible, and a
// failed events read is swallowed into a 200 response whose calendar simply has no
// appointments — which the client caches as "the pondok has nothing planned".
//
// These tests describe the published contract: recurring agendas carry RRULE + EXDATE over
// the same 180-day window the schedule surface renders, a failed read is an HTTP error, and
// one-off agendas keep their plain single VEVENT.
//
// Assertions commented "stage-B red" fail against the current route and define the fix; the
// rest are the behaviour that must survive it.

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  errors: {} as Record<string, { message: string } | null>,
  queried: {} as Record<string, number>,
}));

function matches(row: Row, filters: Array<[string, string, unknown]>): boolean {
  return filters.every(([column, op, value]) => {
    const cell = row[column];
    switch (op) {
      case "eq":
        return cell === value;
      case "neq":
        return cell !== value;
      case "is":
        return value === null ? cell === null || cell === undefined : cell === value;
      case "not.is":
        return !(value === null ? cell === null || cell === undefined : cell === value);
      case "in":
        return Array.isArray(value) && value.includes(cell);
      case "gte":
        return new Date(String(cell)).getTime() >= new Date(String(value)).getTime();
      case "lte":
        return new Date(String(cell)).getTime() <= new Date(String(value)).getTime();
      default:
        throw new Error(`unsupported filter ${op}`);
    }
  });
}

function makeQuery(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  const settle = () => ({
    data: (db.rows[table] || []).filter((row) => matches(row, filters)),
    error: db.errors[table] ?? null,
  });
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => (filters.push([column, "eq", value]), builder),
    neq: (column: string, value: unknown) => (filters.push([column, "neq", value]), builder),
    is: (column: string, value: unknown) => (filters.push([column, "is", value]), builder),
    not: (column: string, op: string, value: unknown) => (filters.push([column, `not.${op}`, value]), builder),
    in: (column: string, value: unknown[]) => (filters.push([column, "in", value]), builder),
    gte: (column: string, value: unknown) => (filters.push([column, "gte", value]), builder),
    lte: (column: string, value: unknown) => (filters.push([column, "lte", value]), builder),
    order: () => builder,
    maybeSingle: async () => {
      const { data, error } = settle();
      return { data: data[0] ?? null, error };
    },
    then: (
      onOk: (value: { data: Row[]; error: unknown }) => unknown,
      onErr: (reason: unknown) => unknown,
    ) => Promise.resolve(settle()).then(onOk, onErr),
  };
  return builder;
}

const adminClient = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient }));
vi.mock("@/lib/fcm", () => ({ hashCalendarToken: (token: string) => `hash:${token}` }));

import { GET } from "@/app/api/calendar/feed/route";

beforeEach(() => {
  adminClient.from.mockImplementation((table: string) => {
    db.queried[table] = (db.queried[table] || 0) + 1;
    return makeQuery(table);
  });
  for (const key of Object.keys(db.queried)) delete db.queried[key];
  db.errors = { calendar_subscriptions: null, profiles: null, team_members: null, events: null, event_occurrence_exceptions: null };
  db.rows = {
    calendar_subscriptions: [
      {
        id: "sub-1",
        user_id: "user-1",
        token_hash: "hash:abcdef0123456789abcdef0123456789",
        expires_at: "2027-06-01T00:00:00.000Z",
        revoked_at: null,
      },
    ],
    profiles: [{ id: "user-1", email: "santri@example.test", full_name: "Santri Uji", team_name: "Tim A", member_type: "santri", status: "active" }],
    team_members: [{ team_id: "team-a", user_id: "user-1", teams: { id: "team-a", name: "Tim A", slug: "tim-a" } }],
    events: [],
    event_occurrence_exceptions: [],
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-10T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function oneOff(overrides: Row = {}): Row {
  return {
    id: "evt-oneoff",
    title: "Rapim Pengurus",
    description: "Agenda seluruh pondok.",
    location: "Aula Utama",
    starts_at: "2027-01-20T08:00:00.000Z",
    ends_at: "2027-01-20T09:00:00.000Z",
    status: "scheduled",
    team_id: null,
    audience_config: { scope: "all" },
    recurrence_rule: "none",
    recurrence_until: null,
    deleted_at: null,
    ...overrides,
  };
}

function weekly(overrides: Row = {}): Row {
  return oneOff({
    id: "evt-weekly",
    title: "Kajian Rutin Selasa",
    location: "Aula Serbaguna",
    starts_at: "2027-01-05T08:00:00.000Z",
    ends_at: "2027-01-05T09:00:00.000Z",
    recurrence_rule: "weekly",
    recurrence_until: "2027-04-01T09:00:00.000Z",
    ...overrides,
  });
}

async function feed(): Promise<{ status: number; text: string }> {
  const response = await GET(new Request("https://pondok.example.test/api/calendar/feed?token=abcdef0123456789abcdef0123456789"));
  return { status: response.status, text: await response.text() };
}

describe("calendar feed authentication", () => {
  it("refuses a missing token", async () => {
    const response = await GET(new Request("https://pondok.example.test/api/calendar/feed"));
    expect(response.status).toBe(401);
  });

  it("refuses an expired subscription", async () => {
    db.rows.calendar_subscriptions = [
      { id: "sub-1", user_id: "user-1", expires_at: "2026-06-01T00:00:00.000Z", revoked_at: null },
    ];
    expect((await feed()).status).toBe(401);
  });

  it("refuses an owner whose account is no longer active", async () => {
    db.rows.profiles = [{ id: "user-1", status: "pending", member_type: "santri", team_name: "Tim A" }];
    expect((await feed()).status).toBe(403);
  });
});

describe("calendar feed honesty", () => {
  it("turns a failed events read into an HTTP error instead of an empty calendar", async () => {
    db.errors.events = { message: "relation events does not exist" };
    db.rows.events = [weekly()];
    const result = await feed();
    expect(result.status).toBe(500);
    expect(result.text).not.toContain("BEGIN:VCALENDAR");
  });

  it("treats a failed exceptions read as an error too, because an unknown cancellation is not 'not cancelled'", async () => {
    db.rows.events = [weekly()];
    db.errors.event_occurrence_exceptions = { message: "permission denied for event_occurrence_exceptions" };
    const result = await feed();
    expect(result.status).toBe(500);
  });
});

describe("calendar feed recurrence", () => {
  it("publishes a weekly agenda as a repeating series, not as its first day alone", async () => {
    db.rows.events = [weekly()];
    const { text } = await feed();
    expect(text).toContain("DTSTART:20270105T080000Z");
    expect(text).toMatch(/^RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=\d{8}T\d{6}Z$/m);
  });

  it("publishes a daily agenda with its frequency and its own end", async () => {
    db.rows.events = [
      oneOff({
        id: "evt-daily",
        title: "Setoran Harian",
        location: "Serambi Barat",
        starts_at: "2027-01-11T10:00:00.000Z",
        ends_at: "2027-01-11T11:00:00.000Z",
        recurrence_rule: "daily",
        recurrence_until: "2027-01-31T11:00:00.000Z",
      }),
    ];
    const { text } = await feed();
    expect(text).toMatch(/^RRULE:FREQ=DAILY;UNTIL=\d{8}T\d{6}Z$/m);
  });

  it("names the cancelled days of a series with EXDATE at the occurrence instant", async () => {
    db.rows.events = [weekly()];
    // 2027-02-16 is 42 days after the 2027-01-05 base, so that occurrence of the Tuesday
    // 08:00Z kajian is called off.
    db.rows.event_occurrence_exceptions = [
      { event_id: "evt-weekly", occurrence_date: "2027-02-16", reason: "Libur lokal" },
    ];
    const { text } = await feed();
    expect(text).toContain("EXDATE:20270216T080000Z");
  });

  it("keeps a one-off agenda as a single appointment with no recurrence lines", async () => {
    db.rows.events = [oneOff()];
    const { text } = await feed();
    expect(text).toContain("DTSTART:20270120T080000Z");
    expect(text).not.toContain("RRULE");
    expect(text).not.toContain("EXDATE");
  });
});

describe("calendar feed text", () => {
  it("escapes the iCalendar text specials", async () => {
    db.rows.events = [oneOff({ title: "Rapim; iuran, bulanan\nCatatan" })];
    const { text } = await feed();
    expect(text).toContain("SUMMARY:Rapim\\; iuran\\, bulanan\\nCatatan");
  });

  it("folds a long property onto continuation lines", async () => {
    db.rows.events = [oneOff({ title: "Rapat Koordinasi " + "Panitia Harbigon ".repeat(12) })];
    const { text } = await feed();
    // The static description header is longer than 75 octets on its own.
    expect(text).toMatch(/^X-WR-CALDESC:.+\r\n /m);
    for (const line of text.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("separates properties with CRLF", async () => {
    db.rows.events = [oneOff()];
    const { text } = await feed();
    const lines = text.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
  });
});

describe("calendar feed audience", () => {
  it("omits an agenda addressed to another team", async () => {
    db.rows.events = [oneOff({ id: "evt-other", team_id: "team-b", audience_config: { scope: "team", teamIds: ["team-b"] } })];
    const { text } = await feed();
    expect(text).not.toContain("Rapim Pengurus");
    expect(text).toContain("BEGIN:VCALENDAR");
  });

  it("omits a fully cancelled agenda", async () => {
    db.rows.events = [oneOff({ id: "evt-cancelled", status: "cancelled" })];
    const { text } = await feed();
    expect(text).not.toContain("Rapim Pengurus");
  });
});
