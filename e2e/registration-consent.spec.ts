import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { REGISTRATION_PRIVACY_VERSION } from "../src/modules/iam/registration";

// Real components and CSS; only server/provider boundaries are mocked, with network writes blocked.
const root = path.resolve(__dirname, "..");
let bundle: string;
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import Register from "@/app/(auth)/register/page";
import AdminUsers from "@/app/(app)/admin/users/page";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MobileNav } from "@/components/layout/mobile-nav";
import { IdentityProvider } from "@/components/auth/identity-context";
const state = window.__registration;
const user = { id: "admin-fixture", role: "super_admin", full_name: "Admin Uji", email: "admin@example.test", status: "active" };
// CACHE-01 Batch 3: the IAM console reads through TanStack Query, so the fixture supplies the client
// AppShell mounts in the real app. retry:false keeps the read counts the assertions rely on.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: 0 } } });
state.call = async (name, args) => {
  state.calls.push({ name, args });
  if (name === "submitAccountApplicationAction") {
    const outcome = state.outcomes.shift();
    if (outcome === "throw") throw new Error("controlled failure");
    if (outcome === "fail") return { success: false, message: "Pengajuan belum dapat diproses." };
    return { success: true, message: "Pengajuan diterima." };
  }
  if (name === "getAccountRequestsAction") return state.requests;
  if (name === "getActiveUsersAction" || name === "getTeamsAction") return [];
  return { success: true, message: "Tersimpan." };
};
const component = state.mode === "admin" ? React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(IdentityProvider, { initialUser: user }, React.createElement(AdminUsers)))
  : state.mode === "mobile" ? React.createElement(MobileNav, { user: { ...user, role: state.role } }) : React.createElement(Register);
