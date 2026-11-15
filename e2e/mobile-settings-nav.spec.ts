import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real MobileNav + MoreSheet; mocked navigation/supabase/notification boundaries.
// Component/browser integration, NOT authenticated production DB E2E.
type Config = { role?: string };
declare global {
  interface Window {
    __navConfig: Config;
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MobileNav } from "@/components/layout/mobile-nav";
const config = window.__navConfig;
const user = { id: "user-a", role: config.role || "santri", status: "active", full_name: "Santri Uji", email: "santri@uji.id", team_name: "Tim Uji" };
const reactRoot = createRoot(document.getElementById("nav-root"));
flushSync(() => reactRoot.render(React.createElement(MobileNav, { user })));
`;
const modules: Record<string, string> = {
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
  "next/navigation": `export const useRouter = () => ({ replace(){}, refresh(){} }); export const usePathname = () => "/";`,
  "@/lib/supabase/client": `export const createClient = () => ({ auth: { signOut: async () => {} } });`,
  "@/lib/notifications": `export const cleanupPushNotifications = async () => {};`,
};
const boundaries: Plugin = {
  name: "nav-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "nav-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "nav-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "nav-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/components/layout/mobile-nav.tsx", "src/components/layout/more-sheet.tsx"]) {
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
    window.__navConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "nav-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}

test.describe("UX-02 — profile/MFA settings reachable from mobile nav", () => {
  test("santri opens Lainnya sheet and reaches /settings/profile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { role: "santri" });
    await page.getByRole("button", { name: "Lainnya" }).click();
    const link = page.getByRole("link", { name: "Pengaturan Profil" });
    await expect(link).toBeVisible();
    expect(await link.getAttribute("href")).toBe("/settings/profile");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("mobile-settings-nav.png"), fullPage: true });
  });

  test("pengurus also sees the profile settings link in the sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { role: "pengurus" });
    await page.getByRole("button", { name: "Lainnya" }).click();
    const link = page.getByRole("link", { name: "Pengaturan Profil" });
    await expect(link).toBeVisible();
    expect(await link.getAttribute("href")).toBe("/settings/profile");
  });
});

test.describe("UX-15 — Review koordinator dipromosikan ke nav utama", () => {
  test("koordinator sees Review in main nav, Kehadiran via Lainnya", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { role: "koordinator" });
    const nav = page.getByRole("navigation", { name: "Navigasi Utama Mobile" });
    const reviewLink = nav.getByRole("link", { name: "Review" });
    await expect(reviewLink).toBeVisible();
    expect(await reviewLink.getAttribute("href")).toBe("/review");
    await expect(nav.getByRole("link", { name: "Kehadiran" })).toHaveCount(0);
    await page.getByRole("button", { name: "Lainnya" }).click();
    const kehadiran = page.getByRole("link", { name: "Kehadiran" });
    await expect(kehadiran).toBeVisible();
    expect(await kehadiran.getAttribute("href")).toBe("/kehadiran");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("mobile-nav-koordinator.png"), fullPage: true });
  });

  test("santri keeps Kehadiran (not Review) in main nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { role: "santri" });
    const nav = page.getByRole("navigation", { name: "Navigasi Utama Mobile" });
    await expect(nav.getByRole("link", { name: "Kehadiran" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Review" })).toHaveCount(0);
  });
});