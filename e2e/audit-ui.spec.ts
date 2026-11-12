import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

/**
 * Component/browser integration, NOT authenticated production/database E2E.
 * esbuild compiles the real UI, safe-url utility, UI primitives, and realtime hook.
 * Only server actions, Supabase/provider boundaries, and Next browser adapters are
 * mocked. /login supplies the running application's stylesheet and local assets.
 * No seeded users, credentials, server actions over HTTP, or provider requests.
 */
type Item = {
  id: string; type: string; title: string; body: string; url: string;
  createdAt: string; isRead: boolean;
};
type Outcome =
  | { kind: "resolve"; value: unknown }
  | { kind: "reject"; message: string }
  | { kind: "defer"; id: string };
type Config = {
  mode?: "inbox" | "identity" | "backup" | "cron" | "dual" | "beranda";
  props?: Record<string, unknown>;
  data?: Record<string, Item[]>;
  queues?: Record<string, Outcome[]>;
  user?: Record<string, unknown> | null;
  runs?: Record<string, unknown>[];
  schedules?: Record<string, unknown>[];
  realtimeUnavailable?: boolean;
};
type Snapshot = {
  calls: { name: string; args: unknown[]; account: string }[];
  navigation: { kind: string; target?: string }[];
  channels: { name: string; removed: boolean; bindings: { type: string; filter: Record<string, string> }[] }[];
  listeners: Record<string, number>;
  pending: string[];
};
type AuditUI = {
  snapshot(): Snapshot;
  queue(name: string, outcome: Outcome): void;
  setData(account: string, items: Item[]): void;
  settle(id: string, value: unknown, reject?: boolean): void;
  emit(account: string, event: "INSERT" | "UPDATE", row?: Record<string, unknown>): void;
  status(account: string, status: string): void;
  render(mode: NonNullable<Config["mode"]>, props?: Record<string, unknown>, remount?: boolean): void;
  unmount(): void;
  flush(): Promise<void>;
};
declare global {
  interface Window { __auditUI: AuditUI; __auditConfig: Config }
}

const root = path.resolve(__dirname, "..");
let bundle: string;
const guardedRequests = new WeakMap<Page, string[]>();

test.afterEach(async ({ page }) => {
  expect(guardedRequests.get(page) || [], "No real provider/server-action requests throughout the test").toEqual([]);
});

// In-memory fixture: no generated source/bundle is written to the application.
const fixtureSource = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { NotificationInbox } from "@/components/notifications/notification-inbox";
import { AccountStateScreen } from "@/components/auth/account-state-screen";
import AdminBackupPage from "@/app/(app)/admin/backup/page";
import AdminCronPage from "@/app/(app)/admin/cron/page";
import BerandaPage from "@/app/(app)/page";

