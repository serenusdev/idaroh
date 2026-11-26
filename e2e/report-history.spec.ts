import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import type { MyReportHistoryEntry, MyReportHistoryPage } from "../src/modules/reports/types";

// Same in-memory esbuild strategy as audit-ui.spec.ts, isolated to avoid shared
// harness edits. Real page, IdentityProvider and cache; mocked external actions.
// This is component/browser integration, NOT authenticated production DB E2E.
type Outcome = { kind: "resolve"; value: unknown } | { kind: "reject" } | { kind: "defer"; id: string };
type Config = { pages?: Record<string, Record<string, MyReportHistoryPage>>; queues?: Record<string, Outcome[]> };
type Call = { name: string; args: unknown[]; account: string };
declare global {
  interface Window {
    __reportHistoryConfig: Config;
    __reportHistoryUI: {
      snapshot(): { calls: Call[]; pending: string[] };
      queue(name: string, outcome: Outcome): void;
      settle(id: string, value: unknown, reject?: boolean): Promise<void>;
      setPage(account: string, cursor: string, page: MyReportHistoryPage): void;
      render(account: string, remount?: boolean): void;
    };
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import LaporanPage from "@/app/(app)/laporan/page";
import { IdentityProvider } from "@/components/auth/identity-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const config = window.__reportHistoryConfig;
// CACHE-01 Batch 2: the page reads through TanStack Query now. The harness keeps the production
// freshness window (30s) but pins retry to zero, because these specs assert a single-shot read
// failure; the provider's own retry policy is pinned by the query-provider unit test.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: 0 } } });
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const state = { pages: clone(config.pages || {}), queues: clone(config.queues || {}), calls: [], pending: new Map(), account: "member-a", status: "draft" };
async function call(name, args, fallback) {
  state.calls.push({ name, args, account: state.account });
  const outcome = state.queues[name]?.shift();
  if (!outcome) return clone(fallback);
  if (outcome.kind === "reject") throw new Error("controlled failure");
  if (outcome.kind === "defer") return new Promise((resolve, reject) => state.pending.set(outcome.id, { resolve, reject }));
  return clone(outcome.value);
}
const today = () => ({
  id: "today", userId: state.account, authorName: "Santri Uji", authorRole: "santri", teamName: "Team",
  reportDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()),
  reportDateFormatted: "Hari ini", submissionStatus: state.status, reviewStatus: "not_reviewed", isLate: false, revisionNo: 1,
  items: [{ id: "today-item", categoryId: "education", categoryName: "Pendidikan", title: "Aktivitas hari ini", description: "Deskripsi hari ini", durationMinutes: 60, sortOrder: 1 }],
});
async function write(name, args) {
  const result = await call(name, args, { success: true, message: "Laporan tersimpan.", isLate: false, submittedAtTime: "12:00 WIB" });
  if (result.success) state.status = name === "submit" ? "submitted" : "draft";
  return result;
}
window.__reportHistoryBoundaries = {
  history: options => call("history", [options], state.pages[state.account]?.[options?.before || "latest"] || { reports: [], nextCursor: null }),
  today: () => call("today", [], today()),
  categories: () => call("categories", [], [{ id: "education", name: "Pendidikan", slug: "pendidikan" }]),
  policy: () => call("policy", [], null),
  save: (...args) => write("save", args), submit: (...args) => write("submit", args),
  identity: () => call("identity", [], { id: state.account, role: "santri", status: "active", full_name: "Santri Uji" }),
};
const reactRoot = createRoot(document.getElementById("report-history-root"));
let generation = 0;
function render(account, remount = false) {
  state.account = account;
  if (remount) generation++;
  flushSync(() => reactRoot.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(IdentityProvider, {
    key: generation, initialUser: { id: account, role: "santri", status: "active", full_name: "Santri Uji" },
  }, React.createElement(LaporanPage)))));
}
window.__reportHistoryUI = {
  snapshot: () => clone({ calls: state.calls, pending: Array.from(state.pending.keys()) }),
  queue: (name, outcome) => { (state.queues[name] ||= []).push(clone(outcome)); },
  settle: async (id, value, reject = false) => {
    const pending = state.pending.get(id);
    if (!pending) throw new Error("No pending request " + id);
    state.pending.delete(id);
    reject ? pending.reject(new Error("controlled failure")) : pending.resolve(clone(value));
    for (let i = 0; i < 4; i++) await Promise.resolve();
    await new Promise(resolve => requestAnimationFrame(resolve));
  },
  setPage: (account, cursor, page) => { (state.pages[account] ||= {})[cursor] = clone(page); },
  render,
};
render("member-a");
`;
const modules: Record<string, string> = {
  "@/modules/reports/actions": `
    export const getMyReportHistoryAction = (...args) => window.__reportHistoryBoundaries.history(...args);
    export const getTodayReportAction = (...args) => window.__reportHistoryBoundaries.today(...args);
    export const getReportCategoriesAction = (...args) => window.__reportHistoryBoundaries.categories(...args);
    export const saveReportDraftAction = (...args) => window.__reportHistoryBoundaries.save(...args);
    export const submitReportAction = (...args) => window.__reportHistoryBoundaries.submit(...args);`,
  "@/modules/analytics/actions": `export const getActivePolicyAction = () => window.__reportHistoryBoundaries.policy();`,
  "@/modules/iam/actions": `export const getCurrentUserAction = () => window.__reportHistoryBoundaries.identity();`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const boundaries: Plugin = {
  name: "report-history-action-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "history-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "history-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "history-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/laporan/page.tsx", "src/components/auth/identity-context.tsx"]) {
    expect(inputs.some(input => input.endsWith(file)), `Bundled actual ${file}`).toBe(true);
  }
  // CACHE-01 Batch 2: /laporan left the manual cache hook behind, so it may not be pulled into this
  // bundle any more. src/lib/data-cache.ts still is — cache-keys.ts imports it for the policy and
  // dashboard bridges that /admin/audit needs until Batch 3.
  expect(inputs.some(input => input.endsWith("src/hooks/use-cached-data.ts")), "Bundled legacy use-cached-data").toBe(false);
  expect(inputs.some(input => /src\/lib\/supabase\/|src\/modules\/.*\/actions\.ts/.test(input))).toBe(false);
  bundle = result.outputFiles[0].text;
});
test.afterEach(async ({ page }) => {
  expect(forbidden.get(page) || [], "No real provider/server-action requests").toEqual([]);
});
async function mount(page: Page, config: Config = {}) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const blocked: string[] = [];
  forbidden.set(page, blocked);
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === "/__nextjs_original-stack-frames") return route.abort();
    if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) {
      blocked.push(`${request.method()} ${request.url()}`);
      return route.abort();
    }
    return route.continue();
  });
  // Only the login document's CSS/assets are reused; never authenticate or seed.
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await page.evaluate(config => {
    window.__reportHistoryConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "report-history-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
function entry(date: string, overrides: Partial<MyReportHistoryEntry> = {}): MyReportHistoryEntry {
  return {
    id: `report-${date}`, reportDate: date, submissionStatus: "submitted", reviewStatus: "approved", isLate: false,
    firstSubmittedAt: `${date}T05:00:00Z`,
    items: [{ id: `item-${date}`, categoryId: "education", categoryName: "Pendidikan", title: `Aktivitas ${date}`,
      description: "Isi laporan lama", resultProgress: "Satu bab selesai", obstacles: "Tidak ada kendala", durationMinutes: 60, sortOrder: 1 }],
    latestReview: { decision: "approved", notes: "Catatan pembina tersimpan", decidedAt: `${date}T06:00:00Z` },
    ...overrides,
  };
}
const empty: MyReportHistoryPage = { reports: [], nextCursor: null };
const first: MyReportHistoryPage = { reports: [entry("2026-11-12"), entry("2026-11-11", { submissionStatus: "draft", reviewStatus: "not_reviewed", firstSubmittedAt: null, latestReview: null })], nextCursor: "2026-11-11" };
const older: MyReportHistoryPage = { reports: [entry("2025-01-01", { reviewStatus: "revision_required", latestReview: { decision: "revision_required", notes: "Perjelas hasil", decidedAt: "2025-01-02T05:00:00Z" } })], nextCursor: null };
const pages = { "member-a": { latest: first, "2026-11-11": older } };
const history = (page: Page) => page.getByRole("region", { name: "Riwayat Laporan Saya" });
const snapshot = (page: Page) => page.evaluate(() => window.__reportHistoryUI.snapshot());
const calls = async (page: Page, name: string) => (await snapshot(page)).calls.filter(call => call.name === name);
const summary = (page: Page, date: string) => history(page).locator(`summary:has(time[datetime="${date}"])`);

test.describe("TRC-05 personal history — real UI, mocked actions", () => {
  test("loading becomes an honest empty state", async ({ page }) => {
    await mount(page, { queues: { history: [{ kind: "defer", id: "initial" }] } });
    await expect(history(page).getByRole("status")).toHaveText("Memuat riwayat laporan...");
    await page.evaluate(value => window.__reportHistoryUI.settle("initial", value), empty);
    await expect(history(page).getByText(/Belum ada riwayat laporan/)).toBeVisible();
    await expect(history(page).locator("summary")).toHaveCount(0);
    await expect(history(page).getByRole("button", { name: "Muat laporan lebih lama" })).toHaveCount(0);
  });

  test("failed first read is not empty success and retry loads separate statuses with keyboard read-only detail", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { pages, queues: { history: [{ kind: "reject" }] } });
    await expect(history(page).getByRole("alert")).toContainText("Riwayat laporan gagal dimuat");
    await expect(history(page).getByText(/Belum ada riwayat laporan/)).toHaveCount(0);
    await history(page).getByRole("button", { name: "Coba lagi memuat riwayat" }).click();
    await expect(history(page).locator("summary")).toHaveCount(2);
    await expect(summary(page, "2026-11-12")).toContainText("Tepat Waktu");
    await expect(summary(page, "2026-11-12")).toContainText("Disetujui");
    await expect(summary(page, "2026-11-11")).toContainText("Draft");
    await expect(summary(page, "2026-11-11")).toContainText("Belum Ditinjau");
    await summary(page, "2026-11-12").focus();
    await page.keyboard.press("Enter");
    const detail = history(page).locator("details[open]");
    await expect(detail.getByText("Isi laporan lama")).toBeVisible();
    await expect(detail.getByText("Catatan pembina tersimpan")).toBeVisible();
    await expect(detail.getByText(/Satu bab selesai/)).toBeVisible();
    await expect(detail.locator("input, textarea, select, button, form")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("report-history-mobile.png"), fullPage: true });
    await expect(page.locator('#report-history-root form input[type="text"]').first()).toHaveValue("Aktivitas hari ini");
    expect((await calls(page, "history")).map(call => call.args)).toEqual([[{ before: null, limit: 20 }], [{ before: null, limit: 20 }]]);
  });

  test("older-page failure retains current rows, retry appends older history using the exclusive cursor", async ({ page }) => {
    await mount(page, { pages });
    await expect(history(page).locator("summary")).toHaveCount(2);
    await page.evaluate(() => window.__reportHistoryUI.queue("history", { kind: "defer", id: "older" }));
    await history(page).getByRole("button", { name: "Muat laporan lebih lama" }).click();
    await expect(history(page).getByRole("status")).toBeVisible();
    await expect(history(page).locator("summary")).toHaveCount(2);
    await page.evaluate(() => window.__reportHistoryUI.settle("older", null, true));
    await expect(history(page).getByRole("alert")).toBeVisible();
    await history(page).getByRole("button", { name: "Coba lagi memuat riwayat" }).click();
    await expect(history(page).locator("summary")).toHaveCount(3);
    await expect(history(page).getByRole("button", { name: "Muat laporan lebih lama" })).toHaveCount(0);
    expect(await history(page).locator("summary > time").evaluateAll(nodes => nodes.map(node => node.getAttribute("datetime")))).toEqual(["2026-11-12", "2026-11-11", "2025-01-01"]);
    expect((await calls(page, "history")).slice(1).map(call => call.args)).toEqual([[{ before: "2026-11-11", limit: 20 }], [{ before: "2026-11-11", limit: 20 }]]);
    await summary(page, "2025-01-01").click();
    await expect(history(page).getByText("Perjelas hasil")).toBeVisible();
  });

  for (const action of ["save", "submit"] as const) {
    test(`${action} success refreshes history and resets older pages; failure leaves history unchanged`, async ({ page }) => {
      await mount(page, { pages, queues: { [action]: [{ kind: "resolve", value: { success: false, message: "Belum tersimpan." } }] } });
      await expect(history(page).locator("summary")).toHaveCount(2);
      await history(page).getByRole("button", { name: "Muat laporan lebih lama" }).click();
      await expect(history(page).locator("summary")).toHaveCount(3);
      const before = (await calls(page, "history")).length;
      const button = page.getByRole("button", { name: action === "save" ? "Simpan Draft" : "Kirim Laporan (1)" });
      await button.click();
      await expect(page.getByText("Belum tersimpan.")).toBeVisible();
      expect((await calls(page, "history")).length).toBe(before);
      const refreshed = { reports: [entry("2026-11-12", { submissionStatus: action === "save" ? "draft" : "submitted", reviewStatus: "under_review" })], nextCursor: null } satisfies MyReportHistoryPage;
      await page.evaluate(value => window.__reportHistoryUI.setPage("member-a", "latest", value), refreshed);
      await button.click();
      await expect(history(page).locator("summary")).toHaveCount(1);
      await expect(summary(page, "2026-11-12")).toContainText("Sedang Ditinjau");
      await expect(summary(page, "2026-11-12")).toContainText(action === "save" ? "Draft" : "Tepat Waktu");
      await expect.poll(async () => (await calls(page, "history")).length).toBeGreaterThan(before);
      const writes = await calls(page, action);
      expect(writes).toHaveLength(2);
      const date = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()));
      expect(writes[1].args[0]).toMatchObject({ reportId: "today", reportDate: date });
    });
  }

  test("a pre-save pending history request cannot overwrite refreshed history", async ({ page }) => {
    await mount(page, { queues: { history: [{ kind: "defer", id: "pre-save" }] } });
    await expect(history(page).getByRole("status")).toBeVisible();
    await expect(page.locator('#report-history-root form input[type="text"]').first()).toHaveValue("Aktivitas hari ini");
    await page.evaluate(value => window.__reportHistoryUI.setPage("member-a", "latest", value), { reports: [entry("2026-11-12")], nextCursor: null });
    await page.getByRole("button", { name: "Simpan Draft" }).click();
    await expect(summary(page, "2026-11-12")).toBeVisible();
    await page.evaluate(value => window.__reportHistoryUI.settle("pre-save", value), older);
    await expect(summary(page, "2025-01-01")).toHaveCount(0);
    await expect(summary(page, "2026-11-12")).toBeVisible();
  });

  test("scoped cache survives revisit but account changes never reveal the previous history", async ({ page }) => {
    await mount(page, { pages });
    await expect(history(page).locator("summary")).toHaveCount(2);
    const readsBeforeRevisit = (await calls(page, "history")).length;
    await page.evaluate(() => {
      window.__reportHistoryUI.render("member-a", true);
    });
    // CACHE-01 Batch 2: inside the 30s freshness window a revisit is served from the cache, so the
    // rows stay and no second read is issued — the manual cache used to revalidate on every mount.
    await expect(history(page).locator("summary")).toHaveCount(2);
    await expect(history(page).getByRole("status")).toHaveCount(0);
    expect((await calls(page, "history")).length).toBe(readsBeforeRevisit);
    await page.evaluate(() => {
      window.__reportHistoryUI.queue("history", { kind: "defer", id: "new-account" });
      window.__reportHistoryUI.render("member-b");
    });
    await expect.poll(async () => (await snapshot(page)).pending).toContain("new-account");
    await expect(history(page).locator("summary")).toHaveCount(0);
    await expect(history(page).getByRole("status")).toBeVisible();
    await page.evaluate(value => window.__reportHistoryUI.settle("new-account", value), empty);
    await expect(history(page).getByText(/Belum ada riwayat laporan/)).toBeVisible();
    await expect(history(page).locator("summary")).toHaveCount(0);
    expect((await calls(page, "history")).at(-1)?.account).toBe("member-b");
  });
});
