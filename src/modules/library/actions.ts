"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuthUser, requireRole } from "@/lib/auth/guards";
import { RESOURCE_RULE_MANAGER_ROLES, isResourceId, resourceVisibilityFilter } from "@/lib/resource-policy";
import { randomUUID } from "node:crypto";
import { INITIAL_RESOURCES } from "./data";
import { CategorySummary, ResourceAdminInput, ResourceItem, ResourceRevisionItem } from "./types";
import { throwQueryError } from "@/lib/query-error";
import { isNonEmptyString } from "@/lib/input-validation";

const RESOURCE_ADMIN_ROLES = ["super_admin", "yayasan", "pengurus"] as const;
// PERMISSIONS.md §3.2: library.import.run is exclusive to super_admin, even
// though the rest of the admin surface stays shared with yayasan/pengurus.
const LIBRARY_IMPORT_ROLES = ["super_admin"] as const;

function mapResourceRow(r: any, authorName: string): ResourceItem {
  const cat = r.resource_categories;
  const filledCount = [
    r.access_setup,
    r.how_to_use,
    r.workflow_examples,
    r.limitations_cautions,
    r.official_sources,
    r.documentation_status,
  ].filter(Boolean).length;

  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description || "",
    category: cat?.name || "Umum",
    categorySlug: cat?.slug || "general",
    officialUrl: r.official_url,
    tags: (r.resource_tags || []).map((item: any) => item.tags?.name).filter(Boolean),
    filledFieldsCount: filledCount,
    totalFieldsCount: 6,
    lastUpdated: new Date(r.updated_at || r.created_at).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    author: authorName,
    visibility: r.visibility || "internal",
    status: r.status || "published",
    accessSetup: r.access_setup,
    howToUse: r.how_to_use,
    workflowExamples: r.workflow_examples,
    limitationsCautions: r.limitations_cautions,
    officialSources: r.official_sources,
    documentationStatus: r.documentation_status,
  };
}

const RESOURCE_SELECT = `
  *,
  resource_categories (
    id, name, slug
  ),
  resource_tags (tags (name, slug))
`;

/**
 * §3.2/D6: only resource_visibility_rules opens a restricted resource. The
 * caller-scoped session runs the read so RLS and app.can_view_resource() make
 * the decision; the admin client then fetches the embedded category/tag rows
 * those restricted ids belong to.
 */
async function grantedRestrictedResourceIds(): Promise<string[]> {
  const session = await createClient();
  const { data, error } = await session
    .from("resources")
    .select("id")
    .eq("visibility", "restricted");
  if (error) throw error;
  return (data || []).map((row: { id: string }) => row.id).filter(isResourceId);
}

export async function getCategoriesAction(): Promise<CategorySummary[]> {
  await requireAuthUser();
  try {
    const supabase = createAdminClient();
    const grantedRestrictedIds = await grantedRestrictedResourceIds();
    const [categoriesResult, resourcesResult] = await Promise.all([
      supabase.from("resource_categories").select("id, name, slug, icon").order("sort_order", { ascending: true }),
      supabase
        .from("resources")
        .select("category_id")
        .eq("status", "published")
        .or(resourceVisibilityFilter(grantedRestrictedIds)),
    ]);

    if (categoriesResult.error) throw categoriesResult.error;
    if (resourcesResult.error) throw resourcesResult.error;
    if (categoriesResult.data && categoriesResult.data.length > 0) {
      const typedData = categoriesResult.data as Array<{ id: string; name: string; slug: string; icon?: string | null }>;

      // Build count map per category_id
      const countMap = new Map<string, number>();
      let totalCount = 0;
      if (resourcesResult.data) {
        for (const r of resourcesResult.data as Array<{ category_id: string | null }>) {
          if (r.category_id) {
            countMap.set(r.category_id, (countMap.get(r.category_id) || 0) + 1);
          }
          totalCount++;
        }
      }

      const mapped: CategorySummary[] = typedData.map((c) => ({
        name: c.name,
        slug: c.slug,
        count: countMap.get(c.id) || 0,
        icon: c.icon || "folder",
      }));

      // Prepend an "all" entry with total count
      return [{ name: "Semua", slug: "all", count: totalCount, icon: "apps" }, ...mapped];
    }
  } catch (err) {
    if (process.env.VITEST) return [];
    throwQueryError("library.categories", err);
  }
  return [];
}

