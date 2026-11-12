"use client";

import * as React from "react";
import { Illustration } from "@/components/ui/illustration";
import { CategorySummary, ResourceItem } from "@/modules/library/types";
import { getResourcesAction, getCategoriesAction, getResourceStatsAction, getFavoriteResourceIdsAction, toggleFavoriteAction } from "@/modules/library/actions";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { writeCache } from "@/lib/data-cache";

export default function ResourceLibraryPage() {
  const { user } = useIdentity();
  const [selectedCategory, setSelectedCategory] = React.useState("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [onlyFavorites, setOnlyFavorites] = React.useState(false);
  const [onlyComplete, setOnlyComplete] = React.useState(false);
  const [selectedTag, setSelectedTag] = React.useState<string | null>(null);

  const resourcesQuery = useCachedData(`resources:list:${selectedCategory}:${searchQuery}`, () => getResourcesAction(searchQuery, selectedCategory));
  const categoriesQuery = useCachedData("resources:categories", getCategoriesAction);
  const statsQuery = useCachedData("resources:stats", getResourceStatsAction);
  const favoritesQuery = useCachedData(`resources:favorites:${user.id}`, getFavoriteResourceIdsAction);

  const resources: ResourceItem[] = React.useMemo(() => resourcesQuery.data ?? [], [resourcesQuery.data]);
  const categories: CategorySummary[] = categoriesQuery.data ?? [];
  const stats = statsQuery.data ?? null;
  const statsError = Boolean(statsQuery.error);
  const loadError = resourcesQuery.error?.message || categoriesQuery.error?.message || null;

  const [favorites, setFavorites] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries((favoritesQuery.data ?? []).map((id) => [id, true]))
  );
  React.useEffect(() => {
    if (favoritesQuery.data) {
      setFavorites(Object.fromEntries(favoritesQuery.data.map((id) => [id, true])));
    }
  }, [favoritesQuery.data]);
  React.useEffect(() => {
    writeCache(`resources:favorites:${user.id}`, Object.keys(favorites).filter((id) => favorites[id]));
  }, [favorites, user.id]);

  React.useEffect(() => {
    const resourceId = new URLSearchParams(window.location.search).get("resource");
    if (!resourceId) return;
    const match = resources.find((resource) => resource.id === resourceId);
    if (match) setDetailModalItem(match);
  }, [resources]);

  const [expandedFields, setExpandedFields] = React.useState<Record<string, boolean>>({});
  const [copyFeedback, setCopyFeedback] = React.useState<Record<string, boolean>>({});
  const [detailModalItem, setDetailModalItem] = React.useState<ResourceItem | null>(null);

  // Filter computation
  const filteredResources = React.useMemo(() => {
    return resources.filter((item) => {
      // Category match
      if (selectedCategory !== "all" && item.categorySlug !== selectedCategory) {
        return false;
      }
      // Favorites filter
      if (onlyFavorites && !favorites[item.id]) {
        return false;
      }
      // Completeness filter
      if (onlyComplete && item.filledFieldsCount < 6) {
        return false;
      }
      // Tag filter
      if (selectedTag && !item.tags.includes(selectedTag)) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesDesc = item.description.toLowerCase().includes(q);
        const matchesSlug = item.slug.toLowerCase().includes(q);
        const matchesTag = item.tags.some((t) => t.toLowerCase().includes(q));
        const matchesDocumentation = [
          item.accessSetup,
          item.howToUse,
          item.workflowExamples,
          item.limitationsCautions,
          item.officialSources,
          item.documentationStatus,
        ].some((field) => field?.toLowerCase().includes(q));
        if (!matchesName && !matchesDesc && !matchesSlug && !matchesTag && !matchesDocumentation) {
          return false;
        }
      }
      return true;
    });
  }, [resources, selectedCategory, searchQuery, onlyFavorites, onlyComplete, selectedTag, favorites]);

  const toggleFavorite = async (id: string) => {
    const result = await toggleFavoriteAction(id);
    if (!result.success) return;
    setFavorites((prev) => ({ ...prev, [id]: result.isFavorited }));
  };

  const toggleAccordion = (id: string) => {
    setExpandedFields((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleCopyLink = async (slug: string, id: string) => {
    const url = `${window.location.origin}/resources/${encodeURIComponent(slug)}`;
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopyFeedback((prev) => ({ ...prev, [id]: false }));
      }, 2000);
    } catch {
      setCopyFeedback((prev) => ({ ...prev, [id]: false }));
    }
  };

  const allTags: string[] = Array.from(new Set(resources.flatMap((r) => r.tags)));

  return (
    <div className="flex flex-col w-full pb-8 max-w-7xl mx-auto space-y-4">
      {/* 1. Sub-header & Operational Context */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent text-accent-foreground font-label-sm text-[12px] font-semibold">
            <span className="material-symbols-outlined text-[15px]">auto_stories</span>
            Everything Library v2.0
          </span>
          <div className="flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground bg-card px-2.5 py-0.5 rounded-full border border-border shadow-xs">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span>{statsError ? "Database Sync Error" : stats ? "Database Sync OK" : "Database Syncing..."}</span>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 mt-1">
          <div>
            <h1 className="font-headline-lg-mobile text-[24px] md:text-[30px] font-bold text-on-surface tracking-tight">
              Pustaka Pengetahuan &amp; Alat Digital
            </h1>
            <p className="font-body-sm text-body-sm text-muted-foreground leading-snug">
              Dokumentasi terstruktur 6 bidang wajib untuk santri digitalpreneur, pengurus, dan pengembang.
            </p>
          </div>
          {/* Quick Stats Pill (Desktop & Mobile) */}
          <div className="flex items-center gap-2 self-start md:self-auto">
            {stats === null && !statsError ? (
              <span className="px-3 py-1 rounded-lg bg-surface-container-high font-mono text-[12px] border border-primary/20 animate-pulse w-48 h-7" />
            ) : statsError ? (
              <span className="px-3 py-1 rounded-lg bg-surface-container-high text-muted-foreground font-mono text-[12px] font-medium border border-border/40">
                Stats tidak tersedia
              </span>
            ) : (
              <span className="px-3 py-1 rounded-lg bg-surface-container-high text-primary font-mono text-[12px] font-medium border border-primary/20">
                {stats!.totalCount} Item Termigrasi • {stats!.validPercent}% Valid
              </span>
            )}
          </div>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error" role="alert">
          {loadError}. Muat ulang halaman untuk mencoba lagi.
        </div>
      )}

      {/* 2. Migration Banner Stat (Stitch Screen Feature) */}
      <div className="rounded-xl bg-surface-container-low p-3.5 flex items-center justify-between shadow-xs border border-border/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center flex-shrink-0 text-primary">
            <span className="material-symbols-outlined text-[20px]">dataset</span>
          </div>
          <div className="flex flex-col min-w-0">
            <p className="font-label-sm text-label-sm text-on-surface truncate font-semibold">
              Resource Library terhubung ke database
            </p>
            <p className="font-body-sm text-[11px] text-muted-foreground truncate">
              Status dan kelengkapan ditampilkan berdasarkan data yang berhasil dibaca saat ini.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-surface-container-highest text-primary font-mono text-[12px] font-bold flex-shrink-0">
          {stats?.totalCount ?? "..."} Record ID
        </span>
      </div>

      {/* 3. Search-First Bar (LIB-002) */}
      <div className="relative flex items-center">
        <span className="material-symbols-outlined absolute left-3.5 text-muted-foreground text-[20px] pointer-events-none">
          search
        </span>
        <input
          className="w-full h-12 pl-11 pr-28 rounded-xl bg-card text-on-surface font-body-md text-body-md placeholder:text-muted-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:bg-surface-bright transition-all border border-border"
          placeholder="Cari alat, framework, SOP, dokumentasi..."
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="absolute right-1.5 flex items-center gap-1">
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted"
            >
              <span className="material-symbols-outlined text-[18px]">clear</span>
            </button>
          )}
          <button
            onClick={() => setOnlyFavorites(!onlyFavorites)}
            className={`h-9 px-2.5 flex items-center gap-1 rounded-lg transition-all text-label-sm font-label-sm ${
              onlyFavorites
                ? "bg-warning/20 text-warning font-semibold border border-warning/40"
                : "bg-surface-container text-on-surface-variant hover:text-primary"
            }`}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">star</span>
            <span className="hidden sm:inline">Favorit</span>
          </button>
        </div>
      </div>

      {/* 4. Mobile Category Pills (Horizontal Scroll) */}
      <div className="lg:hidden flex items-center gap-2 overflow-x-auto py-1 -mx-4 px-4 no-scrollbar">
        {categories.map((cat) => {
          const active = selectedCategory === cat.slug;
          return (
            <button
              key={cat.slug}
              onClick={() => setSelectedCategory(cat.slug)}
              className={`px-3.5 py-1.5 rounded-full font-label-sm text-label-sm whitespace-nowrap shadow-xs transition-all flex items-center gap-1.5 flex-shrink-0 ${
                active
                  ? "bg-primary text-on-primary font-semibold shadow-sm"
                  : "bg-card text-on-surface-variant hover:bg-surface-container border border-border"
              }`}
            >
              <span>{cat.name}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[11px] font-mono ${
                  active
                    ? "bg-primary-container text-on-primary-container"
                    : "bg-surface-container text-muted-foreground"
                }`}
              >
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 5. Responsive Grid Container (Desktop Sidebar + Content Layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 pt-1">
        {/* DESKTOP SIDEBAR: Taksonomi & Filter Cerdas (≥ 1024px) */}
        <div className="hidden lg:flex flex-col gap-5 col-span-1">
          {/* Categories Navigation Card */}
          <div className="bg-card rounded-2xl p-4 border border-border shadow-xs space-y-3">
            <h3 className="font-headline-sm text-[15px] font-semibold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">category</span>
              <span>Kategori Pustaka</span>
            </h3>

            <div className="space-y-1">
              {categories.map((cat) => {
                const active = selectedCategory === cat.slug;
                return (
                  <button
                    key={cat.slug}
                    onClick={() => setSelectedCategory(cat.slug)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left font-label-md text-[13px] transition-all ${
                      active
                        ? "bg-accent/70 text-primary font-semibold shadow-xs"
                        : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="material-symbols-outlined text-[17px] text-muted-foreground">
                        {cat.icon || "folder"}
                      </span>
                      <span className="truncate">{cat.name}</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground bg-surface-container/70 px-1.5 py-0.5 rounded-full">
                      {cat.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Filters Card */}
          <div className="bg-card rounded-2xl p-4 border border-border shadow-xs space-y-3">
            <h3 className="font-headline-sm text-[15px] font-semibold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">filter_list</span>
              <span>Filter Kualitas</span>
            </h3>

            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer text-[13px] font-label-md text-on-surface-variant select-none">
                <input
                  type="checkbox"
                  checked={onlyComplete}
                  onChange={(e) => setOnlyComplete(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary border-border"
                />
                <span>Hanya Lengkap (6/6 Bidang)</span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer text-[13px] font-label-md text-on-surface-variant select-none">
                <input
                  type="checkbox"
                  checked={onlyFavorites}
                  onChange={(e) => setOnlyFavorites(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary border-border"
                />
                <span>Tersimpan di Favorit</span>
              </label>
            </div>
          </div>

          {/* Popular Tags Card */}
          <div className="bg-card rounded-2xl p-4 border border-border shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-headline-sm text-[15px] font-semibold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">tag</span>
                <span>Tag Populer</span>
              </h3>
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag(null)}
                  className="text-[11px] text-primary hover:underline font-label-sm"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const active = selectedTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(active ? null : tag)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                      active
                        ? "bg-primary text-white font-semibold"
                        : "bg-surface-container text-muted-foreground hover:bg-accent/40 hover:text-primary"
                    }`}
                  >
                    #{tag}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* MAIN CONTENT AREA: Resource Cards & 6 Fields (3 Cols on Desktop) */}
        <div className="col-span-1 lg:col-span-3 space-y-4">
          {/* Active Filter Indicators */}
          {(selectedCategory !== "all" || onlyFavorites || onlyComplete || selectedTag || searchQuery) && (
            <div className="flex items-center justify-between bg-surface-container-low px-3.5 py-2 rounded-xl text-[12px] border border-border/40">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground font-label-sm">Filter Aktif:</span>
                {selectedCategory !== "all" && (
                  <span className="px-2 py-0.5 rounded-md bg-card text-primary font-mono border border-border">
                    {selectedCategory}
                  </span>
                )}
                {selectedTag && (
                  <span className="px-2 py-0.5 rounded-md bg-card text-primary font-mono border border-border">
                    #{selectedTag}
                  </span>
                )}
                {onlyFavorites && (
                  <span className="px-2 py-0.5 rounded-md bg-warning/20 text-warning font-label-sm">
                    Favorit
                  </span>
                )}
                {onlyComplete && (
                  <span className="px-2 py-0.5 rounded-md bg-success/15 text-success font-label-sm">
                    6/6 Lengkap
                  </span>
                )}
                {searchQuery && (
                  <span className="px-2 py-0.5 rounded-md bg-card text-on-surface font-mono border border-border">
                    &quot;{searchQuery}&quot;
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setSelectedCategory("all");
                  setSelectedTag(null);
                  setOnlyFavorites(false);
                  setOnlyComplete(false);
                  setSearchQuery("");
                }}
                className="text-primary hover:underline font-label-sm whitespace-nowrap ml-2"
              >
                Reset Semua
              </button>
            </div>
          )}

          {/* Empty State */}
          {filteredResources.length === 0 ? (
            <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
              <Illustration
                src="/illustrations/undraw_road-to-knowledge_ufma.svg"
                alt="Tidak Ada Resource yang Cocok"
                width={140}
                height={95}
              />
              <div>
                <h3 className="font-headline-sm text-base font-semibold text-on-surface">
                  Tidak Ada Resource yang Cocok
                </h3>
                <p className="font-body-sm text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                  Coba sesuaikan kata kunci pencarian atau ubah filter kategori pustaka.
                </p>
              </div>
            </div>
          ) : (
            filteredResources.map((item) => {
              const isExpanded = !!expandedFields[item.id];
              const isFav = !!favorites[item.id];
              const isCopied = !!copyFeedback[item.id];

              return (
                <div
                  key={item.id}
                  className="rounded-2xl bg-card p-4 sm:p-5 shadow-xs border border-border flex flex-col gap-3 relative transition-all hover:border-primary/30"
                >
                  {/* Header Card */}
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-surface-container text-on-surface font-label-sm text-[11px] font-medium">
                          {item.category}
                        </span>
                        {item.filledFieldsCount === 6 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent text-accent-foreground font-label-sm text-[11px] font-semibold">
                            <span className="material-symbols-outlined text-[13px] text-success">
                              verified
                            </span>
                            Lengkap (6/6 Bidang)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-[11px]">
                            <span className="material-symbols-outlined text-[13px]">
                              pending
                            </span>
                            {item.filledFieldsCount}/6 Terisi
                          </span>
                        )}
                      </div>

                      <h2 className="font-headline-sm text-[18px] sm:text-[20px] font-bold text-on-surface mt-1 leading-snug">
                        {item.name}
                      </h2>
                      <p className="font-mono text-[12px] text-primary font-medium tracking-tight">
                        {item.slug}
                      </p>
                    </div>

                    {/* Favorite Button */}
                    <button
                      aria-label="Simpan ke Favorit"
                      className={`w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-low transition-all active:scale-90 flex-shrink-0 ${
                        isFav
                          ? "text-warning bg-warning/15"
                          : "text-muted-foreground hover:text-warning hover:bg-accent/40"
                      }`}
                      onClick={() => toggleFavorite(item.id)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[22px]">star</span>
                    </button>
                  </div>

                  {/* Description */}
                  <p className="font-body-sm text-[13px] text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        onClick={() => setSelectedTag(tag)}
                        className="px-2 py-0.5 rounded-md bg-surface-container-low text-muted-foreground font-mono text-[11px] hover:text-primary hover:bg-accent/40 cursor-pointer transition-colors"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  {/* Official URL Link */}
                  {item.officialUrl && (
                    <a
                      className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-low text-primary hover:bg-surface-container transition-all border border-border/40"
                      href={item.officialUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="material-symbols-outlined text-[18px] flex-shrink-0">
                          public
                        </span>
                        <span className="font-mono text-[12px] truncate font-medium">
                          {item.officialUrl}
                        </span>
                      </div>
                      <span className="material-symbols-outlined text-[16px] text-muted-foreground flex-shrink-0">
                        open_in_new
                      </span>
                    </a>
                  )}

                  {/* 6 Mandatory Fields Accordion (BR-LIB-01) */}
                  <div className="flex flex-col gap-2 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="font-label-sm text-[12px] text-on-surface uppercase tracking-wide font-semibold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-primary text-[16px]">
                          fact_check
                        </span>
                        6 Bidang Dokumentasi Wajib (BR-LIB-01)
                      </span>
                      <button
                        className="font-label-sm text-[12px] text-primary hover:underline flex items-center gap-0.5"
                        onClick={() => toggleAccordion(item.id)}
                        type="button"
                      >
                        <span>{isExpanded ? "Tutup Rincian" : "Buka Rincian (6)"}</span>
                        <span className="material-symbols-outlined text-[16px]">
                          {isExpanded ? "expand_less" : "expand_more"}
                        </span>
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 animate-in fade-in duration-150">
                        {/* 1. Access & Setup */}
                        <div className="rounded-xl bg-surface-container-low p-3 flex flex-col gap-1 border border-border/40">
                          <div className="flex items-center gap-1.5 text-primary font-label-md text-[13px] font-semibold">
                            <span className="material-symbols-outlined text-[16px]">key</span>
                            <span>1. Access &amp; Setup</span>
                          </div>
                          <p className="font-body-sm text-[12px] text-on-surface-variant leading-relaxed">
                            {item.accessSetup || "Belum didokumentasikan"}
                          </p>
                        </div>

                        {/* 2. How to Use */}
                        <div className="rounded-xl bg-surface-container-low p-3 flex flex-col gap-1 border border-border/40">
                          <div className="flex items-center gap-1.5 text-primary font-label-md text-[13px] font-semibold">
                            <span className="material-symbols-outlined text-[16px]">terminal</span>
                            <span>2. How to Use</span>
                          </div>
                          <p className="font-body-sm text-[12px] text-on-surface-variant leading-relaxed">
                            {item.howToUse || "Belum didokumentasikan"}
                          </p>
                        </div>

                        {/* 3. Workflow & Examples */}
                        <div className="rounded-xl bg-surface-container-low p-3 flex flex-col gap-1 border border-border/40">
                          <div className="flex items-center gap-1.5 text-primary font-label-md text-[13px] font-semibold">
                            <span className="material-symbols-outlined text-[16px]">
                              account_tree
                            </span>
                            <span>3. Workflow &amp; Examples</span>
                          </div>
                          <p className="font-body-sm text-[12px] text-on-surface-variant leading-relaxed">
                            {item.workflowExamples || "Belum didokumentasikan"}
                          </p>
                        </div>

                        {/* 4. Limitations & Cautions */}
                        <div className="rounded-xl bg-error-container/30 p-3 flex flex-col gap-1 border border-error/20">
                          <div className="flex items-center gap-1.5 text-destructive font-label-md text-[13px] font-semibold">
                            <span className="material-symbols-outlined text-[16px]">warning</span>
                            <span>4. Limitations &amp; Cautions</span>
                          </div>
                          <p className="font-body-sm text-[12px] text-on-surface leading-relaxed">
                            {item.limitationsCautions || "Belum didokumentasikan"}
                          </p>
                        </div>

                        {/* 5. Official Sources */}
                        <div className="rounded-xl bg-surface-container-low p-3 flex flex-col gap-1 border border-border/40">
                          <div className="flex items-center gap-1.5 text-primary font-label-md text-[13px] font-semibold">
                            <span className="material-symbols-outlined text-[16px]">
                              library_books
                            </span>
                            <span>5. Official Sources</span>
                          </div>
                          <p className="font-body-sm text-[12px] text-on-surface-variant leading-relaxed">
                            {item.officialSources || "Belum didokumentasikan"}
                          </p>
                        </div>

                        {/* 6. Documentation Status */}
                        <div className="rounded-xl bg-surface-container-low p-3 flex flex-col gap-1 border border-border/40">
                          <div className="flex items-center gap-1.5 text-success font-label-md text-[13px] font-semibold">
                            <span className="material-symbols-outlined text-[16px]">
                              verified_user
                            </span>
                            <span>6. Documentation Status</span>
                          </div>
                          <p className="font-body-sm text-[12px] text-on-surface-variant flex items-center justify-between">
                            <span>{item.documentationStatus || "Belum diverifikasi"}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {item.lastUpdated}
                            </span>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40">
                    <button
                      className="h-11 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-[13px] flex items-center justify-center gap-1.5 active:scale-98 transition-all border border-border"
                      onClick={() => handleCopyLink(item.slug, item.id)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {isCopied ? "check" : "content_copy"}
                      </span>
                      <span>{isCopied ? "Tersalin!" : "Salin Tautan"}</span>
                    </button>
                    <button
                      className="h-11 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-[13px] flex items-center justify-center gap-1.5 active:scale-98 transition-all shadow-xs"
                      onClick={() => setDetailModalItem(item)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">menu_book</span>
                      <span>Buka Dokumen</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {/* End State Floating Note */}
          <div className="p-3.5 rounded-xl bg-surface-container-low flex items-center justify-center gap-2 text-center text-muted-foreground font-body-sm text-[12px] border border-border/40">
            <span className="material-symbols-outlined text-[16px]">lock_reset</span>
            <span>
              Akses edit dokumentasi dibatasi untuk role Pengurus &amp; Tim IT (BR-LIB-07 &amp; BR-LIB-08)
            </span>
          </div>
        </div>
      </div>

      {/* DETAIL DOCUMENT MODAL (Desktop Dialog & Mobile Sheet) */}
      {detailModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-2xl rounded-2xl border border-border shadow-2xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between pb-3 border-b border-border">
              <div>
                <span className="px-2 py-0.5 rounded-md bg-accent text-accent-foreground font-mono text-[11px] font-semibold">
                  {detailModalItem.category}
                </span>
                <h3 className="font-headline-sm text-[20px] font-bold text-on-surface mt-1">
                  {detailModalItem.name}
                </h3>
                <p className="font-mono text-[12px] text-muted-foreground">
                  Slug: {detailModalItem.slug}
                </p>
              </div>
              <button
                onClick={() => setDetailModalItem(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="font-label-md text-[13px] text-primary uppercase tracking-wide font-semibold mb-1">
                  Ringkasan Dokumentasi
                </h4>
                <p className="font-body-sm text-[14px] text-on-surface bg-surface-container-low p-3 rounded-xl leading-relaxed">
                  {detailModalItem.description}
                </p>
              </div>

              {/* 6 Fields Grid in Modal */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-surface-container-low border border-border/40">
                  <span className="font-label-sm text-[12px] text-primary font-semibold block mb-0.5">
                    1. Access &amp; Setup
                  </span>
                  <p className="font-body-sm text-[12px] text-on-surface-variant">
                    {detailModalItem.accessSetup || "Belum didokumentasikan"}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-surface-container-low border border-border/40">
                  <span className="font-label-sm text-[12px] text-primary font-semibold block mb-0.5">
                    2. How to Use
                  </span>
                  <p className="font-body-sm text-[12px] text-on-surface-variant">
                    {detailModalItem.howToUse || "Belum didokumentasikan"}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-surface-container-low border border-border/40">
                  <span className="font-label-sm text-[12px] text-primary font-semibold block mb-0.5">
                    3. Workflow &amp; Examples
                  </span>
                  <p className="font-body-sm text-[12px] text-on-surface-variant">
                    {detailModalItem.workflowExamples || "Belum didokumentasikan"}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-error-container/30 border border-error/20">
                  <span className="font-label-sm text-[12px] text-destructive font-semibold block mb-0.5">
                    4. Limitations &amp; Cautions
                  </span>
                  <p className="font-body-sm text-[12px] text-on-surface">
                    {detailModalItem.limitationsCautions || "Belum didokumentasikan"}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-surface-container-low border border-border/40">
                  <span className="font-label-sm text-[12px] text-primary font-semibold block mb-0.5">
                    5. Official Sources
                  </span>
                  <p className="font-body-sm text-[12px] text-on-surface-variant">
                    {detailModalItem.officialSources || "Belum didokumentasikan"}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-surface-container-low border border-border/40">
                  <span className="font-label-sm text-[12px] text-success font-semibold block mb-0.5">
                    6. Documentation Status
                  </span>
                  <p className="font-body-sm text-[12px] text-on-surface-variant">
                    {detailModalItem.documentationStatus || "Belum diverifikasi"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setDetailModalItem(null)}
                className="h-10 px-4 rounded-xl bg-card border border-border text-on-surface-variant font-label-md text-[13px]"
              >
                Tutup
              </button>
              {detailModalItem.officialUrl && (
                <a
                  href={detailModalItem.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-10 px-4 rounded-xl bg-primary text-white font-label-md text-[13px] flex items-center gap-1.5"
                >
                  <span>Buka Sumber Resmi</span>
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
