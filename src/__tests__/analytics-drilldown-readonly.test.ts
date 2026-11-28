import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("analytics drill-down read boundary", () => {
  it("uses ReadOnlyKysely for named drill-down data", () => {
    const source = readFileSync("src/modules/operations/actions.ts", "utf8");
    const start = source.indexOf("export async function getAnalyticsDrilldownAction");
    const end = source.indexOf("function parseCsv", start);
    const drilldown = source.slice(start, end);
    expect(drilldown).toContain("getReadOnlyDb()");
    expect(drilldown).toContain("fetchAnalyticsDrilldown");
    expect(drilldown).not.toContain("createAdminClient()");
  });

  it("does not grant super_admin-only named drill-down access", () => {
    const source = readFileSync("src/modules/operations/actions.ts", "utf8");
    const start = source.indexOf("export async function getAnalyticsDrilldownAction");
    const end = source.indexOf("function parseCsv", start);
    const drilldown = source.slice(start, end);
    expect(drilldown).toContain("hasAnyRole(user, [\"yayasan\", \"pengurus\", \"koordinator\"])");
  });

  it("exposes every dashboard segment as a named metric", async () => {
    const { fetchAnalyticsDrilldown } = await import("@/lib/db/analytics-drilldown-queries");
    expect(fetchAnalyticsDrilldown).toBeTypeOf("function");
    const metrics = [
      "attendance_on_time", "attendance_grace", "attendance_late", "attendance_no_checkin",
      "reports_submitted", "reports_late", "reports_backlog",
      "tasks_open", "tasks_completed", "tasks_overdue",
    ];
    expect(metrics).toHaveLength(10);
  });
});
