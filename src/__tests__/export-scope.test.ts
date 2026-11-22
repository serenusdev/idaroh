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
 * Expectations intentionally FAIL until Stage C lands
 * src/lib/export-policy.ts, the rewritten export route, and the guarded
 * exportAuditedDataAction.
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
    exportLog: Record<string, unknown> | null;
    pdfCalls: string[][];
  } = {
    identity: null,
    queries: [],
    inserts: [],
    rows: {},
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

function opsFor(table: string, occurrence = 0) {
  const matches = harness.state.queries.filter((query) => query.table === table);
  return matches[occurrence]?.ops || [];
}

function datasetTables() {
  return tablesQueried().filter((table) => table !== "export_logs");
}

beforeEach(() => {
  harness.state.identity = OWNER;
  harness.state.queries = [];
  harness.state.inserts = [];
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
  });

  it("refuses to materialize another admin's export request", async () => {
    harness.state.exportLog = logRow({ user_id: "pengurus-9" });
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(404);
    expect(datasetTables()).toHaveLength(0);
  });

  it("refuses a stored category outside the export whitelist instead of dumping audit logs", async () => {
    harness.state.exportLog = logRow({ category: "semua_data" });
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(400);
    expect(datasetTables()).toHaveLength(0);
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
    expect(datasetTables()).toHaveLength(0);
  });

  it("rejects a file extension that disagrees with the logged export_type", async () => {
    harness.state.exportLog = logRow({ export_type: "csv" });
    const response = await download("/api/exports/export-1.pdf", "export-1.pdf");
    expect(response.status).toBe(400);
    expect(harness.state.pdfCalls).toHaveLength(0);
    expect(datasetTables()).toHaveLength(0);
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
    expect(opsFor("attendance_records")).toContain(
      'gte:["attendance_date","2026-11-01"]',
    );
    expect(opsFor("attendance_records")).toContain(
      'lte:["attendance_date","2026-11-07"]',
    );
    expect(opsFor("daily_reports")).toContain('gte:["report_date","2026-11-01"]');
    expect(opsFor("daily_reports")).toContain('lte:["report_date","2026-11-07"]');
  });

  it("narrows timestamp datasets by WIB day boundaries", async () => {
    harness.state.exportLog = logRow({
      category: "tugas_proyek",
      filter_criteria: { date_from: "2026-11-01", date_to: "2026-11-07" },
    });
    harness.state.rows = { tasks: [{ id: "t1", title: "Sentra", status: "todo" }] };
    const response = await download("/api/exports/export-1.csv", "export-1.csv");
    expect(response.status).toBe(200);
    expect(opsFor("tasks")).toContain('gte:["created_at","2026-10-31T17:00:00.000Z"]');
    expect(opsFor("tasks")).toContain('lt:["created_at","2026-11-06T17:00:00.000Z"]');
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
    expect(opsFor("audit_logs")).toContain('gte:["created_at","2026-10-31T17:00:00.000Z"]');
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