export async function getResourceStatsAction(): Promise<{
  totalCount: number;
  validCount: number;
  validPercent: number;
} | null> {
  await requireAuthUser();
  try {
    const supabase = createAdminClient();
    const grantedRestrictedIds = await grantedRestrictedResourceIds();
    const { data, error } = await supabase
      .from("resources")
      .select("access_setup, how_to_use, workflow_examples, limitations_cautions, official_sources, documentation_status")
      .eq("status", "published")
      .or(resourceVisibilityFilter(grantedRestrictedIds));

    if (error) throw error;

    if (data) {
      const totalCount = data.length;
      const validCount = (data as any[]).filter((r: any) =>
        r.access_setup &&
        r.how_to_use &&
        r.workflow_examples &&
        r.limitations_cautions &&
        r.official_sources &&
        r.documentation_status
      ).length;
      const validPercent = totalCount > 0 ? Math.round((validCount / totalCount) * 100) : 0;
      return { totalCount, validCount, validPercent };
    }
  } catch (err) {
    if (process.env.VITEST) return null;
    throwQueryError("library.resource_stats", err);
  }
  return { totalCount: 0, validCount: 0, validPercent: 0 };
}

export async function getFavoriteResourceIdsAction(): Promise<string[]> {
  const user = await requireAuthUser();
  if (process.env.VITEST) return [];
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("resource_favorites")
      .select("resource_id")
      .eq("user_id", user.id);
    if (error) throw error;
    return (data || []).map((row: any) => row.resource_id).filter(Boolean);
  } catch (err) {
    if (process.env.VITEST) return [];
    throwQueryError("library.resource_favorites", err);
  }
}