createRoot(document.getElementById("registration-fixture")).render(component);
`;

const boundaries: Record<string, string> = {
  "@/modules/iam/actions": ["getCurrentUserAction", "submitAccountApplicationAction", "getAccountRequestsAction", "getActiveUsersAction", "approveAccountApplicationAction", "rejectAccountApplicationAction", "createManualAccountAction", "resetUserSessionAction", "revokeDeviceTokenAction", "adminUpdateUserAction", "adminSetUserRolesAction"].map(name => `export const ${name} = (...args) => window.__registration.call('${name}', args);`).join("\n"),
  "@/modules/operations/actions": "export const importMembersCsvAction = (...args) => window.__registration.call('importMembersCsvAction', args);",
  "@/modules/people/actions": "export const getTeamsAction = (...args) => window.__registration.call('getTeamsAction', args);",
  "@/modules/analytics/actions": "export const exportAuditedDataAction = (...args) => window.__registration.call('exportAuditedDataAction', args);",
  "@/lib/supabase/client": "export const createClient = () => ({auth: {signOut: async () => ({error: null})}});",
  "@/lib/notifications": "export const cleanupPushNotifications = async () => {};",
  "next/navigation": "export const usePathname = () => '/'; export const useRouter = () => ({replace() {},refresh() {}});",
  "next/image": "import React from 'react'; export default function Image({priority, unoptimized, ...props}) {return React.createElement('img', props);}",
  "next/link": "import React from 'react'; export default function Link(props) {return React.createElement('a', props);}",
};

test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: source, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY": '""' }, metafile: true,
    plugins: [{ name: "registration-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(?:@\/|next\/)/ }, ({ path: name }) => boundaries[name] ? { path: name, namespace: "boundary" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path: name }) => ({ contents: boundaries[name], loader: "js", resolveDir: root }));
    } }],
  });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(input => input.endsWith("src/app/(auth)/register/page.tsx"))).toBe(true);
  expect(inputs.some(input => /src\/modules\/.*\/actions\.ts/.test(input))).toBe(false);
  bundle = result.outputFiles[0].text;
});

const blocked = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => { expect(blocked.get(page) ?? []).toEqual([]); });

async function mount(page: Page, config: { mode?: string; outcomes?: string[]; requests?: object[]; role?: string } = {}) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const forbidden: string[] = [];
  blocked.set(page, forbidden);
  await page.route("**/*", async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === origin && url.pathname === "/__nextjs_original-stack-frames") return route.abort();
    if (url.origin !== origin || !["GET", "HEAD"].includes(req.method())) {
      forbidden.push(req.method() + " " + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await page.evaluate(config => {
    (window as any).__registration = { calls: [], outcomes: [], requests: [], ...config };
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "registration-fixture";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}

async function fillRegistration(page: Page) {
  await page.getByLabel("Nama Lengkap").fill("Pendaftar Uji");
  await page.getByLabel("Alamat Email", { exact: true }).fill("new@example.test");
  await page.getByLabel("Nomor WhatsApp").fill("081234567890");
  await page.getByLabel("Kata Sandi", { exact: true }).fill("Test-Password-123");
  await page.getByLabel("Konfirmasi Kata Sandi").fill("Test-Password-123");
}
const calls = (page: Page) => page.evaluate(() => (window as any).__registration.calls as { name: string; args: Record<string, unknown>[] }[]);

test("mobile registration requires consent and sends category, not role", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page);
  await expect(page.getByLabel("Kategori Keanggotaan").locator("option")).toHaveText(["Santri", "Ustadz", "Pengurus", "Yayasan", "Lainnya"]);
  await fillRegistration(page);
  await page.getByLabel("Kategori Keanggotaan").selectOption("yayasan");
  const consent = page.getByRole("checkbox");
  await expect(consent).not.toBeChecked();
  await page.getByRole("button", { name: "Kirim Pengajuan Akun" }).click();
  expect((await calls(page)).length).toBe(0);
  await page.getByText("Kebijakan privasi pendaftaran", { exact: true }).click();
  await expect(page.getByText(/Jika Anda belum dewasa/)).toBeVisible();
  await consent.check();
  await page.screenshot({ path: test.info().outputPath("registration-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Kirim Pengajuan Akun" }).click();
  await expect(page.getByRole("heading", { name: "Pengajuan Berhasil Dikirim" })).toBeVisible();
  const [submission] = await calls(page);
  expect(submission.args[0]).toMatchObject({ claimedMemberType: "yayasan", privacyConsent: true, privacyConsentVersion: REGISTRATION_PRIVACY_VERSION });
  expect(submission.args[0]).not.toHaveProperty("roleRequested");
  expect(submission.args[0]).not.toHaveProperty("privacyConsentAt");
});

test("failed registration remains retryable without losing consent or category", async ({ page }) => {
  await mount(page, { outcomes: ["throw", "fail", "ok"] });
  await fillRegistration(page);
  await page.getByLabel("Kategori Keanggotaan").selectOption("ustadz");
  await page.getByRole("checkbox").check();
  const submit = page.getByRole("button", { name: "Kirim Pengajuan Akun" });
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("Silakan coba lagi");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("belum dapat diproses");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(page.getByLabel("Kategori Keanggotaan")).toHaveValue("ustadz");
  await submit.click();
  await expect(page.getByRole("heading", { name: "Pengajuan Berhasil Dikirim" })).toBeVisible();
  expect(await calls(page)).toHaveLength(3);
});

test("admin queue separates category claim from assigned role and identifies missing consent", async ({ page }) => {
  const base = { phoneNumber: "masked", teamRequested: "Tim", notes: "-", status: "pending", createdAt: "13 Nov 2026", initials: "PU" };
  await mount(page, { mode: "admin", requests: [
    { ...base, id: "new", fullName: "Baru", email: "new@example.test", claimedMemberType: "yayasan", privacyConsentVersion: REGISTRATION_PRIVACY_VERSION, privacyConsentAt: "2026-11-13T02:30:00Z" },
    { ...base, id: "legacy", fullName: "Lama", email: "old@example.test", claimedMemberType: null, privacyConsentVersion: null, privacyConsentAt: null },
  ] });
  await expect(page.getByText("yayasan (Tim)", { exact: true })).toBeVisible();
  await expect(page.locator("#role-select-new")).toHaveValue("santri");
  await expect(page.getByText(/Belum tercatat \(pengajuan lama atau impor\)/)).toBeVisible();
  await expect(page.getByText(new RegExp("Persetujuan privasi: versi " + REGISTRATION_PRIVACY_VERSION))).toBeVisible();
});

for (const role of ["santri", "super_admin"]) {
  test(`${role} can find profile and reminder settings from mobile navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { mode: "mobile", role });
    await page.getByRole("button", { name: "grid_view Lainnya" }).click();
    await expect(page.getByRole("link", { name: /Pengaturan Profil/ })).toHaveAttribute("href", "/settings/profile");
    await expect(page.getByRole("link", { name: /Pengaturan Profil/ })).toBeVisible();
  });
}
