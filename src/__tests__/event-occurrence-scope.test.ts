import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

// fs-only scans, so a missing implementation fails as an assertion instead of a
// module-resolution error: the Stage-B evidence stays assertion-level
// (AGENTS.md / AGENT-WORKFLOW.md).
function readOrEmpty(relativePath: string): string {
  const full = resolve(root, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const helper = readOrEmpty("src/lib/event-occurrence.ts");
const actions = readOrEmpty("src/modules/schedules/actions.ts");
const types = readOrEmpty("src/modules/schedules/types.ts");
const adminPage = readOrEmpty("src/app/(app)/admin/jadwal/page.tsx");
const permissions = readOrEmpty("PERMISSIONS.md");
const migration = readOrEmpty("supabase/migrations/20261122000006_event_occurrence_cancellation.sql");
const rollback = readOrEmpty("supabase/rollback/20261122000006_event_occurrence_cancellation_down.sql");

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

describe("SCH-01 — a recurring agenda is addressable one occurrence at a time", () => {
  it("splits the synthetic occurrence id back into uuid + WIB date", () => {
    expect(helper).not.toBe("");
    expect(helper).toContain("export interface EventRef");
    expect(helper).toContain("export function parseEventRef");
    expect(helper).toMatch(/occurrenceDate: string \| null/);
    // Both halves have to be validated: the date is the primary key of an
    // exception row, the uuid is what an events query may be filtered by.
    expect(helper).toContain(UUID);
    expect(helper).toContain("\\d{4}-\\d{2}-\\d{2}");
    // 80 characters is uuid + colon + date, so an over-long id is rejected before
    // it is ever parsed.
    expect(helper).toMatch(/length > 80/);
  });

  it("refuses a malformed id before Postgres sees it as a uuid", () => {
    // Before SCH-01 the actions passed the display id straight into .eq("id", …),
    // which is why every edit of a recurring agenda ended in "Gagal …".
    const parses = (actions.match(/parseEventRef\(/g) || []).length;
    expect(parses).toBeGreaterThanOrEqual(3);
    for (const name of ["updateEventAction", "deleteEventAction", "cancelEventAction"]) {
      const start = actions.indexOf(`export async function ${name}`);
      expect(start, name).toBeGreaterThan(-1);
      const body = actions.slice(start, actions.indexOf("\n}", start));
      expect(body.length, name).toBeGreaterThan(100);
      expect(body, name).toContain("parseEventRef");
      expect(body, name).toContain("ID agenda tidak valid.");
    }
  });

  it("carries the series identity through the expanded rows", () => {
    // The composite id stays the list key, but the row must remember which events
    // row and which WIB day it came from, and whether that day is cancelled.
    expect(actions).toMatch(/function expandEventRows\([\s\S]{0,160}cancelled[A-Za-z]*/);
    expect(actions).toContain("baseEventId");
    expect(actions).toContain("occurrenceDate");
    expect(actions).toContain("cancelledOccurrence");
    expect(actions).toContain('from("event_occurrence_exceptions")');
    expect(types).toContain("baseEventId");
    expect(types).toContain("occurrenceDate");
    expect(types).toContain("cancelledOccurrence");
  });

  it("writes an occurrence through the RPC, never through raw DML", () => {
    expect(actions).toContain('rpc("event_occurrence_set"');
    const setter = actions.slice(actions.indexOf("export async function setEventOccurrenceCancelledAction"));
    expect(setter.length).toBeGreaterThan(200);
    expect(setter).toContain("requireRole(");
    expect(setter).toContain("parseEventRef");
    // A manager-tier list, not a rank comparison (AGENTS.md).
    expect(actions).not.toContain("hasMinimumRole");
    expect(actions).not.toMatch(/roleRank/);
    // The series-level status path must not be replaced by the occurrence path.
    expect(actions).toMatch(/status: "cancelled"/);
  });

  it("ships the exception table, the guard and the audit row together", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.event_occurrence_exceptions");
    expect(migration).toContain("UNIQUE (event_id, occurrence_date)");
    expect(migration).toContain("ALTER TABLE public.event_occurrence_exceptions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain('DROP POLICY IF EXISTS "Schedule managers can read occurrence exceptions" ON public.event_occurrence_exceptions');
    expect(migration).toContain('CREATE POLICY "Schedule managers can read occurrence exceptions"');
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.event_occurrence_exceptions FROM authenticated");
    expect(migration).toContain("FUNCTION app.event_occurrence_set(");
    expect(migration).toContain("public.event_occurrence_set(");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path");
    expect(migration).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(migration).toContain("MOD(");
    expect(migration).toContain("'event.occurrence_cancelled'");
    expect(migration).toContain("'event.occurrence_restored'");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    // §3 schedule.event.update tier: koordinator is not a manager of cancellations.
    const rpcStart = migration.indexOf("CREATE OR REPLACE FUNCTION app.event_occurrence_set");
    const rpcBody = migration.slice(rpcStart, migration.indexOf("$$;", rpcStart));
    expect(rpcStart).toBeGreaterThan(-1);
    expect(rpcBody.length).toBeGreaterThan(400);
    expect(rpcBody).toContain("app.is_active_member()");
    expect(rpcBody).toContain("app.has_any_role('pengurus', 'yayasan', 'super_admin')");
    expect(rpcBody).not.toContain("role_rank");
    // A whole-series cancel is still a separate fact from a single day.
    expect(rpcBody).not.toMatch(/UPDATE public\.events/i);
  });

  it("ships a rollback that leaves only the series state behind", () => {
    expect(rollback).toContain("BEGIN;");
    expect(rollback).toContain('DROP POLICY IF EXISTS "Schedule managers can read occurrence exceptions" ON public.event_occurrence_exceptions');
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.event_occurrence_set(uuid, date, boolean, text);");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS app.event_occurrence_set(uuid, date, boolean, text);");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS app.is_event_occurrence_cancelled(uuid, date);");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.event_occurrence_exceptions");
    expect(rollback).toContain("NOTIFY pgrst, 'reload schema';");
    expect(rollback).toContain("COMMIT;");
  });

  it("gives the schedule manager a button per occurrence (§3 five-layer sync)", () => {
    expect(adminPage).toContain("setEventOccurrenceCancelledAction");
    expect(adminPage).toContain("Batalkan hari ini");
    expect(adminPage).toContain("Pulihkan hari ini");
    // The acting browser holds the events cache, so the row has to refresh. CACHE-01 Batch 1
    // refetches through the TanStack invalidation on the occurrence mutation.
    expect(adminPage).toContain("invalidateEvents(queryClient, currentUser)");
  });

  it("records the new surface in PERMISSIONS.md", () => {
    expect(permissions).toContain("event_occurrence_exceptions");
    expect(permissions).toContain("event.occurrence_cancelled");
  });
});
