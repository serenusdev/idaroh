import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const query = readFileSync(resolve(process.cwd(), "src/lib/db/analytics-queries.ts"), "utf8");
const actions = readFileSync(resolve(process.cwd(), "src/modules/analytics/actions.ts"), "utf8");
const policy = readFileSync(resolve(process.cwd(), "src/lib/export-policy.ts"), "utf8");

describe("Wave 6.2 audit compliance center", () => {
  it("uses the typed read-only path and WIB date boundaries", () => {
    expect(query).toContain("fetchComplianceCenterPage");
    expect(query).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(actions).toContain("getReadOnlyDb()");
  });
  it("supports actor, action, entity, and compliance filters", () => {
    expect(query).toContain("actionType");
    expect(query).toContain("entityType");
    expect(query).toContain("complianceStatus");
    expect(query).toContain("attention");
  });
  it("keeps compliance export restricted and categorized", () => {
    expect(policy).toContain('"compliance_audit"');
    expect(policy).toContain("AUDIT_EXPORT_ROLES");
  });
});
