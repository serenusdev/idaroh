import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real AccountStateScreen; mocked supabase/notification/navigation boundaries.
// Component/browser evidence for UX-20 (admin contact from config), NOT DB E2E.
type Props = Record<string, unknown>;
declare global {
  interface Window {
    __accountStateProps: Props;
  }
}
const root = path.resolve(__dirname, "..");
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AccountStateScreen } from "@/components/auth/account-state-screen";
const props = window.__accountStateProps;
const reactRoot = createRoot(document.getElementById("account-state-root"));
flushSync(() => reactRoot.render(React.createElement(AccountStateScreen, props)));
`;
const modules: Record<string, string> = {
  "next/navigation": `export const useRouter = () => ({ replace(){}, refresh(){} });`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
  "@/lib/supabase/client": `export const createClient = () => ({ auth: { signOut: async () => ({ error: null }) } });`,
  "@/lib/notifications": `export const cleanupPushNotifications = async () => {};`,
};
const boundaries: Plugin = {
  name: "account-state-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "account-state-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "account-state-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
async function buildBundle(contact: { email: string; whatsapp: string }) {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "account-state-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL": JSON.stringify(contact.email),
      "process.env.NEXT_PUBLIC_ADMIN_WHATSAPP": JSON.stringify(contact.whatsapp),
    },
    plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(input => input.endsWith("src/components/auth/account-state-screen.tsx")), "Bundled actual account-state-screen").toBe(true);
  expect(inputs.some(input => /src\/lib\/supabase\/|src\/modules\/.*\/actions\.ts/.test(input))).toBe(false);
  return result.outputFiles[0].text;
}
let withContact: string;
let noContact: string;
test.beforeAll(async () => {
  withContact = await buildBundle({ email: "admin@pondok.test", whatsapp: "6281234567890" });
  noContact = await buildBundle({ email: "", whatsapp: "" });
});
test.afterEach(async ({ page }) => {
  expect(forbidden.get(page) || [], "No real provider/server-action requests").toEqual([]);
});
async function mount(page: Page, bundle: string, props: Props) {
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
  await page.evaluate(props => {
    window.__accountStateProps = props;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "account-state-root";
    document.body.appendChild(host);
  }, props);
  await page.addScriptTag({ content: bundle });
}

test.describe("UX-20 — layar status akun menyediakan kontak admin nyata", () => {
  test("pending screen shows WhatsApp + email links from config", async ({ page }) => {
    await mount(page, withContact, { kind: "inactive", status: "pending", email: "pemohon@uji.id" });
    await expect(page.getByText("Akun Menunggu Persetujuan")).toBeVisible();
    const wa = page.getByRole("link", { name: "WhatsApp Admin" });
    await expect(wa).toBeVisible();
    expect(await wa.getAttribute("href")).toBe("https://wa.me/6281234567890");
    const mail = page.getByRole("link", { name: "admin@pondok.test" });
    await expect(mail).toBeVisible();
    expect(await mail.getAttribute("href")).toBe("mailto:admin@pondok.test");
    await page.screenshot({ path: test.info().outputPath("account-state-contact.png"), fullPage: true });
  });

  test("without config it degrades to guidance, no dead links", async ({ page }) => {
    await mount(page, noContact, { kind: "inactive", status: "suspended", email: "pemohon@uji.id" });
    await expect(page.getByText("Butuh bantuan administrator?")).toBeVisible();
    await expect(page.getByText(/Hubungi administrator pondok melalui pengurus tim/)).toBeVisible();
    await expect(page.getByRole("link", { name: "WhatsApp Admin" })).toHaveCount(0);
  });

  test("identity_error keeps retry focus, no admin contact block", async ({ page }) => {
    await mount(page, withContact, { kind: "identity_error", traceId: "QRY-TEST" });
    await expect(page.getByText("Identitas Belum Dapat Diverifikasi")).toBeVisible();
    await expect(page.getByText("Butuh bantuan administrator?")).toHaveCount(0);
  });
});