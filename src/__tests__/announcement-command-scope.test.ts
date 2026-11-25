import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

function readOrEmpty(relativePath: string): string {
  const full = resolve(root, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const actions = readOrEmpty("src/modules/schedules/actions.ts");
const jadwalPage = readOrEmpty("src/app/(app)/jadwal/page.tsx");
const adminPage = readOrEmpty("src/app/(app)/admin/jadwal/page.tsx");
const permissions = readOrEmpty("PERMISSIONS.md");
const migration = readOrEmpty("supabase/migrations/20261122000014_announcement_command_scope.sql");
const rollback = readOrEmpty("supabase/rollback/20261122000014_announcement_command_scope_down.sql");
const pgtap = readOrEmpty("supabase/tests/announcement_command_scope.sql");

const ANN_TIER = 'requireRole(["super_admin", "yayasan", "pengurus", "koordinator"])';
const WRITE_ACTIONS = ["publishAnnouncementAction", "updateAnnouncementAction", "deleteAnnouncementAction"];

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

describe("ANN — the announcement command runs on the caller session", () => {
  it("writes every announcement through one command RPC", () => {
    expect(actions, "src/modules/schedules/actions.ts is missing").not.toBe("");
    for (const name of ["publishAnnouncementAction", "updateAnnouncementAction"]) {
      const body = actionBody(actions, name);
      expect(body, name).toContain('rpc("announcement_upsert"');
      expect(body, name).toContain("createClient()");
      expect(body, name).not.toContain("createAdminClient()");
      expect(body, name).not.toContain('from("announcements").insert(');
      expect(body, name).not.toContain('from("announcements").update(');
    }
    const archive = actionBody(actions, "deleteAnnouncementAction");
    expect(archive).toContain('rpc("announcement_archive"');
    expect(archive).toContain("createClient()");
    expect(archive).not.toContain("createAdminClient()");
    expect(archive).not.toContain('from("announcements").update(');
    // §2 rule 8: the menu the guard admits and the tier the RPC admits have to be the same.
    for (const name of WRITE_ACTIONS) {
      expect(actionBody(actions, name), name).toContain(ANN_TIER);
    }
    expect(actions).not.toContain("hasMinimumRole");
    expect(actions).not.toMatch(/roleRank/);
  });

  it("keeps the audit entry, the revision and the clock inside the database", () => {
    for (const name of WRITE_ACTIONS) {
      const body = actionBody(actions, name);
      expect(body, name).not.toContain('from("audit_logs").insert(');
      expect(body, name).not.toContain("announcement_revisions");
    }
    // The old delete archived by id with no scope check and no actor_id; the count-then-insert
    // revision pair raced two editors into the same revision_no.
    expect(actions).not.toContain('from("announcement_revisions")');
    // §2 rule 5: the wall-clock typed into <input type="datetime-local"> is handed over
    // untouched so Asia/Jakarta is applied once, by the database.
    expect(actions).not.toContain("new Date(payload.scheduledFor)");
    expect(actions).not.toContain("new Date(payload.expiresAt)");
    expect(actions).toContain("function announcementFormPayload(");
    expect(actions).toContain("p_payload:");
  });

  it("reads announcements under RLS instead of a second TypeScript audience rule", () => {
    // filterByAudience() re-implemented app.can_view_audience() in JavaScript on rows fetched
    // with the service-role key, which is why an out-of-tier audience could ever be written:
    // nothing in the database was asked. The announcements feed now trusts the SELECT policy.
    for (const name of ["getAnnouncementsAction", "markAnnouncementReadAction"]) {
      const body = actionBody(actions, name);
      expect(body, name).toContain("createClient()");
      expect(body, name).not.toContain("createAdminClient()");
      expect(body, name).not.toContain("filterByAudience(");
    }
    // The agenda read still filters in JavaScript (recurrence expansion needs the base row);
    // this branch does not touch it, so pinning it keeps that split visible rather than implied.
    expect(actionBody(actions, "getEventsAction")).toContain("filterByAudience(");
    // A short id used to be silently skipped, so a read receipt never arrived.
    expect(actions).not.toContain("announcementId.length > 30");
    // getAdminAnnouncementsAction keeps the service-role read: drafts and archived history are
    // invisible to the SELECT policy by design (PERMISSIONS.md §3.6 note).
    expect(actionBody(actions, "getAdminAnnouncementsAction")).toContain("createAdminClient()");
  });

  it("keeps delivery fan-out on the existing trigger and outbox drain", () => {
    const publish = actionBody(actions, "publishAnnouncementAction");
    expect(publish).toContain('drainNotificationOutbox({ notificationType: "ANNOUNCEMENT_PUBLISHED"');
    const update = actionBody(actions, "updateAnnouncementAction");
    expect(update).toContain('"ANNOUNCEMENT_UPDATED"');
    // The recipient list is a delivery read, not an authorization decision.
    expect(update).toContain("notifyAudience(");
    expect(update).not.toContain("getAudienceUserIds(supabase");
  });

  it("ships the helper, the trigger and both commands", () => {
    expect(migration, "migration 20261122000014 is missing").not.toBe("");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.can_write_announcement_audience(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.enforce_announcement_audience_scope()");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.announcement_upsert(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION app.announcement_archive(");
    expect(migration).toContain("app.coordinator_team_keys(");
    expect(migration).toContain(
      "CREATE TRIGGER trg_announcements_audience_scope BEFORE INSERT OR UPDATE OF audience_config ON public.announcements"
    );
    for (const name of ["can_write_announcement_audience", "announcement_upsert", "announcement_archive"]) {
      expect(migration, name).toContain(`GRANT EXECUTE ON FUNCTION app.${name}`);
      expect(migration, name).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    expect(migration).toContain("REVOKE ALL ON FUNCTION app.enforce_announcement_audience_scope() FROM PUBLIC");
    // The command path replaces the direct one: no session write remains on the table.
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.announcements FROM anon, authenticated");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("derives the tier from roles and team memberships, never from member_type", () => {
    const helper = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.can_write_announcement_audience(");
    expect(helper, "app.can_write_announcement_audience is missing").not.toBe("");
    expect(helper).toContain("app.is_active_member()");
    expect(helper).toContain("app.has_any_role('super_admin', 'yayasan', 'pengurus')");
    expect(helper).toContain("app.has_any_role('koordinator')");
    expect(helper).toContain("'member_type'");
    // The team set comes from an active coordinator membership, exactly like the agenda helper.
    expect(helper).toContain("app.coordinator_team_keys(v_uid)");
  });

  it("keeps the whole command inside one transaction and one identity", () => {
    const upsert = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.announcement_upsert(");
    expect(upsert, "app.announcement_upsert is missing").not.toBe("");
    expect(upsert).toContain("v_uid uuid := auth.uid();");
    expect(upsert).toContain("IF v_uid IS NULL OR NOT app.is_active_member() THEN");
    expect(upsert).toContain("FROM public.announcements WHERE id = p_announcement_id FOR UPDATE");
    // author_id is the session for a new row and never whatever the payload claimed; an edit
    // keeps the original author, as the old update path did.
    expect(upsert).toContain("COALESCE(v_existing.author_id, v_uid)");
    expect(upsert).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(upsert).toContain("COALESCE(max(revision_no), 0) + 1");
    expect(upsert).toContain("INSERT INTO public.announcement_revisions");
    expect(upsert).toContain("INSERT INTO public.audit_logs");
    expect(upsert).toContain("app.can_write_announcement_audience");
    // SCH-07 parity: a payload that cannot express the stored audience keeps it.
    expect(upsert).toContain("COALESCE(v_row->'audience'");
    expect(upsert).toContain("v_existing.audience_config");
    // Key presence, not null, is what clears a scheduled or expiry time.
    expect(upsert).toContain("? 'scheduled_for'");
    expect(upsert).toContain("? 'expires_at'");

    const archive = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.announcement_archive(");
    expect(archive, "app.announcement_archive is missing").not.toBe("");
    expect(archive).toContain("FOR UPDATE");
    // The row-ownership rule follows the approved SCH-02 precedent (app.event_cancel judges the
    // stored row against app.coordinator_team_keys(); the audience helper is for the audience a
    // write is about to store, which an archive does not change).
    expect(archive).toContain("app.coordinator_team_keys(v_uid)");
    expect(archive).toContain("Pengumuman ini berada di luar tim Anda.");
    expect(archive).toContain("archived_at");
    expect(archive).toContain("'announcement.deleted'");
    expect(archive).toContain("COALESCE(v_actor_name, v_uid::text)");
  });

  it("refuses the out-of-tier writes by name", () => {
    const upsert = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.announcement_upsert(");
    expect(upsert).toContain("Anda tidak memiliki izin mengelola pengumuman.");
    expect(upsert).toContain("Sesi tidak valid atau akun tidak aktif.");
    expect(upsert).toContain("Pengumuman tidak ditemukan.");
    expect(upsert).toContain("Pengumuman yang sudah diarsipkan tidak dapat diubah.");
    expect(upsert).toContain("Audiens berbasis kategori anggota tidak diizinkan; pilih tim atau seluruh pondok.");
    expect(upsert).toContain("Koordinator hanya dapat menerbitkan pengumuman untuk timnya sendiri.");
    expect(upsert).toContain("Pengumuman dengan waktu terbit mendatang harus tetap draft.");
    const trigger = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.enforce_announcement_audience_scope()");
    expect(trigger).toContain("'42501'");
    expect(trigger).toContain("auth.uid() IS NULL");
    expect(trigger).toContain("Audiens pengumuman di luar izin peran Anda (PERMISSIONS.md §3.6).");
  });

  it("rolls the command surface back out of the schema", () => {
    expect(rollback, "rollback file is missing").not.toBe("");
    expect(rollback).toContain("DROP TRIGGER IF EXISTS trg_announcements_audience_scope ON public.announcements");
    for (const name of ["announcement_archive", "announcement_upsert", "can_write_announcement_audience"]) {
      expect(rollback, name).toContain(`DROP FUNCTION IF EXISTS public.${name}`);
      expect(rollback, name).toContain(`DROP FUNCTION IF EXISTS app.${name}`);
    }
    expect(rollback).toContain("DROP FUNCTION IF EXISTS app.enforce_announcement_audience_scope();");
    expect(rollback).not.toContain("DROP FUNCTION IF EXISTS public.enforce_announcement_audience_scope");
    // The pre-migration application wrote with the service-role client, which this migration never
    // revoked, so the direct path does not strictly have to come back. The rollback restores the
    // authenticated privilege it removed and deliberately leaves anon revoked — a rollback that
    // re-widens a surface nobody used is not an undo, it is a second change.
    expect(rollback).toContain("GRANT INSERT, UPDATE, DELETE ON public.announcements TO authenticated");
    expect(rollback).not.toContain("TO anon, authenticated");
    expect(rollback).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("proves the tier with pgTAP fixtures", () => {
    expect(pgtap, "supabase/tests/announcement_command_scope.sql is missing").not.toBe("");
    expect(pgtap).toContain("SELECT plan(37)");
    expect(pgtap).toContain("SET LOCAL ROLE authenticated");
    expect(pgtap).toContain("RESET ROLE;");
    // Every physical read (audit_logs, drafts, the revision ledger) has to run outside the
    // impersonated session: the SELECT policy hides exactly those rows, so read as
    // `authenticated` the assertions would pass while the RPC wrote nothing.
    expect(pgtap).toMatch(/RESET ROLE;\nSELECT is\(\(SELECT count\(\*\)::int FROM public\.audit_logs/);
    expect(pgtap).toContain("throws_ok");
    expect(pgtap).toContain("'42501'");
    expect(pgtap).toContain("announcement.published");
    expect(pgtap).toContain("announcement.deleted");
    // The parity assertions are what stop the two audience helpers from drifting apart.
    expect(pgtap).toContain("app.can_write_event_audience(");
    expect(pgtap).toContain("ANNOUNCEMENT_PUBLISHED");
  });

  it("stops offering a member_type audience in either form", () => {
    expect(jadwalPage, "jadwal page is missing").not.toBe("");
    expect(adminPage, "admin jadwal page is missing").not.toBe("");
    // §2 rule 1: profiles.member_type is descriptive, so the pickers only offer the pondok and
    // the teams the session coordinates; app.announcement_upsert() refuses anything else.
    expect(jadwalPage).not.toContain('scope: "member_type"');
    expect(adminPage).not.toContain('scope: "member_type"');
    expect(adminPage).not.toContain("audienceFromScope");
    expect(adminPage).toContain("announcementForm.audienceTeamId");
    expect(adminPage).toContain("AudiencePicker");
    // §2 rule 8: the composer a coordinator may use is gated by the same list the RPC accepts.
    expect(jadwalPage).toContain("holdsScheduleRole(user, AGENDA_WRITE_ROLES)");
    expect(jadwalPage).toContain("getEventAudienceOptionsAction");
    expect(jadwalPage).not.toContain('["super_admin", "yayasan", "pengurus"].includes(user.role)');
  });

  it("records the enforced constraint in PERMISSIONS.md", () => {
    expect(permissions).toContain("Catatan `ANN-CMD`");
    expect(permissions).toContain("app.can_write_announcement_audience");
    expect(permissions).toContain("trg_announcements_audience_scope");
    expect(permissions).toContain("announcement_revisions");
  });
});
