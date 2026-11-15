import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real profile page + IdentityProvider; mocked action boundaries only. This is
// browser/component evidence, NOT persisted production/database E2E. No users or
// provider writes. Keep this feature fixture separate from the shared audit spec.
type Outcome = { kind: "resolve"; value: unknown } | { kind: "reject"; message: string } | { kind: "defer"; id: string };
type Config = { values?: Record<string, boolean>; queues?: Record<string, Outcome[]> };
type Snapshot = { calls: { name: string; account: string; args: unknown[] }[]; values: Record<string, boolean>; pending: string[] };
declare global {
  interface Window {
    __attendanceReminderConfig: Config;
    __attendanceReminderUI: {
      snapshot(): Snapshot;
      queue(name: string, outcome: Outcome): void;
      settle(id: string, value: unknown, reject?: boolean): void;
      render(account?: string, remount?: boolean): void;
    };
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const guardedRequests = new WeakMap<Page, string[]>();
const fixtureSource = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ProfileSettingsPage from "@/app/(app)/settings/profile/page";
import { IdentityProvider } from "@/components/auth/identity-context";
const config = window.__attendanceReminderConfig;
const clone = value => JSON.parse(JSON.stringify(value));
const state = { account: "caller", values: { caller: true, other: false, ...config.values }, queues: config.queues || {}, calls: [], pending: new Map() };
async function call(name, args, fallback) {
  const account = state.account;
  state.calls.push({ name, account, args });
  const outcome = state.queues[name]?.shift();
  if (!outcome) return fallback;
  if (outcome.kind === "reject") throw new Error(outcome.message);
  if (outcome.kind === "defer") return new Promise((resolve, reject) => state.pending.set(outcome.id, { resolve, reject }));
  return clone(outcome.value);
}
window.__attendanceReminderBoundaries = {
  load: () => call("load", [], { success: true, enabled: state.values[state.account], message: "Loaded" }),
  save: async enabled => {
    const account = state.account;
    const result = await call("save", [enabled], { success: true, enabled, message: "Pengaturan pengingat presensi disimpan." });
    if (result.success) state.values[account] = result.enabled;
    return result;
  },
};
const reactRoot = createRoot(document.getElementById("attendance-reminder-fixture"));
let generation = 0;
function render(account = state.account, remount = false) {
  state.account = account;
  if (remount) generation++;
  const user = { id: account, role: "santri", roles: ["santri"], email: account + "@example.test", full_name: "Fixture " + account, status: "active", member_type: "santri" };
  flushSync(() => reactRoot.render(React.createElement(IdentityProvider, { initialUser: user, key: generation }, React.createElement(ProfileSettingsPage))));
}
window.__attendanceReminderUI = {
  snapshot: () => clone({ calls: state.calls, values: state.values, pending: Array.from(state.pending.keys()) }),
  queue: (name, outcome) => { (state.queues[name] ||= []).push(clone(outcome)); },
  settle: (id, value, reject = false) => {
    const pending = state.pending.get(id);
    if (!pending) throw new Error("No pending request: " + id);
    state.pending.delete(id);
    reject ? pending.reject(new Error(String(value))) : pending.resolve(clone(value));
  },
  render,
};
render();
`;
const boundaryModules: Record<string, string> = {
  "@/modules/notifications/actions": `
    export const getAttendanceReminderPreferenceAction = () => window.__attendanceReminderBoundaries.load();
    export const updateAttendanceReminderPreferenceAction = enabled => window.__attendanceReminderBoundaries.save(enabled);`,
  "@/modules/iam/actions": `
    const unexpected = () => { throw new Error("Unrelated IAM action invoked"); };
    export const updateProfileAction = unexpected;
    export const uploadAvatarAction = unexpected;
    export const deleteAvatarAction = unexpected;
    export const changePasswordAction = unexpected;
    export const listMfaFactorsAction = async () => [];
    export const enrollMfaAction = unexpected;
    export const verifyMfaAction = unexpected;
    export const unenrollMfaAction = unexpected;
    export const getCurrentUserAction = unexpected;`,
  "@/modules/people/actions": `
    export const getPersonalBioAction = async () => ({ success: true, bio: "" });
    export const updatePersonalBioAction = async () => ({ success: true, message: "Bio profil berhasil diperbarui." });`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
};
const boundaries: Plugin = {
  name: "attendance-reminder-action-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/modules\/|next\/)/ }, args => boundaryModules[args.path] ? { path: args.path, namespace: "preference-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "preference-boundary" }, args => ({ contents: boundaryModules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: fixtureSource, resolveDir: root, sourcefile: "attendance-reminder-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const required of ["src/app/(app)/settings/profile/page.tsx", "src/components/auth/identity-context.tsx", "src/components/ui/loading-spinner.tsx"]) {
    expect(inputs.some(input => input.endsWith(required)), `Actual ${required}`).toBe(true);
  }
  expect(inputs.some(input => /src\/lib\/supabase\/|src\/modules\/.*\/actions\.ts/.test(input))).toBe(false);
  bundle = result.outputFiles[0].text;
});
test.afterEach(async ({ page }) => {
  expect(guardedRequests.get(page) || [], "No provider writes or server-action requests").toEqual([]);
});
async function mount(page: Page, config: Config = {}) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const blocked: string[] = [];
  guardedRequests.set(page, blocked);
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
    window.__attendanceReminderConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "attendance-reminder-fixture";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const panel = (page: Page) => page.getByRole("region", { name: "Pengingat Presensi", exact: true });
const toggle = (page: Page) => panel(page).getByRole("switch", { name: "Aktifkan pengingat presensi" });
const clickToggle = (page: Page) => panel(page).getByText("Aktifkan pengingat presensi", { exact: true }).click();
const snapshot = (page: Page) => page.evaluate(() => window.__attendanceReminderUI.snapshot());

test.describe("OPS-12 attendance preference — actual page, mocked persistence", () => {
  test("waits for loaded state, locks saving, and reloads saved off/on values", async ({ page }) => {
    await mount(page, { queues: { load: [{ kind: "defer", id: "initial" }], save: [{ kind: "defer", id: "saving" }] } });
    await expect(panel(page).getByRole("status")).toContainText("Memuat");
    await expect(toggle(page)).toHaveCount(0);
    await page.evaluate(() => window.__attendanceReminderUI.settle("initial", { success: true, enabled: true, message: "Loaded" }));
    await expect(toggle(page)).toBeChecked();
    await clickToggle(page);
    await expect(toggle(page)).toBeDisabled();
    await expect(toggle(page)).toBeChecked(); // Last saved value, not optimistic success.
    await expect(panel(page).getByRole("status")).toContainText("Menyimpan");
    await panel(page).getByText("Aktifkan pengingat presensi", { exact: true }).click({ force: true });
    expect((await snapshot(page)).calls.filter(call => call.name === "save")).toHaveLength(1);
    await page.evaluate(() => window.__attendanceReminderUI.settle("saving", { success: true, enabled: false, message: "Pengaturan pengingat presensi disimpan." }));
    await expect(toggle(page)).not.toBeChecked();
    await expect(toggle(page)).toBeEnabled();
    await expect(panel(page).getByRole("status")).toHaveText("Pengaturan pengingat presensi disimpan.");
    await page.evaluate(() => window.__attendanceReminderUI.render("caller", true));
    await expect(toggle(page)).not.toBeChecked();
    await toggle(page).focus();
    await page.keyboard.press("Space");
    await expect(toggle(page)).toBeChecked();
    await page.evaluate(() => window.__attendanceReminderUI.render("caller", true));
    await expect(toggle(page)).toBeChecked();
    const state = await snapshot(page);
    expect(state.values).toEqual({ caller: true, other: false });
    expect(state.calls.filter(call => call.name === "save").map(call => call.args)).toEqual([[false], [true]]);
    expect(state.calls.filter(call => call.name === "load").every(call => call.args.length === 0)).toBe(true);
    await expect(panel(page)).toContainText("Pengingat laporan dan notifikasi lainnya tidak berubah.");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("reminder-mobile.png"), fullPage: true });
  });

  for (const kind of ["resolve", "reject"] as const) {
    test(`load ${kind} failure offers retry without a fake switch`, async ({ page }) => {
      const outcome: Outcome = kind === "resolve" ? { kind, value: { success: false, message: "Tidak dapat memuat preferensi." } } : { kind, message: "Transport failed" };
      await mount(page, { values: { caller: false }, queues: { load: [outcome] } });
      await expect(panel(page).getByRole("alert")).toBeVisible();
      await expect(toggle(page)).toHaveCount(0);
      await panel(page).getByRole("button", { name: "Coba lagi" }).click();
      await expect(toggle(page)).not.toBeChecked();
      await expect(panel(page).getByRole("alert")).toHaveCount(0);
    });

    test(`save ${kind} failure keeps the saved value and unlocks retry`, async ({ page }) => {
      const outcome: Outcome = kind === "resolve" ? { kind, value: { success: false, message: "Tidak tersimpan." } } : { kind, message: "Transport failed" };
      await mount(page, { queues: { save: [outcome] } });
      await expect(toggle(page)).toBeChecked();
      await clickToggle(page);
      await expect(panel(page).getByRole("alert")).toBeVisible();
      await expect(toggle(page)).toBeChecked();
      await expect(toggle(page)).toBeEnabled();
      expect((await snapshot(page)).values.caller).toBe(true);
      await clickToggle(page);
      await expect(toggle(page)).not.toBeChecked();
      await expect(panel(page).getByRole("alert")).toHaveCount(0);
      await expect(panel(page).getByRole("status")).toContainText("disimpan");
    });
  }

  test("a late read for the previous identity cannot expose its preference to the next account", async ({ page }) => {
    await mount(page, { queues: { load: [{ kind: "defer", id: "old-account" }] } });
    await expect.poll(async () => (await snapshot(page)).pending).toContain("old-account");
    await page.evaluate(() => window.__attendanceReminderUI.render("other"));
    await expect(toggle(page)).not.toBeChecked();
    await page.evaluate(() => window.__attendanceReminderUI.settle("old-account", { success: true, enabled: true, message: "Old account" }));
    await expect(toggle(page)).not.toBeChecked();
    expect((await snapshot(page)).calls.filter(call => call.name === "load").map(call => call.account)).toEqual(["caller", "other"]);
  });

  test("a late save for the previous identity cannot overwrite the next account's control", async ({ page }) => {
    await mount(page, { values: { other: true }, queues: { save: [{ kind: "defer", id: "old-save" }] } });
    await expect(toggle(page)).toBeChecked();
    await clickToggle(page);
    await expect(toggle(page)).toBeDisabled();
    await page.evaluate(() => window.__attendanceReminderUI.render("other"));
    await expect(toggle(page)).toBeEnabled();
    await expect(toggle(page)).toBeChecked();
    await page.evaluate(() => window.__attendanceReminderUI.settle("old-save", { success: true, enabled: false, message: "Old save" }));
    await expect(toggle(page)).toBeChecked();
    await expect(panel(page).getByRole("status")).toHaveCount(0);
    expect((await snapshot(page)).values).toEqual({ caller: false, other: true });
  });
});
