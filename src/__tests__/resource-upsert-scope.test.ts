import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

function readOrEmpty(relativePath: string): string {
  const full = resolve(root, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const libraryActions = readOrEmpty("src/modules/library/actions.ts");
const migration = readOrEmpty("supabase/migrations/20261122000007_team_command_rpcs_and_resource_upsert.sql");
const rollback = readOrEmpty("supabase/rollback/20261122000007_team_command_rpcs_and_resource_upsert_down.sql");

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

describe("LIB-03 / LIB-08 — one resource save is one transaction", () => {
  it("sends the admin save through a single command RPC", () => {
    const body = actionBody(libraryActions, "saveResourceAction");
    expect(body, "saveResourceAction is missing").toContain('rpc("resource_upsert"');
    expect(body).toContain("createClient()");
    expect(body).not.toContain("createAdminClient()");
    expect(body).not.toContain('from("resources").insert(');
    expect(body).not.toContain('from("resources").update(');
  });

  it("sends every imported CSV row through the same RPC", () => {
    const body = actionBody(libraryActions, "importResourcesCsvAction");
    expect(body, "importResourcesCsvAction is missing").toContain('rpc("resource_upsert"');
    // LIB-01 stays: the import surface remains exclusive to super_admin.
    expect(body).toContain("await requireRole([...LIBRARY_IMPORT_ROLES]);");
    expect(body).not.toContain('from("resources").insert(');
  });

  it("deletes the split write helpers the RPC replaces", () => {
    // A leftover helper would be a second, non-atomic way to write the same row.
    expect(libraryActions).not.toContain("syncResourceTags");
    expect(libraryActions).not.toContain("resourceRow(");
    expect(libraryActions).not.toContain('from("resource_revisions").insert(');
  });

  it("carries the payload as data, not as SQL the caller composes", () => {
    const save = actionBody(libraryActions, "saveResourceAction");
    expect(save).toContain("p_row:");
    expect(save).toContain("p_tag_names:");
    expect(save).toContain("p_change_note:");
  });

  it("ships app.resource_upsert with the command guards", () => {
    expect(migration, "migration 20261122000007 is missing").not.toBe("");
    const fn = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.resource_upsert(");
    expect(fn, "app.resource_upsert is missing").not.toBe("");
    expect(fn).toContain("p_resource_id uuid");
    expect(fn).toContain("p_row jsonb");
    expect(fn).toContain("p_tag_names text[]");
    expect(fn).toContain("p_change_note text");
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("SET search_path = public, app, pg_temp");
    expect(fn).toContain("auth.uid() IS NULL");
    expect(fn).toContain("app.is_active_member()");
    expect(fn).toContain("app.has_any_role('super_admin', 'yayasan', 'pengurus')");
  });

  it("writes resource, tags, revision and audit inside that one body", () => {
    const fn = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.resource_upsert(");
    const order = [
      fn.indexOf("INSERT INTO public.resources"),
      fn.indexOf("UPDATE public.resources"),
      fn.indexOf("DELETE FROM public.resource_tags"),
      fn.indexOf("INSERT INTO public.resource_tags"),
      fn.indexOf("INSERT INTO public.resource_revisions"),
      fn.indexOf("INSERT INTO public.audit_logs"),
    ];
    expect(Math.min(...order), "one of the four writes is missing").toBeGreaterThan(-1);
    // The revision snapshot has to describe the row that was just written.
    expect(order[order.length - 1]).toBeGreaterThan(order[order.length - 2]);
    expect(fn).toContain("FOR UPDATE");
    expect(fn).toContain("COALESCE(max(revision_no), 0) + 1");
    expect(fn).toContain("library.resource_saved");
  });

  it("validates the enum labels and the unique identities before writing", () => {
    const fn = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.resource_upsert(");
    expect(fn).toContain("resource_visibility_type");
    expect(fn).toContain("resource_status_type");
    // Two resources on one slug would otherwise abort with a raw constraint name.
    expect(fn).toMatch(/slug/);
    expect(fn).toMatch(/legacy_record_id/);
    expect(fn).toContain("wajib diisi");
  });

  it("keeps the tag slugs derived in the database", () => {
    const fn = sqlFunction(migration, "CREATE OR REPLACE FUNCTION app.resource_upsert(");
    expect(fn).toContain("regexp_replace(lower(");
    expect(fn).toContain("ON CONFLICT (slug)");
    expect(fn).toContain("btrim(");
  });

  it("exposes the PostgREST wrapper", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.resource_upsert(");
    expect(migration).toContain("SELECT app.resource_upsert(");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.resource_upsert");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("rolls the atomic upsert back out of the schema", () => {
    expect(rollback, "rollback file is missing").not.toBe("");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.resource_upsert(uuid, jsonb, text[], text)");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS app.resource_upsert(uuid, jsonb, text[], text)");
    expect(rollback).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
