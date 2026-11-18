import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Browser component integration only. Server actions, Supabase, Resend, and
// identity boundaries are mocked; this is not authenticated production E2E.
type Config = {
  role: string;
  emailSummary?: { providerConfigured: boolean; pending: number; processing: number; failed: number };
};

declare global {
  interface Window {
    __notificationConfig: Config;
  }
}

const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import AdminNotificationsPage from "@/app/(app)/admin/notifications/page";
const config = window.__notificationConfig;
const root = createRoot(document.getElementById("notifications-root"));
root.render(React.createElement(AdminNotificationsPage));
`;

const modules: Record<string, string> = {
  "@/components/auth/identity-context": `export const useIdentity = () => ({ user: window.__notificationConfig ? { role: window.__notificationConfig.role } : null });`,
  "@/components/ui/unauthorized-state": `import React from "react"; export function UnauthorizedState({ requiredRole }) { return React.createElement("p", { role: "alert" }, "Unauthorized: " + requiredRole); }`,
  "@/modules/notifications/actions": `
    export const getNotificationDeliverySummaryAction = async () => ({ pending: 0, processing: 0, deadLetter: 0 });
    export const getEmailDeliverySummaryAction = async () => window.__notificationConfig.emailSummary || null;`,
  "@/modules/operations/actions": `export const sendTestPushAction = async () => ({ success: true, message: "ok" });`,
  "@/hooks/use-cached-data": `
    import React from "react";
    export function useCachedData(key, loader) {
      const [state, setState] = React.useState({ data: undefined, error: null });
      React.useEffect(() => {
        if (!key) { setState({ data: undefined, error: null }); return; }
        let alive = true;
        Promise.resolve(loader()).then(data => { if (alive) setState({ data, error: null }); }).catch(error => { if (alive) setState({ data: undefined, error }); });
        return () => { alive = false; };
      }, [key, loader]);
      return { ...state, refresh: async () => { if (key) setState({ data: await loader(), error: null }); } };
    }`,
};

const boundaries: Plugin = {
  name: "notification-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, (args) =>
      modules[args.path] ? { path: args.path, namespace: "notification-boundary" } : undefined,
    );
    builder.onLoad({ filter: /.*/, namespace: "notification-boundary" }, (args) => ({
      contents: modules[args.path],
      loader: "js",
      resolveDir: root,
    }));
  },
};

test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: fixture, resolveDir: root, sourcefile: "notifications-fixture.tsx", loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [boundaries],
    metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some((input) => input.endsWith("src/app/(app)/admin/notifications/page.tsx"))).toBe(true);
  expect(inputs.some((input) => /src\/lib\/supabase\//.test(input))).toBe(false);
  bundle = result.outputFiles[0].text;
});

test.afterEach(async ({ page }) => {
  expect(forbidden.get(page) || [], "No provider or server-action requests").toEqual([]);
});

async function mount(page: Page, config: Config) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const blocked: string[] = [];
  forbidden.set(page, blocked);
  await page.route("**/*", async (route) => {
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
  await page.evaluate((value) => {
    window.__notificationConfig = value;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "notifications-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}

test.describe("email outbox monitoring", () => {
  test("super_admin sees counts only and no recipient/body data", async ({ page }) => {
    await mount(page, {
      role: "super_admin",
      emailSummary: { providerConfigured: true, pending: 3, processing: 1, failed: 2 },
    });

    const section = page.locator("section").filter({ hasText: "Antrean email" });
    await expect(section).toContainText("Menunggu");
    await expect(section).toContainText("Diproses");
    await expect(section).toContainText("Gagal permanen");
    await expect(section).toContainText("3");
    await expect(section).toContainText("1");
    await expect(section).toContainText("2");
    await expect(section).not.toContainText("santri@example.com");
    await expect(section).not.toContainText("Isi email rahasia");
  });

  test("non-super_admin does not receive email monitoring", async ({ page }) => {
    await mount(page, {
      role: "pengurus",
      emailSummary: { providerConfigured: true, pending: 3, processing: 1, failed: 2 },
    });

    await expect(page.getByText("Antrean email", { exact: true })).toHaveCount(0);
  });

  test("shows provider configuration state without exposing credentials", async ({ page }) => {
    await mount(page, {
      role: "super_admin",
      emailSummary: { providerConfigured: false, pending: 0, processing: 0, failed: 0 },
    });

    await expect(page.getByRole("alert")).toContainText("Provider email belum dikonfigurasi");
    await expect(page.getByText("re_", { exact: false })).toHaveCount(0);
  });
});
