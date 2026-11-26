import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real TugasPage + IdentityProvider + cache; mocked task/operations actions.
// Component/browser integration, NOT authenticated production DB E2E.
type Member = { id: string; name: string; role: string };
type Config = { members?: Member[] };
type Calls = {
  createTask: Array<Record<string, unknown>>;
  assignReviewer: Array<{ taskId: string; reviewerId: string }>;
};
declare global {
  interface Window {
    __tugasConfig: Config;
    __tugasCalls: Calls;
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import TugasPage from "@/app/(app)/tugas/page";
import { IdentityProvider } from "@/components/auth/identity-context";
import { QueryProvider } from "@/components/providers/query-provider";
const config = window.__tugasConfig;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
window.__tugasCalls = { createTask: [], assignReviewer: [] };
window.__tugasBoundaries = {
  tasks: async () => [],
  projects: async () => [],
  members: async () => clone(config.members || []),
  createTask: async (payload) => {
    window.__tugasCalls.createTask.push(clone(payload));
    return { success: true, message: "Tugas berhasil dibuat.", taskId: "tsk-fixture-1" };
  },
  assignReviewer: async (taskId, reviewerId) => {
    window.__tugasCalls.assignReviewer.push({ taskId, reviewerId });
    return { success: true, message: "Reviewer berhasil ditetapkan." };
  },
  ok: async () => ({ success: true, message: "ok" }),
  discussion: async () => ({ comments: [], attachments: [] }),
  identity: async () => ({ id: "member-a", role: "koordinator", status: "active", full_name: "Ustadz Uji" }),
};
const reactRoot = createRoot(document.getElementById("tugas-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "member-a", role: "koordinator", status: "active", full_name: "Ustadz Uji" },
}, React.createElement(QueryProvider, null, React.createElement(TugasPage)))));
`;
const modules: Record<string, string> = {
  "@/modules/tasks/actions": `
    export const getTasksAction = (...args) => window.__tugasBoundaries.tasks(...args);
    export const getProjectsAction = (...args) => window.__tugasBoundaries.projects(...args);
    export const getAssignableMembersAction = (...args) => window.__tugasBoundaries.members(...args);
    export const createTaskAction = (...args) => window.__tugasBoundaries.createTask(...args);
    export const assignReviewerToTaskAction = (...args) => window.__tugasBoundaries.assignReviewer(...args);
    export const updateTaskAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const toggleChecklistItemAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const updateTaskStatusAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const deleteTaskAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const addChecklistItemAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const updateChecklistItemAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const deleteChecklistItemAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const createProjectAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const updateProjectAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const archiveProjectAction = (...args) => window.__tugasBoundaries.ok(...args);`,
  "@/modules/operations/actions": `
    export const getTaskDiscussionAction = (...args) => window.__tugasBoundaries.discussion(...args);
    export const addTaskCommentAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const uploadTaskAttachmentAction = (...args) => window.__tugasBoundaries.ok(...args);
    export const deleteTaskAttachmentAction = (...args) => window.__tugasBoundaries.ok(...args);`,
  "@/modules/iam/actions": `export const getCurrentUserAction = () => window.__tugasBoundaries.identity();`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const boundaries: Plugin = {
  name: "tugas-action-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "tugas-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "tugas-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "tugas-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/tugas/page.tsx", "src/components/auth/identity-context.tsx", "src/components/providers/query-provider.tsx"]) {
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
    window.__tugasConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "tugas-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const members: Member[] = [
  { id: "member-b", name: "Ahmad Santri", role: "santri" },
  { id: "member-c", name: "Ustadz Fulan", role: "ustadz" },
];

test.describe("TRC-22/23 — scoped assignee picker + required reviewer on create", () => {
  test("assignee chips flow into createTaskAction; reviewer required and assigned after create", async ({ page }) => {
    await mount(page, { members });
    await page.getByRole("button", { name: "+ Tambah Tugas Baru" }).first().click();
    await expect(page.getByText("Buat Tugas Baru", { exact: true })).toBeVisible();

    const ahmadChip = page.getByRole("button", { name: "Ahmad Santri" });
    await expect(ahmadChip).toBeVisible();
    await expect(page.getByRole("button", { name: "Ustadz Fulan" })).toBeVisible();
    await expect(page.locator("#task-reviewer-select")).toHaveCount(0);

    await ahmadChip.click();
    await expect(ahmadChip).toHaveAttribute("aria-pressed", "true");
    await page.locator("#req-review-cb").check();
    await expect(page.locator("#task-reviewer-select")).toBeVisible();

    await page.getByPlaceholder("Contoh: Implementasi endpoint API presensi").fill("Tugas uji assignee");
    await page.getByRole("button", { name: "Buat Tugas", exact: true }).click();
    await expect(page.getByText("Pilih reviewer terlebih dahulu untuk tugas yang wajib review.")).toBeVisible();
    expect(await page.evaluate(() => window.__tugasCalls.createTask.length)).toBe(0);

    await page.locator("#task-reviewer-select").selectOption("member-c");
    await page.getByRole("button", { name: "Buat Tugas", exact: true }).click();
    await expect(page.getByText("Buat Tugas Baru", { exact: true })).toHaveCount(0);

    const calls = await page.evaluate(() => window.__tugasCalls);
    expect(calls.createTask).toHaveLength(1);
    expect(calls.createTask[0].assigneeIds).toEqual(["member-b"]);
    expect(calls.createTask[0].requiresReview).toBe(true);
    expect(calls.assignReviewer).toEqual([{ taskId: "tsk-fixture-1", reviewerId: "member-c" }]);
    await expect(page.getByText("Tugas uji assignee").first()).toBeVisible();
  });

  test("mobile dialog shows pickers without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { members });
    await page.getByRole("button", { name: "+ Tambah Tugas Baru" }).first().click();
    await expect(page.getByRole("button", { name: "Ahmad Santri" })).toBeVisible();
    await page.locator("#req-review-cb").check();
    await expect(page.locator("#task-reviewer-select")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("tugas-assignee-mobile.png"), fullPage: true });
  });
});