/**
 * SEC-02 Stage B contract (AGENT-WORKFLOW §4): the database — not the client —
 * must own the Jakarta operational date, is_late (WIB deadline), and the
 * report write path through a thin public.save_report wrapper.
 *
 * These expectations intentionally FAIL until Stage C adds
 * supabase/migrations/20261122000001_report_save_wib_is_late.sql and updates
 * src/modules/reports/actions.ts. Heuristic source guards, not a SQL parser.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "20261122000001_report_save_wib_is_late.sql";
const ROLLBACK_DOWN = "20261122000001_report_save_wib_is_late_down.sql";

function migration(): string {
  return readFileSync(resolve(process.cwd(), "supabase/migrations", MIGRATION), "utf8");
}

describe("SEC-02 save_report WIB integrity contract", () => {
  it("ships the SEC-02 migration and its rollback artifact", () => {
    expect(existsSync(resolve(process.cwd(), "supabase/migrations", MIGRATION))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "supabase/rollback", ROLLBACK_DOWN))).toBe(true);
  });

  it("computes is_late and the operational date in the database", () => {
    const sql = migration();
    expect(sql).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(sql).toContain("report_deadline_time");
    // The client-supplied flag must never be stored verbatim; every is_late
    // assignment has to be a guarded CASE, so both directions of forgery die.
    expect(sql).not.toMatch(/is_late\s*=\s*EXCLUDED\.is_late\s*[,\n]/i);
    expect(sql).toContain("'report.submitted'");
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("restores public.save_report as a thin delegating wrapper over app.save_report", () => {
    const sql = migration();
    expect(sql).toContain("SELECT app.save_report(");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.save_report\(uuid, date, text, boolean, jsonb\) FROM PUBLIC/,
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.save_report(uuid, date, text, boolean, jsonb) TO authenticated",
    );
  });

  it("keeps the duration regex fix in the replacement implementation", () => {
    // 20261102000006 shipped '\\d+$' (literal backslash + d) which never
    // matches; the SEC-02 rewrite must carry the single-backslash form.
    expect(migration()).toContain("'\\d+$'");
  });

  it("ends trusting the server action's own clock for the submitted value", () => {
    const actions = readFileSync(resolve(process.cwd(), "src/modules/reports/actions.ts"), "utf8");
    const start = actions.indexOf("export async function submitReportAction");
    expect(start).toBeGreaterThan(-1);
    const next = actions.indexOf("export async function", start + 1);
    const body = actions.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("p_is_late: false");
    expect(body).not.toMatch(/p_is_late:\s*isLate\b/);
    expect(body).toContain("data?.is_late === true");
  });

  it("keeps the pgTAP scenario plan count aligned with its assertions", () => {
    const fixture = readFileSync(
      resolve(process.cwd(), "supabase/tests/report_wib_is_late.sql"),
      "utf8",
    );
    const plan = Number(fixture.match(/SELECT plan\((\d+)\);/)?.[1] ?? "0");
    const assertions = (fixture.match(/^SELECT (?:is|ok|throws_ok)\(/gm) ?? []).length;
    expect(plan).toBe(assertions);
  });
});
