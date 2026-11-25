import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

// fs-only scans: a missing file must fail as an assertion, never as a throw, so
// the Stage-B evidence stays assertion-level (AGENTS.md / AGENT-WORKFLOW.md).
function readOrEmpty(relativePath: string): string {
  const full = resolve(root, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

const libraryActions = readOrEmpty("src/modules/library/actions.ts");
const resourcePolicy = readOrEmpty("src/lib/resource-policy.ts");
const migration = readOrEmpty("supabase/migrations/20261122000005_resource_visibility_rules.sql");
const rollback = readOrEmpty("supabase/rollback/20261122000005_resource_visibility_rules_down.sql");

describe("LIB-02 — resource visibility rules are the only route to `restricted` (D6)", () => {
  it("drops the blanket elevated branch from the library module", () => {
    expect(libraryActions).not.toContain("visibilityFilter");
    expect(libraryActions).not.toContain('"visibility.eq.internal,visibility.eq.restricted"');
    expect(libraryActions).not.toContain("hasMinimumRole");
  });

  it("asks the caller-scoped session which restricted rows RLS grants", () => {
    expect(resourcePolicy).not.toBe("");
    expect(libraryActions).toContain('from "@/lib/supabase/server"');
    expect(libraryActions).toContain('.eq("visibility", "restricted")');
    expect(libraryActions).toContain("createClient()");
  });

  it("applies the rule-derived filter on every public read path", () => {
    const uses = (libraryActions.match(/resourceVisibilityFilter\(/g) || []).length;
    // list, deep link, category counts and the documentation-stats panel all
    // count or return rows, so none of them may stay unfiltered.
    expect(uses).toBeGreaterThanOrEqual(4);
    expect(resourcePolicy).toContain("export function resourceVisibilityFilter");
  });

  it("keeps the rule manager list at library.resource.update tier (§3.2)", () => {
    const managerList = resourcePolicy.match(/RESOURCE_RULE_MANAGER_ROLES[^;]*;/)?.[0] ?? "";
    expect(managerList).toContain("pengurus");
    expect(managerList).toContain("yayasan");
    expect(managerList).toContain("super_admin");
    // library.resource.archive/update is pengurus-and-up; D7 (koordinator
    // team/own authoring) is a separate decision and stays out of this item.
    expect(managerList).not.toContain("koordinator");
    expect(managerList).not.toContain("santri");
    expect(resourcePolicy).toContain("§3.2");
    expect(resourcePolicy).toContain("D6");
  });

  it("ships the rules table, the predicate and the repointed policy", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.resource_visibility_rules");
    expect(migration).toContain("app.can_view_resource");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path");
    expect(migration).toContain('DROP POLICY IF EXISTS "Active users can view published internal resources" ON public.resources');
    expect(migration).toContain('CREATE POLICY "Active members can view granted resources"');
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    // §3.2: a restricted row without a rule opens for nobody, super_admin included.
    const predicateStart = migration.indexOf("CREATE OR REPLACE FUNCTION app.can_view_resource");
    const predicateBody = migration.slice(predicateStart, migration.indexOf("$$;", predicateStart));
    // Guard the slice itself: an empty extraction would let the negative
    // assertion below pass without testing anything.
    expect(predicateStart).toBeGreaterThan(-1);
    expect(predicateBody.length).toBeGreaterThan(200);
    expect(predicateBody).not.toMatch(/has_any_role|has_role\s*\(/);
    // Single argument: the predicate decides for the session owner only.
    expect(migration).toMatch(/FUNCTION app\.can_view_resource\(\s*p_resource_id uuid\s*\)/);
  });

  it("wires the rule book into the admin surface (§3.2 five-layer sync)", () => {
    const adminPage = readOrEmpty("src/app/(app)/admin/resources/page.tsx");
    expect(adminPage).toContain("getResourceVisibilityRulesAction");
    expect(adminPage).toContain("getResourceRuleOptionsAction");
    expect(adminPage).toContain("setResourceVisibilityRulesAction");
    // A restricted resource an operator cannot grant is a resource nobody reads.
    expect(adminPage).toContain('"restricted"');
    const guarded = (libraryActions.match(/requireRole\(\[\.\.\.RESOURCE_RULE_MANAGER_ROLES\]\)/g) || []).length;
    expect(guarded).toBeGreaterThanOrEqual(3);
    const toggle = libraryActions.slice(
      libraryActions.indexOf("export async function toggleFavoriteAction"),
      libraryActions.indexOf("function normalizeResourceInput")
    );
    expect(toggle.length).toBeGreaterThan(200);
    // Favouriting is the one write that takes a raw resource id from the client,
    // so it has to pass through the caller's own RLS-scoped read first.
    expect(toggle).toContain("createClient()");
    expect(toggle).toContain("isResourceId(resourceId)");
  });

  it("ships a rollback that restores the pre-fix policy verbatim", () => {
    expect(rollback).toContain('CREATE POLICY "Active users can view published internal resources"');
    expect(rollback).toContain("visibility = 'internal'");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.resource_visibility_rules");
  });
});