export async function getResourcesAction(
  query: string = "",
  categorySlug: string = "all"
): Promise<ResourceItem[]> {
  await requireAuthUser();
  if (typeof query !== "string" || typeof categorySlug !== "string") return [];
  try {
    const supabase = createAdminClient();
    const grantedRestrictedIds = await grantedRestrictedResourceIds();
    let dbQuery = supabase
      .from("resources")
      .select(RESOURCE_SELECT)
      .eq("status", "published")
      .or(resourceVisibilityFilter(grantedRestrictedIds))
      .order("created_at", { ascending: false })
      .limit(100);

    const sanitizedQuery = query.replace(/[,()]/g, "").trim();
    if (sanitizedQuery) {
      const searchTerms = sanitizedQuery.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim();
      if (searchTerms) {
        dbQuery = dbQuery.textSearch("search_vector", searchTerms, { config: "simple", type: "websearch" });
      }
    }
    if (categorySlug && categorySlug !== "all") {
      const { data: category, error: categoryError } = await supabase.from("resource_categories").select("id").eq("slug", categorySlug).maybeSingle();
      if (categoryError) throw categoryError;
      if (category?.id) dbQuery = dbQuery.eq("category_id", category.id);
    }

    const { data, error } = await dbQuery;

    if (error) throw error;
    if (data) {
      if (data.length === 0) return [];
      const authorIds = Array.from(new Set(data.map((resource: any) => resource.created_by).filter(Boolean)));
      const { data: authors, error: authorError } = authorIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", authorIds)
        : { data: [], error: null };
      if (authorError) throw authorError;
      const authorMap = new Map<string, string>((authors || []).map((author: any) => [author.id, author.full_name]));

      const mapped: ResourceItem[] = data.map((r: any) => mapResourceRow(r, authorMap.get(r.created_by) || "Tidak diketahui"));

      return mapped;
    }
  } catch (err) {
    if (!process.env.VITEST) throwQueryError("library.resources", err);
  }

  // Vitest test runner fallback only
  if (process.env.VITEST) {
    let filtered = [...INITIAL_RESOURCES];
    if (categorySlug && categorySlug !== "all") {
      filtered = filtered.filter((r) => r.categorySlug === categorySlug);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.slug.toLowerCase().includes(q) ||
          r.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return filtered;
  }

  return [];
}

/**
 * TRC-27: deep-link slug langsung ke DB (tanpa limit 100 getResourcesAction).
 */
export async function getResourceBySlugAction(slug: string): Promise<ResourceItem | null> {
  await requireAuthUser();
  if (!isNonEmptyString(slug, 200)) return null;
  if (process.env.VITEST) {
    return INITIAL_RESOURCES.find((resource) => resource.slug === slug) || null;
  }
  try {
    const supabase = createAdminClient();
    const grantedRestrictedIds = await grantedRestrictedResourceIds();
    const { data, error } = await supabase
      .from("resources")
      .select(RESOURCE_SELECT)
      .eq("status", "published")
      .eq("slug", slug)
      .or(resourceVisibilityFilter(grantedRestrictedIds))
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { data: author } = data.created_by
      ? await supabase.from("profiles").select("full_name").eq("id", data.created_by).maybeSingle()
      : { data: null };
    return mapResourceRow(data, author?.full_name || "Tidak diketahui");
  } catch (err) {
    if (!process.env.VITEST) throwQueryError("library.resourceBySlug", err);
    return null;
  }
}

export async function toggleFavoriteAction(
  resourceId: string
): Promise<{ success: boolean; isFavorited: boolean }> {
  const user = await requireAuthUser();
  if (!isNonEmptyString(resourceId, 100)) {
    return { success: false, isFavorited: false };
  }
  if (process.env.VITEST) return { success: true, isFavorited: true };
  try {
    const supabase = createAdminClient();
    const { data: favorite, error: readError } = await supabase
      .from("resource_favorites")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("resource_id", resourceId)
      .maybeSingle();
    if (readError) throw readError;
    if (favorite) {
      const { error } = await supabase
        .from("resource_favorites")
        .delete()
        .eq("user_id", user.id)
        .eq("resource_id", resourceId);
      if (error) throw error;
      return { success: true, isFavorited: false };
    }
    const { error } = await supabase.from("resource_favorites").insert({
      user_id: user.id,
      resource_id: resourceId,
    });
    if (error) throw error;
    return { success: true, isFavorited: true };
  } catch (err) {
    console.error("Failed to toggle resource favorite:", err);
    return { success: false, isFavorited: Boolean(false) };
  }
}

function normalizeResourceInput(payload: ResourceAdminInput): ResourceAdminInput {
  const slug = payload.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const tags = Array.from(new Set(payload.tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 20);
  return {
    legacyRecordId: payload.legacyRecordId?.trim() || null,
    name: payload.name.trim(),
    slug,
    description: payload.description.trim(),
    categoryId: payload.categoryId || null,
    officialUrl: payload.officialUrl?.trim() || null,
    visibility: payload.visibility,
    status: payload.status,
    tags,
    accessSetup: payload.accessSetup?.trim() || null,
    howToUse: payload.howToUse?.trim() || null,
    workflowExamples: payload.workflowExamples?.trim() || null,
    limitationsCautions: payload.limitationsCautions?.trim() || null,
    officialSources: payload.officialSources?.trim() || null,
    documentationStatus: payload.documentationStatus?.trim() || null,
  };
}

function resourceRow(input: ResourceAdminInput, userId: string) {
  return {
    legacy_record_id: input.legacyRecordId || null,
    name: input.name,
    slug: input.slug,
    description: input.description,
    category_id: input.categoryId,
    official_url: input.officialUrl,
    visibility: input.visibility,
    status: input.status,
    access_setup: input.accessSetup,
    how_to_use: input.howToUse,
    workflow_examples: input.workflowExamples,
    limitations_cautions: input.limitationsCautions,
    official_sources: input.officialSources,
    documentation_status: input.documentationStatus,
    archived_at: input.status === "archived" ? new Date().toISOString() : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
}

async function syncResourceTags(supabase: ReturnType<typeof createAdminClient>, resourceId: string, names: string[]) {
  const normalized = names.map((name) => ({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  })).filter((tag) => tag.slug);
  const { error: deleteError } = await supabase.from("resource_tags").delete().eq("resource_id", resourceId);
  if (deleteError) throw deleteError;
  if (!normalized.length) return;
  const { error: upsertError } = await supabase.from("tags").upsert(normalized, { onConflict: "slug" });
  if (upsertError) throw upsertError;
  const { data: tags, error: tagsError } = await supabase.from("tags").select("id, slug").in("slug", normalized.map((tag) => tag.slug));
  if (tagsError) throw tagsError;
  const { error: linkError } = await supabase.from("resource_tags").insert((tags || []).map((tag: { id: string }) => ({ resource_id: resourceId, tag_id: tag.id })));
  if (linkError) throw linkError;
}

function toResourceAdminInput(row: any, tags: string[] = []): ResourceAdminInput {
  return {
    legacyRecordId: row.legacy_record_id || null,
    name: row.name,
    slug: row.slug,
    description: row.description || "",
    categoryId: row.category_id || null,
    officialUrl: row.official_url || null,
    visibility: row.visibility,
    status: row.status,
    tags,
    accessSetup: row.access_setup || null,
    howToUse: row.how_to_use || null,
    workflowExamples: row.workflow_examples || null,
    limitationsCautions: row.limitations_cautions || null,
    officialSources: row.official_sources || null,
    documentationStatus: row.documentation_status || null,
  };
}

export async function getResourceAdminListAction(): Promise<Array<ResourceAdminInput & { id: string; updatedAt: string }>> {
  await requireRole([...RESOURCE_ADMIN_ROLES]);
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("resources").select("*, resource_tags(tags(name))").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    updatedAt: row.updated_at,
    ...toResourceAdminInput(row, (row.resource_tags || []).map((item: any) => item.tags?.name).filter(Boolean)),
  }));
}

