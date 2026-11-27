/**
 * SEC-01 Stage B contract (AGENT-WORKFLOW §3): the export endpoint may only
 * materialize the dataset the caller is entitled to, and it must honour the
 * filters stored with the export request.
 *
 * SSOT (PERMISSIONS.md §3.8):
 *   - `analytics.export`  = yayasan `all`, pengurus `all`, koordinator `—`,
 *     super_admin `—` ("Ditolak untuk super_admin; wajib memvalidasi
 *     export_type & filter_criteria").
 *   - `admin.audit.read`  = yayasan `all`, pengurus **ditolak**.
 *
 * DX-01 retarget: the dataset reads now run through the typed Kysely reader, so the
 * "was the stored range applied" assertions read the bound parameters of the emitted SQL
 * instead of the PostgREST `gte:[column,value]` op strings. Every authorization assertion is
 * unchanged, and the refusal cases are now pinned harder: the export_logs lookup must be the
 * only relation touched and no dataset SELECT may leave the process.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  type Identity = {
    id: string;
    role: string;
    roles?: string[];
    full_name: string;
    status: string;
  } | null;

  const state: {
    identity: Identity;
    queries: { table: string; ops: string[] }[];
    inserts: { table: string; payload: Record<string, unknown> }[];
    rows: Record<string, unknown[]>;
    /** DX-01: dataset reads are parameterised SQL emitted by the Kysely reader. */
    selects: { sql: string; params: unknown[] }[];
    exportLog: Record<string, unknown> | null;
    pdfCalls: string[][];
  } = {
    identity: null,
    queries: [],
    inserts: [],
    rows: {},
    selects: [],
    exportLog: null,
    pdfCalls: [],
  };

  const makeChain = (table: string) => {
    const ops: string[] = [];
    state.queries.push({ table, ops });
    const chain: Record<string, unknown> = {};
    const push =
      (name: string) =>
      (...args: unknown[]) => {
        ops.push(`${name}:${JSON.stringify(args)}`);
        return chain;
      };
    for (const name of [
      "select",
      "eq",
      "gte",
      "lte",
      "lt",
      "gt",
      "is",
      "in",
      "or",
      "order",
      "limit",
      "update",
    ]) {
      chain[name] = push(name);
    }
    chain.insert = (payload: Record<string, unknown>) => {
      ops.push("insert");
      state.inserts.push({ table, payload });
      return chain;
    };
    chain.maybeSingle = () =>
      Promise.resolve({ data: table === "export_logs" ? state.exportLog : null, error: null });
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: state.rows[table] ?? [], error: null }).then(resolve);
    return chain;
  };

  return { state, makeChain };
});

vi.mock("@/lib/auth/guards", () => ({
  requireRole: async (allowed: string[]) => {
    const identity = harness.state.identity;
    if (!identity) throw new Error("UNAUTHORIZED: Anda harus masuk (login) terlebih dahulu.");
    const held = [identity.role, ...(identity.roles || [])];
    if (!allowed.some((role) => held.includes(role))) {
      throw new Error(`FORBIDDEN: Anda tidak memiliki izin (${allowed.join(', ')}).`);
    }
    return identity;
  },
  requireAuthUser: async () => {
    if (!harness.state.identity) throw new Error("UNAUTHORIZED");
    return harness.state.identity;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => harness.makeChain(table),
  }),
}));

vi.mock("@/lib/pdf", () => ({
  buildPdf: async (_title: string, lines: string[]) => {
    harness.state.pdfCalls.push(lines);
    return new Uint8Array([1, 2, 3]);
  },
}));

/**
 * DX-01: the dataset reads moved from the PostgREST chain to the typed read-only reader. The mock
 * keeps the *real* reader module (so its read-only driver guard and session bootstrap stay in the
 * loop) and only swaps the pool: statements land in state.selects and rows come from state.rows by
 * table name, exactly like the PostgREST mock above.
 */
vi.mock("@/lib/db/reader", async () => {
  const { createReadOnlyDb } = await vi.importActual<typeof import("@/lib/db/reader")>("@/lib/db/reader");
  const pool = {
    options: {},
    Client: function Client() {},
    cursor: function Cursor() {},
    connect: async () => ({
      processID: 4242,
      async query(sql: string, params: unknown[] = []) {
        harness.state.selects.push({ sql, params });
        if (/^\s*set /i.test(sql)) return { command: "SET", rowCount: 0, rows: [] };
        const table = Object.keys(harness.state.rows).find((name) => sql.includes(`"${name}"`));
        return { command: "SELECT", rowCount: 0, rows: table ? harness.state.rows[table] : [] };
      },
      release() {},
    }),
    end: async () => {},
  };
  const db = createReadOnlyDb({ pool: pool as never, url: "postgresql://x@127.0.0.1:5432/postgres" });
  return {
    createReadOnlyDb,
    getReadOnlyDb: () => db,
    closeReadOnlyDb: async () => db.destroy(),
  };
});

