import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real TugasPage + IdentityProvider; mocked tasks/operations/iam action boundaries.
// Component/browser integration, NOT authenticated production DB E2E.
type Config = { role?: string };
declare global {
  interface Window {
    __tugasModalConfig: Config;
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
const config = window.__tugasModalConfig;
const empty = async () => [];
window.__tugasBoundaries = {
  tasks: empty, projects: empty, members: empty,
  noop: async () => ({ success: true, message: "ok" }),
  discussion: async () => ({ comments: [], attachments: [] }),
  identity: async () => ({ id: "koor-a", role: config.role || "koordinator", status: "active", full_name: "Koordinator Uji", team_name: "Tim Uji" }),
};
const reactRoot = createRoot(document.getElementById("tugas-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "koor-a", role: config.role || "koordinator", status: "active", full_name: "Koordinator Uji", team_name: "Tim Uji" },
}, React.createElement(QueryProvider, null, React.createElement(TugasPage)))));
`;
const modules: Record<string, string> = {
  "@/modules/tasks/actions": `
    export const getTasksAction = () => window.__tugasBoundaries.tasks();
    export const getProjectsAction = () => window.__tugasBoundaries.projects();
    export const getAssignableMembersAction = () => window.__tugasBoundaries.members();
    export const createTaskAction = () => window.__tugasBoundaries.noop();
    export const updateTaskAction = () => window.__tugasBoundaries.noop();
    export const toggleChecklistItemAction = () => window.__tugasBoundaries.noop();
    export const updateTaskStatusAction = () => window.__tugasBoundaries.noop();
    export const deleteTaskAction = () => window.__tugasBoundaries.noop();
    export const addChecklistItemAction = () => window.__tugasBoundaries.noop();
    export const updateChecklistItemAction = () => window.__tugasBoundaries.noop();
    export const deleteChecklistItemAction = () => window.__tugasBoundaries.noop();
    export const createProjectAction = () => window.__tugasBoundaries.noop();
    export const updateProjectAction = () => window.__tugasBoundaries.noop();
    export const archiveProjectAction = () => window.__tugasBoundaries.noop();
    export const assignReviewerToTaskAction = () => window.__tugasBoundaries.noop();`,
  "@/modules/operations/actions": `
    export const getTaskDiscussionAction = () => window.__tugasBoundaries.discussion();
    export const addTaskCommentAction = () => window.__tugasBoundaries.noop();
    export const uploadTaskAttachmentAction = () => window.__tugasBoundaries.noop();
    export const deleteTaskAttachmentAction = () => window.__tugasBoundaries.noop();`,
  "@/modules/iam/actions": `export const getCurrentUserAction = () => window.__tugasBoundaries.identity();`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
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
    window.__tugasModalConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "tugas-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}

test.describe("UX-06 — task modal scrolls and fits the mobile viewport", () => {
  test("create-task modal is height-capped, scrollable, and submit stays reachable at 390x844", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, {});
    await page.getByRole("button", { name: "Tambah Tugas Baru" }).first().click();

    const card = page.locator("div.fixed.inset-0 > div.bg-card");
    await expect(card).toBeVisible();
    await expect(card.getByText("Buat Tugas Baru")).toBeVisible();

    const overflowY = await card.evaluate(el => getComputedStyle(el).overflowY);
    const maxHeight = await card.evaluate(el => getComputedStyle(el).maxHeight);
    expect(overflowY).toBe("auto");
    expect(maxHeight).not.toBe("none");

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844 + 1);

    const submit = card.getByRole("button", { name: "Buat Tugas", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();
    const submitBox = await submit.boundingBox();
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(844 + 1);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("tugas-modal-mobile.png"), fullPage: true });
  });
});