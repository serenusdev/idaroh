import { describe, expect, it } from 'vitest';
import { createFakePool } from './helpers/pg-fake-pool';
import { createReadOnlyDb } from '@/lib/db/reader';
import { fetchLiveTelemetry } from '@/lib/db/live-telemetry-queries';

describe('live telemetry date-key regression', () => {
  it('accepts pg Date values for report and task trend date columns', async () => {
    const fake = createFakePool({}, [
      [{ count: 1 }],
      [],
      [],
      [],
      [{ count: 1 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [],
      [{ report_date: new Date('2026-11-28T00:00:00Z'), count: 1 }],
      [{ date: new Date('2026-11-28T00:00:00Z'), count: 1 }],
    ]);
    const db = createReadOnlyDb({
      url: 'postgres://telemetry-test.invalid/db',
      pool: fake.pool as never,
    });

    const result = await fetchLiveTelemetry(db, '2026-11-28');

    expect(result.attendanceTrend.at(-1)?.reportsSubmitted).toBe(1);
    expect(result.attendanceTrend.at(-1)?.tasksCompleted).toBe(1);
    expect(fake.statementsFor("daily_reports").some((statement) => statement.sql.includes("to_char"))).toBe(true);
    expect(fake.statementsFor("tasks").some((statement) => statement.sql.includes("to_char"))).toBe(true);
    await db.destroy();
  });
});
