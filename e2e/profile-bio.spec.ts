import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// Real ProfileSettingsPage + IdentityProvider; mocked action boundaries only.
// Component/browser integration, NOT authenticated production DB E2E.
type Config = { initialBio?: string };
type SaveCall = { userId: string; bio: string };
declare global {
  interface Window {
    __bioConfig: Config;
    __bioCalls: SaveCall[];
  }
}
const root = path.resolve(__dirname, "..");
let bundle: string;
const forbidden = new WeakMap<Page, string[]>();
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ProfileSettingsPage from "@/app/(app)/settings/profile/page";
import { IdentityProvider } from "@/components/auth/identity-context";
const config = window.__bioConfig;
window.__bioCalls = [];
window.__bioBoundaries = {
  loadBio: async () => ({ success: true, bio: config.initialBio || "" }),
  saveBio: async (userId, bio) => {
    window.__bioCalls.push({ userId, bio });
    return { success: true, message: "Bio profil berhasil diperbarui." };
  },
  reminderLoad: async () => ({ success: true, enabled: true }),
  reminderSave: async () => ({ success: true, enabled: true, message: "ok" }),
  identity: async () => ({ id: "member-a", role: "santri", status: "active", full_name: "Santri Uji", email: "santri@example.test" }),
};
const reactRoot = createRoot(document.getElementById("bio-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: { id: "member-a", role: "santri", status: "active", full_name: "Santri Uji", email: "santri@example.test" },
}, React.createElement(ProfileSettingsPage))));
`;
const modules: Record<string, string> = {
  "@/modules/people/actions": `
    export const getPersonalBioAction = () => window.__bioBoundaries.loadBio();
    export const updatePersonalBioAction = (userId, bio) => window.__bioBoundaries.saveBio(userId, bio);`,
  "@/modules/notifications/actions": `
    export const getAttendanceReminderPreferenceAction = () => window.__bioBoundaries.reminderLoad();
    export const updateAttendanceReminderPreferenceAction = (enabled) => window.__bioBoundaries.reminderSave(enabled);`,
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
    export const getCurrentUserAction = () => window.__bioBoundaries.identity();`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
};
const boundaries: Plugin = {
  name: "bio-action-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/modules\/|next\/)/ }, args => modules[args.path] ? { path: args.path, namespace: "bio-boundary" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "bio-boundary" }, args => ({ contents: modules[args.path], loader: "js", resolveDir: root }));
  },
};
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { contents: fixture, resolveDir: root, sourcefile: "bio-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [boundaries], metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const file of ["src/app/(app)/settings/profile/page.tsx", "src/components/auth/identity-context.tsx"]) {
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
    window.__bioConfig = config;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "bio-root";
    document.body.appendChild(host);
  }, config);
  await page.addScriptTag({ content: bundle });
}

test.describe("TRC-26 — personal bio in profile settings", () => {
  test("bio loads, save disabled when unchanged, edit flows to updatePersonalBioAction", async ({ page }) => {
    await mount(page, { initialBio: "Bio lama." });
    const textarea = page.getByRole("textbox", { name: "Bio singkat" });
    await expect(textarea).toHaveValue("Bio lama.");
    await expect(textarea).toHaveAttribute("maxlength", "500");
    const saveButton = page.getByRole("button", { name: "Simpan Bio" });
    await expect(saveButton).toBeDisabled();

    await textarea.fill("Santri backend developer & penggiat open-source.");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByText("Bio profil berhasil diperbarui.")).toBeVisible();

    const calls = await page.evaluate(() => window.__bioCalls);
    expect(calls).toEqual([{ userId: "member-a", bio: "Santri backend developer & penggiat open-source." }]);
    await expect(saveButton).toBeDisabled();
  });

  test("mobile viewport renders bio card without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, { initialBio: "" });
    await expect(page.getByRole("textbox", { name: "Bio singkat" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("profile-bio-mobile.png"), fullPage: true });
  });
});