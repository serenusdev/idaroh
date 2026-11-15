import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real AdminUsersPage + IdentityProvider; mocked action boundaries. Browser/
// component evidence for UX-05 (mandatory rejection reason), NOT production DB E2E.
type Outcome = { success: boolean; message: string };
type Config = { requests?: unknown[]; users?: unknown[]; rejectOutcome?: Outcome; resetOutcome?: Outcome };
type RejectCall = { id: string; reason: string };
declare global {
  interface Window {
    __rejectConfig: Config;
    __rejectCalls: RejectCall[];
    __resetCalls: string[];
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import AdminUsersPage from "@/app/(app)/admin/users/page";
import { IdentityProvider } from "@/components/auth/identity-context";
const config = window.__rejectConfig;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
window.__rejectCalls = [];
window.__resetCalls = [];
window.__rejectBoundaries = {
  requests: async () => clone(config.requests || []),
  users: async () => clone(config.users || []),
  teams: async () => [{ id: "team-1", name: "Sentra Digitalpreneur" }],
  reject: async (id, reason) => {
    window.__rejectCalls.push({ id, reason });
    return clone(config.rejectOutcome || { success: true, message: "Permohonan ditolak." });
  },
  reset: async (id) => {
    window.__resetCalls.push(id);
    return clone(config.resetOutcome || { success: true, message: "Sesi dicabut." });
  },
};
const reactRoot = createRoot(document.getElementById("reject-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "admin-a", role: "super_admin", roles: ["super_admin"], status: "active", full_name: "Admin Uji", email: "admin@example.test", member_type: "pengurus" },
}, React.createElement(AdminUsersPage))));
`;
const modules: Record<string, string> = {
  "@/modules/iam/actions": `
    export const getAccountRequestsAction = () => window.__rejectBoundaries.requests();
    export const getActiveUsersAction = () => window.__rejectBoundaries.users();
    export const rejectAccountApplicationAction = (id, reason) => window.__rejectBoundaries.reject(id, reason);
    export const approveAccountApplicationAction = async () => ({ success: true, message: "ok" });
    export const createManualAccountAction = async () => ({ success: true, message: "ok" });
    export const resetUserSessionAction = (id) => window.__rejectBoundaries.reset(id);
    export const revokeDeviceTokenAction = async () => ({ success: true, message: "ok" });
    export const adminUpdateUserAction = async () => ({ success: true, message: "ok" });
    export const getCurrentUserAction = async () => ({ id: "admin-a", role: "super_admin", status: "active", full_name: "Admin Uji" });`,
  "@/modules/operations/actions": `export const importMembersCsvAction = async () => ({ success: true, message: "ok", errors: [] });`,
  "@/modules/people/actions": `export const getTeamsAction = () => window.__rejectBoundaries.teams();`,
  "@/modules/analytics/actions": `export const exportAuditedDataAction = async () => ({ success: true, message: "ok", downloadUrl: "" });`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const boundaries: Plugin = {
  name: "reject-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "reject-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "reject-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "reject-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/admin/users/page.tsx", "src/components/auth/identity-context.tsx"]) {
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
    window.__rejectConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "reject-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const requests = [
  { id: "req-1", status: "pending", initials: "BS", fullName: "Bilal Santri", email: "bilal@example.test", phoneNumber: "0812", claimedMemberType: "santri", teamRequested: "Sentra Digitalpreneur", createdAt: "2026-11-14 08:00", notes: "-" },
];
const openReject = async (page: Page) => {
  await page.getByRole("button", { name: "Tolak" }).click();
  await expect(page.getByText("Tolak Permohonan Akun")).toBeVisible();
};

test.describe("UX-05 — rejection requires a real reason", () => {
  test("confirm is disabled until a reason is typed, then sends the trimmed reason", async ({ page }) => {
    await mount(page, { requests });
    await openReject(page);
    const confirm = page.getByRole("button", { name: /Konfirmasi Tolak|Memproses/ });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Alasan Penolakan").fill("   ");
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Alasan Penolakan").fill("  Data diri belum lengkap.  ");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    const calls = await page.evaluate(() => window.__rejectCalls);
    expect(calls).toEqual([{ id: "req-1", reason: "Data diri belum lengkap." }]);
  });

  test("a failed rejection surfaces an error and keeps the modal open", async ({ page }) => {
    await mount(page, { requests, rejectOutcome: { success: false, message: "Permohonan sudah diproses admin lain." } });
    await openReject(page);
    await page.getByLabel("Alasan Penolakan").fill("Duplikat akun.");
    await page.getByRole("button", { name: "Konfirmasi Tolak" }).click();
    await expect(page.getByRole("alert")).toContainText("Permohonan sudah diproses admin lain.");
    await expect(page.getByText("Tolak Permohonan Akun")).toBeVisible();
  });
});

const activeUser = {
  id: "user-1", fullName: "Bilal Santri", email: "bilal@example.test", role: "santri",
  teamName: "Sentra Digitalpreneur", status: "active", initials: "BS", devicesCount: 1,
  deviceInfo: "1 Perangkat Aktif", mfaEnabled: false,
  devices: [{ id: "dev-1", platform: "web", label: "Chrome", updatedAt: "2026-11-14" }],
};

test.describe("UX-17 — reset sesi gated by an explicit confirmation", () => {
  test("confirm dialog blocks resetUserSessionAction until confirmed", async ({ page }) => {
    await mount(page, { requests: [], users: [activeUser] });
    await page.getByRole("button", { name: /^Aktif/ }).click();
    await page.getByRole("button", { name: "Cabut Sesi & Perangkat" }).click();
    await expect(page.getByText("Cabut semua sesi & perangkat pengguna ini?")).toBeVisible();
    expect(await page.evaluate(() => window.__resetCalls)).toEqual([]);
    await page.getByRole("button", { name: "Ya, Lanjutkan" }).click();
    await expect(page.getByText("Sesi & Perangkat Dicabut")).toBeVisible();
    expect(await page.evaluate(() => window.__resetCalls)).toEqual(["user-1"]);
  });

  test("cancel closes the dialog without calling reset", async ({ page }) => {
    await mount(page, { requests: [], users: [activeUser] });
    await page.getByRole("button", { name: /^Aktif/ }).click();
    await page.getByRole("button", { name: "Cabut Sesi & Perangkat" }).click();
    await expect(page.getByText("Cabut semua sesi & perangkat pengguna ini?")).toBeVisible();
    await page.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByText("Cabut semua sesi & perangkat pengguna ini?")).toHaveCount(0);
    expect(await page.evaluate(() => window.__resetCalls)).toEqual([]);
  });
});