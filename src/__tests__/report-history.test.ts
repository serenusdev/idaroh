import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), requireAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendPushToUsers: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireAuthUser: mocks.requireAuthUser }));

import { getMyReportHistoryAction } from "@/modules/reports/actions";
import type { MyReportHistoryOptions } from "@/modules/reports/types";

function row(date: string, user = "member-a") {
  return {
    id: `${user}-${date}`, user_id: user, report_date: date,
    submission_status: "submitted", review_status: "revision_required", is_late: true,
    first_submitted_at: `${date}T15:00:00Z`,
    report_items: [{
      id: `item-${date}`, category_id: "education", report_categories: { name: "Pendidikan" },
      title: "Belajar", description: "Membaca kitab", result_progress: "Satu bab", obstacles: "", duration_minutes: 0, sort_order: 1,
    }],
    report_reviews: [{ decision: "revision_required", notes: "Jelaskan hasil belajar", decided_at: `${date}T16:00:00Z` }],
  };
}

// A thenable PostgREST chain: filtering, ordering and limiting happen only when
// the real action awaits its query. No action stub or VITEST fallback is used.
function database(rows: ReturnType<typeof row>[] = [], error: unknown = null, nullData = false) {
  let userId: string | undefined;
  let before: string | undefined;
  let ascending = true;
  let pageLimit = Infinity;
  const chain = {
    select: vi.fn((_columns: string) => chain),
    eq: vi.fn((column: string, value: string) => {
      if (column === "user_id") userId = value;
      return chain;
    }),
    lt: vi.fn((column: string, value: string) => {
      if (column === "report_date") before = value;
      return chain;
    }),
    order: vi.fn((column: string, options: { ascending: boolean; referencedTable?: string }) => {
      if (column === "report_date" && !options.referencedTable) ascending = options.ascending;
      return chain;
    }),
    limit: vi.fn((value: number, options?: { referencedTable?: string }) => {
      if (!options?.referencedTable) pageLimit = value;
      return chain;
    }),
    then: (resolve: (value: { data: ReturnType<typeof row>[] | null; error: unknown }) => unknown) => Promise.resolve({
      data: nullData ? null : rows
        .filter(item => (!userId || item.user_id === userId) && (!before || item.report_date < before))
        .sort((a, b) => a.report_date.localeCompare(b.report_date) * (ascending ? 1 : -1))
        .slice(0, pageLimit),
      error,
    }).then(resolve),
  };
  const from = vi.fn(() => chain);
  mocks.createAdminClient.mockReturnValue({ from });
  return { ...chain, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthUser.mockResolvedValue({ id: "member-a", role: "santri" });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("TRC-05 authenticated personal report history", () => {
  it("authenticates before creating an admin query and propagates auth failure", async () => {
    mocks.requireAuthUser.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    await expect(getMyReportHistoryAction()).rejects.toThrow("UNAUTHENTICATED");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(["santri", "super_admin"])("always scopes %s history to the session, ignoring a forged userId", async (role) => {
    mocks.requireAuthUser.mockResolvedValue({ id: "member-a", role });
    const db = database([row("2026-11-11", "member-b"), row("2026-11-10"), row("2026-11-12")]);
    const options = { userId: "member-b", limit: 10 } as MyReportHistoryOptions;
    const result = await getMyReportHistoryAction(options);
    expect(mocks.requireAuthUser).toHaveBeenCalledOnce();
    expect(db.from).toHaveBeenCalledExactlyOnceWith("daily_reports");
    expect(db.eq).toHaveBeenCalledExactlyOnceWith("user_id", "member-a");
    expect(db.order).toHaveBeenCalledWith("report_date", { ascending: false });
    expect(db.lt).not.toHaveBeenCalled();
    expect(result.reports.map(item => item.id)).toEqual(["member-a-2026-11-12", "member-a-2026-11-10"]);
    expect(result.nextCursor).toBeNull();
  });

  it("maps real columns into independent statuses, contents and the latest review", async () => {
    const db = database([row("2026-11-12")]);
    const result = await getMyReportHistoryAction();
    expect(db.select).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("report_reviews(decision, notes, decided_at)"));
    expect(db.select.mock.calls[0][0]).not.toContain("*");
    expect(db.order).toHaveBeenCalledWith("sort_order", { ascending: true, referencedTable: "report_items" });
    expect(db.order).toHaveBeenCalledWith("decided_at", { ascending: false, referencedTable: "report_reviews" });
    expect(db.limit).toHaveBeenCalledWith(1, { referencedTable: "report_reviews" });
    expect(result.reports[0]).toEqual({
      id: "member-a-2026-11-12", reportDate: "2026-11-12", submissionStatus: "submitted",
      reviewStatus: "revision_required", isLate: true, firstSubmittedAt: "2026-11-12T15:00:00Z",
      items: [{ id: "item-2026-11-12", categoryId: "education", categoryName: "Pendidikan", title: "Belajar",
        description: "Membaca kitab", resultProgress: "Satu bab", obstacles: "", durationMinutes: 0, sortOrder: 1 }],
      latestReview: { decision: "revision_required", notes: "Jelaskan hasil belajar", decidedAt: "2026-11-12T16:00:00Z" },
    });
  });

  it.each([false, true])("returns a genuine empty page (null data: %s), even under VITEST", async (nullData) => {
    const db = database([], null, nullData);
    expect(await getMyReportHistoryAction()).toEqual({ reports: [], nextCursor: null });
    expect(db.limit).toHaveBeenCalledWith(11); // Default 10 + one lookahead row.
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
  });

  it("includes stored drafts without inventing review notes or contents", async () => {
    const draft = { ...row("2026-11-10"), submission_status: "draft", review_status: "not_reviewed", report_items: [], report_reviews: [] };
    database([draft]);
    expect((await getMyReportHistoryAction()).reports[0]).toMatchObject({
      submissionStatus: "draft", reviewStatus: "not_reviewed", items: [], latestReview: null,
    });
  });

  it("uses exclusive date cursors with lookahead to reach older reports without duplicates", async () => {
    const rows = [row("2025-01-01"), row("2026-11-10"), row("2026-11-12"), row("2026-11-11", "member-b")];
    let db = database(rows);
    const first = await getMyReportHistoryAction({ limit: 2 });
    expect(db.limit).toHaveBeenCalledWith(3);
    expect(first.reports.map(item => item.reportDate)).toEqual(["2026-11-12", "2026-11-10"]);
    expect(first.nextCursor).toBe("2026-11-10");
    db = database(rows);
    const second = await getMyReportHistoryAction({ limit: 2, before: first.nextCursor });
    expect(db.eq).toHaveBeenCalledExactlyOnceWith("user_id", "member-a");
    expect(db.lt).toHaveBeenCalledExactlyOnceWith("report_date", "2026-11-10");
    expect(second.reports.map(item => item.reportDate)).toEqual(["2025-01-01"]);
    expect(second.nextCursor).toBeNull();
    database(rows);
    expect(await getMyReportHistoryAction({ before: "2025-01-01" })).toEqual({ reports: [], nextCursor: null });
  });

  it("caps requested page size at 25 plus one lookahead row", async () => {
    const db = database(Array.from({ length: 31 }, (_, i) => row(`2026-10-${String(i + 1).padStart(2, "0")}`)));
    const result = await getMyReportHistoryAction({ limit: 1000000 });
    expect(db.limit).toHaveBeenCalledWith(26);
    expect(result.reports).toHaveLength(25);
    expect(result.nextCursor).toBe("2026-10-07");
  });

  it.each([null, [], { limit: 0 }, { limit: -1 }, { limit: 1.5 }, { limit: NaN }, { limit: Infinity },
    { limit: "100" }, { before: "bad" }, { before: "2026-02-30" }, { before: "2026-13-01" }, { before: 20261112 }])(
    "rejects malformed pagination %j before database access", async (options) => {
      await expect(getMyReportHistoryAction(options as MyReportHistoryOptions)).rejects.toThrow();
      expect(mocks.requireAuthUser).toHaveBeenCalledOnce();
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    }
  );

  it("surfaces database failures instead of disguising them as empty history or fixtures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    database([], new Error("private database details"));
    await expect(getMyReportHistoryAction()).rejects.toThrow("Data gagal dimuat");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("reports.my-history"), expect.any(Error));
  });
});
