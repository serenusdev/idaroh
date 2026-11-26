import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real KehadiranPage + IdentityProvider; mocked attendance/analytics actions.
// Browser/component evidence for UX-03 (robust correction/exception submit),
// NOT production DB E2E.
type Outcome = { kind: "resolve"; value: unknown } | { kind: "reject"; message: string } | { kind: "defer"; id: string };
type Config = { history?: unknown[]; queues?: Record<string, Outcome[]> };
type Call = { name: string; args: unknown[] };
declare global {
  interface Window {
    __attSubmitConfig: Config;
    __attSubmitUI: {
      calls(): Call[];
      queue(name: string, outcome: Outcome): void;
      settle(id: string, value: unknown, reject?: boolean): void;
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
import KehadiranPage from "@/app/(app)/kehadiran/page";
import { IdentityProvider } from "@/components/auth/identity-context";
import { QueryProvider } from "@/components/providers/query-provider";
const config = window.__attSubmitConfig;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const state = { queues: config.queues || {}, calls: [], pending: new Map() };
async function call(name, args, fallback) {
  state.calls.push({ name, args });
  const outcome = state.queues[name]?.shift();
  if (!outcome) return fallback;
  if (outcome.kind === "reject") throw new Error(outcome.message);
  if (outcome.kind === "defer") return new Promise((resolve, reject) => state.pending.set(outcome.id, { resolve, reject }));
  return clone(outcome.value);
}
window.__attSubmitBoundaries = {
  history: async () => clone(config.history || []),
  policy: async () => ({ id: "pol-1", name: "Kebijakan Uji", attendanceCutoffTime: "08:00", attendanceGraceCutoffTime: "08:15", reportDeadlineTime: "21:00" }),
  checkin: async () => ({ success: true, timeStr: "07:50:00 WIB", classification: "on_time", message: "Presensi berhasil dicatat." }),
  correction: payload => call("correction", [payload], { success: true, message: "Pengajuan koreksi berhasil dikirim." }),
  exception: (...args) => call("exception", args, { success: true, message: "Permohonan Sakit berhasil dikirim." }),
};
window.__attSubmitUI = {
  calls: () => clone(state.calls),
  queue: (name, outcome) => { (state.queues[name] ||= []).push(clone(outcome)); },
  settle: (id, value, reject = false) => {
    const pending = state.pending.get(id);
    if (!pending) throw new Error("No pending request: " + id);
    state.pending.delete(id);
    reject ? pending.reject(new Error(String(value))) : pending.resolve(clone(value));
  },
};
const reactRoot = createRoot(document.getElementById("att-submit-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "santri-a", role: "santri", roles: ["santri"], status: "active", full_name: "Santri Uji", email: "santri@example.test", member_type: "santri" },
}, React.createElement(QueryProvider, null, React.createElement(KehadiranPage))));
`;
const modules: Record<string, string> = {
  "@/modules/attendance/actions": `
    export const getAttendanceHistoryAction = () => window.__attSubmitBoundaries.history();
    export const checkInAttendanceAction = () => window.__attSubmitBoundaries.checkin();
    export const submitCorrectionAction = (payload) => window.__attSubmitBoundaries.correction(payload);
    export const submitExceptionAction = (...args) => window.__attSubmitBoundaries.exception(...args);`,
  "@/modules/analytics/actions": `export const getActivePolicyAction = () => window.__attSubmitBoundaries.policy();`,
  "@/modules/iam/actions": `export const getCurrentUserAction = async () => ({ id: "santri-a", role: "santri", status: "active", full_name: "Santri Uji" });`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const boundaries: Plugin = {
  name: "att-submit-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "att-submit-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "att-submit-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "att-submit-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/kehadiran/page.tsx", "src/components/auth/identity-context.tsx", "src/components/providers/query-provider.tsx"]) {
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
    window.__attSubmitConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "att-submit-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const history = [
  { id: "att-1", dateStr: "2026-11-13", dateFormatted: "Jumat, 13 Nov 2026", timeStr: "08:08 WIB", classification: "late", sessionTitle: "Presensi Pagi", canCorrect: true },
];
const calls = (page: Page) => page.evaluate(() => window.__attSubmitUI.calls());
const openCorrection = async (page: Page) => {
  await page.getByRole("button", { name: /Ajukan Koreksi/ }).click();
  await expect(page.getByText("Formulir Koreksi Presensi")).toBeVisible();
};

test.describe("UX-03 — correction & exception submits are robust", () => {
  for (const kind of ["resolve", "reject"] as const) {
    test(`correction ${kind} failure surfaces an error and keeps the form usable`, async ({ page }) => {
      const outcome: Outcome = kind === "resolve" ? { kind, value: { success: false, message: "Alasan koreksi tidak valid." } } : { kind, message: "Transport failed" };
      await mount(page, { history, queues: { correction: [outcome] } });
      await openCorrection(page);
      await page.getByRole("button", { name: "Kirim Pengajuan" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByText("Formulir Koreksi Presensi")).toBeVisible();
      await expect(page.getByRole("button", { name: "Kirim Pengajuan" })).toBeEnabled();
      expect((await calls(page)).filter(c => c.name === "correction")).toHaveLength(1);
    });
  }

  test("correction submit is locked while in flight (no duplicate on double click)", async ({ page }) => {
    await mount(page, { history, queues: { correction: [{ kind: "defer", id: "corr" }] } });
    await openCorrection(page);
    const submit = page.getByRole("button", { name: /Kirim Pengajuan|Mengirim/ });
    await submit.click();
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    expect((await calls(page)).filter(c => c.name === "correction")).toHaveLength(1);
    await page.evaluate(() => window.__attSubmitUI.settle("corr", { success: true, message: "Pengajuan koreksi berhasil dikirim." }));
    await expect(page.getByText("Pengajuan koreksi berhasil dikirim.")).toBeVisible();
  });

  test("exception failure surfaces an error instead of silently closing", async ({ page }) => {
    await mount(page, { history, queues: { exception: [{ kind: "resolve", value: { success: false, message: "Keterangan alasan wajib diisi." } }] } });
    await page.getByRole("button", { name: /Ajukan Keterangan Izin \/ Sakit/ }).click();
    await expect(page.getByText("Permohonan Izin / Sakit")).toBeVisible();
    await page.getByPlaceholder("Jelaskan alasan dan perkiraan tanggal kembali...").fill("Demam tinggi.");
    await page.getByRole("button", { name: "Ajukan Keterangan", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Keterangan alasan wajib diisi.");
    await expect(page.getByText("Permohonan Izin / Sakit")).toBeVisible();
    expect((await calls(page)).filter(c => c.name === "exception")).toHaveLength(1);
  });
});