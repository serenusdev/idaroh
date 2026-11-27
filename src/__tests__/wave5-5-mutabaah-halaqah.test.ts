import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Wave 5.5 dual-track mutabaah and halaqah", () => {
  it("keeps both logs bound to students and protects the daily uniqueness rule", () => {
    const migration = read("supabase/migrations/202611300003_wave5_5_mutabaah_halaqah.sql");
    expect(migration).toContain("student_id uuid NOT NULL REFERENCES public.students");
    expect(migration).toContain("UNIQUE (student_id, log_date)");
    expect(migration).toContain("timezone('Asia/Jakarta', now())");
    expect(migration).toContain("app.has_any_role('pengurus', 'super_admin')");
    expect(migration).toContain("recorded_by = auth.uid()");
  });

  it("uses server actions and never accepts recorded_by or ustadz_id from the client", () => {
    const actions = read("src/modules/mutabaah/actions.ts");
    expect(actions).toContain('supabase.rpc("save_mutabaah_log"');
    expect(actions).toContain('supabase.rpc("save_halaqah_log"');
    expect(actions).not.toContain("recorded_by:");
    expect(actions).not.toContain("ustadz_id:");
  });

  it("merges halaqah entries into tahfidz_data for report-card reads", () => {
    const page = read("src/app/(app)/rapor/[termId]/page.tsx");
    const summary = read("src/modules/mutabaah/tahfidz-summary.ts");
    expect(page).toContain("halaqah_logs");
    expect(page).toContain("tahfidz_data");
    expect(summary).toContain("halaqah_summary");
  });
});
