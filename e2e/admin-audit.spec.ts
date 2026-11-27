import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real AdminAuditPage + IdentityProvider; mocked analytics/iam action boundaries.
// Component/browser integration, NOT authenticated production DB E2E.
type Metrics = { totalSantri: number; todayCheckedIn: number; todayLate: number; pendingReports: number; approvedReports: number; pendingAccountRequests: number; activeTasks: number };
type Policy = { id: string; code: string; name: string; attendanceCutoffTime: string; attendanceGraceCutoffTime: string; reportDeadlineTime: string; status: string; effectiveFrom: string };
type Config = { stats?: Metrics; pendingPolicies?: Policy[]; activePolicy?: Policy | null; role?: string };
type ApproveCall = { id: string; note: string };
declare global {
  interface Window {
    __adminAuditConfig: Config;
    __adminApproveCalls: ApproveCall[];
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import AdminAuditPage from "@/app/(app)/admin/audit/page";
import { IdentityProvider } from "@/components/auth/identity-context";
import { QueryProvider } from "@/components/providers/query-provider";
const config = window.__adminAuditConfig;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
window.__adminApproveCalls = [];
window.__auditBoundaries = {
  stats: async () => clone(config.stats),
  pending: async () => clone(config.pendingPolicies || []),
  active: async () => clone(config.activePolicy ?? null),
  chain: async () => ({ valid: true, checked: 3, message: "ok" }),
  logs: async () => ({ success: true, logs: [], hasMore: false }),
  compliance: async () => ({ success: true, rows: [], totalCount: 0, hasMore: false }),
  approve: async (id, note) => { window.__adminApproveCalls.push({ id, note }); return { success: true, message: "Usulan kebijakan disetujui." }; },
  activate: async () => ({ success: true, message: "ok" }),
  update: async () => ({ success: true, message: "ok" }),
  export: async () => ({ success: true, message: "ok" }),
  identity: async () => ({ id: "yayasan-a", role: config.role || "yayasan", status: "active", full_name: "Yayasan Uji" }),
};
const reactRoot = createRoot(document.getElementById("audit-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "yayasan-a", role: config.role || "yayasan", status: "active", full_name: "Yayasan Uji" },
}, React.createElement(QueryProvider, null, React.createElement(AdminAuditPage)))));
`;
const modules: Record<string, string> = {
  "@/modules/analytics/actions": `
    export const getAdminDashboardStatsAction = () => window.__auditBoundaries.stats();
    export const getPendingPolicySettingsAction = () => window.__auditBoundaries.pending();
    export const getActivePolicyAction = () => window.__auditBoundaries.active();
    export const getAuditChainStatusAction = () => window.__auditBoundaries.chain();
    export const queryAuditLogsAction = () => window.__auditBoundaries.logs();
    export const queryComplianceCenterAction = (...args) => window.__auditBoundaries.compliance(...args);
    export const approvePolicySettingsAction = (...args) => window.__auditBoundaries.approve(...args);
    export const activatePolicySettingsAction = () => window.__auditBoundaries.activate();
    export const updatePolicySettingsAction = () => window.__auditBoundaries.update();
    export const exportAuditedDataAction = () => window.__auditBoundaries.export();`,
  "@/modules/iam/actions": `export const getCurrentUserAction = () => window.__auditBoundaries.identity();`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const boundaries: Plugin = {
  name: "audit-action-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "audit-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "audit-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "audit-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/admin/audit/page.tsx", "src/components/auth/identity-context.tsx"]) {
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
    window.__adminAuditConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "audit-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const stats: Metrics = { totalSantri: 40, todayCheckedIn: 30, todayLate: 5, pendingReports: 4, approvedReports: 16, pendingAccountRequests: 2, activeTasks: 7 };
const activePolicy: Policy = { id: "pol-active", code: "POL-2026-00", name: "Shift Aktif", attendanceCutoffTime: "08:00", attendanceGraceCutoffTime: "08:15", reportDeadlineTime: "21:00", status: "active", effectiveFrom: "2026-11-01" };
const proposed: Policy = { id: "pol-1", code: "POL-2026-01", name: "Shift Reguler Santri", attendanceCutoffTime: "07:30", attendanceGraceCutoffTime: "07:45", reportDeadlineTime: "21:00", status: "proposed", effectiveFrom: "2026-12-01" };

test.describe("UX-04 — audit dashboard real metrics + reviewer-typed approval reason", () => {
  test("metrics render real numbers, not hardcoded 0%", async ({ page }) => {
    await mount(page, { stats, activePolicy, pendingPolicies: [] });
    await expect(page.getByText("75%", { exact: true })).toBeVisible();
    await expect(page.getByText("30 dari 40 Santri Terdaftar")).toBeVisible();
    await expect(page.getByText("80%", { exact: true })).toBeVisible();
    await expect(page.getByText("4 Menunggu")).toBeVisible();
    await expect(page.getByText("16 Disetujui")).toBeVisible();
    await expect(page.getByText("4 Berkas")).toBeVisible();
    await expect(page.getByText("Belum Hadir")).toBeVisible();
    expect(await page.getByText("0 dari 0").count()).toBe(0);
    expect(await page.getByText("0%", { exact: true }).count()).toBe(0);
  });

  test("approval requires a typed reason and never writes the canned note", async ({ page }) => {
    await mount(page, { stats, activePolicy, pendingPolicies: [proposed] });
    await page.getByRole("button", { name: "Setujui", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Konfirmasi Setujui", exact: true });
    await expect(confirm).toBeDisabled();

    await dialog.getByLabel("Alasan persetujuan").fill("Jadwal shift baru sesuai keputusan rapat yayasan 14 Nov 2026.");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText("Usulan kebijakan disetujui.")).toBeVisible();

    const calls = await page.evaluate(() => window.__adminApproveCalls);
    expect(calls).toEqual([{ id: "pol-1", note: "Jadwal shift baru sesuai keputusan rapat yayasan 14 Nov 2026." }]);
    expect(calls[0].note).not.toBe("Disetujui setelah meninjau dampak operasional.");
  });

  test("blank reason keeps submit disabled and sends nothing", async ({ page }) => {
    await mount(page, { stats, activePolicy, pendingPolicies: [proposed] });
    await page.getByRole("button", { name: "Setujui", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Alasan persetujuan").fill("   ");
    await expect(dialog.getByRole("button", { name: "Konfirmasi Setujui", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.__adminApproveCalls)).toEqual([]);
  });

  test("mobile viewport renders dashboard without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { stats, activePolicy, pendingPolicies: [proposed] });
    await expect(page.getByText("75%", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("admin-audit-mobile.png"), fullPage: true });
  });
});
