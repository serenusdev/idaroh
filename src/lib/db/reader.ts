import {
  CompiledQuery,
  Kysely,
  PostgresDialect,
  SelectQueryNode,
  type DatabaseConnection,
  type Dialect,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type PostgresPool,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from "kysely";
import type { ReadonlyKysely } from "kysely/readonly";
import { Pool } from "pg";
import type { Database } from "./schema";

/**
 * DX-01 — the single typed entry point for the audited read paths (analytics, audit explorer,
 * export datasets).
 *
 * Three independent layers make "read-only" more than a comment:
 *   1. types     — consumers get `ReadonlyKysely<Database>`, where insertInto/updateTable/
 *                  deleteFrom/mergeInto/replaceInto are `KyselyTypeError` markers, so a write is a
 *                  compile error;
 *   2. executor  — the plugin below rejects any root node that is not a SelectQueryNode before the
 *                  query is compiled, so a write smuggled through `sql`...execute(db)` or a cast
 *                  through `unknown` never reaches the socket;
 *   3. session   — every connection opens with `default_transaction_read_only = on`, so even a
 *                  statement the two layers above mis-classified is refused by Postgres itself.
 *
 * A data-modifying CTE (`WITH x AS (DELETE ...) SELECT`) survives layer 2 as a SelectQueryNode;
 * that is what layer 3 is for. It is also unreachable through the type facade.
 *
 * The connection string comes from SUPABASE_DB_URL only. It is never derived from the service-role
 * HTTP client: the point of this module is a second, narrower path (reads), while every write keeps
 * going through the audited PostgREST/service-role path with its RLS policies and audit inserts.
 */

export const READ_ONLY_REJECTED =
  "INTERNAL: koneksi analitik bersifat read-only — hanya SELECT yang boleh dieksekusi.";

export type ReadOnlyDb = ReadonlyKysely<Database>;

/** Statements per connection, in order: refuse writes, fix the clock, bound the query. */
const SESSION_STATEMENTS = (statementTimeoutMs: number): string[] => [
  "set default_transaction_read_only = on",
  "set time zone 'utc'",
  `set statement_timeout = ${statementTimeoutMs}`,
];

class ReadOnlyGuardPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    // Kysely's node classes are `createNodeClass` namespaces, so the guard is `.is()`, not instanceof.
    if (!SelectQueryNode.is(args.node)) {
      throw new Error(`${READ_ONLY_REJECTED} (node: ${args.node.kind})`);
    }
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}

export interface ReadOnlyDbOptions {
  /** Injected in tests; production builds its own pool from `url`. */
  pool?: PostgresPool;
  url?: string;
  /** Guards against an analytic query holding a pooler connection indefinitely. */
  statementTimeoutMs?: number;
}

function clampTimeout(value: number | undefined): number {
  const requested = value ?? Number(process.env.DX01_STATEMENT_TIMEOUT_MS ?? 5000);
  if (!Number.isFinite(requested)) return 5000;
  return Math.min(30000, Math.max(250, Math.trunc(requested)));
}

/**
 * libpq-style knob for the Supabase pooler endpoint. Verification stays on by default; an operator
 * who points this at the session pooler sets the mode explicitly (see docs/dx01-readonly-reader.md).
 */
function sslConfig(): false | { rejectUnauthorized: boolean } {
  const mode = (process.env.SUPABASE_DB_SSL_MODE || "verify-full").trim().toLowerCase();
  if (mode === "disable") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export function createReadOnlyDb(options: ReadOnlyDbOptions = {}): ReadOnlyDb {
  const url = (options.url ?? process.env.SUPABASE_DB_URL ?? "").trim();
  if (!url) {
    throw new Error(
      "UNAVAILABLE: SUPABASE_DB_URL belum dikonfigurasi, sehingga jalur baca tertype (Kysely) tidak dapat dipakai."
    );
  }

  const statementTimeoutMs = clampTimeout(options.statementTimeoutMs);
  const pool: PostgresPool =
    options.pool ??
    new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      ssl: sslConfig(),
    });

  const dialect = new PostgresDialect({
    pool,
    onCreateConnection: async (connection: DatabaseConnection) => {
      for (const statement of SESSION_STATEMENTS(statementTimeoutMs)) {
        await connection.executeQuery(CompiledQuery.raw(statement));
      }
    },
  });

  const wrapped: Dialect = {
    createAdapter: () => dialect.createAdapter(),
    createDriver: () => dialect.createDriver(),
    createIntrospector: (db) => dialect.createIntrospector(db),
    createQueryCompiler: () => dialect.createQueryCompiler(),
  };

  // The cast is the boundary between the runtime object Kysely builds and the read-only facade
  // consumers are handed; layers 2 and 3 above are what the facade promises.
  return new Kysely<Database>({ dialect: wrapped }).withPlugin(new ReadOnlyGuardPlugin()) as unknown as ReadOnlyDb;
}

let singleton: ReadOnlyDb | null = null;

/** Lazily opens one pooled reader for the whole server process. */
export function getReadOnlyDb(): ReadOnlyDb {
  if (!singleton) singleton = createReadOnlyDb();
  return singleton;
}

export async function closeReadOnlyDb(): Promise<void> {
  const current = singleton;
  singleton = null;
  if (current) await current.destroy();
}
