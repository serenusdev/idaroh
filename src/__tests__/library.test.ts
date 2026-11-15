import { describe, it, expect } from "vitest";
import { getResourcesAction, getResourceBySlugAction } from "@/modules/library/actions";
import { INITIAL_RESOURCES, CATEGORIES_DATA } from "@/modules/library/data";

describe("Stage 3 — Resource Library (PRD-02)", () => {
  it("provides categories matching Everything Library taxonomy", () => {
    expect(CATEGORIES_DATA.length).toBeGreaterThanOrEqual(6);
    const categorySlugs = CATEGORIES_DATA.map((c) => c.slug);
    expect(categorySlugs).toContain("database-backend");
    expect(categorySlugs).toContain("frontend-ui");
    expect(categorySlugs).toContain("media-desain");
    expect(categorySlugs).toContain("sop-operasional");
  });

  it("enforces 6 mandatory documentation fields per BR-LIB-01", () => {
    const topResource = INITIAL_RESOURCES[0];
    expect(topResource.accessSetup).toBeDefined();
    expect(topResource.howToUse).toBeDefined();
    expect(topResource.workflowExamples).toBeDefined();
    expect(topResource.limitationsCautions).toBeDefined();
    expect(topResource.officialSources).toBeDefined();
    expect(topResource.documentationStatus).toBeDefined();
  });

  it("filters resources correctly by search query and category", async () => {
    const searchResult = await getResourcesAction("supabase", "all");
    expect(searchResult.length).toBeGreaterThan(0);
    expect(searchResult[0].slug).toBe("supabase-db-rls");

    const categoryResult = await getResourcesAction("", "frontend-ui");
    expect(categoryResult.every((r) => r.categorySlug === "frontend-ui")).toBe(true);
  });

  it("handles empty fields without fabricating information per BR-LIB-02", () => {
    const nextjsBlueprint = INITIAL_RESOURCES.find((r) => r.slug === "nextjs-app-router-blueprint");
    expect(nextjsBlueprint).toBeDefined();
    // 5 filled fields out of 6
    expect(nextjsBlueprint?.filledFieldsCount).toBe(5);
  });

  it("resolves deep-link slug directly without the 100-resource list cap (TRC-27)", async () => {
    const resource = await getResourceBySlugAction("supabase-db-rls");
    expect(resource?.slug).toBe("supabase-db-rls");
    expect(resource?.filledFieldsCount).toBe(6);

    const missing = await getResourceBySlugAction("tidak-ada-slug-ini");
    expect(missing).toBeNull();

    const invalid = await getResourceBySlugAction("");
    expect(invalid).toBeNull();
  });
});

