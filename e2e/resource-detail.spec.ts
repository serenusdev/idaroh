import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real ResourceDetailPage (async server component invoked directly) with mocked
// library action + next/navigation. Component evidence, NOT production DB E2E.
type Resource = {
  name: string; slug: string; description: string; category: string; tags: string[];
  officialUrl?: string;
  accessSetup?: string; howToUse?: string; workflowExamples?: string;
  limitationsCautions?: string; officialSources?: string; documentationStatus?: string;
};
type Config = { slug: string; resource: Resource | null };
declare global {
  interface Window {
    __resourceConfig: Config;
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ResourceDetailPage from "@/app/(app)/resources/[slug]/page";
const config = window.__resourceConfig;
window.__resourceBoundaries = {
  bySlug: async (slug) => (config.resource && config.resource.slug === slug ? config.resource : null),
};
const reactRoot = createRoot(document.getElementById("resource-root"));
(async () => {
  try {
    const element = await ResourceDetailPage({ params: Promise.resolve({ slug: config.slug }) });
    flushSync(() => reactRoot.render(element));
  } catch (error) {
    flushSync(() => reactRoot.render(React.createElement("p", { id: "not-found-marker" }, "NOT_FOUND: " + String(error && error.message))));
  }
})();
`;
const modules: Record<string, string> = {
  "@/modules/library/actions": `export const getResourceBySlugAction = (slug) => window.__resourceBoundaries.bySlug(slug);`,
  "next/navigation": `export const notFound = () => { throw new Error("NEXT_NOT_FOUND"); };`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
};
const boundaries: Plugin = {
  name: "resource-action-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "resource-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "resource-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "resource-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(input => input.endsWith("src/app/(app)/resources/[slug]/page.tsx")), "Bundled actual slug page").toBe(true);
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
    window.__resourceConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "resource-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}
const resource: Resource = {
  name: "Supabase Database & Row-Level Security",
  slug: "supabase-db-rls",
  description: "Arsitektur PostgreSQL dengan kebijakan isolasi RLS.",
  category: "Database & Backend",
  tags: ["Postgres", "RLS"],
  officialUrl: "https://supabase.com/docs",
  accessSetup: "Proyek cloud region Singapura.",
  howToUse: "Menggunakan Supabase CLI untuk migrasi skema lokal.",
  workflowExamples: "",
  limitationsCautions: "Dilarang memakai service role di client-side.",
  officialSources: "Dokumentasi resmi Supabase Auth & Storage.",
  documentationStatus: "Diverifikasi Tim IT Pondok (Nov 2026)",
};

test.describe("TRC-27 — deep-link slug + six honest documentation fields", () => {
  test("all six sections render; empty field shows Belum didokumentasikan", async ({ page }) => {
    await mount(page, { slug: "supabase-db-rls", resource });
    await expect(page.getByRole("heading", { name: "Supabase Database & Row-Level Security" })).toBeVisible();
    for (const title of ["Cara Akses / Setup", "Cara Penggunaan", "Contoh Workflow", "Batasan & Catatan", "Sumber Resmi", "Status Dokumentasi"]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
    await expect(page.getByText("Belum didokumentasikan", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Menggunakan Supabase CLI untuk migrasi skema lokal.")).toBeVisible();
  });

  test("unknown slug triggers notFound instead of silently listing page 1", async ({ page }) => {
    await mount(page, { slug: "resource-ke-101", resource });
    await expect(page.locator("#not-found-marker")).toContainText("NEXT_NOT_FOUND");
  });

  test("mobile viewport renders detail without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { slug: "supabase-db-rls", resource });
    await expect(page.getByText("Belum didokumentasikan", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("resource-detail-mobile.png"), fullPage: true });
  });
});