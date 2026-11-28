import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('academic term command contract', () => {
  const root = process.cwd();
  const migration = readFileSync(resolve(root, 'supabase/migrations/202612040005_academic_terms_command.sql'), 'utf8');
  const page = readFileSync(resolve(root, 'src/app/(app)/rapor/page.tsx'), 'utf8');
  it('guards term creation and rejects overlaps under a transaction lock', () => {
    expect(migration).toContain("app.has_any_role('pengurus','super_admin')");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('TERM_OVERLAP');
    expect(migration).toContain('TERM_CODE_EXISTS');
  });
  it('provides a create-term empty state', () => {
    expect(page).toContain('CreateTermForm');
    expect(migration.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});
