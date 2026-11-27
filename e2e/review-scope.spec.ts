import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// RVS-01 — real ReviewPage + IdentityProvider + QueryProvider mounts, one per tier §3.4 names.
//
// The reported symptom was a red "Antrean review gagal dimuat. Ini bukan berarti antrean kosong."
// banner for an Admin Utama: the page offered the queue to super_admin and yayasan, the query fired
// for them, and getReviewQueueAction answered with its FORBIDDEN guard — a load-failure message for
// a permission answer. These mounts prove the queue request is never issued for an out-of-scope
// role and that the page says "Akses Dibatasi" instead, while a reviewer still really loads it.
type Report = Record<string, unknown>;
type FixtureUser = {
  id: string;
  role: string;
  roles: string[];
  status: string;
  full_name: string;
  email: string;
  member_type: string;
  team_name: string | null;
};
declare global {
  interface Window {
    __reviewQueueReports: Report[];
    __reviewQueueCalls: number;
  }
}
const root = path.resolve(__dirname, "..");
const bundles: Record<string, string> = {};
const failureBanner = "Antrean review gagal dimuat. Ini bukan berarti antrean kosong.";
const reports: Report[] = [
  {
    id: "rep-1",
    userId: "santri-b",
    authorName: "Ahmad Santri",
    authorRole: "Santri",
    teamName: "Tim Kebersihan",
    reportDate: "2026-11-14",
    reportDateFormatted: "Sabtu, 14 Nov 2026",
    submissionStatus: "submitted",
    isLate: false,
    submittedAtTime: "20:10:00 WIB",
    reviewStatus: "not_reviewed",
    revisionNo: 1,
    items: [{ id: "item-1", categoryId: "cat-1", categoryName: "Kegiatan", title: "Piket pagi", description: "Membersihkan halaman", durationMinutes: 30, sortOrder: 1 }],
    reviews: [],
  },
];

const users: Record<string, FixtureUser> = {
  superAdmin: {
    id: "sa-session", role: "super_admin", roles: ["super_admin"], status: "active",
    full_name: "Admin Utama", email: "sa@example.test", member_type: "pengurus", team_name: null,
  },
  yayasan: {
    id: "ya-session", role: "yayasan", roles: ["yayasan"], status: "active",
    full_name: "Pembina Yayasan", email: "ya@example.test", member_type: "pengurus", team_name: null,
  },
  koordinator: {
    id: "ko-session", role: "koordinator", roles: ["koordinator"], status: "active",
    full_name: "Ustadz Salman", email: "ko@example.test", member_type: "pengurus", team_name: "Tim Pembina",
  },
  pengurus: {
    id: "pe-session", role: "pengurus", roles: ["pengurus"], status: "active",
    full_name: "Ustadz Bilal", email: "pe@example.test", member_type: "pengurus", team_name: "Harian",
  },
  // §3.4 is evaluated across every role the account holds, so a santri that also carries
  // koordinator keeps the queue.
  santriPromoted: {
    id: "sp-session", role: "santri", roles: ["santri", "koordinator"], status: "active",
    full_name: "Ustadz Ahmad", email: "sp@example.test", member_type: "santri", team_name: "Tim Santri",
  },
};

function fixture(user: FixtureUser): string {
  return `
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ReviewPage from "@/app/(app)/review/page";
import { IdentityProvider } from "@/components/auth/identity-context";
import { QueryProvider } from "@/components/providers/query-provider";
window.__reviewQueueCalls = 0;
const reactRoot = createRoot(document.getElementById("review-scope-root"));
flushSync(() => reactRoot.render(React.createElement(IdentityProvider, {
  initialUser: ${JSON.stringify(user)},
}, React.createElement(QueryProvider, null, React.createElement(ReviewPage)))));
`;
}

const modules: Record<string, string> = {
  "@/modules/reports/actions": `
    export const getReviewQueueAction = async () => {
      window.__reviewQueueCalls += 1;
      return JSON.parse(JSON.stringify(window.__reviewQueueReports));
    };
    export const reviewReportAction = async () => ({ success: true, message: "Review tersimpan." });`,
  "@/modules/iam/actions": `export const getCurrentUserAction = async () => null;`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`,
  "next/image": `import React from "react"; export default function Image({ priority, unoptimized, ...props }) { return React.createElement("img", props); }`,
};
const scopeBoundary: Plugin = {
  name: "review-scope-boundary",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, (args) =>
      modules[args.path] ? { path: args.path, namespace: "review-scope-boundary" } : undefined,
    );
    builder.onLoad({ filter: /.*/, namespace: "review-scope-boundary" }, (args) => ({
      contents: modules[args.path], loader: "js", resolveDir: root,
    }));
  },
};

test.beforeAll(async () => {
  for (const [name, user] of Object.entries(users)) {
    const result = await build({
      absWorkingDir: root,
      stdin: { contents: fixture(user), resolveDir: root, sourcefile: `review-scope-${name}.tsx`, loader: "tsx" },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' }, plugins: [scopeBoundary], metafile: true,
    });
    const inputs = Object.keys(result.metafile!.inputs);
    for (const file of [
      "src/app/(app)/review/page.tsx",
      "src/components/auth/identity-context.tsx",
      "src/components/providers/query-provider.tsx",
      "src/lib/report-policy.ts",
    ]) {
      expect(inputs.some((input) => input.endsWith(file)), `Bundled actual ${file}`).toBe(true);
    }
    expect(inputs.some((input) => /src\/lib\/supabase\/|src\/modules\/.*\/actions\.ts/.test(input))).toBe(false);
    bundles[name] = result.outputFiles[0].text;
  }
});

async function mount(page: Page, bundle: string, queueReports: Report[] = []) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/__nextjs_original-stack-frames") return route.abort();
    if (url.origin !== origin) return route.abort();
    return route.continue();
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await page.evaluate((rows) => {
    window.__reviewQueueReports = rows;
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "review-scope-root";
    document.body.appendChild(host);
  }, queueReports);
  await page.addScriptTag({ content: bundle });
}

test.describe("RVS-01 — the tiers §3.4 excludes are refused before the request", () => {
  for (const name of ["superAdmin", "yayasan"] as const) {
    test(`${name} sees Akses Dibatasi and no queue request is issued`, async ({ page }) => {
      await mount(page, bundles[name]);
      await expect(page.getByText("Akses Dibatasi").first()).toBeVisible();
      await expect(page.getByText(failureBanner)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Antrean Review Laporan" })).toHaveCount(0);
      expect(await page.evaluate(() => window.__reviewQueueCalls)).toBe(0);
    });
  }
});

test.describe("RVS-01 — a reviewer still really loads the queue", () => {
  for (const name of ["koordinator", "pengurus", "santriPromoted"] as const) {
    test(`${name} fetches the queue and renders it`, async ({ page }) => {
      await mount(page, bundles[name], reports);
      await expect(page.getByText("Akses Dibatasi")).toHaveCount(0);
      await expect(page.getByText(failureBanner)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Antrean Review Laporan" })).toBeVisible();
      await expect(page.getByText("Piket pagi").first()).toBeVisible();
      expect(await page.evaluate(() => window.__reviewQueueCalls)).toBeGreaterThan(0);
    });
  }
});
