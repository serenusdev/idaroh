import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

function readOrEmpty(relativePath: string): string {
  const full = resolve(root, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const actions = readOrEmpty("src/modules/schedules/actions.ts");
const adminPage = readOrEmpty("src/app/(app)/admin/jadwal/page.tsx");
const permissions = readOrEmpty("PERMISSIONS.md");
const migration = readOrEmpty("supabase/migrations/20261122000008_event_command_scope.sql");
const rollback = readOrEmpty("supabase/rollback/20261122000008_event_command_scope_down.sql");
const pgtap = readOrEmpty("supabase/tests/event_command_rls.sql");

const EVENT_TIER = 'requireRole(["super_admin", "yayasan", "pengurus", "koordinator"])';

function actionBody(source: string, name: string): string {
  const marker = `export async function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const rest = source.slice(start + marker.length);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
}

function sqlFunction(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const end = source.indexOf("\n$$;", start);
  return end < 0 ? source.slice(start) : source.slice(start, end + 4);
}

describe("SCH-02 — the agenda audience tier is a database rule", () => {
  it("creates and updates an agenda through one command RPC", () => {
    for (const name of ["createEventAction", "updateEventAction"]) {
      const body = actionBody(actions, name);
      expect(body, name).toContain('rpc("event_upsert"');
      expect(body, name).toContain("createClient()");
      expect(body, name).not.toContain("createAdminClient()");
      expect(body, name).not.toContain('from("events").insert(');
      expect(body, name).not.toContain('from("events").update(');
    }
  });

  it("cancels and deletes through the same command family", () => {
    for (const name of ["cancelEventAction", "deleteEventAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}(`));
      expect(body, name).toContain('rpc("event_cancel"');
      expect(body, name).not.toContain('from("events").update(');
      expect(body, name).not.toContain('from("audit_logs").insert(');
    }
  });

  it("admits a coordinator to the schedule commands with an explicit tier", () => {
    for (const name of [
      "createEventAction",
      "updateEventAction",
      "deleteEventAction",
      "cancelEventAction",
      "setEventOccurrenceCancelledAction",
    ]) {
      const body = actionBody(actions, name);
      expect(body, name).toContain(EVENT_TIER);
    }
    // AGENTS.md: no rank comparison in place of a (permission, scope) pair.
    expect(actions).not.toContain("hasMinimumRole");
    expect(actions).not.toMatch(/roleRank/);
  });

  it("stops resolving the wall-clock and the revision number in JavaScript", () => {
    // §2 rule 5: the WIB date the operator typed and the revision counter belong
    // to the database, not to the server's timezone or a count-then-insert pair.
    expect(actions).not.toContain("new Date(payload.startsAt)");
    expect(actions).not.toContain("new Date(payload.endsAt)");
    expect(actions).not.toContain('from("event_revisions")');
    expect(actions).not.toContain("async function hasEventConflict");
    expect(actions).toContain("p_row:");
    expect(actions).toContain("p_change_note:");
  });

  it("ships the audience helper, the trigger and both commands", () => {
    expect(migration, "migration 20261122000008 is missing").not.toBe("");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.can_write_event_audience(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.enforce_event_audience_scope()");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.event_upsert(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.event_cancel(");
    expect(migration).toContain(
      'CREATE TRIGGER trg_events_audience_scope BEFORE INSERT OR UPDATE OF audience_config ON public.events'
    );
    for (const name of ["can_write_event_audience", "enforce_event_audience_scope", "event_upsert", "event_cancel"]) {
      expect(migration, name).toContain(`GRANT EXECUTE ON FUNCTION app.${name}`);
      expect(migration, name).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("derives the tier from roles and team memberships, never from member_type", () => {
    const helper = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.can_write_event_audience(");
    expect(helper, "app.can_write_event_audience is missing").not.toBe("");
    expect(helper).toContain("app.is_active_member()");
    expect(helper).toContain("app.has_any_role('super_admin', 'yayasan', 'pengurus')");
    expect(helper).toContain("app.has_any_role('koordinator')");
    expect(helper).toContain("tm.team_role = 'coordinator'");
    expect(helper).toContain("tm.valid_to IS NULL");
    expect(helper).toContain("team.status = 'active'");
    // The forbidden audience filter stays forbidden for new writes.
    expect(helper).toContain("'member_type'");
  });

  it("keeps the whole command inside one transaction and one identity", () => {
    const upsert = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.event_upsert(");
    expect(upsert).toContain("auth.uid() IS NULL");
    expect(upsert).toContain("app.is_active_member()");
    expect(upsert).toContain("FROM public.events WHERE id = p_event_id FOR UPDATE");
    expect(upsert).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(upsert).toContain("INSERT INTO public.event_revisions");
    expect(upsert).toContain("INSERT INTO public.audit_logs");
    expect(upsert).toContain("COALESCE(max(revision_no), 0) + 1");
    expect(upsert).toContain("app.can_write_event_audience");
  });

  it("refuses the out-of-tier audiences by name", () => {
    const upsert = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.event_upsert(");
    expect(upsert).toContain("Koordinator hanya dapat menandai agenda untuk timnya sendiri.");
    expect(upsert).toContain("Audiens berbasis kategori anggota tidak diizinkan; pilih tim atau seluruh pondok.");
    expect(upsert).toContain("Agenda ini berada di luar tim Anda.");
    expect(upsert).toContain("Bentrok: sudah ada agenda di lokasi dan waktu tersebut.");
    const trigger = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.enforce_event_audience_scope()");
    expect(trigger).toContain("'42501'");
    expect(trigger).toContain("auth.uid() IS NULL");
  });

  it("rolls the command surface back out of the schema", () => {
    expect(rollback, "rollback file is missing").not.toBe("");
    expect(rollback).toContain("DROP TRIGGER IF EXISTS trg_events_audience_scope ON public.events");
    for (const name of ["event_cancel", "event_upsert", "enforce_event_audience_scope", "can_write_event_audience"]) {
      expect(rollback, name).toContain(`DROP FUNCTION IF EXISTS public.${name}`);
      expect(rollback, name).toContain(`DROP FUNCTION IF EXISTS app.${name}`);
    }
    expect(rollback).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("proves the tier with pgTAP fixtures", () => {
    expect(pgtap, "supabase/tests/event_command_rls.sql is missing").not.toBe("");
    expect(pgtap).toContain("SELECT plan(35)");
    expect(pgtap).toContain("SET LOCAL ROLE authenticated");
    expect(pgtap).toContain("throws_ok");
    expect(pgtap).toContain("'42501'");
    expect(pgtap).toContain("event.created");
    expect(pgtap).toContain("event.deleted");
  });

  it("shows the coordinator a team-only audience picker and hides announcement tools", () => {
    expect(adminPage, "admin jadwal page is missing").not.toBe("");
    expect(adminPage).toContain(EVENT_TIER);
    expect(adminPage).toContain("canManageAnnouncements");
    expect(adminPage).toContain("AudiencePicker");
    // Nested in the server component, so it is not an exported function.
    const start = adminPage.indexOf("async function handleSubmit(");
    expect(start).toBeGreaterThan(-1);
    const body = adminPage.slice(start, adminPage.indexOf("async function", start + 10));
    expect(body.length).toBeGreaterThan(100);
    // The event form can no longer build a member_type audience in the browser
    // layer; the value comes from the options the server derived from the session.
    expect(body).not.toContain("audienceFromScope");
    expect(body).toContain("audienceConfig");
  });

  it("records the enforced constraint in PERMISSIONS.md", () => {
    expect(permissions).toContain("Catatan `SCH-02`");
    expect(permissions).toContain("app.can_write_event_audience");
    expect(permissions).toContain("trg_events_audience_scope");
  });
});
