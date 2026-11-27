/**
 * PROF-SELF contract test — the migration chain and the action source are checked statically so
 * a future edit cannot quietly move the profile save back onto the service role.
 *
 * The rules below come from AGENTS.md ("setiap RPC SECURITY DEFINER: search_path terkunci,
 * validasi auth.uid(), cek app.is_active_member(), tulis audit_logs dalam transaksi yang sama")
 * and PERMISSIONS.md §3.7 (`people.profile.update_self` = `own` for S/K/P/Y/SA).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATION = "20261122000017_self_profile_update_rpc.sql";
const migrationPath = resolve(root, "supabase/migrations", MIGRATION);
const rollbackPath = resolve(root, "supabase/rollback", MIGRATION.replace(".sql", "_down.sql"));

function actionSource(): string {
  const source = readFileSync(resolve(root, "src/modules/iam/actions.ts"), "utf8");
  const start = source.indexOf("export async function updateProfileAction(");
  const end = source.indexOf("export async function uploadAvatarAction(", start);
  expect(start, "updateProfileAction still exists in src/modules/iam/actions.ts").toBeGreaterThan(-1);
  return source.slice(start, end);
}

describe("updateProfileAction source contract", () => {
  it("reads the payload only after the try block opens", () => {
    const body = actionSource();
    const tryAt = body.indexOf("try {");
    expect(tryAt).toBeGreaterThan(-1);
    // Every payload dereference must sit inside the try: a statement before it turns a malformed
    // request into an uncaught TypeError, which production renders as the opaque banner.
    const before = body.slice(0, tryAt);
    expect(before).not.toMatch(/payload\s*!\./);
    expect(before).not.toMatch(/payload\.[a-zA-Z]+\s*\./);
  });

  it("delegates to the update_own_profile RPC instead of a direct table write", () => {
    const body = actionSource();
    expect(body).toMatch(/\.rpc\(\s*["']update_own_profile["']/);
    expect(body).not.toMatch(/from\(\s*["']profiles["']\s*\)/);
  });

  it("authenticates through the guard rather than trusting a client identity", () => {
    expect(actionSource()).toMatch(/requireAuthUser\(/);
  });
});

describe("20261122000017 migration contract", () => {
  it("ships a rollback for the new RPC", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(rollbackPath)).toBe(true);
  });

  it("keeps the SECURITY DEFINER checklist for app.update_own_profile", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION app.update_own_profile(");
    const end = sql.indexOf("REVOKE", start);
    expect(start).toBeGreaterThan(-1);
    const fn = sql.slice(start, end);
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET\s+search_path\s*=\s*public,\s*app,\s*pg_temp/);
    expect(fn).toMatch(/auth\.uid\(\)/);
    expect(fn).toMatch(/app\.is_active_member\(\)/);
    expect(fn).toMatch(/INSERT INTO public\.audit_logs/);
    expect(fn).toMatch(/iam\.profile_updated/);
  });

  it("exposes a public wrapper and grants the session role only", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_own_profile\(/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*update_own_profile[\s\S]*TO authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*update_own_profile[\s\S]*FROM PUBLIC/);
  });

  it("closes the direct write path that 20261102000003 left open", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/REVOKE UPDATE ON public\.profiles FROM (anon, )?authenticated/);
    expect(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });

  it("restores the previous grant instead of leaving the rollback destructive", () => {
    const down = readFileSync(rollbackPath, "utf8");
    expect(down).toMatch(/DROP FUNCTION IF EXISTS public\.update_own_profile\(/);
    expect(down).toMatch(/DROP FUNCTION IF EXISTS app\.update_own_profile\(/);
    expect(down).toMatch(/GRANT UPDATE \(full_name, phone_number, avatar_url, notes, updated_at\)\s*\n?\s*ON public\.profiles TO authenticated/);
    expect(down.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });

  it("ships a pgTAP suite so CI proves the RPC against a real database", () => {
    expect(existsSync(resolve(root, "supabase/tests/profile_self_update_rls.sql"))).toBe(true);
  });
});
