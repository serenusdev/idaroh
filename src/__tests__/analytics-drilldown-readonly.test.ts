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
});
