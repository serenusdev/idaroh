"use client";

import * as React from "react";
import { Illustration } from "@/components/ui/illustration";
import { PersonProfile, TeamStructureItem } from "@/modules/people/types";
import {
  revealContactNumberAction,
  getPeopleAction,
  getTeamsAction,
} from "@/modules/people/actions";
import { useCachedData } from "@/hooks/use-cached-data";

type ViewTab = "anggota" | "tim";

export default function TimPage() {
  const [activeTab, setActiveTab] = React.useState<ViewTab>("anggota");
  const [roleFilter, setRoleFilter] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const peopleQuery = useCachedData("people:list", getPeopleAction);
  const teamsQuery = useCachedData("teams:structure", getTeamsAction);
  const profiles: PersonProfile[] = React.useMemo(() => peopleQuery.data ?? [], [peopleQuery.data]);
  const teams: TeamStructureItem[] = teamsQuery.data ?? [];
  const loadError = peopleQuery.error?.message || teamsQuery.error?.message || null;
  const [selectedPerson, setSelectedPerson] = React.useState<PersonProfile | null>(null);
  const [unmaskedPhones, setUnmaskedPhones] = React.useState<Record<string, string>>({});
  const [toastNotice, setToastNotice] = React.useState<string | null>(null);

  // Dynamic member statistics
  const stats = React.useMemo(() => {
    return {
      total: profiles.length,
      santri: profiles.filter((p) => p.memberType === "santri").length,
      ustadz: profiles.filter((p) => p.memberType === "ustadz").length,
      pengurus: profiles.filter((p) => p.memberType === "pengurus").length,
      yayasan: profiles.filter((p) => p.memberType === "yayasan").length,
    };
  }, [profiles]);

  // Filter people based on role & search query
  const filteredProfiles = React.useMemo(() => {
    return profiles.filter((person) => {
      // Role filter
      if (roleFilter !== "all" && person.memberType !== roleFilter) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = person.name.toLowerCase().includes(q);
        const matchTeam = person.teamName.toLowerCase().includes(q);
        const matchRole = person.roleLabel.toLowerCase().includes(q);
        if (!matchName && !matchTeam && !matchRole) return false;
      }
      return true;
    });
  }, [profiles, roleFilter, searchQuery]);

  // Handle phone reveal action
  const handleToggleRevealPhone = async (person: PersonProfile) => {
    if (unmaskedPhones[person.id]) {
      // Re-mask
      setUnmaskedPhones((prev) => {
        const next = { ...prev };
        delete next[person.id];
        return next;
      });
      return;
    }

    const res = await revealContactNumberAction(person.id, "pengurus", "usr-salman");
    if (res.success && res.phoneNumber) {
      setUnmaskedPhones((prev) => ({ ...prev, [person.id]: res.phoneNumber! }));
    } else {
      setToastNotice(res.message);
      setTimeout(() => setToastNotice(null), 3500);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-24">
      {/* Toast Notice */}
      {loadError && (
        <div className="p-3.5 rounded-xl bg-error-container/30 text-error border border-error/30 text-xs sm:text-sm" role="alert">
          {loadError}. Muat ulang halaman untuk mencoba lagi.
        </div>
      )}
      {toastNotice && (
        <div className="p-3.5 rounded-xl bg-surface-container text-primary border border-border flex items-center justify-between text-xs sm:text-sm shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">info</span>
            <span>{toastNotice}</span>
          </div>
          <button
            onClick={() => setToastNotice(null)}
            className="text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Header Sub-title & Quick Stat Capsule */}
      <section className="flex flex-col gap-2.5 pt-1">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-label-sm text-xs text-primary tracking-wide uppercase font-semibold">
              PRD-07 • People &amp; Teams
            </p>
            <h1 className="font-headline-lg-mobile text-headline-sm sm:text-headline-md text-on-surface tracking-tight font-bold">
              Direktori Anggota &amp; Tim
            </h1>
          </div>
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-primary shrink-0 shadow-xs">
            <span className="material-symbols-outlined text-[22px]">diversity_3</span>
          </div>
        </div>

        {/* Stat bar pill */}
        <div className="flex flex-wrap items-center gap-2 bg-surface-container-high px-3.5 py-2.5 rounded-xl text-on-surface-variant text-xs sm:text-sm">
          <span className="inline-flex w-2 h-2 rounded-full bg-success animate-pulse"></span>
          <span className="font-label-sm font-semibold text-on-surface">
            {stats.total} Anggota Aktif
          </span>
          <span className="text-outline-variant">•</span>
          <span className="font-body-sm text-muted-foreground">
            {teams.length} Tim Kolaborasi
          </span>
          <div className="ml-auto flex items-center gap-1 text-primary">
            <span className="material-symbols-outlined text-[16px]">
              verified_user
            </span>
            <span className="font-label-sm text-[11px] font-medium hidden sm:inline">
              Data Terverifikasi
            </span>
          </div>
        </div>
      </section>

      {/* Segmented Tab Switcher */}
      <div className="grid grid-cols-2 p-1 bg-surface-variant rounded-xl gap-1 max-w-md">
        <button
          type="button"
          onClick={() => setActiveTab("anggota")}
          className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-label-md text-xs sm:text-sm transition-all ${
            activeTab === "anggota"
              ? "bg-card text-primary shadow-xs font-semibold"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">group</span>
          <span>Daftar Anggota</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("tim")}
          className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-label-md text-xs sm:text-sm transition-all ${
            activeTab === "tim"
              ? "bg-card text-primary shadow-xs font-semibold"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">account_tree</span>
          <span>Struktur Tim</span>
          <span className="px-1.5 py-0.2 bg-primary-container text-on-primary font-label-sm text-[10px] rounded-full">
            {teams.length}
          </span>
        </button>
      </div>

      {/* Search and Role Filter Chips */}
      {activeTab === "anggota" && (
        <div className="space-y-3">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[20px]">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama santri, ustadz, atau keahlian..."
              className="w-full h-11 pl-11 pr-10 bg-card rounded-xl text-on-surface font-body-md text-xs sm:text-sm placeholder:text-muted-foreground shadow-xs border border-border focus:outline-none focus:ring-2 focus:ring-primary transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>

          {/* Filter chips scroll */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-nowrap">
            {[
              { id: "all", label: "Semua", count: stats.total },
              { id: "santri", label: "Santri", count: stats.santri },
              { id: "ustadz", label: "Ustadz", count: stats.ustadz },
              { id: "pengurus", label: "Pengurus", count: stats.pengurus },
              { id: "yayasan", label: "Yayasan", count: stats.yayasan },
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setRoleFilter(chip.id)}
                className={`px-3.5 py-1.5 rounded-full font-label-sm text-xs transition-all flex items-center gap-1 ${
                  roleFilter === chip.id
                    ? "bg-primary text-on-primary font-medium shadow-xs"
                    : "bg-card hover:bg-surface-container text-on-surface-variant border border-border shadow-2xs"
                }`}
              >
                <span>{chip.label}</span>
                <span className="text-[11px] opacity-80">({chip.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Responsive Grid Layout (Desktop 2-Column, Mobile Stack) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Team Overview Cards & Guidance (Desktop Sticky) */}
        <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
          {/* Section: Ringkasan Tim Kolaborasi */}
          <section className="bg-card p-4 sm:p-5 rounded-2xl border border-border shadow-xs space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">
                  hub
                </span>
                <h3 className="font-headline-sm text-sm sm:text-base font-semibold text-on-surface">
                  Sekilas Tim Kolaborasi
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("tim")}
                className="font-label-sm text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                <span>Lihat Semua</span>
                <span className="material-symbols-outlined text-[14px]">
                  arrow_forward
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {teams.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-3">Belum ada tim aktif</p>
              ) : (
                teams.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setActiveTab("tim")}
                    className="p-3 rounded-xl bg-surface-container-low hover:bg-accent/40 cursor-pointer flex items-center justify-between gap-3 transition-all border border-border/40"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-surface text-primary flex items-center justify-center shrink-0 border border-border/40">
                        <span className="material-symbols-outlined text-[18px]">
                          {t.icon}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-label-md text-xs font-semibold text-on-surface truncate">
                          {t.name}
                        </h4>
                        <p className="font-body-sm text-[11px] text-muted-foreground truncate">
                          Koord: {t.coordinatorName}
                        </p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-secondary-container text-on-secondary-fixed font-label-sm text-[10px] font-semibold shrink-0">
                      {t.badgeLabel}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Guidance Micro-Banner */}
          <div className="bg-gradient-to-r from-accent/50 to-surface-container-high/60 rounded-2xl p-4 flex items-center gap-3.5 border border-border/40">
            <div className="w-9 h-9 rounded-full bg-card flex items-center justify-center text-primary shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-[20px]">handshake</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-label-md text-xs font-semibold text-on-surface leading-snug">
                Ta&apos;awun &amp; Sinergi Kerja
              </p>
              <p className="font-body-sm text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                Saling membantu antar penugasan tim. Koordinasikan kendala lapangan
                dengan pereview masing-masing.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Dynamic Tab Content (col-span-8) */}
        <div className="lg:col-span-8 space-y-4">
          {activeTab === "anggota" && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between text-muted-foreground px-0.5 text-xs">
                <span>Menampilkan {filteredProfiles.length} personil</span>
                <span className="flex items-center gap-1 text-primary cursor-pointer font-medium">
                  Urutkan: Sesuai Tim{" "}
                  <span className="material-symbols-outlined text-[14px]">
                    expand_more
                  </span>
                </span>
              </div>

              {/* Members List */}
              <div className="space-y-3.5">
                {filteredProfiles.length === 0 ? (
                  <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
                    <Illustration
                      src="/illustrations/undraw_connect-the-dots_4p4i.svg"
                      alt="Belum ada anggota tim ditemukan"
                      width={150}
                      height={88}
                    />
                    <div>
                      <p className="font-headline-sm text-base font-semibold text-on-surface">
                        Belum Ada Personil Terdaftar
                      </p>
                      <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                        Daftar santri, pengurus, dan staf pondok akan tampil di sini setelah akun aktif terdaftar.
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredProfiles.map((person) => {
                  const revealedPhone = unmaskedPhones[person.id];

                  return (
                    <article
                      key={person.id}
                      className="bg-card rounded-2xl p-4 sm:p-5 shadow-xs border border-border relative overflow-hidden transition-all hover:shadow-md hover:border-primary/40"
                    >
                      <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full pointer-events-none"></div>

                      <div className="flex items-start gap-3.5">
                        {/* Avatar & Online status */}
                        <div className="relative shrink-0">
                          {person.avatar ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={person.avatar}
                              alt={person.name}
                              className="w-13 h-13 rounded-full object-cover shadow-inner ring-1 ring-border"
                              style={{ width: "52px", height: "52px" }}
                            />
                          ) : (
                            <div
                              className="w-13 h-13 rounded-full bg-surface-dim flex items-center justify-center text-primary font-headline-sm font-semibold shadow-inner"
                              style={{ width: "52px", height: "52px" }}
                            >
                              {person.nickname?.slice(0, 2).toUpperCase() ||
                                person.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span
                            className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full shadow-xs ring-2 ring-card ${
                              person.onlineStatus === "active"
                                ? "bg-success"
                                : person.onlineStatus === "away"
                                ? "bg-warning"
                                : "bg-muted-foreground"
                            }`}
                            title={
                              person.onlineStatus === "active"
                                ? "Online Aktif"
                                : "Sedang Tugas Lapangan"
                            }
                          ></span>
                        </div>

                        {/* Name & Role Tags */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <h3 className="font-headline-sm text-sm sm:text-base font-semibold text-on-surface truncate">
                              {person.name}
                            </h3>
                            {person.isCurrentUser && (
                              <span className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-label-sm text-[10px] shrink-0 font-medium">
                                Anda
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md bg-secondary-container text-on-secondary-fixed font-label-sm text-[11px] font-medium">
                              {person.memberTypeLabel}
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-primary-container text-on-primary font-label-sm text-[11px] font-semibold flex items-center gap-1">
                              <span className="material-symbols-outlined text-[13px]">
                                military_tech
                              </span>
                              {person.roleLabel}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Detail Penugasan & Metadata */}
                      <div className="mt-3.5 pt-3 bg-surface-container-low rounded-xl p-3 space-y-2 border border-border/40 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-muted-foreground flex items-center gap-1 font-body-sm text-[12px] shrink-0">
                            <span className="material-symbols-outlined text-[16px] text-primary">
                              groups
                            </span>{" "}
                            Tim:
                          </span>
                          <span className="font-label-md text-on-surface text-right font-medium">
                            {person.teamName}
                          </span>
                        </div>

                        <div className="flex items-start justify-between gap-2">
                          <span className="text-muted-foreground flex items-center gap-1 font-body-sm text-[12px] shrink-0">
                            <span className="material-symbols-outlined text-[16px] text-tertiary">
                              assignment_ind
                            </span>{" "}
                            Pereview Utama:
                          </span>
                          <span className="font-label-sm text-primary font-semibold text-right">
                            {person.primaryReviewerName}
                          </span>
                        </div>

                        {/* Kontak Phone with Masking toggle */}
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-muted-foreground flex items-center gap-1 font-body-sm text-[12px]">
                            <span className="material-symbols-outlined text-[16px] text-secondary">
                              contact_phone
                            </span>{" "}
                            Kontak:
                          </span>

                          <button
                            type="button"
                            onClick={() => handleToggleRevealPhone(person)}
                            className="flex items-center gap-1.5 bg-card hover:bg-accent/40 px-2.5 py-0.5 rounded-md text-on-surface font-code-md text-xs border border-border transition-colors"
                            title="Klik untuk membuka / menutup nomor telepon"
                          >
                            <span
                              className={`material-symbols-outlined text-[13px] ${
                                revealedPhone ? "text-success" : "text-muted-foreground"
                              }`}
                            >
                              {revealedPhone ? "lock_open" : "lock"}
                            </span>
                            <span>{revealedPhone || person.phoneMasked}</span>
                          </button>
                        </div>
                      </div>

                      {/* Flags Kewajiban (BR-PPL-02 & PPL-008) */}
                      <div className="mt-3 flex items-center justify-between flex-wrap gap-1.5 pt-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {person.dutyFlags.attendanceRequired && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-success font-label-sm text-[11px] font-semibold">
                              <span className="material-symbols-outlined text-[14px]">
                                check_circle
                              </span>{" "}
                              Wajib Absen
                            </span>
                          )}

                          {person.dutyFlags.reportRequired && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-success font-label-sm text-[11px] font-semibold">
                              <span className="material-symbols-outlined text-[14px]">
                                description
                              </span>{" "}
                              Wajib Lapor Harian
                            </span>
                          )}

                          {person.specialBadge && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent text-accent-foreground font-label-sm text-[11px] font-semibold">
                              <span className="material-symbols-outlined text-[14px]">
                                fact_check
                              </span>{" "}
                              {person.specialBadge}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedPerson(person)}
                          className="w-8 h-8 rounded-lg bg-surface hover:bg-accent text-primary flex items-center justify-center transition-all ml-auto border border-border/50"
                          title="Buka profil detail"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            chevron_right
                          </span>
                        </button>
                      </div>
                    </article>
                  );
                }))}
              </div>
            </div>
          )}

          {/* TAB 2: Struktur Tim (Organization Hierarchy) */}
          {activeTab === "tim" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
                <span>Daftar {teams.length} divisi &amp; kelompok kerja pondok</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {teams.length === 0 ? (
                  <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3 col-span-full">
                    <Illustration
                      src="/illustrations/undraw_connect-the-dots_4p4i.svg"
                      alt="Belum ada struktur tim"
                      width={130}
                      height={90}
                    />
                    <div>
                      <p className="font-headline-sm text-base font-semibold text-on-surface">
                        Belum Ada Struktur Tim
                      </p>
                      <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                        Sentra dan divisi kerja pondok akan ditampilkan di sini.
                      </p>
                    </div>
                  </div>
                ) : (
                  teams.map((t) => (
                    <div
                      key={t.id}
                      className="p-5 rounded-2xl bg-card border border-border shadow-xs flex flex-col justify-between space-y-4"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-accent text-accent-foreground flex items-center justify-center">
                            <span className="material-symbols-outlined text-[22px]">
                              {t.icon}
                            </span>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-xs font-semibold">
                            {t.memberCount} Anggota
                          </span>
                        </div>

                        <h3 className="font-headline-sm text-base font-semibold text-on-surface">
                          {t.name}
                        </h3>
                        <p className="font-body-sm text-xs text-muted-foreground leading-relaxed">
                          {t.description}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">
                            Koordinator
                          </span>
                          <span className="font-semibold text-on-surface">
                            {t.coordinatorName}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setRoleFilter("all");
                            setSearchQuery(t.name.split(" ")[1] || "");
                            setActiveTab("anggota");
                          }}
                          className="h-8 px-3 rounded-lg bg-surface-container text-primary font-medium hover:bg-accent transition-colors flex items-center gap-1"
                        >
                          <span>Personil</span>
                          <span className="material-symbols-outlined text-[15px]">
                            chevron_right
                          </span>
                        </button>
                      </div>
                    </div>
                  )))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Dialog: Detail Profil Anggota */}
      {selectedPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-card rounded-2xl w-full max-w-md p-5 sm:p-6 shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="font-label-sm text-xs text-primary font-semibold uppercase">
                Profil Anggota Pondok OS
              </span>
              <button
                type="button"
                onClick={() => setSelectedPerson(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex items-center gap-3.5">
              {selectedPerson.avatar ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={selectedPerson.avatar}
                  alt={selectedPerson.name}
                  className="w-14 h-14 rounded-full object-cover shadow-inner"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-surface-dim flex items-center justify-center text-primary font-headline-sm font-semibold shadow-inner">
                  {selectedPerson.nickname?.slice(0, 2).toUpperCase() || "SA"}
                </div>
              )}
              <div>
                <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                  {selectedPerson.name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {selectedPerson.roleLabel} • {selectedPerson.teamName}
                </p>
              </div>
            </div>

            {selectedPerson.bio && (
              <p className="text-xs text-on-surface-variant italic bg-surface-container-low p-3 rounded-xl border border-border/40">
                &quot;{selectedPerson.bio}&quot;
              </p>
            )}

            <div className="space-y-2 text-xs bg-surface-container-low p-3.5 rounded-xl border border-border/50">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tipe Keanggotaan:</span>
                <span className="font-medium text-on-surface">
                  {selectedPerson.memberTypeLabel}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pereview Utama:</span>
                <span className="font-medium text-primary">
                  {selectedPerson.primaryReviewerName}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Nomor HP:</span>
                <span className="font-code-md text-on-surface">
                  {unmaskedPhones[selectedPerson.id] || selectedPerson.phoneMasked}
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedPerson(null)}
                className="h-9 px-4 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