const { GET } = await import("@/app/api/exports/[exportId]/route");
const { exportAuditedDataAction } = await import("@/modules/analytics/actions");

const OWNER = {
  id: "yayasan-1",
  role: "yayasan",
  full_name: "Yayasan Uji",
  status: "active",
};

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "export-1",
    user_id: OWNER.id,
    category: "presensi_laporan",
    export_type: "csv",
    filter_criteria: { requested_by: OWNER.full_name },
    ...overrides,
  };
}

async function download(pathname: string, exportId: string) {
  return GET(new Request(`https://idaroh.test${pathname}`), {
    params: Promise.resolve({ exportId }),
  });
}

function tablesQueried() {
  return harness.state.queries.map((query) => query.table);
}

/** DX-01: the SQL the reader actually sent, minus the `SET` session bootstrap. */
function selects() {
  return harness.state.selects.filter((statement) => !/^\s*set /i.test(statement.sql));
}

function sqlFor(table: string) {
  return selects()
    .filter((statement) => statement.sql.includes(`"${table}"`))
    .map((statement) => statement.sql.replace(/\s+/g, " ").toLowerCase())
    .join("\n");
}

function paramsFor(table: string) {
  return selects()
    .filter((statement) => statement.sql.includes(`"${table}"`))
    .flatMap((statement) => statement.params);
}

beforeEach(() => {
  harness.state.identity = OWNER;
  harness.state.queries = [];
  harness.state.inserts = [];
  harness.state.selects = [];
  harness.state.rows = {};
  harness.state.exportLog = logRow();
  harness.state.pdfCalls = [];
});

describe("SEC-01 export download authorization", () => {
  it("refuses a super_admin download without reading any dataset", async () => {
    harness.state.identity = {
      id: "sa-1",
      role: "super_admin",
      full_name: "Super Admin",
      status: "active",
    };
    harness.state.exportLog = logRow({ user_id: "sa-1" });
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(403);
    expect(harness.state.queries).toHaveLength(0);
    expect(selects()).toHaveLength(0);
  });

  it("refuses to materialize another admin's export request", async () => {
    harness.state.exportLog = logRow({ user_id: "pengurus-9" });
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(404);
    expect(tablesQueried()).toEqual(["export_logs"]);
    expect(selects()).toHaveLength(0);
  });

  it("refuses a stored category outside the export whitelist instead of dumping audit logs", async () => {
    harness.state.exportLog = logRow({ category: "semua_data" });
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(400);
    expect(tablesQueried()).toEqual(["export_logs"]);
    expect(selects()).toHaveLength(0);
  });

  it("refuses a pengurus audit-log export (admin.audit.read denies pengurus)", async () => {
    harness.state.identity = {
      id: "pengurus-1",
      role: "pengurus",
      full_name: "Pengurus Uji",
      status: "active",
    };
    harness.state.exportLog = logRow({
      user_id: "pengurus-1",
      category: "audit_logs",
    });
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(403);
    expect(tablesQueried()).toEqual(["export_logs"]);
    expect(selects()).toHaveLength(0);
  });

  it("rejects a file extension that disagrees with the logged export_type", async () => {
    harness.state.exportLog = logRow({ export_type: "csv" });
    const response = await download("/api/exports/export-1.pdf", "export-1.pdf");
    expect(response.status).toBe(400);
    expect(harness.state.pdfCalls).toHaveLength(0);
    expect(tablesQueried()).toEqual(["export_logs"]);
    expect(selects()).toHaveLength(0);
  });
});

