import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real AdminAttendanceReviewPage + IdentityProvider; mocked attendance actions.
// Component/browser integration, NOT authenticated production DB E2E.
type Correction = { id: string; userId: string; userName: string; attendanceDate: string; reason: string; requestedClassification: string };
type Config = { corrections?: Correction[] };
type ReviewCall = { id: string; decision: string; note: string; effectiveClassification?: string };
declare global {
  interface Window {
    __reviewConfig: Config;
    __reviewCalls: ReviewCall[];
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import AdminAttendanceReviewPage from "@/app/(app)/admin/kehadiran/page";
import { IdentityProvider } from "@/components/auth/identity-context";
import { QueryProvider } from "@/components/providers/query-provider";
const config = window.__reviewConfig;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
window.__reviewCalls = [];
window.__reviewBoundaries = {
  queue: async () => ({ corrections: clone(config.corrections || []), exceptions: [] }),
  reviewCorrection: async (id, decision, note, effectiveClassification) => {
    window.__reviewCalls.push({ id, decision, note, effectiveClassification });
    return { success: true, message: "Koreksi presensi berhasil diproses." };
  },
  reviewException: async () => ({ success: true, message: "ok" }),
  identity: async () => ({ id: "reviewer-a", role: "pengurus", status: "active", full_name: "Pengurus Uji" }),
};
const reactRoot = createRoot(document.getElementById("review-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "reviewer-a", role: "pengurus", status: "active", full_name: "Pengurus Uji" },
}, React.createElement(QueryProvider, null, React.createElement(AdminAttendanceReviewPage))));
`;
const modules: Record<string, string> = {
  "@/modules/attendance/actions": `
    export const getAttendanceReviewQueueAction = () => window.__reviewBoundaries.queue();
    export const reviewAttendanceCorrectionAction = (...args) => window.__reviewBoundaries.reviewCorrection(...args);
    export const reviewAttendanceExceptionAction = (...args) => window.__reviewBoundaries.reviewException(...args);`,
  "@/modules/iam/actions": `export const getCurrentUserAction = () => window.__reviewBoundaries.identity();`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const boundaries: Plugin = {
  name: "review-action-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "review-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "review-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "review-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/admin/kehadiran/page.tsx", "src/components/auth/identity-context.tsx"]) {
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
    window.__reviewConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "review-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const corrections: Correction[] = [
  { id: "corr-1", userId: "user-b", userName: "Ahmad Santri", attendanceDate: "2026-11-13", reason: "wrong_time: Terlambat karena piket", requestedClassification: "grace" },
];

test.describe("FUNC-12/TRC-03 — reviewer chooses effective classification, honest copy", () => {
  test("approval panel defaults to requested classification and passes reviewer choice to the action", async ({ page }) => {
    await mount(page, { corrections });
    await expect(page.getByText("Ahmad Santri · 2026-11-13")).toBeVisible();
    await expect(page.getByText(/Anda tidak dapat mereview koreksi Anda sendiri/)).toBeVisible();

    await page.getByRole("button", { name: "Setujui" }).click();
    const select = page.locator("#eff-class-corr-1");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("grace");

    await select.selectOption("late");
    await page.getByLabel("Catatan reviewer").fill("Tetap terlambat sesuai kebijakan.");
    await page.getByRole("button", { name: "Konfirmasi Setujui" }).click();
    await expect(page.getByText("Koreksi presensi berhasil diproses.")).toBeVisible();

    const calls = await page.evaluate(() => window.__reviewCalls);
    expect(calls).toEqual([{ id: "corr-1", decision: "approved", note: "Tetap terlambat sesuai kebijakan.", effectiveClassification: "late" }]);
  });

  test("mobile viewport renders approval panel without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { corrections });
    await page.getByRole("button", { name: "Setujui" }).click();
    await expect(page.locator("#eff-class-corr-1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("attendance-review-mobile.png"), fullPage: true });
  });
});