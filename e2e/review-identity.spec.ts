import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real ReviewPage + IdentityProvider; mocked reports actions. Browser/component
// evidence for UX-01 (session reviewer identity), NOT production DB E2E.
type Report = Record<string, unknown>;
type Config = { reports?: Report[]; failQueue?: boolean };
type ReviewCall = { reportId: string; decision: string; notes: string; reviewerName?: string };
declare global {
  interface Window {
    __reviewIdentityConfig: Config;
    __reviewIdentityCalls: ReviewCall[];
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ReviewPage from "@/app/(app)/review/page";
import { IdentityProvider } from "@/components/auth/identity-context";
const config = window.__reviewIdentityConfig;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
window.__reviewIdentityCalls = [];
window.__reviewIdentityBoundaries = {
  queue: async () => { if (config.failQueue) throw new Error("Data gagal dimuat. Coba lagi atau hubungi administrator (ID: QRY-TEST)"); return clone(config.reports || []); },
  review: async (payload) => {
    window.__reviewIdentityCalls.push(clone(payload));
    return { success: true, message: "Laporan santri berhasil disetujui oleh " + payload.reviewerName + "." };
  },
};
const reactRoot = createRoot(document.getElementById("review-identity-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "reviewer-session", role: "koordinator", roles: ["koordinator"], status: "active", full_name: "Ustadz Salman Uji", team_name: "Tim Pembina Uji", email: "salman@example.test", member_type: "pengurus" },
}, React.createElement(ReviewPage))));
`;
const modules: Record<string, string> = {
  "@/modules/reports/actions": `
    export const getReviewQueueAction = () => window.__reviewIdentityBoundaries.queue();
    export const reviewReportAction = (payload) => window.__reviewIdentityBoundaries.review(payload);`,
  "@/modules/iam/actions": `export const getCurrentUserAction = async () => ({ id: "reviewer-session", role: "koordinator", status: "active", full_name: "Ustadz Salman Uji" });`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const boundaries: Plugin = {
  name: "review-identity-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "review-identity-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "review-identity-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "review-identity-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/review/page.tsx", "src/components/auth/identity-context.tsx"]) {
    expect(inputs.some(input => input.endsWith(file)), `Bundled actual ${file}`).toBe(true);
  }
  expect(inputs.some(input => /src\/lib\/supabase\/|src\/modules\/.*\/actions\.ts/.test(input))).toBe(false);
  bundle = result.outputFiles[0].text;
});
test.afterEach(async ({ page }) => {
  expect(forbidden.get(page) || [], "No real provider/server-action requests").toEqual([]);
});
async function mount(page: Page, config: Config) {
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
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await page.evaluate(config => {
    window.__reviewIdentityConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "review-identity-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const reports: Report[] = [
  {
    id: "rep-1", userId: "santri-b", authorName: "Ahmad Santri", authorRole: "Santri", teamName: "Tim Kebersihan",
    reportDate: "2026-11-14", reportDateFormatted: "Sabtu, 14 Nov 2026", submissionStatus: "submitted",
    isLate: false, submittedAtTime: "20:10:00 WIB", reviewStatus: "not_reviewed", revisionNo: 1,
    items: [{ id: "item-1", categoryId: "cat-1", categoryName: "Kegiatan", title: "Piket pagi", description: "Membersihkan halaman", durationMinutes: 30, sortOrder: 1 }],
    reviews: [],
  },
];

test.describe("UX-01 — reviewer identity comes from the session, not a fixture", () => {
  test("header shows the signed-in reviewer and no fabricated batch/name", async ({ page }) => {
    await mount(page, { reports });
    await expect(page.getByText(/Peninjau: Ustadz Salman Uji/)).toBeVisible();
    await expect(page.getByText("Ustadz Ahmad Fauzi")).toHaveCount(0);
    await expect(page.getByText("Batch #42")).toHaveCount(0);
  });

  test("approve sends the session identity and renders it in the review history", async ({ page }) => {
    await mount(page, { reports });
    await page.getByRole("button", { name: "Setujui Laporan" }).click();
    await expect(page.getByText(/berhasil disetujui oleh Ustadz Salman Uji/)).toBeVisible();
    const calls = await page.evaluate(() => window.__reviewIdentityCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ reportId: "rep-1", decision: "approved", reviewerName: "Ustadz Salman Uji" });
    await expect(page.getByText("Ustadz Salman Uji", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.body.innerText.includes("usr-fauzi"))).toBe(false);
  });

  test("mobile viewport renders the queue without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { reports });
    await expect(page.getByText(/Peninjau: Ustadz Salman Uji/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("review-identity-mobile.png"), fullPage: true });
  });
});

test.describe("UX-08 — review membedakan gagal muat vs antrean kosong", () => {
  test("queue load failure shows an error banner, not the empty state", async ({ page }) => {
    await mount(page, { failQueue: true });
    await expect(page.getByRole("alert")).toContainText("Antrean review gagal dimuat");
    await expect(page.getByText("Tidak Ada Antrean Laporan")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  });
});