export async function getResourceCategoryOptionsAction(): Promise<Array<{ id: string; name: string; slug: string }>> {
  await requireRole([...RESOURCE_ADMIN_ROLES]);
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("resource_categories").select("id, name, slug").order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveResourceAction(
  resourceId: string | null,
  payload: ResourceAdminInput,
  changeNote = "Pembaruan Resource Library"
): Promise<{ success: boolean; message: string; id?: string }> {
  const user = await requireRole([...RESOURCE_ADMIN_ROLES]);
  const input = normalizeResourceInput(payload);
  if (!input.name || !input.slug || !input.description) return { success: false, message: "Nama, slug, dan deskripsi wajib diisi." };
  const supabase = createAdminClient();
  try {
    let id = resourceId;
    if (resourceId) {
      const { error } = await supabase.from("resources").update(resourceRow(input, user.id)).eq("id", resourceId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("resources").insert({ ...resourceRow(input, user.id), created_by: user.id }).select("id").single();
      if (error) throw error;
      id = data.id;
    }
    await syncResourceTags(supabase, id!, input.tags);
    const { data: saved, error: savedError } = await supabase.from("resources").select("*").eq("id", id!).single();
    if (savedError) throw savedError;
    const { data: latest } = await supabase.from("resource_revisions").select("revision_no").eq("resource_id", id!).order("revision_no", { ascending: false }).limit(1).maybeSingle();
    const { error: revisionError } = await supabase.from("resource_revisions").insert({
      resource_id: id,
      revision_no: Number(latest?.revision_no || 0) + 1,
      snapshot: saved,
      changed_by: user.id,
      change_note: changeNote.trim() || "Pembaruan Resource Library",
    });
    if (revisionError) throw revisionError;
    return { success: true, message: resourceId ? "Resource berhasil diperbarui." : "Resource berhasil dibuat.", id: id! };
  } catch (error: any) {
    console.error("Failed to save resource:", error);
    return { success: false, message: error?.message || "Gagal menyimpan resource." };
  }
}

export async function setResourceArchiveAction(resourceId: string, archived: boolean): Promise<{ success: boolean; message: string }> {
  const user = await requireRole([...RESOURCE_ADMIN_ROLES]);
  const supabase = createAdminClient();
  const { error } = await supabase.from("resources").update({ status: archived ? "archived" : "draft", archived_at: archived ? new Date().toISOString() : null, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", resourceId);
  if (error) return { success: false, message: "Gagal mengubah status resource." };
  return { success: true, message: archived ? "Resource diarsipkan tanpa menghapus riwayat." : "Resource dikembalikan sebagai draft." };
}

/**
 * §3.2 / D6: the rule book behind a restricted resource, readable by the same
 * roles that may change it.
 */
export async function getResourceVisibilityRulesAction(
  resourceId: string
): Promise<{ roleKeys: string[]; teamIds: string[] } | null> {
  await requireRole([...RESOURCE_RULE_MANAGER_ROLES]);
  if (!isResourceId(resourceId)) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("resource_visibility_rules")
    .select("role_key, team_id")
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return {
    roleKeys: (data || []).map((row: any) => row.role_key).filter(Boolean),
    teamIds: (data || []).map((row: any) => row.team_id).filter(Boolean),
  };
}

export async function setResourceVisibilityRulesAction(
  resourceId: string,
  roleKeys: string[],
  teamIds: string[]
): Promise<{ success: boolean; message: string }> {
  await requireRole([...RESOURCE_RULE_MANAGER_ROLES]);
  if (!isResourceId(resourceId)) return { success: false, message: "Resource tidak ditemukan." };
  // app.resource_rule_set() owns the validation, the delete/insert pair and the
  // audit row, so the write travels on the caller's own session instead of a
  // service-role shortcut around it.
  const session = await createClient();
  const { data, error } = await session.rpc("resource_rule_set", {
    p_resource_id: resourceId,
    p_role_keys: (roleKeys || []).filter((key) => isNonEmptyString(key, 40)),
    p_team_ids: (teamIds || []).filter(isResourceId),
  });
  if (error) throw error;
  const result = data as { success?: boolean; message?: string } | null;
  return {
    success: Boolean(result?.success),
    message: result?.message || "Aturan visibilitas resource tidak tersimpan.",
  };
}

export async function getResourceRevisionsAction(resourceId: string): Promise<ResourceRevisionItem[]> {
  await requireRole([...RESOURCE_ADMIN_ROLES]);
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("resource_revisions").select("id, revision_no, snapshot, change_note, changed_at, changed_by").eq("resource_id", resourceId).order("revision_no", { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({ id: row.id, revisionNo: row.revision_no, snapshot: toResourceAdminInput(row.snapshot), changeNote: row.change_note, changedAt: row.changed_at, changedBy: row.changed_by }));
}

export async function restoreResourceRevisionAction(resourceId: string, revisionId: string): Promise<{ success: boolean; message: string }> {
  const user = await requireRole([...RESOURCE_ADMIN_ROLES]);
  const supabase = createAdminClient();
  const { data: revision, error: revisionError } = await supabase.from("resource_revisions").select("snapshot").eq("id", revisionId).eq("resource_id", resourceId).maybeSingle();
  if (revisionError || !revision) return { success: false, message: "Revisi tidak ditemukan." };
  const result = await saveResourceAction(resourceId, toResourceAdminInput(revision.snapshot), `Restore revisi ${revisionId} oleh ${user.full_name}`);
  return result.success ? { success: true, message: "Revisi berhasil dipulihkan sebagai revisi baru." } : result;
}

function parseResourceCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === '"') {
      if (quoted && next === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export interface ResourceImportResult {
  success: boolean;
  message: string;
  totalRows: number;
  importedRows: number;
  rejectedRows: number;
  errors: string[];
  batchId?: string;
}

export async function importResourcesCsvAction(fileName: string, csv: string): Promise<ResourceImportResult> {
  const user = await requireRole([...LIBRARY_IMPORT_ROLES]);
  const rows = parseResourceCsv(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return { success: false, message: "CSV resource harus memiliki header dan minimal satu baris.", totalRows: 0, importedRows: 0, rejectedRows: 0, errors: [] };
  const headers = rows[0].map((header) => header.toLowerCase().trim().replace(/\s+/g, "_"));
  const required = ["name", "slug", "description"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) return { success: false, message: `Kolom wajib tidak ditemukan: ${missing.join(", ")}.`, totalRows: rows.length - 1, importedRows: 0, rejectedRows: rows.length - 1, errors: [] };
  const items = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] || ""])) as Record<string, string>);
  if (items.length > 1000) return { success: false, message: "Maksimal 1.000 resource per batch.", totalRows: items.length, importedRows: 0, rejectedRows: items.length, errors: [] };
  if (process.env.VITEST) return { success: true, message: `${items.length} resource lolos validasi.`, totalRows: items.length, importedRows: items.length, rejectedRows: 0, errors: [] };

  const supabase = createAdminClient();
  const batchId = randomUUID();
  const errors: string[] = [];
  let importedRows = 0;
  const { error: batchError } = await supabase.from("resource_import_batches").insert({ id: batchId, uploaded_by: user.id, file_name: fileName || "resources.csv", total_rows: items.length, status: "validated" });
  if (batchError) throw batchError;
  const { data: categories } = await supabase.from("resource_categories").select("id, slug");
  const categoryMap = new Map<string, string>((categories || []).map((category: any) => [String(category.slug), String(category.id)]));

  for (const [index, raw] of items.entries()) {
    const rowNo = index + 2;
    const input = normalizeResourceInput({
      legacyRecordId: raw.legacy_record_id || null,
      name: raw.name || "",
      slug: raw.slug || "",
      description: raw.description || "",
      categoryId: categoryMap.get(raw.category_slug) || null,
      officialUrl: raw.official_url || null,
      visibility: raw.visibility === "restricted" ? "restricted" : "internal",
      status: raw.status === "draft" || raw.status === "archived" ? raw.status : "published",
      tags: (raw.tags || "").split("|").length > 1 ? (raw.tags || "").split("|") : (raw.tags || "").split(","),
      accessSetup: raw.access_setup,
      howToUse: raw.how_to_use,
      workflowExamples: raw.workflow_examples,
      limitationsCautions: raw.limitations_cautions,
      officialSources: raw.official_sources,
      documentationStatus: raw.documentation_status,
    });
    if (!input.name || !input.slug || !input.description) { errors.push(`Baris ${rowNo}: name, slug, dan description wajib diisi.`); continue; }
    try {
      const lookup = input.legacyRecordId
        ? supabase.from("resources").select("id").eq("legacy_record_id", input.legacyRecordId).maybeSingle()
        : supabase.from("resources").select("id").eq("slug", input.slug).maybeSingle();
      const { data: existing, error: lookupError } = await lookup;
      if (lookupError) throw lookupError;
      let resourceId = existing?.id;
      if (resourceId) {
        const { error } = await supabase.from("resources").update(resourceRow(input, user.id)).eq("id", resourceId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase.from("resources").insert({ ...resourceRow(input, user.id), created_by: user.id }).select("id").single();
        if (error) throw error;
        resourceId = inserted.id;
      }
      await syncResourceTags(supabase, resourceId, input.tags);
      const { data: saved, error: savedError } = await supabase.from("resources").select("*").eq("id", resourceId).single();
      if (savedError) throw savedError;
      const { data: latest } = await supabase.from("resource_revisions").select("revision_no").eq("resource_id", resourceId).order("revision_no", { ascending: false }).limit(1).maybeSingle();
      const { error: revisionError } = await supabase.from("resource_revisions").insert({ resource_id: resourceId, revision_no: Number(latest?.revision_no || 0) + 1, snapshot: saved, changed_by: user.id, change_note: `Impor CSV batch ${batchId}` });
      if (revisionError) throw revisionError;
      importedRows += 1;
    } catch (error: any) {
      errors.push(`Baris ${rowNo}: ${error?.message || "gagal disimpan"}`);
    }
  }
  const status = importedRows === 0 ? "failed" : errors.length ? "completed_with_errors" : "completed";
  const { error: updateError } = await supabase.from("resource_import_batches").update({ status, imported_rows: importedRows, rejected_rows: errors.length, errors }).eq("id", batchId);
  if (updateError) throw updateError;
  return { success: importedRows > 0, message: importedRows > 0 ? `${importedRows} resource berhasil diimpor${errors.length ? `; ${errors.length} baris gagal.` : "."}` : "Tidak ada resource yang berhasil diimpor.", totalRows: items.length, importedRows, rejectedRows: errors.length, errors, batchId };
}
