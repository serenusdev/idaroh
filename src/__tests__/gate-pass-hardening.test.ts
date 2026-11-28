import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const migration = readFileSync(resolve(root, 'supabase/migrations/202612040003_gate_pass_hardening.sql'), 'utf8');
const rollback = readFileSync(resolve(root, 'supabase/rollback/202612040003_gate_pass_hardening_down.sql'), 'utf8');
const actions = readFileSync(resolve(root, 'src/modules/gate-pass/actions.ts'), 'utf8');

describe('E-Tasrih hardening contract', () => {
  it('removes direct authenticated INSERT and keeps the RPC path', () => {
    expect(migration).toContain('REVOKE INSERT ON public.gate_passes FROM authenticated');
    expect(migration).toContain('DROP POLICY IF EXISTS gate_passes_request_scoped');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.request_gate_pass');
  });

  it('enforces lifecycle transitions and no self-review', () => {
    expect(migration).toContain("IF EXISTS (SELECT 1 FROM public.students WHERE id = v_row.student_id AND profile_id = v_uid)");
    expect(migration).toContain("v_row.status NOT IN ('out','overdue') OR v_row.out_at IS NULL");
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain('returned_late');
    expect(migration).toContain('late_minutes');
  });

  it('ships operator-only resolve/cancel RPCs and structured action errors', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_gate_pass_token');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.cancel_gate_pass');
    expect(actions).toContain('resolve_gate_pass_token');
    expect(actions).toContain('errorToMessage');
  });

  it('rollback restores the old direct-write policy without deleting lifecycle data', () => {
    expect(rollback).toContain('GRANT SELECT, INSERT ON public.gate_passes TO authenticated');
    expect(rollback).toContain('CREATE POLICY gate_passes_request_scoped');
    expect(rollback).not.toContain('DROP COLUMN');
    expect(migration.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
    expect(rollback.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});