const config = window.__auditConfig;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const state = {
  data: clone(config.data || {}), queues: clone(config.queues || {}),
  user: config.user === undefined ? { id: "admin", role: "super_admin" } : config.user,
  runs: clone(config.runs || []), schedules: clone(config.schedules || []), calls: [], navigation: [], channels: [],
  account: "account-a", pending: new Map(), listeners: new Map(),
};
const watched = ["focus", "online", "notifications:changed"];
const originalAdd = window.addEventListener.bind(window);
const originalRemove = window.removeEventListener.bind(window);
window.addEventListener = (type, callback, options) => {
  if (watched.includes(type)) {
    if (!state.listeners.has(type)) state.listeners.set(type, new Set());
    state.listeners.get(type).add(callback);
  }
  originalAdd(type, callback, options);
};
window.removeEventListener = (type, callback, options) => {
  if (watched.includes(type)) state.listeners.get(type)?.delete(callback);
  originalRemove(type, callback, options);
};
async function call(name, args, fallback) {
  const account = state.account;
  state.calls.push({ name, args, account });
  const outcome = state.queues[name]?.shift();
  if (!outcome) return clone(fallback);
  if (outcome.kind === "reject") throw new Error(outcome.message);
  if (outcome.kind === "defer") return new Promise((resolve, reject) => {
    if (state.pending.has(outcome.id)) throw new Error("Duplicate deferred id");
    state.pending.set(outcome.id, { resolve, reject });
  });
  return clone(outcome.value);
}
window.__auditBoundaries = {
  fetch: () => call("fetch", [], state.data[state.account] || []),
  read: async id => {
    const account = state.account;
    const result = await call("read", [id], { success: true, message: "saved" });
    if (result.success) state.data[account] = (state.data[account] || []).map(item => item.id === id ? { ...item, isRead: true } : item);
    return result;
  },
  all: async () => {
    const account = state.account;
    const result = await call("all", [], { success: true, message: "saved" });
    if (result.success) state.data[account] = (state.data[account] || []).map(item => ({ ...item, isRead: true }));
    return result;
  },
  currentUser: () => call("currentUser", [], state.user),
  runs: () => call("runs", [], state.runs),
  manifest: type => call("manifest", [type], { success: true, message: "Manifest dicatat; backup belum terverifikasi." }),
  schedules: () => call("schedules", [], state.schedules),
  saveSchedule: (key, input) => call("saveSchedule", [key, input], { success: true, message: "Jadwal disimpan. Perubahan berlaku pada tick berikutnya (maksimal ±15 menit)." }),
  checkIn: () => call("checkIn", [], { success: true, message: "Presensi berhasil dicatat: Tepat Waktu (07:00 WIB).", classification: "on_time", timeStr: "07:00 WIB", alreadyCheckedIn: false }),
  policy: () => call("policy", [], null),
  events: () => call("events", [], []),
  announcements: () => call("announcements", [], []),
  adminStats: () => call("adminStats", [], null),
  updatePolicy: input => call("updatePolicy", [input], { success: true, message: "Kebijakan diperbarui." }),
  pushCleanup: () => call("pushCleanup", [], undefined),
  router: {
    push: target => state.navigation.push({ kind: "push", target }),
    replace: target => state.navigation.push({ kind: "replace", target }),
    refresh: () => state.navigation.push({ kind: "refresh" }),
  },
  client: () => ({
    auth: { signOut: () => call("signOut", [], { error: null }) },
    channel: name => {
      if (config.realtimeUnavailable) throw new Error("mock realtime unavailable");
      const channel = { name, removed: false, bindings: [], subscriber: null };
      channel.on = (type, filter, callback) => { channel.bindings.push({ type, filter, callback }); return channel; };
      channel.subscribe = callback => { channel.subscriber = callback; state.channels.push(channel); return channel; };
      return channel;
    },
    removeChannel: channel => { channel.removed = true; state.calls.push({ name: "removeChannel", args: [channel.name], account: state.account }); return Promise.resolve("ok"); },
  }),
};
const host = document.getElementById("audit-ui-root");
let reactRoot = createRoot(host);
let generation = 0;
function render(mode, props = {}, remount = false) {
  if (remount) generation++;
  state.account = props.userId || "account-a";
  let component;
  if (mode === "identity") component = React.createElement(AccountStateScreen, { ...props, key: generation });
  else if (mode === "backup") component = React.createElement(AdminBackupPage, { key: generation });
  else if (mode === "cron") component = React.createElement(AdminCronPage, { key: generation });
  else if (mode === "beranda") component = React.createElement(BerandaPage, { key: generation });
  else if (mode === "dual") component = React.createElement(React.Fragment, null,
    React.createElement("section", { "aria-label": "First inbox" }, React.createElement(NotificationInbox, { userId: "account-a" })),
    React.createElement("section", { "aria-label": "Second inbox" }, React.createElement(NotificationInbox, { userId: "account-a" })));
  else component = React.createElement(NotificationInbox, { userId: state.account, key: generation });
  flushSync(() => reactRoot.render(component));
}
window.__auditUI = {
  snapshot: () => clone({
    calls: state.calls, navigation: state.navigation,
    channels: state.channels.map(channel => ({ name: channel.name, removed: channel.removed, bindings: channel.bindings.map(({ type, filter }) => ({ type, filter })) })),
    listeners: Object.fromEntries(watched.map(type => [type, state.listeners.get(type)?.size || 0])),
    pending: Array.from(state.pending.keys()),
  }),
  queue: (name, outcome) => { (state.queues[name] ||= []).push(clone(outcome)); },
  setData: (account, items) => { state.data[account] = clone(items); },
  settle: (id, value, reject = false) => {
    const pending = state.pending.get(id);
    if (!pending) throw new Error("No pending request: " + id);
    state.pending.delete(id);
    reject ? pending.reject(new Error(String(value))) : pending.resolve(clone(value));
  },
  emit: (account, event, row = {}) => {
    for (const channel of state.channels.filter(channel => !channel.removed)) {
      for (const binding of channel.bindings) {
        if (binding.type === "postgres_changes" && binding.filter.filter === "user_id=eq." + account && (binding.filter.event === "*" || binding.filter.event === event)) {
          binding.callback({ eventType: event, schema: "public", table: "notifications", new: row, old: {} });
        }
      }
    }
  },
  status: (account, status) => {
    for (const channel of state.channels.filter(channel => !channel.removed && channel.bindings.some(binding => binding.filter.filter === "user_id=eq." + account))) channel.subscriber?.(status);
  },
  render,
  unmount: () => { flushSync(() => reactRoot.unmount()); },
  flush: async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); await new Promise(resolve => requestAnimationFrame(resolve)); },
};
render(config.mode || "inbox", config.props);
`;

const boundaryModules: Record<string, string> = {
  "@/modules/notifications/actions": `
    export const getNotificationsAction = (...args) => window.__auditBoundaries.fetch(...args);
    export const markNotificationReadAction = (...args) => window.__auditBoundaries.read(...args);
    export const markAllNotificationsReadAction = (...args) => window.__auditBoundaries.all(...args);`,
  "@/modules/operations/actions": `
    export const getBackupRunsAction = (...args) => window.__auditBoundaries.runs(...args);
    export const createBackupManifestAction = (...args) => window.__auditBoundaries.manifest(...args);`,
  "@/modules/cron/actions": `
    export const getCronJobSchedulesAction = (...args) => window.__auditBoundaries.schedules(...args);
    export const updateCronJobScheduleAction = (...args) => window.__auditBoundaries.saveSchedule(...args);`,
  "@/modules/iam/actions": `export const getCurrentUserAction = () => window.__auditBoundaries.currentUser();`,
  "@/modules/attendance/actions": `
    export const checkInAttendanceAction = (...args) => window.__auditBoundaries.checkIn(...args);`,
  "@/modules/analytics/actions": `
    export const getActivePolicyAction = (...args) => window.__auditBoundaries.policy(...args);
    export const updatePolicySettingsAction = (...args) => window.__auditBoundaries.updatePolicy(...args);
    export const getAdminDashboardStatsAction = (...args) => window.__auditBoundaries.adminStats(...args);`,
  "@/modules/schedules/actions": `
    export const getEventsAction = (...args) => window.__auditBoundaries.events(...args);
    export const getAnnouncementsAction = (...args) => window.__auditBoundaries.announcements(...args);`,
  "@/lib/supabase/client": `export const createClient = () => window.__auditBoundaries.client();`,
  "@/lib/notifications": `export const cleanupPushNotifications = () => window.__auditBoundaries.pushCleanup();`,
  "next/navigation": `export const useRouter = () => window.__auditBoundaries.router;`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
  "next/link": `import React from "react"; export default function Link({ children, ...props }) { return React.createElement("a", props, children); }`,
};

const boundaries: Plugin = {
  name: "audit-ui-external-boundaries-only",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => {
      if (boundaryModules[args.path]) return { path: args.path, namespace: "audit-boundary" };
      // Crucially, use-notification-changes.ts and all component imports resolve
      // to their real files. No hook, component, or safe-url substitute exists.
      return undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "audit-boundary" }, args => ({
      contents: boundaryModules[args.path], loader: "js", resolveDir: root,
    }));
  },
};

test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: fixtureSource, resolveDir: root, sourcefile: "audit-ui-browser-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife",
    jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const required of [
    "src/components/notifications/notification-inbox.tsx",
    "src/components/notifications/use-notification-changes.ts",
    "src/components/auth/account-state-screen.tsx",
    "src/app/(app)/admin/backup/page.tsx",
    "src/app/(app)/admin/cron/page.tsx",
    "src/app/(app)/page.tsx",
    "src/lib/safe-url.ts",
  ]) expect(inputs.some(input => input.endsWith(required)), `Bundled actual ${required}`).toBe(true);
  expect(inputs.some(input => /src\/lib\/supabase\/|src\/modules\/.*\/actions\.ts/.test(input))).toBe(false);
  bundle = result.outputFiles[0].text;
});

function notification(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id, type: "task_assigned", title: `Notification ${id}`, body: `Body ${id}`,
    url: "/tugas/task-1?source=inbox#details", createdAt: "2026-11-05T10:00:00.000Z", isRead: false,
    ...overrides,
  };
}
const resolved = (value: unknown): Outcome => ({ kind: "resolve", value });
const rejected = (message = "controlled dependency failure"): Outcome => ({ kind: "reject", message });
const deferred = (id: string): Outcome => ({ kind: "defer", id });
const saved = { success: true, message: "saved" };
const failed = { success: false, message: "not saved" };
const itemButton = (page: Page, id = "one") => page.locator("#audit-ui-root").getByRole("button", { name: new RegExp(`Notification ${id}`) });
const unread = (page: Page) => page.locator('#audit-ui-root [aria-label="Belum dibaca"]');
const snapshot = (page: Page) => page.evaluate(() => window.__auditUI.snapshot());
const flush = (page: Page) => page.evaluate(() => window.__auditUI.flush());
const callCount = async (page: Page, name: string) => (await snapshot(page)).calls.filter(call => call.name === name).length;

async function mount(page: Page, config: Config = {}) {
  const base = test.info().project.use.baseURL!;
  const origin = new URL(base).origin;
  const forbiddenRequests: string[] = [];
  guardedRequests.set(page, forbiddenRequests);
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    // Next's dev overlay symbolicates the deliberately caught console errors
    // through this local diagnostic POST. Abort it too, but do not mislabel it
    // as a production server action/provider request.
    if (url.origin === origin && url.pathname === "/__nextjs_original-stack-frames") {
      await route.abort();
      return;
    }
    if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) {
      forbiddenRequests.push(`${request.method()} ${request.url()}`);
      await route.abort();
    } else await route.continue();
  });
  // Real page and hydration first: preserve <head>, stylesheet links, fonts, and
  // public assets. Never submit the real login form or perform a server action.
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await page.evaluate(config => {
    window.__auditConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "audit-ui-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
  await flush(page);
  expect(forbiddenRequests, "No real provider/server-action requests during fixture bootstrap").toEqual([]);
  return forbiddenRequests;
}

async function mountInbox(page: Page, queues: Config["queues"] = {}, items = [notification("one"), notification("two")]) {
  return mount(page, { data: { "account-a": items }, queues });
}

test.describe("audit UI — actual components, mocked external dependencies (not production DB E2E)", () => {
  test("initial inbox fetch failure renders real ErrorState and retry restores data with app CSS", async ({ page }) => {
    const blocked = await mountInbox(page, { fetch: [rejected()] });
    await expect(page.getByRole("heading", { name: "Notifikasi Gagal Dimuat" })).toBeVisible();
    await expect(page.getByText("Belum ada notifikasi baru.")).toHaveCount(0);
    await expect(page.locator("#audit-ui-root > div")).toHaveCSS("max-width", "896px");
    await expect.poll(() => page.locator("#audit-ui-root img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.getByRole("button", { name: "Muat Ulang Halaman" }).click();
    await expect(itemButton(page)).toBeVisible();
    await expect(unread(page)).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Notifikasi Gagal Dimuat" })).toHaveCount(0);
    expect(await callCount(page, "fetch")).toBe(2);
    expect(blocked).toEqual([]);
  });

  test("read stays unread while pending, then marks only after successful action and pushes safe internal target", async ({ page }) => {
    await mountInbox(page, { read: [deferred("read-one")] });
    await expect(unread(page)).toHaveCount(2);
    await itemButton(page).click();
    await expect.poll(async () => (await snapshot(page)).pending).toContain("read-one");
    await expect(itemButton(page).locator('[aria-label="Belum dibaca"]')).toHaveCount(1);
    expect((await snapshot(page)).navigation).toEqual([]);
    await page.evaluate(result => window.__auditUI.settle("read-one", result), saved);
    await expect(itemButton(page).locator('[aria-label="Belum dibaca"]')).toHaveCount(0);
    await expect(itemButton(page, "two").locator('[aria-label="Belum dibaca"]')).toHaveCount(1);
    await expect.poll(async () => (await snapshot(page)).navigation).toEqual([{ kind: "push", target: "/tugas/task-1?source=inbox#details" }]);
    expect((await snapshot(page)).calls.filter(call => call.name === "read").map(call => call.args)).toEqual([["one"]]);
    expect(await callCount(page, "fetch")).toBe(2); // Actual hook handles notifications:changed.
    await itemButton(page).click();
    await flush(page);
    expect(await callCount(page, "read")).toBe(1); // Already-read item does not write again.
    await expect(page).toHaveURL(/\/login$/); // Router boundary is mocked, not real routing.
  });

  test("read rejection displays error and retains unread", async ({ page }) => {
    await mountInbox(page, { read: [rejected("read failed")] });
    await itemButton(page).click();
    await expect(page.getByRole("alert")).toHaveText("Status baca belum tersimpan. Coba lagi nanti.");
    await expect(unread(page)).toHaveCount(2);
    expect(await callCount(page, "read")).toBe(1);
  });

  test("false read result does not optimistically mark read and refetches authoritative data", async ({ page }) => {
    await mountInbox(page, { read: [resolved(failed)] });
    await itemButton(page).click();
    await expect.poll(() => callCount(page, "fetch")).toBe(2);
    await flush(page);
    await expect(unread(page)).toHaveCount(2);
  });

  for (const url of ["https://evil.invalid/phish", "//evil.invalid/phish", "javascript:window.__unsafeExecuted=true", "/\\evil.invalid/phish", "/notifikasi"]) {
    test(`unsafe/self deep link never navigates: ${url}`, async ({ page }) => {
      await mountInbox(page, {}, [notification("one", { url })]);
      await itemButton(page).click();
      await expect(unread(page)).toHaveCount(0);
      await flush(page);
      expect((await snapshot(page)).navigation).toEqual([]);
      expect(await page.evaluate(() => Object.hasOwn(window, "__unsafeExecuted"))).toBe(false);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  for (const outcome of [rejected("mark all failed"), resolved(failed)]) {
    test(`mark all ${outcome.kind === "reject" ? "throws" : "returns false"}: keeps unread and retry succeeds only after pending result`, async ({ page }) => {
      await mountInbox(page, { all: [outcome, deferred("all-success")] });
      const all = page.getByRole("button", { name: "Tandai semua dibaca" });
      await all.click();
      await expect(page.getByRole("alert")).toHaveText("Gagal menandai semua notifikasi. Coba lagi nanti.");
      await expect(unread(page)).toHaveCount(2);
      await expect(all).toBeEnabled();
      await all.click();
      await expect.poll(async () => (await snapshot(page)).pending).toContain("all-success");
      await expect(all).toBeDisabled();
      await expect(unread(page)).toHaveCount(2);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.evaluate(value => window.__auditUI.settle("all-success", value), saved);
      await expect(unread(page)).toHaveCount(0);
      await expect(all).toHaveCount(0);
      expect(await callCount(page, "all")).toBe(2);
      await expect.poll(() => callCount(page, "fetch")).toBe(2);
    });
  }

  test("realtime INSERT/UPDATE, focus, online, local change and reconnect refetch real inbox; unmount cleans channels/listeners", async ({ page }) => {
    await mountInbox(page, {}, [notification("one")]);
    await expect(itemButton(page)).toBeVisible();
    const initial = await snapshot(page);
    expect(initial.channels).toHaveLength(1);
    expect(initial.channels[0].bindings).toEqual([{ type: "postgres_changes", filter: { event: "*", schema: "public", table: "notifications", filter: "user_id=eq.account-a" } }]);
    expect(initial.listeners).toEqual({ focus: 1, online: 1, "notifications:changed": 1 });

    const signals = ["SUBSCRIBED", "INSERT", "UPDATE", "focus", "online", "notifications:changed", "RECONNECT"];
    for (let index = 0; index < signals.length; index++) {
      const signal = signals[index];
      const next = notification(`signal-${index}`, { isRead: signal === "UPDATE" });
      const before = await callCount(page, "fetch");
      await page.evaluate(({ signal, next }) => {
        window.__auditUI.setData("account-a", [next]);
        if (signal === "INSERT" || signal === "UPDATE") window.__auditUI.emit("account-a", signal, { id: next.id, read_at: next.isRead ? "now" : null });
        else if (signal === "SUBSCRIBED") window.__auditUI.status("account-a", signal);
        else if (signal === "RECONNECT") {
          window.__auditUI.status("account-a", "CHANNEL_ERROR");
          window.__auditUI.status("account-a", "TIMED_OUT");
          window.__auditUI.status("account-a", "CLOSED");
          window.__auditUI.status("account-a", "SUBSCRIBED");
        } else window.dispatchEvent(new Event(signal));
      }, { signal, next });
      await expect(itemButton(page, next.id)).toBeVisible();
      await expect(unread(page)).toHaveCount(next.isRead ? 0 : 1);
      expect(await callCount(page, "fetch"), `one refetch for ${signal}`).toBe(before + 1);
    }
    await page.evaluate(() => window.__auditUI.emit("other-account", "INSERT"));
    await flush(page);
    const beforeCleanup = await callCount(page, "fetch");
    expect(beforeCleanup).toBe(initial.calls.filter(call => call.name === "fetch").length + signals.length);
    await page.evaluate(() => window.__auditUI.unmount());
    expect((await snapshot(page)).listeners).toEqual({ focus: 0, online: 0, "notifications:changed": 0 });
    expect((await snapshot(page)).channels.every(channel => channel.removed)).toBe(true);
    expect(await callCount(page, "removeChannel")).toBe(1);
    await page.evaluate(() => {
      for (const type of ["focus", "online", "notifications:changed"]) window.dispatchEvent(new Event(type));
      window.__auditUI.emit("account-a", "INSERT");
      window.__auditUI.status("account-a", "SUBSCRIBED");
    });
    await flush(page);
    expect(await callCount(page, "fetch")).toBe(beforeCleanup);
    await expect(page.locator("#audit-ui-root")).toBeEmpty();
  });

  test("failed background refetch retains last items with retry, rather than showing empty success", async ({ page }) => {
    await mountInbox(page);
    await expect(itemButton(page)).toBeVisible();
    await page.evaluate(outcome => {
      window.__auditUI.queue("fetch", outcome);
      window.dispatchEvent(new Event("online"));
    }, rejected());
    await expect(page.getByRole("status")).toContainText("Pembaruan notifikasi gagal; data terakhir masih ditampilkan.");
    await expect(unread(page)).toHaveCount(2);
    await page.evaluate(items => window.__auditUI.setData("account-a", items), [notification("fresh")]);
    await page.getByRole("button", { name: "Coba lagi", exact: true }).click();
    await expect(itemButton(page, "fresh")).toBeVisible();
    await expect(itemButton(page)).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("latest fetch wins over stale pending fetch, including stale failure", async ({ page }) => {
    await mountInbox(page, { fetch: [deferred("old-fetch")] });
    await expect(page.getByText("Memuat notifikasi...")).toBeVisible();
    await page.evaluate(items => {
      window.__auditUI.setData("account-a", items);
      window.dispatchEvent(new Event("focus"));
    }, [notification("latest")]);
    await expect(itemButton(page, "latest")).toBeVisible();
    await page.evaluate(() => window.__auditUI.settle("old-fetch", "late error", true));
    await flush(page);
    await expect(itemButton(page, "latest")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notifikasi Gagal Dimuat" })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("successful read is not reverted by an older pending unread fetch", async ({ page }) => {
    await mountInbox(page);
    await expect(itemButton(page)).toBeVisible();
    await page.evaluate(outcome => {
      window.__auditUI.queue("fetch", outcome);
      window.dispatchEvent(new Event("focus"));
    }, deferred("stale-unread"));
    await expect.poll(async () => (await snapshot(page)).pending).toContain("stale-unread");
    await itemButton(page).click();
    await expect(itemButton(page).locator('[aria-label="Belum dibaca"]')).toHaveCount(0);
    await page.evaluate(items => window.__auditUI.settle("stale-unread", items), [notification("one"), notification("two")]);
    await flush(page);
    await expect(itemButton(page).locator('[aria-label="Belum dibaca"]')).toHaveCount(0);
    await expect(unread(page)).toHaveCount(1);
  });

  test("account remount isolates data and old pending fetch; previous channel/listeners are removed", async ({ page }) => {
    await mount(page, {
      data: { "account-a": [notification("old-account")], "account-b": [notification("new-account")] },
    });
    await expect(itemButton(page, "old-account")).toBeVisible();
    await page.evaluate(({ oldRequest, newRequest }) => {
      window.__auditUI.queue("fetch", oldRequest);
      window.dispatchEvent(new Event("focus"));
      window.__auditUI.queue("fetch", newRequest);
    }, { oldRequest: deferred("account-a-pending"), newRequest: deferred("account-b-pending") });
    await expect.poll(async () => (await snapshot(page)).pending).toContain("account-a-pending");
    await page.evaluate(() => window.__auditUI.render("inbox", { userId: "account-b" }, true));
    await expect(page.getByText("Memuat notifikasi...")).toBeVisible();
    await expect(itemButton(page, "old-account")).toHaveCount(0);
    await expect.poll(async () => (await snapshot(page)).pending).toContain("account-b-pending");
    await page.evaluate(items => window.__auditUI.settle("account-b-pending", items), [notification("new-account")]);
    await expect(itemButton(page, "new-account")).toBeVisible();
    await page.evaluate(items => window.__auditUI.settle("account-a-pending", items), [notification("old-account")]);
    await flush(page);
    await expect(itemButton(page, "old-account")).toHaveCount(0);
    await expect(itemButton(page, "new-account")).toBeVisible();
    let state = await snapshot(page);
    expect(state.channels).toHaveLength(2);
    expect(state.channels[0].removed).toBe(true);
    expect(state.channels[1].bindings[0].filter.filter).toBe("user_id=eq.account-b");
    expect(state.listeners).toEqual({ focus: 1, online: 1, "notifications:changed": 1 });
    const before = await callCount(page, "fetch");
    await page.evaluate(() => {
      window.__auditUI.emit("account-a", "INSERT");
      window.__auditUI.status("account-a", "SUBSCRIBED");
    });
    await flush(page);
    expect(await callCount(page, "fetch")).toBe(before);
    await page.evaluate(items => {
      window.__auditUI.setData("account-b", items);
      window.__auditUI.emit("account-b", "UPDATE");
    }, [notification("new-account-updated", { isRead: true })]);
    await expect(itemButton(page, "new-account-updated")).toBeVisible();
    await expect(unread(page)).toHaveCount(0);
    await page.evaluate(() => window.__auditUI.unmount());
    state = await snapshot(page);
    expect(state.channels.every(channel => channel.removed)).toBe(true);
    expect(state.listeners).toEqual({ focus: 0, online: 0, "notifications:changed": 0 });
  });

  test("two real hook instances use distinct channels and both clean up", async ({ page }) => {
    await mount(page, { mode: "dual", data: { "account-a": [notification("one")] } });
    await expect(page.getByRole("region", { name: "First inbox" }).getByText("Notification one")).toBeVisible();
    await expect(page.getByRole("region", { name: "Second inbox" }).getByText("Notification one")).toBeVisible();
    const state = await snapshot(page);
    expect(state.channels).toHaveLength(2);
    expect(new Set(state.channels.map(channel => channel.name)).size).toBe(2);
    expect(state.listeners).toEqual({ focus: 2, online: 2, "notifications:changed": 2 });
    await page.evaluate(items => {
      window.__auditUI.setData("account-a", items);
      window.__auditUI.emit("account-a", "INSERT");
    }, [notification("shared-insert")]);
    await expect(page.getByText("Notification shared-insert", { exact: true })).toHaveCount(2);
    await page.evaluate(() => window.__auditUI.unmount());
    expect((await snapshot(page)).channels.every(channel => channel.removed)).toBe(true);
    expect((await snapshot(page)).listeners).toEqual({ focus: 0, online: 0, "notifications:changed": 0 });
    expect(await callCount(page, "removeChannel")).toBe(2);
  });

  test("realtime creation failure still permits focus/online refresh and listener cleanup", async ({ page }) => {
    await mount(page, { realtimeUnavailable: true, data: { "account-a": [notification("one")] } });
    await expect(itemButton(page)).toBeVisible();
    for (const event of ["focus", "online"]) {
      await page.evaluate(({ event, items }) => {
        window.__auditUI.setData("account-a", items);
        window.dispatchEvent(new Event(event));
      }, { event, items: [notification(event)] });
      await expect(itemButton(page, event)).toBeVisible();
    }
    expect((await snapshot(page)).channels).toEqual([]);
    await page.evaluate(() => window.__auditUI.unmount());
    expect((await snapshot(page)).listeners).toEqual({ focus: 0, online: 0, "notifications:changed": 0 });
  });

  test("role_missing explains missing role, retry refreshes without logout, logout error is recoverable", async ({ page }) => {
    const blocked = await mount(page, {
      mode: "identity", props: { kind: "role_missing", email: "roleless@example.invalid" },
      queues: { signOut: [resolved({ error: { message: "controlled signOut action error" } }), deferred("logout-success")] },
    });
    await expect(page.getByRole("heading", { name: "Peran Akun Belum Ditetapkan" })).toBeVisible();
    await expect(page.getByText("Administrator perlu menetapkan peran", { exact: false })).toBeVisible();
    await expect(page.getByText("Masuk sebagai roleless@example.invalid")).toBeVisible();
    await page.getByRole("button", { name: "Coba Lagi" }).click();
    expect((await snapshot(page)).navigation).toEqual([{ kind: "refresh" }]);
    expect(await callCount(page, "signOut")).toBe(0);
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page.getByRole("alert")).toHaveText("Gagal keluar dari akun. Silakan coba lagi.");
    await expect(page.getByRole("button", { name: "Keluar" })).toBeEnabled();
    expect((await snapshot(page)).navigation).toEqual([{ kind: "refresh" }]);
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect.poll(async () => (await snapshot(page)).pending).toContain("logout-success");
    // The real shared Button changes its accessible name while isLoading.
    await expect(page.getByRole("button", { name: "Memproses..." })).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.evaluate(() => window.__auditUI.settle("logout-success", { error: null }));
    await expect.poll(async () => (await snapshot(page)).navigation).toEqual([{ kind: "refresh" }, { kind: "replace", target: "/login" }, { kind: "refresh" }]);
    expect((await snapshot(page)).calls.filter(call => ["pushCleanup", "signOut"].includes(call.name)).map(call => call.name)).toEqual(["pushCleanup", "signOut", "pushCleanup", "signOut"]);
    expect(blocked).toEqual([]);
  });

  test("identity_error shows trace and safe-session explanation, retry never signs out", async ({ page }) => {
    await mount(page, { mode: "identity", props: { kind: "identity_error", traceId: "trace-controlled-123" } });
    await expect(page.getByRole("heading", { name: "Identitas Belum Dapat Diverifikasi" })).toBeVisible();
    await expect(page.getByText("Sesi Anda tetap aman", { exact: false })).toBeVisible();
    await expect(page.getByText("Kode pelacakan: trace-controlled-123")).toBeVisible();
    await expect(page.getByText("Masuk sebagai", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: "Coba Lagi" }).click();
    expect((await snapshot(page)).navigation).toEqual([{ kind: "refresh" }]);
    expect(await callCount(page, "signOut")).toBe(0);
    await expect.poll(() => page.locator("#audit-ui-root img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  });

  for (const [status, title, description, retryable] of [
    ["pending", "Akun Menunggu Persetujuan", "sedang ditinjau administrator", true],
    ["approved", "Akun Sedang Diaktifkan", "belum aktif sepenuhnya", true],
    ["rejected", "Permohonan Akun Ditolak", "tidak disetujui", false],
    ["suspended", "Akun Ditangguhkan", "pemulihan akses", false],
    ["deactivated", "Akun Dinonaktifkan", "memerlukan akses kembali", false],
  ] as const) {
    test(`inactive ${status} displays accurate account message and retry policy`, async ({ page }) => {
      await mount(page, { mode: "identity", props: { kind: "inactive", status, email: "inactive@example.invalid" } });
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(page.getByText(description, { exact: false })).toBeVisible();
      await expect(page.getByText("Masuk sebagai inactive@example.invalid")).toBeVisible();
      await expect(page.getByRole("button", { name: "Coba Lagi" })).toHaveCount(retryable ? 1 : 0);
      await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
      if (retryable) {
        await page.getByRole("button", { name: "Coba Lagi" }).click();
        expect((await snapshot(page)).navigation).toEqual([{ kind: "refresh" }]);
      }
    });
  }

  test("logout cleanup rejection displays real error without calling signOut or navigating", async ({ page }) => {
    await mount(page, { mode: "identity", props: { kind: "identity_error", traceId: "logout-test" }, queues: { pushCleanup: [rejected("cleanup failed")] } });
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page.getByRole("alert")).toHaveText("Gagal keluar dari akun. Silakan coba lagi.");
    await expect(page.getByRole("button", { name: "Keluar" })).toBeEnabled();
    expect(await callCount(page, "signOut")).toBe(0);
    expect((await snapshot(page)).navigation).toEqual([]);
  });

  test("backup renders manifest-not-backup warning, honest legacy statuses, no restore/storage controls", async ({ page }) => {
    const blocked = await mount(page, {
      mode: "backup",
      runs: [
        { id: "legacy", run_type: "database", status: "completed", artifact_ref: "Supabase PITR / provider backup", started_at: "2026-11-05T10:00:00Z" },
        { id: "manifest", run_type: "database", status: "manifest_only", artifact_ref: null, started_at: "2026-11-05T10:00:00Z" },
        { id: "verified", run_type: "database", status: "backup_verified", artifact_ref: "provider-reference-123", started_at: "2026-11-05T10:00:00Z" },
      ],
    });
    await expect(page.getByRole("heading", { name: "Manifest database & status backup" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Manifest ini bukan backup.");
    await expect(page.getByRole("note")).toContainText("tidak menyalin database atau file Storage dan tidak menjalankan uji restore");
    await expect(page.getByRole("note")).toContainText("Backup dan pemulihan belum terverifikasi");
    await expect(page.getByText("database · Manifest saja — belum terverifikasi", { exact: true })).toHaveCount(2);
    await expect(page.getByText("database · Backup terverifikasi", { exact: true })).toBeVisible();
    await expect(page.getByText("Referensi artefak: provider-reference-123")).toBeVisible();
    await expect(page.getByText("Supabase PITR / provider backup", { exact: false })).toHaveCount(0);
    await expect(page.locator("#audit-ui-root").getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /restore|storage|pulih/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /restore|storage|pulih/i })).toHaveCount(0);
    await page.getByRole("button", { name: /Catat manifest database/ }).click();
    await expect(page.getByText("Manifest dicatat; backup belum terverifikasi.", { exact: true })).toBeVisible();
    await expect.poll(() => callCount(page, "runs")).toBe(2);
    expect((await snapshot(page)).calls.filter(call => call.name === "manifest").map(call => call.args)).toEqual([["database"]]);
    await expect(page.getByRole("note")).toContainText("Manifest ini bukan backup.");
    expect(blocked).toEqual([]);
  });

  test("backup role guard renders actual UnauthorizedState and exposes no manifest action", async ({ page }) => {
    await mount(page, { mode: "backup", user: { id: "member", role: "santri" } });
    await expect(page.getByRole("heading", { name: "Akses Dibatasi" })).toBeVisible();
    await expect(page.getByText("peran: Super Admin", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Catat manifest database/ })).toHaveCount(0);
    expect(await callCount(page, "manifest")).toBe(0);
  });

  const cronSchedules = [
    { jobKey: "attendance_reminder", label: "Pengingat presensi pagi", timeWib: "07:30", daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true },
    { jobKey: "report_reminder", label: "Pengingat laporan harian", timeWib: "21:00", daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true },
    { jobKey: "backup_manifest", label: "Manifest database harian", timeWib: "00:30", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], enabled: true },
  ];
  const cronSection = (page: Page, label: string) => page.locator("#audit-ui-root section", { hasText: label });

  test("cron page edits time, days and enabled flag, then saves through the real action boundary", async ({ page }) => {
    const blocked = await mount(page, { mode: "cron", schedules: cronSchedules });
    await expect(page.getByRole("heading", { name: "Jadwal otomatis", exact: true })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("setiap ±15 menit");
    await expect(page.locator("#audit-ui-root section")).toHaveCount(3);
    const attendance = cronSection(page, "Pengingat presensi pagi");
    await expect(attendance.locator('input[type="time"]')).toHaveValue("07:30");
    await expect(attendance.getByRole("button", { name: "Min", exact: true })).toHaveAttribute("aria-pressed", "false");
    await attendance.locator('input[type="time"]').fill("08:15");
    await attendance.getByRole("button", { name: "Min", exact: true }).click();
    await expect(attendance.getByRole("button", { name: "Min", exact: true })).toHaveAttribute("aria-pressed", "true");
    await attendance.getByRole("checkbox", { name: "Aktif" }).uncheck();
    await attendance.getByRole("button", { name: "Simpan jadwal" }).click();
    await expect(attendance.getByRole("status")).toContainText("Jadwal disimpan");
    expect((await snapshot(page)).calls.filter(call => call.name === "saveSchedule").map(call => call.args)).toEqual([
      ["attendance_reminder", { timeWib: "08:15", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], enabled: false }],
    ]);
    expect(blocked).toEqual([]);
  });

  test("cron save failure and validation rejection surface alerts without losing the draft", async ({ page }) => {
    await mount(page, {
      mode: "cron", schedules: cronSchedules,
      queues: { saveSchedule: [rejected(), resolved({ success: false, message: "Format jam harus HH:MM, antara 00:00 dan 23:59 WIB." })] },
    });
    const report = cronSection(page, "Pengingat laporan harian");
    await report.locator('input[type="time"]').fill("21:30");
    await report.getByRole("button", { name: "Simpan jadwal" }).click();
    await expect(report.getByRole("alert")).toContainText("Jadwal belum tersimpan");
    await expect(report.locator('input[type="time"]')).toHaveValue("21:30");
    await report.getByRole("button", { name: "Simpan jadwal" }).click();
    await expect(report.getByRole("alert")).toContainText("Format jam harus HH:MM");
    expect(await callCount(page, "saveSchedule")).toBe(2);
  });

  test("cron role guard renders actual UnauthorizedState and never loads schedules", async ({ page }) => {
    await mount(page, { mode: "cron", user: { id: "member", role: "santri" }, schedules: cronSchedules });
    await expect(page.getByRole("heading", { name: "Akses Dibatasi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan jadwal" })).toHaveCount(0);
    expect(await callCount(page, "schedules")).toBe(0);
  });

  test("cron identity failure retries into a working schedule editor", async ({ page }) => {
    await mount(page, { mode: "cron", schedules: cronSchedules, queues: { currentUser: [rejected()] } });
    await expect(page.getByRole("heading", { name: "Identitas Gagal Dimuat" })).toBeVisible();
    expect(await callCount(page, "schedules")).toBe(0);
    await page.getByRole("button", { name: "Muat Ulang Halaman" }).click();
    await expect(page.getByRole("heading", { name: "Jadwal otomatis", exact: true })).toBeVisible();
    expect(await callCount(page, "schedules")).toBe(1);
  });

  test("cron schedule load failure retries without reloading identity", async ({ page }) => {
    await mount(page, { mode: "cron", schedules: cronSchedules, queues: { schedules: [rejected()] } });
    await expect(page.getByRole("heading", { name: "Jadwal Gagal Dimuat" })).toBeVisible();
    await page.getByRole("button", { name: "Muat Ulang Halaman" }).click();
    await expect(page.locator("#audit-ui-root section")).toHaveCount(3);
    expect(await callCount(page, "currentUser")).toBe(1);
    expect(await callCount(page, "schedules")).toBe(2);
  });
});

test.describe("beranda check-in — real page, mocked actions (not production DB E2E)", () => {
  const santri = { id: "santri-1", role: "santri", roles: ["santri"], full_name: "Santri Uji", status: "active" };
  const checkinFailure = {
    success: false,
    message: "Gagal menyimpan presensi ke database: Could not find the function public.attendance_check_in in the schema cache",
    classification: "on_time",
    timeStr: "07:00",
  };
  const checkinSuccess = {
    success: true,
    message: "Presensi berhasil dicatat: Tepat Waktu (07:00 WIB).",
    classification: "on_time",
    timeStr: "07:00 WIB",
    alreadyCheckedIn: false,
  };

  test("failed check-in surfaces the server error instead of dying silently", async ({ page }) => {
    await mount(page, { mode: "beranda", user: santri, queues: { checkIn: [resolved(checkinFailure)] } });
    const button = page.locator("#btn-checkin");
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole("alert")).toContainText("Could not find the function public.attendance_check_in");
    await expect(button).toBeVisible();
    await expect(page.getByText("Berhasil Presensi Hari Ini")).toHaveCount(0);
    expect(await callCount(page, "checkIn")).toBe(1);
  });

  test("retry after failure succeeds and clears the alert", async ({ page }) => {
    await mount(page, {
      mode: "beranda", user: santri,
      queues: { checkIn: [resolved(checkinFailure), resolved(checkinSuccess)] },
    });
    const button = page.locator("#btn-checkin");
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole("alert")).toContainText("Gagal menyimpan presensi");
    await button.click();
    await expect(page.getByText("Berhasil Presensi Hari Ini")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await callCount(page, "checkIn")).toBe(2);
  });
});
