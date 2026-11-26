import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real TugasPage + IdentityProvider; mocked tasks/operations/iam action boundaries.
// Verifies the shared Modal primitive (UX-11): dialog semantics, Escape, focus-trap,
// backdrop-click close, and focus restore. Component/browser integration, NOT DB E2E.
type Config = { role?: string };
declare global {
  interface Window {
    __modalA11yConfig: Config;
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import TugasPage from "@/app/(app)/tugas/page";
import { IdentityProvider } from "@/components/auth/identity-context";
import { QueryProvider } from "@/components/providers/query-provider";
const config = window.__modalA11yConfig;
const empty = async () => [];
window.__modalA11yBoundaries = {
  tasks: empty, projects: empty, members: empty,
  noop: async () => ({ success: true, message: "ok" }),
  discussion: async () => ({ comments: [], attachments: [] }),
  identity: async () => ({ id: "koor-a", role: config.role || "koordinator", status: "active", full_name: "Koordinator Uji", team_name: "Tim Uji" }),
};
const reactRoot = createRoot(document.getElementById("modal-a11y-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "koor-a", role: config.role || "koordinator", status: "active", full_name: "Koordinator Uji", team_name: "Tim Uji" },
}, React.createElement(QueryProvider, null, React.createElement(TugasPage)))));
`;
const modules: Record<string, string> = {
  "@/modules/tasks/actions": `
    export const getTasksAction = () => window.__modalA11yBoundaries.tasks();
    export const getProjectsAction = () => window.__modalA11yBoundaries.projects();
    export const getAssignableMembersAction = () => window.__modalA11yBoundaries.members();
    export const createTaskAction = () => window.__modalA11yBoundaries.noop();
    export const updateTaskAction = () => window.__modalA11yBoundaries.noop();
    export const toggleChecklistItemAction = () => window.__modalA11yBoundaries.noop();
    export const updateTaskStatusAction = () => window.__modalA11yBoundaries.noop();
    export const deleteTaskAction = () => window.__modalA11yBoundaries.noop();
    export const addChecklistItemAction = () => window.__modalA11yBoundaries.noop();
    export const updateChecklistItemAction = () => window.__modalA11yBoundaries.noop();
    export const deleteChecklistItemAction = () => window.__modalA11yBoundaries.noop();
    export const createProjectAction = () => window.__modalA11yBoundaries.noop();
    export const updateProjectAction = () => window.__modalA11yBoundaries.noop();
    export const archiveProjectAction = () => window.__modalA11yBoundaries.noop();
    export const assignReviewerToTaskAction = () => window.__modalA11yBoundaries.noop();`,
  "@/modules/operations/actions": `
    export const getTaskDiscussionAction = () => window.__modalA11yBoundaries.discussion();
    export const addTaskCommentAction = () => window.__modalA11yBoundaries.noop();
    export const uploadTaskAttachmentAction = () => window.__modalA11yBoundaries.noop();
    export const deleteTaskAttachmentAction = () => window.__modalA11yBoundaries.noop();`,
  "@/modules/iam/actions": `export const getCurrentUserAction = () => window.__modalA11yBoundaries.identity();`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const boundaries: Plugin = {
  name: "modal-a11y-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "modal-a11y-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "modal-a11y-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "modal-a11y-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/tugas/page.tsx", "src/components/ui/modal.tsx", "src/components/auth/identity-context.tsx", "src/components/providers/query-provider.tsx"]) {
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
    window.__modalA11yConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "modal-a11y-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}

async function openTaskModal(page: Page) {
  await page.getByRole("button", { name: "Tambah Tugas Baru" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Buat Tugas Baru" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("UX-11 — shared Modal primitive accessibility", () => {
  test("exposes dialog role, aria-modal, and an accessible name", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mount(page, {});
    const dialog = await openTaskModal(page);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAttribute("aria-label", "Buat Tugas Baru");
    // initial focus lands inside the dialog
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  });

  test("Escape closes the modal and restores focus to the trigger", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mount(page, {});
    const dialog = await openTaskModal(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.textContent?.includes("Tambah Tugas Baru"))).toBe(true);
  });

  test("Tab wraps from last to first and Shift+Tab from first to last (focus-trap)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mount(page, {});
    const dialog = await openTaskModal(page);

    await dialog.evaluate((el, sel) => {
      const nodes = el.querySelectorAll<HTMLElement>(sel);
      nodes[nodes.length - 1].focus();
    }, FOCUSABLE);
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el, sel) => {
      const nodes = el.querySelectorAll<HTMLElement>(sel);
      return document.activeElement === nodes[0];
    }, FOCUSABLE)).toBe(true);

    await dialog.evaluate((el, sel) => {
      const nodes = el.querySelectorAll<HTMLElement>(sel);
      nodes[0].focus();
    }, FOCUSABLE);
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((el, sel) => {
      const nodes = el.querySelectorAll<HTMLElement>(sel);
      return document.activeElement === nodes[nodes.length - 1];
    }, FOCUSABLE)).toBe(true);

    // focus never escapes the dialog while tabbing forward
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  });

  test("clicking the backdrop closes the modal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mount(page, {});
    const dialog = await openTaskModal(page);
    // Click the backdrop's left edge, vertically centered — outside the centered panel.
    const point = await page.evaluate(() => {
      const backdrop = document.querySelector('[role="dialog"]')?.parentElement as HTMLElement | null;
      const r = backdrop!.getBoundingClientRect();
      return { x: r.x + 6, y: r.y + r.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await expect(dialog).toHaveCount(0);
  });
});