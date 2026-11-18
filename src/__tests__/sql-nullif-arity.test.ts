import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Heuristic arity guard, NOT a full SQL parser. It flags NULLIF(...) whose
// argument list has no top-level comma, handling one level of nested
// parentheses (e.g. NULLIF(btrim(x), '') or NULLIF(current_setting('k', true), '')).
// Limitations: nesting deeper than one level and parentheses/commas inside
// string literals or comments can produce false positives or evade detection.
// PostgreSQL NULLIF is special parser syntax requiring exactly two arguments;
// a single-argument call fails at parse time (SQLSTATE 42601).
const SINGLE_ARGUMENT_NULLIF = /NULLIF\((?:[^(),]|\([^()]*\))*\)/i;

function collectSqlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSqlFiles(full));
    else if (entry.name.endsWith(".sql")) out.push(full);
  }
  return out;
}

const root = resolve(process.cwd(), "supabase");
const sqlFiles = collectSqlFiles(root).sort();

describe("repo-wide SQL NULLIF arity guard", () => {
  it("scans the full supabase SQL surface", () => {
    expect(sqlFiles.length).toBeGreaterThanOrEqual(60);
  });

  for (const file of sqlFiles) {
    it(`has no single-argument NULLIF in ${relative(process.cwd(), file)}`, () => {
      expect(readFileSync(file, "utf8")).not.toMatch(SINGLE_ARGUMENT_NULLIF);
    });
  }
});