describe("SEC-01 stored filters are applied", () => {
  beforeEach(() => {
    harness.state.exportLog = logRow({
      category: "presensi_laporan",
      filter_criteria: {
        requested_by: OWNER.full_name,
        date_from: "2026-11-01",
        date_to: "2026-11-07",
      },
    });
    harness.state.rows = {
      attendance_records: [
        { id: "a1", user_id: "u1", attendance_date: "2026-11-02", classification: "hadir" },
      ],
      daily_reports: [
        {
          id: "r1",
          user_id: "u1",
          report_date: "2026-11-03",
          submission_status: "submitted",
          review_status: "approved",
        },
      ],
    };
  });

  it("narrows every attendance/report read to the stored WIB range", async () => {
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(200);
    const attendance = sqlFor("attendance_records");
    expect(attendance).toContain('"attendance_date" >= $');
    expect(attendance).toContain('"attendance_date" <= $');
    expect(paramsFor("attendance_records")).toContain("2026-11-01");
    expect(paramsFor("attendance_records")).toContain("2026-11-07");
    expect(sqlFor("attendance_records")).toContain("order by");
    const reports = sqlFor("daily_reports");
    expect(reports).toContain('"report_date" >= $');
    expect(reports).toContain('"report_date" <= $');
    expect(paramsFor("daily_reports")).toContain("2026-11-01");
    expect(paramsFor("daily_reports")).toContain("2026-11-07");
  });

  it("narrows timestamp datasets by WIB day boundaries", async () => {
    harness.state.exportLog = logRow({
      category: "tugas_proyek",
      filter_criteria: { date_from: "2026-11-01", date_to: "2026-11-07" },
    });
    harness.state.rows = { tasks: [{ id: "t1", title: "Sentra", status: "todo" }] };
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(200);
    // Inclusive lower and exclusive upper bound, so the whole final WIB day stays inside.
    expect(paramsFor("tasks")).toContain("2026-10-31T17:00:00.000Z");
    expect(paramsFor("tasks")).toContain("2026-11-07T17:00:00.000Z");
    expect(sqlFor("tasks")).toContain('"created_at" >= $');
    expect(sqlFor("tasks")).toContain('"created_at" < $');
    expect(sqlFor("tasks")).toContain('"deleted_at" is null');
  });

  it("narrows the audit dataset for yayasan and keeps the CSV escaping", async () => {
    harness.state.exportLog = logRow({
      category: "audit_logs",
      filter_criteria: { date_from: "2026-11-01", date_to: "2026-11-07" },
    });
    harness.state.rows = {
      audit_logs: [
        { id: "l1", event_name: "=cmd|' /C calc'", actor_id: "u1", created_at: "2026-11-02" },
      ],
    };
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(200);
    expect(paramsFor("audit_logs")).toContain("2026-10-31T17:00:00.000Z");
    // The 500-row cap of the previous .limit(500) survives the move to SQL.
    expect(sqlFor("audit_logs")).toContain("limit $");
    expect(paramsFor("audit_logs")).toContain(500);
    // Timestamps are rendered by Postgres, so the CSV text stays what PostgREST produced.
    expect(sqlFor("audit_logs")).toContain(`to_jsonb("audit_logs"."created_at") #>> '{}'`);
    const csv = await response.text();
    expect(csv).toContain('"\'=cmd');
  });
});

describe("SEC-01 export request creation", () => {
  it("denies a super_admin export request", async () => {
    harness.state.identity = {
      id: "sa-1",
      role: "super_admin",
      full_name: "Super Admin",
      status: "active",
    };
    await expect(exportAuditedDataAction("csv", "presensi", "Super Admin")).rejects.toThrow(
      /FORBIDDEN/,
    );
    expect(harness.state.inserts).toHaveLength(0);
  });

  it("persists the validated WIB date range in filter_criteria", async () => {
    const result = await exportAuditedDataAction("csv", "presensi", "Yayasan Uji", {
      dateFrom: "2026-11-01",
      dateTo: "2026-11-07",
    });
    expect(result.success).toBe(true);
    const logInsert = harness.state.inserts.find((entry) => entry.table === "export_logs");
    expect(logInsert?.payload.filter_criteria).toMatchObject({
      date_from: "2026-11-01",
      date_to: "2026-11-07",
    });
  });

  it("rejects an unknown category before writing anything", async () => {
    const result = await exportAuditedDataAction("csv", "rahasa_negara", "Yayasan Uji");
    expect(result.success).toBe(false);
    expect(harness.state.inserts).toHaveLength(0);
  });

  it("rejects a malformed or inverted date range before writing anything", async () => {
    const bad = await exportAuditedDataAction("csv", "presensi", "Yayasan Uji", {
      dateFrom: "01-11-2026",
    });
    expect(bad.success).toBe(false);
    const inverted = await exportAuditedDataAction("csv", "presensi", "Yayasan Uji", {
      dateFrom: "2026-11-07",
      dateTo: "2026-11-01",
    });
    expect(inverted.success).toBe(false);
    expect(harness.state.inserts).toHaveLength(0);
  });

  it("refuses a pengurus audit-log request (same scope as the download)", async () => {
    harness.state.identity = {
      id: "pengurus-1",
      role: "pengurus",
      full_name: "Pengurus Uji",
      status: "active",
    };
    const result = await exportAuditedDataAction("csv", "audit_logs", "Pengurus Uji");
    expect(result.success).toBe(false);
    expect(harness.state.inserts).toHaveLength(0);
  });
});
