import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import type { ScheduleEventItem } from "../src/modules/schedules/types";

// Real JadwalPage + IdentityProvider + cache; mocked schedule actions.
// Component/browser integration, NOT authenticated production DB E2E.
type Config = { events?: ScheduleEventItem[] };
declare global {
  interface Window {
    __jadwalConfig: Config;
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import JadwalPage from "@/app/(app)/jadwal/page";
import { IdentityProvider } from "@/components/auth/identity-context";
const config = window.__jadwalConfig;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
window.__jadwalBoundaries = {
  events: async () => clone(config.events || []),
  announcements: async () => [],
  markRead: async () => ({ success: true, message: "ok" }),
  publish: async () => ({ success: true, message: "ok" }),
  // ANN-CMD: the composer now asks the session which audiences it may address instead of
  // guessing from profiles.member_type. This fixture signs in as a santri, so the picker the
  // database would answer with is empty.
  audience: async () => ({ tier: "none", teams: [], coordinated: [] }),
  ical: async () => ({ success: true, icalUrl: "https://example.invalid/feed.ics" }),
  identity: async () => ({ id: "member-a", role: "santri", status: "active", full_name: "Santri Uji" }),
};
const reactRoot = createRoot(document.getElementById("jadwal-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "member-a", role: "santri", status: "active", full_name: "Santri Uji" },
}, React.createElement(JadwalPage))));
`;
const modules: Record<string, string> = {
  "@/modules/schedules/actions": `
    export const getEventsAction = (...args) => window.__jadwalBoundaries.events(...args);
    export const getAnnouncementsAction = (...args) => window.__jadwalBoundaries.announcements(...args);
    export const markAnnouncementReadAction = (...args) => window.__jadwalBoundaries.markRead(...args);
    export const publishAnnouncementAction = (...args) => window.__jadwalBoundaries.publish(...args);
    export const getEventAudienceOptionsAction = (...args) => window.__jadwalBoundaries.audience(...args);
    export const generateICalSubscriptionAction = (...args) => window.__jadwalBoundaries.ical(...args);`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
  "@/modules/iam/actions": `export const getCurrentUserAction = () => window.__jadwalBoundaries.identity();`,
};
const boundaries: Plugin = {
  name: "jadwal-action-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "jadwal-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "jadwal-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "jadwal-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/jadwal/page.tsx", "src/components/auth/identity-context.tsx"]) {
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
    window.__jadwalConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "jadwal-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const event = (overrides: Partial<ScheduleEventItem>): ScheduleEventItem => ({
  id: "evt-1",
  startsAt: `${today}T12:00:00Z`,
  endsAt: `${today}T13:00:00Z`,
  dateStr: today,
  timeRangeStr: "19:00 - 20:00 WIB",
  statusBadge: "on_schedule",
  statusLabel: "Sesuai Jadwal",
  category: "teknologi",
  categoryLabel: "Teknologi & Koding",
  title: "Kelas Koding",
  location: "Lab Utama",
  actionType: "detail",
  actionLabel: "Lihat Detail",
  ...overrides,
});
const events = [
  event({}),
  event({ id: "evt-2", title: "Kajian Malam", category: "keagamaan", categoryLabel: "Kajian & Ibadah", statusBadge: "cancelled", statusLabel: "Dibatalkan" }),
];

test.describe("TRC-20/21 — cancelled events stay visible, honest notification copy", () => {
  test("cancelled event renders with Dibatalkan badge instead of disappearing", async ({ page }) => {
    await mount(page, { events });
    await expect(page.getByText("Kelas Koding")).toBeVisible();
    await expect(page.getByText("Kajian Malam")).toBeVisible();
    await expect(page.getByText("Dibatalkan", { exact: true })).toBeVisible();
    await expect(page.getByText("Sesuai Jadwal", { exact: true })).toBeVisible();
    await expect(page.getByText("Perubahan lokasi dan pembatalan acara dikirim sebagai notifikasi push.")).toBeVisible();
    await expect(page.getByText(/15 menit/)).toHaveCount(0);
  });

  test("mobile viewport shows both cards without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { events });
    await expect(page.getByText("Dibatalkan", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("jadwal-cancelled-mobile.png"), fullPage: true });
  });
});