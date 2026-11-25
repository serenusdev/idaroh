/**
 * CRON-DAY + DEAD-RPC — pins for the two operator-approved TEMPORAL §7 follow-ups.
 *
 * 1. The notification cron must ask the database whether today is operational before it sends
 *    an attendance reminder. The snapshot ('no_checkin') already hides Sunday and closed days, but
 *    only while refresh_attendance_effective succeeds; the route has a fallback that derives the
 *    audience from attendance_records, and the admin picker offers "Min" as a weekday. Without the
 *    guard, a closed day can still produce "Batas waktu presensi pagi hampir ditutup".
 * 2. app.report_submit(uuid, uuid) is dead (revoked, unexported, uncalled) and carries three
 *    hazards a future writer would inherit: a hardcoded ' 21:00:00' deadline instead of
 *    policy_settings, search_path without pg_temp, and a caller-supplied p_user_id instead of
 *    auth.uid(). Removing it is safer than repairing a function nobody calls.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (...parts: string[]) => readFileSync(resolve(root, ...parts), "utf8");

const GUARD_MIGRATION = "supabase/migrations/20261122000012_attendance_reminder_day_guard.sql";
const DROP_MIGRATION = "supabase/migrations/20261122000013_drop_dead_report_submit.sql";
const GUARD_ROLLBACK = "supabase/rollback/20261122000012_attendance_reminder_day_guard_down.sql";
const DROP_ROLLBACK = "supabase/rollback/20261122000013_drop_dead_report_submit_down.sql";

function productionFilesTouching(name: string): string[] {
  const hits: string[] = [];
  const walk = (relDir: string) => {
    for (const entry of readdirSync(resolve(root, relDir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(`${relDir}/${entry.name}`);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const rel = `${relDir}/${entry.name}`;
      if (readFileSync(resolve(root, rel), "utf8").includes(name)) hits.push(rel);
    }
  };
  for (const dir of ["src/app", "src/modules", "src/lib", "src/components"]) {
    if (existsSync(resolve(root, dir))) walk(dir);
  }
  return hits;
}

describe("public.is_operational_day exposes the day rule to the cron", () => {
  const sql = read(GUARD_MIGRATION);

  it("wraps the single app-level rule instead of duplicating the Sunday arithmetic", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_operational_day\(\s*p_date date\s*\)/);
    expect(sql).toContain("app.is_operational_day(p_date)");
    // A second copy of EXTRACT(DOW ...) would drift from the snapshot layer again, which is how
    // the TEMPORAL defect was introduced in the first place.
    expect(sql).not.toMatch(/EXTRACT\(DOW/);
    expect(sql).not.toMatch(/non_operational_dates/);
  });

  it("obeys the SECURITY DEFINER house rules from AGENTS.md", () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, app, pg_temp/);
    expect(sql).toMatch(/STABLE/);
  });

  it("grants service_role only, so the pondok calendar is not an API-probeable list", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.is_operational_day\(date\) FROM PUBLIC/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_operational_day\(date\) TO service_role/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.is_operational_day\(date\) TO (authenticated|anon)/);
  });

  it("reloads the schema so PostgREST picks the endpoint up", () => {
    expect(sql.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});

describe("the dead report_submit is dropped without touching the live path", () => {
  const sql = read(DROP_MIGRATION);

  it("drops both possible schemas idempotently", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS app\.report_submit\(uuid, uuid\)/i);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.report_submit\(uuid, uuid\)/i);
  });

  it("fails closed if the live report commands would not survive", () => {
    for (const signature of [
      "app.save_report(uuid, date, text, boolean, jsonb)",
      "public.save_report(uuid, date, text, boolean, jsonb)",
      "app.review_report(uuid, integer, text, text, text)",
      "public.review_report(uuid, integer, text, text, text)",
    ]) {
      expect(sql, `missing assertion for ${signature}`).toContain(`'${signature}'`);
    }
    expect(sql).toMatch(/to_regprocedure/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
  });

  it("has no callers left in production code", () => {
    expect(productionFilesTouching("report_submit")).toEqual([]);
  });
});

describe("the cron route consults the guard and fails closed", () => {
  const route = read("src/app/api/cron/notifications/route.ts");

  it("asks the database before deciding the attendance job is due", () => {
    expect(route).toMatch(/rpc\("is_operational_day",\s*\{\s*p_date: today\s*\}\s*\)/);
    expect(route).toMatch(/const sendAttendanceReminder = due\("attendance_reminder"\) && operationalToday === true/);
    expect(route.indexOf("is_operational_day")).toBeLessThan(route.indexOf("const jobKeys"));
  });

  it("refuses to guess when the day cannot be read", () => {
    expect(route).toMatch(/if \(dayError\) throw dayError/);
    // `=== true`, not `!== false`: a null/absent answer must not send reminders.
    expect(route).toContain("operationalToday === true");
    expect(route).not.toContain("operationalToday !== false");
  });

  it("leaves the report reminder alone: §3.4 sets a daily deadline, no calendar exemption", () => {
    expect(route).toMatch(/const sendReportReminder = due\("report_reminder"\);/);
  });
});

describe("rollbacks invert exactly these changes", () => {
  it("the guard rollback removes only the wrapper", () => {
    const down = read(GUARD_ROLLBACK);
    expect(down).toMatch(/DROP FUNCTION IF EXISTS public\.is_operational_day\(date\)/i);
    expect(down).not.toMatch(/DROP FUNCTION IF EXISTS app\.is_operational_day/);
    expect(down).toMatch(/app\.is_operational_day/);
  });

  it("the drop rollback restores the pre-image from 20261101000004 verbatim", () => {
    const down = read(DROP_ROLLBACK);
    const original = read("supabase/migrations/20261101000004_activity_reports_schema.sql");
    const body = original.slice(original.indexOf("CREATE OR REPLACE FUNCTION app.report_submit("));
    const preImage = body.slice(0, body.indexOf("$$;") + 3);
    expect(down).toContain(preImage.trim());
    expect(down).toMatch(/SET search_path = public, app$/m);
    // Rolling back must not silently re-export the dead function.
    expect(down).not.toMatch(/GRANT EXECUTE ON FUNCTION (app|public)\.report_submit/);
  });

  it("both files exist", () => {
    for (const file of [GUARD_MIGRATION, DROP_MIGRATION, GUARD_ROLLBACK, DROP_ROLLBACK]) {
      expect(existsSync(resolve(root, file)), file).toBe(true);
    }
  });
});
