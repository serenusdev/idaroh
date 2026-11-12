"use client";

import * as React from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { invalidateCache } from "@/lib/data-cache";
import {
  getResourceAdminListAction,
  getResourceCategoryOptionsAction,
  getResourceRevisionsAction,
  importResourcesCsvAction,
  restoreResourceRevisionAction,
  saveResourceAction,
  setResourceArchiveAction,
} from "@/modules/library/actions";
import type { ResourceAdminInput, ResourceRevisionItem } from "@/modules/library/types";

const EMPTY_FORM: ResourceAdminInput = {
  name: "",
  slug: "",
  description: "",
  categoryId: null,
  officialUrl: null,
  visibility: "internal",
  status: "draft",
  tags: [],
  accessSetup: "",
  howToUse: "",
  workflowExamples: "",
  limitationsCautions: "",
  officialSources: "",
  documentationStatus: "",
};

export default function AdminResourcesPage() {
  const { user } = useIdentity();
  const listQuery = useCachedData("admin:resources-list", getResourceAdminListAction);
  const categoriesQuery = useCachedData("admin:resource-categories", getResourceCategoryOptionsAction);
  const resources = listQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const [form, setForm] = React.useState<ResourceAdminInput>(EMPTY_FORM);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [revisions, setRevisions] = React.useState<ResourceRevisionItem[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [importCsv, setImportCsv] = React.useState("");
  const [importFileName, setImportFileName] = React.useState("resources.csv");
  const [importFeedback, setImportFeedback] = React.useState<string | null>(null);

  const loading = listQuery.isLoading || categoriesQuery.isLoading;
  const loadError = listQuery.error ?? categoriesQuery.error;
  React.useEffect(() => {
    if (loadError) setNotice("Data resource belum dapat dimuat. Silakan coba lagi.");
  }, [loadError]);

  const invalidateUserResources = () => {
    invalidateCache("resources:list");
    invalidateCache("resources:stats");
  };

  if (loading) return <div className="min-h-[360px] grid place-items-center"><LoadingSpinner size="lg" /></div>;
  if (!["super_admin", "yayasan", "pengurus"].includes(user.role)) {
    return <UnauthorizedState requiredRole="Super Admin / Yayasan / Pengurus" />;
  }

  const selectResource = async (resource: ResourceAdminInput & { id: string; updatedAt: string }) => {
    setEditingId(resource.id);
    setForm(resource);
    setRevisions(await getResourceRevisionsAction(resource.id));
  };

  const updateField = <K extends keyof ResourceAdminInput>(key: K, value: ResourceAdminInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const result = await saveResourceAction(editingId, { ...form, tags: form.tags });
    setNotice(result.message);
    if (result.success) {
      const items = await listQuery.refresh();
      setEditingId(result.id || editingId);
      if (result.id) {
        const saved = items?.find((item) => item.id === result.id);
        if (saved) setForm(saved);
        setRevisions(await getResourceRevisionsAction(result.id));
      }
      invalidateUserResources();
    }
    setSaving(false);
  };

  const archive = async (resource: ResourceAdminInput & { id: string; updatedAt: string }) => {
    const result = await setResourceArchiveAction(resource.id, resource.status !== "archived");
    setNotice(result.message);
    if (result.success) {
      await listQuery.refresh();
      invalidateUserResources();
    }
  };

  const restoreRevision = async (revision: ResourceRevisionItem) => {
    if (!editingId) return;
    const result = await restoreResourceRevisionAction(editingId, revision.id);
    setNotice(result.message);
    if (result.success) {
      const items = await listQuery.refresh();
      const saved = items?.find((item) => item.id === editingId);
      if (saved) setForm(saved);
      setRevisions(await getResourceRevisionsAction(editingId));
      invalidateUserResources();
    }
  };

  const importCsvResources = async () => {
    setImportFeedback(null);
    const result = await importResourcesCsvAction(importFileName, importCsv);
    setImportFeedback(`${result.message}${result.errors.length ? ` ${result.errors.slice(0, 3).join(" ")}` : ""}`);
    if (result.importedRows > 0) {
      await listQuery.refresh();
      setImportCsv("");
      invalidateUserResources();
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-20">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">LIB-ADMIN · Resource Library</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Kelola Resource Library</h1>
        <p className="text-sm text-muted-foreground mt-1">Buat, ubah, publikasikan, arsipkan, dan pulihkan resource tanpa menghapus riwayat revisi.</p>
      </header>
      {notice && <div className="rounded-xl border border-primary/30 bg-accent/30 p-3 text-sm" aria-live="polite">{notice}</div>}

      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div><h2 className="font-semibold">Impor Everything Library dari CSV</h2><p className="text-xs text-muted-foreground mt-1">Gunakan header: <code>name,slug,description,category_slug,tags,access_setup,how_to_use,workflow_examples,limitations_cautions,official_sources,documentation_status</code>. Pisahkan banyak tag dengan koma atau <code>|</code>.</p></div>
        <input value={importFileName} onChange={(event) => setImportFileName(event.target.value)} placeholder="Nama file" className="h-10 w-full rounded-lg border border-border bg-surface-container-low px-3 text-sm" />
        <textarea value={importCsv} onChange={(event) => setImportCsv(event.target.value)} rows={5} placeholder="name,slug,description,category_slug,tags\nSupabase,supabase,Database,database-backend,Postgres|RLS" className="w-full rounded-lg border border-border bg-surface-container-low px-3 py-2 font-mono text-xs" />
        <div className="flex items-center gap-3"><button type="button" disabled={!importCsv.trim()} onClick={() => void importCsvResources()} className="h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-on-primary disabled:opacity-50">Validasi &amp; impor</button>{importFeedback && <p className="text-xs text-muted-foreground" aria-live="polite">{importFeedback}</p>}</div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(360px,1.1fr)] gap-5 items-start">
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between gap-3">
            <div><h2 className="font-semibold">Daftar resource</h2><p className="text-xs text-muted-foreground mt-1">{resources.length} resource terdaftar</p></div>
            <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setRevisions([]); }} className="h-9 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold">Resource baru</button>
          </div>
          <div className="divide-y divide-border">
            {resources.map((resource) => (
              <div key={resource.id} className={`p-4 flex items-start justify-between gap-3 ${editingId === resource.id ? "bg-accent/30" : ""}`}>
                <button type="button" onClick={() => void selectResource(resource)} className="text-left min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{resource.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{resource.slug} · {resource.status} · {resource.visibility}</p>
                </button>
                <button type="button" onClick={() => void archive(resource)} className="text-xs text-error hover:underline whitespace-nowrap">
                  {resource.status === "archived" ? "Jadikan draft" : "Arsipkan"}
                </button>
              </div>
            ))}
            {resources.length === 0 && <p className="p-5 text-sm text-muted-foreground">Belum ada resource di database.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="font-semibold">{editingId ? "Edit resource" : "Resource baru"}</h2><p className="text-xs text-muted-foreground mt-1">Setiap simpan membuat snapshot revisi.</p></div>{editingId && <span className="text-[11px] font-mono text-muted-foreground">{editingId.slice(0, 8)}</span>}</div>
          <form onSubmit={save} className="space-y-3">
            <input required value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Nama resource" className="w-full h-10 rounded-lg border border-border bg-surface-container-low px-3 text-sm" />
            <input required value={form.slug} onChange={(e) => updateField("slug", e.target.value)} placeholder="slug-resource" className="w-full h-10 rounded-lg border border-border bg-surface-container-low px-3 text-sm font-mono" />
            <textarea required value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Deskripsi" rows={3} className="w-full rounded-lg border border-border bg-surface-container-low px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-3"><select value={form.categoryId || ""} onChange={(e) => updateField("categoryId", e.target.value || null)} className="h-10 rounded-lg border border-border bg-surface-container-low px-2 text-sm"><option value="">Tanpa kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input value={form.officialUrl || ""} onChange={(e) => updateField("officialUrl", e.target.value)} placeholder="URL resmi" className="h-10 rounded-lg border border-border bg-surface-container-low px-3 text-sm" /></div>
            <div className="grid grid-cols-2 gap-3"><select value={form.status} onChange={(e) => updateField("status", e.target.value as ResourceAdminInput["status"])} className="h-10 rounded-lg border border-border bg-surface-container-low px-2 text-sm"><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select><select value={form.visibility} onChange={(e) => updateField("visibility", e.target.value as ResourceAdminInput["visibility"])} className="h-10 rounded-lg border border-border bg-surface-container-low px-2 text-sm"><option value="internal">Internal</option><option value="restricted">Restricted</option></select></div>
            <input value={form.tags.join(", ")} onChange={(e) => updateField("tags", e.target.value.split(","))} placeholder="Tag, pisahkan dengan koma" className="w-full h-10 rounded-lg border border-border bg-surface-container-low px-3 text-sm" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{(["accessSetup", "howToUse", "workflowExamples", "limitationsCautions", "officialSources", "documentationStatus"] as const).map((field) => <textarea key={field} value={form[field] || ""} onChange={(e) => updateField(field, e.target.value)} placeholder={field} rows={3} className="w-full rounded-lg border border-border bg-surface-container-low px-3 py-2 text-sm" />)}</div>
            <button disabled={saving} type="submit" className="h-10 px-4 rounded-lg bg-primary text-on-primary text-xs font-semibold disabled:opacity-50">{saving ? "Menyimpan…" : "Simpan resource"}</button>
          </form>
          {editingId && revisions.length > 0 && <div className="mt-6 border-t border-border pt-4"><h3 className="text-sm font-semibold">Riwayat revisi</h3><div className="mt-2 space-y-2">{revisions.map((revision) => <div key={revision.id} className="flex items-center justify-between gap-2 text-xs"><span>Revisi {revision.revisionNo} · {new Date(revision.changedAt).toLocaleString("id-ID")}</span><button type="button" onClick={() => void restoreRevision(revision)} className="text-primary hover:underline">Pulihkan</button></div>)}</div></div>}
        </section>
      </div>
    </div>
  );
}
