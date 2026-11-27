import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202612010001_wave6_1_gate_passes.sql"), "utf8");
const actions = readFileSync(resolve(process.cwd(), "src/modules/gate-pass/actions.ts"), "utf8");

describe("Wave 6.1 E-Tasrih", () => {
  it("binds every pass to the dual-track student record and protects the QR token", () => {
    expect(migration).toContain("student_id uuid NOT NULL REFERENCES public.students");
    expect(migration).toContain("qr_token text UNIQUE NOT NULL");
    expect(migration).toContain("ALTER TABLE public.gate_passes ENABLE ROW LEVEL SECURITY");
  });
  it("keeps approval and scanning on server-side role checks", () => {
    expect(migration).toContain("app.has_any_role('pengurus','super_admin')");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.approve_gate_pass");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.scan_gate_pass");
    expect(actions).toContain('rpc("scan_gate_pass"');
  });
  it("marks overdue passes from the authoritative server clock", () => {
    expect(migration).toContain("due_back_at < now()");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.refresh_gate_pass_overdue");
  });
});
