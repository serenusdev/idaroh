import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
describe('Mutabaah date and roster contract', () => {
  const migration = readFileSync(resolve(root, 'supabase/migrations/202612040004_mutabaah_date_scope.sql'), 'utf8');
  const page = readFileSync(resolve(root, 'src/app/(app)/mutabaah/page.tsx'), 'utf8');
  const workspace = readFileSync(resolve(root, 'src/modules/mutabaah/mutabaah-workspace.tsx'), 'utf8');

  it('uses a date-scoped idempotent RPC with WIB bounds', () => {
    expect(migration).toContain('save_mutabaah_log_for_date');
    expect(migration).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(migration).toContain('ON CONFLICT (student_id, log_date) DO UPDATE');
    expect(migration).toContain('v_today - 30');
  });

  it('loads the full operator roster and exposes student selection', () => {
    expect(page).toContain('select("id,full_name,nis")');
    expect(workspace).toContain('Pilih santri');
    expect(workspace).toContain('students.map');
  });
});
