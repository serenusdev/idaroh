import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Wave 5.4 live telemetry contract", () => {
  it("uses the read-only Kysely path and exact role guard", () => {
    const action = read("src/modules/live-telemetry/actions.ts");
    const queries = read("src/lib/db/live-telemetry-queries.ts");
    expect(action).toContain('requireRole(["pengurus", "super_admin"])');
    expect(action).toContain("getReadOnlyDb()");
    expect(queries).toContain('Asia/Jakarta');
    expect(queries).toContain("attendance_exceptions");
    expect(queries).toContain("daily_reports");
    expect(queries).toContain("tasks");
  });

  it("subscribes only to telemetry source tables with debounced refresh", () => {
    const realtime = read("src/modules/live-telemetry/realtime.ts");
    expect(realtime).toContain('"postgres_changes"');
    expect(realtime).toContain('"attendance_records", "daily_reports", "tasks"');
    expect(realtime).toContain("setTimeout");
    expect(realtime).toContain("400");
  });

  it("does not grant santri a telemetry navigation entry", () => {
    const page = read("src/app/(app)/admin/live-telemetry/page.tsx");
    const sidebar = read("src/components/layout/desktop-sidebar.tsx");
    expect(page).toContain('user.role === "pengurus"');
    expect(page).toContain('user.role === "super_admin"');
    expect(sidebar).toContain('href: "/admin/live-telemetry"');
  });
});
