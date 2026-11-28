import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const migrationPath = resolve(root, 'supabase/migrations/202612040001_students_auto_nis_and_sync.sql');
const rollbackPath = resolve(root, 'supabase/rollback/202612040001_students_auto_nis_and_sync_down.sql');

describe('automatic student NIS migration contract', () => {
  const migration = readFileSync(migrationPath, 'utf8');
  const rollback = readFileSync(rollbackPath, 'utf8');

  it('uses a WIB year counter and immutable IDH format', () => {
    expect(migration).toContain("EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Jakarta'))");
    expect(migration).toContain("'IDH-' || v_year::text || '-' || lpad(v_seq::text, 4, '0')");
    expect(migration).toContain('NIS_IMMUTABLE');
  });

  it('makes gender nullable and adds the narrow santri self-select policy', () => {
    expect(migration).toContain('ALTER TABLE public.students ALTER COLUMN gender DROP NOT NULL');
    expect(migration).toContain('CREATE POLICY students_self_select');
    expect(migration).toContain('profile_id = auth.uid()');
    expect(migration).not.toContain('USING (true)');
  });

  it('provisions only active profiles with an active santri role and is idempotent', () => {
    expect(migration).toContain("v_profile.status NOT IN ('active', 'approved')");
    expect(migration).toContain("r.key = 'santri'");
    expect(migration).toContain('ON CONFLICT (profile_id) DO NOTHING');
    expect(migration).toContain('migration_202612040001_backfill');
  });

  it('ships a guarded rollback without resetting the counter', () => {
    expect(rollback).toContain("created_via = 'migration_202612040001_backfill'");
    expect(rollback).toContain('DROP TABLE IF EXISTS public.student_number_counters');
    expect(rollback).not.toMatch(/DELETE FROM public\.student_number_counters/i);
    expect(migration.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
    expect(rollback.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});
