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
const policy = readOrEmpty("src/lib/schedule-policy.ts");
const sidebar = readOrEmpty("src/components/layout/desktop-sidebar.tsx");
const moreSheet = readOrEmpty("src/components/layout/more-sheet.tsx");
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

function fnBody(source: string, name: string): string {
  const match = new RegExp(`\\n(?:export\\s+)?(?:async\\s+)?function ${name}\\(`).exec(source);
  if (!match) return "";
  const rest = source.slice((match.index ?? 0) + match[0].length);
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
      const body = actionBody(actions, name);
      expect(body, name).not.toBe("");
      expect(body, name).toContain('rpc("event_cancel"');
      expect(body, name).not.toContain('from("events").update(');
      expect(body, name).not.toContain('from("audit_logs").insert(');
    }
  });

  it("admits a coordinator to the agenda commands, but not to day-level cancels", () => {
    for (const name of [
      "createEventAction",
      "updateEventAction",
      "deleteEventAction",
      "cancelEventAction",
    ]) {
      const body = actionBody(actions, name);
      expect(body, name).toContain(EVENT_TIER);
    }
    // SCH-01 locked a single-day cancel to the manager tier (§3.6 note, and
    // app.event_occurrence_set() checks the same three roles); a coordinator cancelling
    // a whole series must not silently gain that power.
    const occurrence = actionBody(actions, "setEventOccurrenceCancelledAction");
    expect(occurrence).toContain('requireRole(["super_admin", "yayasan", "pengurus"])');
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
    expect(actions).toContain("p_payload:");
    expect(actions).toContain("p_note:");
  });

  it("keeps the push recipient read separate from the command path", () => {
    // The audience list is a delivery read, not an authorisation decision: the profiles
    // an agenda addresses are invisible to the acting coordinator's own RLS policies.
    const helper = fnBody(actions, "notifyAudience");
    expect(helper, "notifyAudience is missing").not.toBe("");
    expect(helper).toContain("createAdminClient()");
    expect(helper).toContain("getAudienceUserIds(");
    for (const name of ["createEventAction", "updateEventAction", "deleteEventAction", "cancelEventAction"]) {
      expect(actionBody(actions, name), name).not.toContain("createAdminClient()");
    }
    // The three paths that announce a change to the audience keep their fan-out call; a
    // new agenda never notified anyone before, and still does not.
    for (const name of ["updateEventAction", "deleteEventAction", "cancelEventAction"]) {
      expect(actionBody(actions, name), name).toContain("notifyAudience(");
    }
  });

  it("ships the audience helper, the trigger and both commands", () => {
    expect(migration, "migration 20261122000008 is missing").not.toBe("");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.can_write_event_audience(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.enforce_event_audience_scope()");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.event_upsert(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.event_cancel(");
    expect(migration).toContain("app.coordinator_team_keys(");
    expect(migration).toContain(
      'CREATE TRIGGER trg_events_audience_scope BEFORE INSERT OR UPDATE OF audience_config ON public.events'
    );
    // The command surface reaches PostgREST as public wrappers, the trigger function
    // stays internal.
    for (const name of ["can_write_event_audience", "event_upsert", "event_cancel"]) {
      expect(migration, name).toContain(`GRANT EXECUTE ON FUNCTION app.${name}`);
      expect(migration, name).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    expect(migration).toContain("REVOKE ALL ON FUNCTION app.enforce_event_audience_scope() FROM PUBLIC");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("derives the tier from roles and team memberships, never from member_type", () => {
    const helper = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.can_write_event_audience(");
    expect(helper, "app.can_write_event_audience is missing").not.toBe("");
    expect(helper).toContain("app.is_active_member()");
    expect(helper).toContain("app.has_any_role('super_admin', 'yayasan', 'pengurus')");
    expect(helper).toContain("app.has_any_role('koordinator')");
    // The teams a coordinator may address come from membership, not from a rank or from
    // profiles.member_type (§2 rule 1), and an ended membership no longer counts.
    const keys = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.coordinator_team_keys(");
    expect(keys, "app.coordinator_team_keys is missing").not.toBe("");
    expect(keys).toContain("tm.team_role = 'coordinator'");
    expect(keys).toContain("tm.valid_to IS NULL");
    expect(keys).toContain("t.status = 'active'");
    // The forbidden audience filter stays forbidden for new writes.
    expect(helper).toContain("'member_type'");
  });

  it("keeps the whole command inside one transaction and one identity", () => {
    const upsert = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.event_upsert(");
    expect(upsert).toContain("v_uid uuid := auth.uid();");
    expect(upsert).toContain("IF v_uid IS NULL OR NOT app.is_active_member() THEN");
    expect(upsert).toContain("app.has_any_role('super_admin', 'yayasan', 'pengurus', 'koordinator')");
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
    for (const name of ["event_cancel", "event_upsert", "can_write_event_audience", "coordinator_team_keys"]) {
      expect(rollback, name).toContain(`DROP FUNCTION IF EXISTS public.${name}`);
      expect(rollback, name).toContain(`DROP FUNCTION IF EXISTS app.${name}`);
    }
    // The trigger body has no PostgREST wrapper, so only the app. schema holds it.
    expect(rollback).toContain("DROP FUNCTION IF EXISTS app.enforce_event_audience_scope();");
    expect(rollback).not.toContain("DROP FUNCTION IF EXISTS public.enforce_event_audience_scope");
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
    // A "use client" page cannot call requireRole(); it only decides which surface is
    // rendered, and the two tiers §3.6 distinguishes have to stay distinct here too.
    expect(adminPage).toContain("holdsScheduleRole(currentUser, AGENDA_WRITE_ROLES)");
    expect(adminPage).toContain("holdsScheduleRole(currentUser, AGENDA_MANAGER_ROLES)");
    expect(adminPage).not.toContain("requireRole(");
    expect(adminPage).toContain("canManageAnnouncements");
    expect(adminPage).toContain("AudiencePicker");
    const start = adminPage.indexOf("const handleCreateEvent = async");
    expect(start).toBeGreaterThan(-1);
    const body = adminPage.slice(start, adminPage.indexOf("const handleDeleteEvent", start));
    expect(body.length).toBeGreaterThan(100);
    // The event form can no longer build a member_type audience in the browser
    // layer; the value comes from the options the server derived from the session.
    expect(body).not.toContain("audienceFromScope");
    expect(body).not.toContain("memberTypes");
    expect(body).toContain("audienceConfig");
    expect(body).toContain("teamId:");
  });

  it("lists the audience option surface in one place", () => {
    expect(policy).toContain("AGENDA_MANAGER_ROLES: readonly UserRole[] = [");
    expect(policy).toContain("AGENDA_WRITE_ROLES");
    expect(policy).toContain('"koordinator"');
    // §2 rule 2: an explicit pairing, never a rank comparison.
    expect(policy).not.toMatch(/roleRank|hasMinimumRole|>=/);
    // §2 rule 8: the menu entry the guard accepts must exist in both nav surfaces.
    expect(sidebar).toContain('href: "/admin/jadwal"');
    expect(sidebar).toContain("AGENDA_WRITE_ROLES");
    expect(moreSheet).toContain('href="/admin/jadwal"');
    expect(moreSheet).toContain("AGENDA_WRITE_ROLES");
  });

  it("records the enforced constraint in PERMISSIONS.md", () => {
    expect(permissions).toContain("Catatan `SCH-02`");
    expect(permissions).toContain("app.can_write_event_audience");
    expect(permissions).toContain("trg_events_audience_scope");
  });
});
