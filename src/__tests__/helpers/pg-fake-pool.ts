/**
 * DX-01 test helper — a stand-in for the `pg` pool the Kysely reader wraps.
 *
 * Kysely's PostgresDriver only needs `pool.connect()` and `client.query(sql, parameters)`, so the
 * fake records every statement the reader emits (session bootstrap included) and answers selects
 * by the table named in the SQL. That keeps the DX-01 suites honest about the *real* contract:
 * the parameterised SQL text and the bound values, which is exactly what the PostgREST mock chain
 * in export-scope.test.ts used to pin with `gte:["column","value"]` op strings.
 */

export interface RecordedStatement {
  sql: string;
  params: unknown[];
}

export interface FakePool {
  statements: RecordedStatement[];
  /** Everything except the `SET ...` session bootstrap. */
  selects(): RecordedStatement[];
  statementsFor(table: string): RecordedStatement[];
  pool: unknown;
}

export function createFakePool(
  tableRows: Record<string, Array<Record<string, unknown>>> = {},
  queued: Array<Array<Record<string, unknown>>> = []
): FakePool {
  const statements: RecordedStatement[] = [];
  const queue = [...queued];

  const rowsFor = (sql: string): Array<Record<string, unknown>> => {
    if (queue.length > 0) return queue.shift() ?? [];
    for (const [table, rows] of Object.entries(tableRows)) {
      if (sql.includes(`"${table}"`)) return rows;
    }
    return [];
  };

  return {
    statements,
    selects: () => statements.filter((statement) => !/^\s*set /i.test(statement.sql)),
    statementsFor: (table: string) =>
      statements.filter((statement) => statement.sql.includes(`"${table}"`)),
    pool: {
      options: {},
      Client: function Client() {},
      cursor: function Cursor() {},
      connect: async () => ({
        // processID is set so Kysely skips its `select pg_backend_pid()` session probe.
        processID: 4242,
        async query(sql: string, params: unknown[] = []) {
          statements.push({ sql, params });
          // The session bootstrap must not eat a queued result: it answers no rows.
          if (/^\s*set /i.test(sql)) return { command: "SET", rowCount: 0, rows: [] };
          return { command: "SELECT", rowCount: 1, rows: rowsFor(sql) };
        },
        release() {},
      }),
      end: async () => {},
    },
  };
}

/** Whitespace-collapsed SQL, so assertions survive Kysely's line breaks. */
export function flat(statement: RecordedStatement | undefined): string {
  return (statement?.sql ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}
