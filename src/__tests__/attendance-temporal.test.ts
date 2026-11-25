/**
 * TEMPORAL (Gelombang 3, item 1) — pins for PERMISSIONS.md §3.3 and §3.4.
 *
 * Two halves:
 *   * the day rule and the boundary arithmetic now live in SQL helpers that pgTAP can put on a
 *     clock (supabase/tests/attendance_temporal_rules.sql); these tests keep the TypeScript side
 *     honest about the same minutes and keep the migration from losing a clause the way
 *     20261114000007 lost the one 20261102000012 had added;
 *   * the effective-attendance statuses have to be nameable, because the history page drops rows
 *     whose status it cannot label — a Sunday that renders as nothing is a Sunday erased.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CORRECTABLE_STATUSES, EFFECTIVE_STATUS_LABELS } from "@/modules/attendance/labels";
import { resolveCorrectionClassification } from "@/modules/attendance/classification";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(resolve(root, ...parts), "utf8");

const migration = read("supabase/migrations/20261122000011_attendance_temporal_rules.sql");
const rollback = read("supabase/rollback/20261122000011_attendance_temporal_rules_down.sql");
const effectiveLayer = read("supabase/migrations/20261102000011_effective_attendance.sql");

/** The 08:00 cut-off / 08:15 grace baseline from 20261102000005:478, as the SQL helper sees it. */
const classify = (hhmmss: string) => {
  const [h, m, s] = hhmmss.split(":").map(Number);
  const minutes = h * 60 + m;
  const seconds = minutes * 60 + s;
  if (seconds <= 8 * 60 * 60 + 59) return "on_time";
  if (seconds <= 8 * 60 * 60 + 15 * 60 + 59) return "grace";
  return "late";
};

describe("the day rule lives in one SQL helper that both layers ask", () => {
  it("defines app.is_operational_day with the Sunday clause and the closure calendar", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION app\.is_operational_day\(p_date date\)/);
    expect(migration).toMatch(/EXTRACT\(DOW FROM p_date\) <> 0/);
    expect(migration).toContain("FROM public.non_operational_dates nod WHERE nod.attendance_date = p_date");
  });

  it("the snapshot asks the helper instead of re-deriving the weekday", () => {
    const refresh = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION app.refresh_attendance_effective")
    );
    expect(refresh).toContain("v_operational := app.is_operational_day(p_date)");
    expect(refresh).toContain("WHEN NOT v_operational THEN 'non_operational'");
    expect(refresh).toContain("WHEN NOT v_operational THEN 'calendar'");
    // ROLE-SYNC must not be undone while the Sunday clause is being restored.
    expect(refresh).not.toContain("member_type");
    expect(refresh).toContain("r.key IN ('santri', 'koordinator')");
    // The text/enum cast that made every attendance insert parseable again.
    expect(refresh).toContain("c.requested_classification::text");
  });

  it("the check-in gate blocks on the calendar, not only on Sunday", () => {
    const checkIn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION app.attendance_check_in"),
      migration.indexOf("REVOKE ALL ON FUNCTION app.attendance_check_in")
    );
    expect(checkIn).toContain("IF NOT app.is_operational_day(v_date) THEN");
    expect(checkIn).not.toMatch(/IF EXTRACT\(DOW FROM \(now\(\) AT TIME ZONE/);
    expect(checkIn).toContain("FROM app.classify_checkin_time(");
    expect(checkIn).toContain("ON CONFLICT (user_id, attendance_date) DO NOTHING");
  });

  it("a calendar closure refreshes the snapshot in both directions", () => {
    expect(migration).toContain("CREATE TRIGGER trg_refresh_attendance_after_calendar");
    expect(migration).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON public\.non_operational_dates/);
    const fn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION app.refresh_attendance_after_calendar"),
      migration.indexOf("DROP TRIGGER IF EXISTS trg_refresh_attendance_after_calendar")
    );
    expect(fn).toContain("app.refresh_attendance_effective(NEW.attendance_date)");
    expect(fn).toContain("app.refresh_attendance_effective(OLD.attendance_date)");
  });

  it("the repair is bounded, service-role only, and runs once at release", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION app\.backfill_non_operational_effective\(p_from date, p_to date\)/);
    expect(migration).toContain("WHERE ae.attendance_date BETWEEN p_from AND p_to");
    expect(migration).toContain("AND NOT app.is_operational_day(ae.attendance_date)");
    // Idempotence: rows already correct are not matched, so a second pass repairs nothing.
    expect(migration).toContain("(ae.status <> 'non_operational' OR ae.source_type <> 'calendar')");
    expect(migration).toContain("REVOKE ALL ON FUNCTION app.backfill_non_operational_effective(date, date) FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.backfill_non_operational_effective(date, date) TO service_role");
    expect(migration).toMatch(/SELECT min\(attendance_date\), max\(attendance_date\) INTO v_from, v_to/);
  });

  it("grants are not widened anywhere on the way", () => {
    // non_operational_dates keeps its single SELECT policy from 20261102000011 and this
    // migration adds no INSERT/UPDATE policy and no write grant.
    expect(migration).not.toMatch(/CREATE POLICY .*ON public\.non_operational_dates/);
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE) ON public\.non_operational_dates/);
    expect(effectiveLayer).toContain('CREATE POLICY "Active users can view non operational dates"');
  });

  it("the rollback restores every pre-image and drops every new object", () => {
    expect(rollback).toContain("DROP TRIGGER IF EXISTS trg_refresh_attendance_after_calendar");
    for (const name of [
      "app.is_operational_day(date)",
      "app.classify_checkin_time(time, time, time)",
      "app.report_time_is_late(time, time)",
      "app.backfill_non_operational_effective(date, date)",
      "public.backfill_non_operational_effective(date, date)",
      "app.refresh_attendance_after_calendar()",
    ]) {
      expect(rollback).toContain(`DROP FUNCTION IF EXISTS ${name}`);
    }
    expect(rollback).toContain("IF EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Jakarta')) = 0 THEN");
    expect(rollback).toContain("v_is_late := v_now_wib::time > v_deadline;");
    // The pre-image is the buggy one by definition: the rollback must not pretend otherwise.
    const rolledRefresh = rollback.slice(
      rollback.indexOf("CREATE OR REPLACE FUNCTION app.refresh_attendance_effective"),
      rollback.indexOf("REVOKE ALL ON FUNCTION app.refresh_attendance_effective")
    );
    expect(rolledRefresh).not.toContain("is_operational_day");
    expect(rolledRefresh).not.toContain("EXTRACT(DOW FROM p_date)");
  });
});

