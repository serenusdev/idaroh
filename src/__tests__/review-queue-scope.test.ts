/**
 * RVS-01 — the /review queue is offered, gated and fetched with one answer.
 *
 * PERMISSIONS.md §3.4 fixes `report.review` at `— | assigned | assigned | — | —`: the queue belongs
 * to koordinator and pengurus, and only for the reviewees named in an active `reviewer_assignments`
 * row (REP-01). `super_admin` and `yayasan` are `—`, and §3.4 line 129 refuses `super_admin` the
 * report content itself, so a queue it cannot open must not be offered anywhere.
 *
 * The reported bug was the mismatch: `getReviewQueueAction` rejected the caller through
 * `requireRole(["pengurus", "koordinator"])` while the page, the sidebar, the mobile sheet and the
 * beranda shortcuts all answered a wider question. The action threw `FORBIDDEN:`, the query stored
 * that as `queueQuery.error`, and the page rendered "Antrean review gagal dimuat. Ini bukan berarti
 * antrean kosong." — a load-failure banner for a permission answer, which is precisely the
 * distinction UX-08 exists to keep honest.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

const reviewPage = read("src/app/(app)/review/page.tsx");
const homePage = read("src/app/(app)/page.tsx");
const desktopSidebar = read("src/components/layout/desktop-sidebar.tsx");
const mobileNav = read("src/components/layout/mobile-nav.tsx");
const reportsActions = read("src/modules/reports/actions.ts");
const policyPath = resolve(root, "src/lib/report-policy.ts");
const reportPolicy = existsSync(policyPath) ? readFileSync(policyPath, "utf8") : "";

function slice(source: string, startNeedle: string, endNeedle: string, label: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `${label} is missing ("${startNeedle}")`).toBeGreaterThan(-1);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end === -1 ? source.length : end);
}

describe("RVS-01 — one role set answers for §3.4 report.review", () => {
  it("publishes a shared reviewer policy module instead of four private copies", () => {
    expect(reportPolicy, "src/lib/report-policy.ts is missing").not.toBe("");
    expect(reportPolicy).toMatch(/export const REPORT_REVIEW_ROLES: readonly UserRole\[\] = \[\s*"pengurus",\s*"koordinator",?\s*\]/);
    expect(reportPolicy).toMatch(/export function holdsReportReviewRole\(/);
    // AGENTS.md: evaluate every role the account holds, never a rank or a hierarchy.
    expect(reportPolicy).toMatch(/new Set<[A-Za-z<>|\s]*>\(\[user\.role, \.\.\.\(user\.roles \|\| \[\]\)\]\)/);
    expect(reportPolicy).not.toMatch(/hasMinimumRole|roleRank|ROLE_RANK|roleOrder/);
  });

  it("keeps the Server Action guard on the same pair the policy declares", () => {
    const body = slice(reportsActions, "export async function getReviewQueueAction(", "\nexport ", "getReviewQueueAction");
    const guard = body.match(/requireRole\(\[([^\]]*)\]\)/);
    expect(guard, "getReviewQueueAction lost its role guard").not.toBeNull();
    const guarded = (guard![1].match(/"([^"]+)"/g) ?? []).map((item) => item.replace(/"/g, "")).sort();
    expect(guarded).toEqual(["koordinator", "pengurus"]);
    expect(body).not.toMatch(/hasMinimumRole|roleRank/);
  });
});

describe("RVS-01 — the queue page gates before it fetches", () => {
  it("derives canReview from the shared policy, without the out-of-scope tiers", () => {
    const gate = slice(reviewPage, "const canReview =", "\n\n", "the review page gate");
    expect(gate).toContain("holdsReportReviewRole(");
    expect(gate).not.toMatch(/super_admin|yayasan/);
  });

  it("computes the gate above the query and disables the query for a non-reviewer", () => {
    const gateIndex = reviewPage.indexOf("const canReview =");
    const queryIndex = reviewPage.indexOf("const queueQuery = useQuery(");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(-1);
    expect(gateIndex, "canReview is still declared after the query that needs it").toBeLessThan(queryIndex);
    const query = slice(reviewPage, "const queueQuery = useQuery(", "});", "the queue query");
    expect(query).toContain("enabled: canReview");
    expect(query).toContain("queryFn: getReviewQueueAction");
  });

  it("keeps the UnauthorizedState copy honest about who may review", () => {
    const gate = slice(reviewPage, "if (!canReview) {", "const handleReviewDecision", "the unauthorized branch");
    expect(gate).toContain("<UnauthorizedState");
    expect(gate).toMatch(/requiredRole="[^"]*(Pengurus|Koordinator)[^"]*"/);
    expect(gate).not.toMatch(/Ustadz Pembina/);
  });

  it("still reports a genuine load failure as a load failure", () => {
    expect(reviewPage).toContain("queueQuery.error");
    expect(reviewPage).toContain("Antrean review gagal dimuat. Ini bukan berarti antrean kosong.");
    expect(reviewPage).toContain("Coba lagi");
  });
});

describe("RVS-01 — no surface offers a queue the caller cannot open (§2 rule 8)", () => {
  const surfaces: Array<[string, string]> = [
    ["src/components/layout/desktop-sidebar.tsx", desktopSidebar],
    ["src/components/layout/mobile-nav.tsx", mobileNav],
    ["src/app/(app)/page.tsx", homePage],
  ];

  for (const [name, source] of surfaces) {
    it(`gates every /review entry in ${name}`, () => {
      expect(source.includes('"/review"'), `${name} no longer links to /review`).toBe(true);
      // Both spellings count: JSX renders href="/review", a nav-item object literal writes href: "/review".
      for (const match of source.matchAll(/href\s*[=:]\s*"\/review"/g)) {
        const before = source.slice(Math.max(0, (match.index ?? 0) - 1500), match.index);
        // isKoordinator is a branch selector in the mobile sheet, and that branch is the reviewer tier.
        expect(before, `${name} renders a /review link nobody gated`).toMatch(
          /canReview|holdsReportReviewRole|isKoordinator/,
        );
      }
    });
  }

  it("keeps the mobile sheet admin branch from assuming review belongs to every manager", () => {
    const adminBranch = slice(mobileNav, "const isAdminOrPengurus", "    : isKoordinator", "the mobile admin branch");
    expect(adminBranch).toMatch(/\.\.\.\(canReview \? \[\{/);
  });
});

describe("RVS-01 — the browser evidence for the reported symptom", () => {
  it("adds a real mount for the tiers §3.4 excludes", () => {
    const specPath = resolve(root, "e2e/review-scope.spec.ts");
    expect(existsSync(specPath), "e2e/review-scope.spec.ts is missing").toBe(true);
    const spec = existsSync(specPath) ? readFileSync(specPath, "utf8") : "";
    expect(spec).toContain('role: "super_admin"');
    expect(spec).toContain('role: "yayasan"');
    expect(spec).toContain("Antrean review gagal dimuat");
    expect(spec).toContain("getReviewQueueAction");
    expect(spec).toContain("Akses Dibatasi");
  });
});

describe("RVS-01 — behaviour of the shared predicate", () => {
  // The module is plain TypeScript with no framework dependency, so the contract it publishes is
  // testable directly; the page and the navigation read the same function.
  const users = {
    santri: { role: "santri", roles: ["santri"] },
    koordinator: { role: "koordinator", roles: ["koordinator"] },
    pengurus: { role: "pengurus", roles: ["pengurus"] },
    yayasan: { role: "yayasan", roles: ["yayasan"] },
    superAdmin: { role: "super_admin", roles: ["super_admin"] },
    santriPromoted: { role: "santri", roles: ["santri", "pengurus"] },
    adminAlsoReviewer: { role: "super_admin", roles: ["super_admin", "koordinator"] },
  };

  for (const [name, expected] of [
    ["santri", false],
    ["koordinator", true],
    ["pengurus", true],
    ["yayasan", false],
    ["superAdmin", false],
    ["santriPromoted", true],
    ["adminAlsoReviewer", true],
  ] as Array<[keyof typeof users, boolean]>) {
    it(`${name} -> can open the queue: ${expected}`, async () => {
      const { holdsReportReviewRole, REPORT_REVIEW_ROLES } = await import("@/lib/report-policy");
      expect(holdsReportReviewRole(users[name], REPORT_REVIEW_ROLES)).toBe(expected);
    });
  }
});
