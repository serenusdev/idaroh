import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const calledRpcs = new Set<string>();
for (const file of collectSourceFiles(resolve(root, "src"))) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(/\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g)) {
    calledRpcs.add(match[1]);
  }
}

const definedPublicFunctions = new Set<string>();
const migrationsDir = resolve(root, "supabase/migrations");
for (const file of readdirSync(migrationsDir)) {
  if (!file.endsWith(".sql")) continue;
  const content = readFileSync(join(migrationsDir, file), "utf8");
  for (const match of content.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi,
  )) {
    definedPublicFunctions.add(match[1].toLowerCase());
  }
}

describe("RPC schema coverage", () => {
  it("discovers the live RPC call sites in src", () => {
    expect(calledRpcs.has("save_report")).toBe(true);
    expect(calledRpcs.has("attendance_check_in")).toBe(true);
    expect(calledRpcs.has("refresh_attendance_effective")).toBe(true);
    expect(calledRpcs.size).toBeGreaterThanOrEqual(15);
  });

  it("every supabase.rpc() call has a public function defined in migrations", () => {
    const missing = [...calledRpcs].filter((name) => !definedPublicFunctions.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it("keeps the cron snapshot wrapper restricted to the service role", () => {
    const sql = readFileSync(
      join(migrationsDir, "20261112000006_public_refresh_attendance_effective.sql"),
      "utf8",
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_attendance_effective\(date\) TO service_role/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_attendance_effective\(date\) FROM PUBLIC/);
    expect(sql).toMatch(/SECURITY INVOKER/);
  });
});