describe("the boundary minutes agree between the SQL helper and the TypeScript re-derivation", () => {
  it("the SQL helpers are pure functions of the times they are handed", () => {
    const classifier = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION app.classify_checkin_time"),
      migration.indexOf("COMMENT ON FUNCTION app.classify_checkin_time")
    );
    expect(classifier).toContain("p_time <= p_cutoff + interval '59 seconds'");
    expect(classifier).toContain("p_time <= p_grace + interval '59 seconds'");
    expect(classifier).toContain("GREATEST(0, floor(EXTRACT(EPOCH FROM (p_time - p_cutoff)) / 60)::integer)");
    const late = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION app.report_time_is_late"),
      migration.indexOf("COMMENT ON FUNCTION app.report_time_is_late")
    );
    expect(late).toContain("SELECT p_now > p_deadline");
    // save_report is a verbatim copy of 20261122000002:450-615 except this one line.
    expect(migration).toContain("v_is_late := app.report_time_is_late(v_now_wib::time, v_deadline);");
    expect(migration).not.toContain("v_is_late := v_now_wib::time > v_deadline;");
  });

  it.each([
    ["07:59:00", "on_time"],
    ["08:00:00", "on_time"],
    ["08:00:59", "on_time"],
    ["08:01:00", "grace"],
    ["08:15:00", "grace"],
    ["08:15:59", "grace"],
    ["08:16:00", "late"],
    ["09:30:00", "late"],
  ])("the reference rule and the SQL helper read %s the same way (%s)", (hhmmss, expected) => {
    expect(classify(hhmmss)).toBe(expected);
  });

  it("a correction recomputed from a recorded time lands on the same side of the minute", () => {
    // recordedTime arrives as "08:00 WIB" style text: whole minutes, which is exactly what the
    // SQL "+59 seconds" tolerance reduces to, so the two implementations cannot disagree.
    const at = (hhmm: string) => {
      const resolved = resolveCorrectionClassification("wrong_time", `${hhmm} WIB`, "08:00", "08:15");
      if ("error" in resolved) throw new Error(resolved.error);
      return resolved.classification;
    };
    expect(at("07:59")).toBe("on_time");
    expect(at("08:00")).toBe("on_time");
    expect(at("08:01")).toBe("grace");
    expect(at("08:15")).toBe("grace");
    expect(at("08:16")).toBe("late");
  });
});

describe("every effective-attendance status is nameable in the member's own history", () => {
  const statusCheck = /status text NOT NULL CHECK \(status IN \(([^)]*)\)\)/.exec(effectiveLayer);

  it("covers exactly the statuses the database CHECK allows", () => {
    const allowed = (statusCheck?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();
    expect(allowed.length).toBe(9);
    expect(Object.keys(EFFECTIVE_STATUS_LABELS).sort()).toEqual(allowed);
  });

  it("labels the two non-attended-but-compliant statuses instead of hiding them", () => {
    expect(EFFECTIVE_STATUS_LABELS.non_operational).toBe("Hari Non-Operasional");
    expect(EFFECTIVE_STATUS_LABELS.not_required).toBe("Tidak Wajib Presensi");
    expect(EFFECTIVE_STATUS_LABELS.duty).toBe("Tugas Luar");
  });

  it("never offers a correction for a day nobody was expected to attend", () => {
    expect(CORRECTABLE_STATUSES).toEqual(["late", "grace", "no_checkin"]);
    expect(CORRECTABLE_STATUSES).not.toContain("non_operational");
    expect(CORRECTABLE_STATUSES).not.toContain("not_required");
  });

  it("the history action reads the shared label table", () => {
    const actions = read("src/modules/attendance/actions.ts");
    expect(actions).toContain('from "./labels"');
    expect(actions).toContain("row.status in EFFECTIVE_STATUS_LABELS");
    expect(actions).toContain("EFFECTIVE_STATUS_LABELS[classification]");
    expect(actions).toContain("CORRECTABLE_STATUSES.includes(classification)");
    expect(actions).not.toContain('no_checkin: "Belum Presensi",\n        };');
  });
});
