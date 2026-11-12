"use client";

import * as React from "react";
import { Illustration } from "@/components/ui/illustration";
import {
  AnnouncementItem,
  ScheduleEventItem,
  WeekDayPickerItem,
} from "@/modules/schedules/types";
import {
  generateICalSubscriptionAction,
  markAnnouncementReadAction,
  publishAnnouncementAction,
  getEventsAction,
  getAnnouncementsAction,
} from "@/modules/schedules/actions";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { invalidateCache, writeCache } from "@/lib/data-cache";

type ScheduleTab = "agenda" | "announcements";

function buildWeekDays(dateStr: string, activeDate = dateStr): WeekDayPickerItem[] {
  const base = new Date(`${dateStr}T12:00:00+07:00`);
  const mondayOffset = (base.getUTCDay() + 6) % 7;
  base.setUTCDate(base.getUTCDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + index);
    const iso = date.toISOString().slice(0, 10);
    return {
      dayName: new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "Asia/Jakarta" }).format(date),
      dateNum: Number(iso.slice(-2)),
      fullDate: iso,
      isActive: iso === activeDate,
      hasEvent: false,
    };
  });
}

export default function JadwalPage() {
  const { user } = useIdentity();
  const [activeTab, setActiveTab] = React.useState<ScheduleTab>("agenda");
  const [selectedDate, setSelectedDate] = React.useState<string>(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  });
  const [weekDays, setWeekDays] = React.useState<WeekDayPickerItem[]>(() => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    return buildWeekDays(today);
  });
  const eventsQuery = useCachedData(`events:${user.id}`, getEventsAction);
  const announcementsQuery = useCachedData(`announcements:${user.id}`, getAnnouncementsAction);
  const [events, setEvents] = React.useState<ScheduleEventItem[]>(eventsQuery.data ?? []);
  const [announcements, setAnnouncements] = React.useState<AnnouncementItem[]>(announcementsQuery.data ?? []);

  React.useEffect(() => {
    if (eventsQuery.data) setEvents(eventsQuery.data);
  }, [eventsQuery.data]);
  React.useEffect(() => {
    if (announcementsQuery.data) setAnnouncements(announcementsQuery.data);
  }, [announcementsQuery.data]);
  React.useEffect(() => {
    writeCache(`events:${user.id}`, events);
  }, [events, user.id]);
  React.useEffect(() => {
    writeCache(`announcements:${user.id}`, announcements);
  }, [announcements, user.id]);
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [isPinnedDismissed, setIsPinnedDismissed] = React.useState(false);
  const [selectedEvent, setSelectedEvent] = React.useState<ScheduleEventItem | null>(null);
  const [activeAnnouncement, setActiveAnnouncement] = React.useState<AnnouncementItem | null>(null);
  const [icalNotice, setIcalNotice] = React.useState<string | null>(null);
  const [isCreatingAnn, setIsCreatingAnn] = React.useState(false);

  // New announcement form state
  const [newAnnTitle, setNewAnnTitle] = React.useState("");
  const [newAnnBody, setNewAnnBody] = React.useState("");
  const [newAnnPriority, setNewAnnPriority] = React.useState<"normal" | "important">("normal");
  const [newAnnAudience, setNewAnnAudience] = React.useState("Semua Santri & Tim");

  const unreadCount = announcements.filter((a) => !a.isRead).length;

  const handleDaySelect = (day: WeekDayPickerItem) => {
    setSelectedDate(day.fullDate);
    setWeekDays((prev) =>
      prev.map((d) => ({
        ...d,
        isActive: d.fullDate === day.fullDate,
      }))
    );
  };

  const handleDateJump = (dateStr: string) => {
    if (!dateStr) return;
    setSelectedDate(dateStr);
    setWeekDays(buildWeekDays(dateStr, dateStr));
  };

  const handleMarkRead = async (annId: string) => {
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === annId ? { ...a, isRead: true } : a))
    );
    await markAnnouncementReadAction(annId);
  };

  const handleGenerateIcal = async () => {
    const res = await generateICalSubscriptionAction();
    if (res.success) {
      setIcalNotice(res.icalUrl);
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAnnTitle.trim() || !newAnnBody.trim()) return;

    const res = await publishAnnouncementAction({
      title: newAnnTitle,
      bodyMarkdown: newAnnBody,
      priority: newAnnPriority,
      targetAudienceLabel: newAnnAudience,
      audienceConfig: newAnnAudience.toLowerCase().includes("pengurus")
        ? { scope: "member_type", memberTypes: ["pengurus"] }
        : newAnnAudience.toLowerCase().includes("koordinator")
          ? { scope: "member_type", memberTypes: ["koordinator"] }
          : newAnnAudience.toLowerCase().includes("santri") && !newAnnAudience.toLowerCase().includes("tim")
            ? { scope: "member_type", memberTypes: ["santri"] }
            : { scope: "all" },
    });

    if (res.success && res.announcement) {
      setAnnouncements((prev) => [res.announcement!, ...prev]);
      invalidateCache("admin:announcements");
      setIsCreatingAnn(false);
      setNewAnnTitle("");
      setNewAnnBody("");
    }
  };

  const filteredEvents = events.filter((evt) => {
    const dateMatches = !selectedDate || !evt.dateStr || evt.dateStr === selectedDate;
    const categoryMatches = categoryFilter === "all" || evt.category === categoryFilter;
    return dateMatches && categoryMatches;
  });

  const pinnedAnnouncement = announcements.find((a) => a.isPinned);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-24">
      {/* Sub-header & Quick Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-primary">
            <span className="material-symbols-outlined text-[18px]">
              calendar_today
            </span>
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold text-xs">
              Pekan Akademik 12 • Semester Ganjil
            </span>
          </div>
          <h1 className="font-headline-sm text-headline-sm text-on-surface truncate">
            Jadwal &amp; Pengumuman
          </h1>
        </div>

        {/* Date Quick Jump & Action Buttons */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <label className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent text-accent-foreground font-label-sm text-xs shadow-xs hover:bg-accent/80 transition-all cursor-pointer">
            <span className="material-symbols-outlined text-[16px]">event</span>
            <span className="font-medium">{selectedDate || "Pilih tanggal"}</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => handleDateJump(event.target.value)}
              className="sr-only"
              aria-label="Lompat ke tanggal"
            />
          </label>

          <button
            type="button"
            onClick={handleGenerateIcal}
            className="h-8 px-3 rounded-full bg-card border border-border text-on-surface font-label-sm text-xs flex items-center gap-1 hover:text-primary transition-colors"
            title="Sinkronisasi iCal Kalender"
          >
            <span className="material-symbols-outlined text-[15px] text-primary">
              sync_alt
            </span>
            <span className="hidden sm:inline">Sinkron iCal</span>
          </button>
        </div>
      </div>

      {/* iCal Notification Notice */}
      {icalNotice && (
        <div className="p-3.5 rounded-xl bg-surface-container text-primary border border-border flex items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[18px] shrink-0">
              link
            </span>
            <span className="truncate">
              Tautan iCal: <code>{icalNotice}</code>
            </span>
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(icalNotice);
              setIcalNotice(null);
            }}
            className="px-2.5 py-1 rounded bg-primary text-on-primary text-xs shrink-0"
          >
            Salin Link
          </button>
        </div>
      )}

      {/* Primary Tab Switcher */}
      <div className="p-1 rounded-xl bg-surface-container flex items-center gap-1 max-w-md">
        <button
          type="button"
          onClick={() => setActiveTab("agenda")}
          className={`flex-1 py-2 rounded-lg font-label-md text-label-md flex items-center justify-center gap-1.5 transition-all duration-200 ${
            activeTab === "agenda"
              ? "bg-card text-primary shadow-xs font-semibold"
              : "text-on-surface-variant hover:text-primary"
          }`}
        >
          <span
            className="material-symbols-outlined text-[18px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            event_note
          </span>
          <span>Agenda Kegiatan</span>
          <span className="w-1.5 h-1.5 rounded-full bg-primary ml-0.5"></span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("announcements")}
          className={`flex-1 py-2 rounded-lg font-label-md text-label-md flex items-center justify-center gap-1.5 transition-all duration-200 ${
            activeTab === "announcements"
              ? "bg-card text-primary shadow-xs font-semibold"
              : "text-on-surface-variant hover:text-primary"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">campaign</span>
          <span>Pengumuman Resmi</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-error text-on-error font-code-md text-[10px] leading-tight font-bold">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Main Responsive Grid Layout (Desktop 2-Column, Mobile Stack) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Weekly Agenda Strip & Pinned Notice (Desktop Sticky) */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-20">
          {/* Horizontal Weekly Agenda Strip Widget */}
          <div className="rounded-xl bg-card p-4 shadow-sm border border-border flex flex-col gap-3">
            <div className="flex items-center justify-between text-muted-foreground font-label-sm text-xs px-1">
              <span className="font-body-md text-on-surface text-xs font-semibold">
                {selectedDate
                  ? new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(`${selectedDate}T12:00:00+07:00`))
                  : "Kalender operasional"}
              </span>
              <div className="flex items-center gap-1 text-[11px] text-primary">
                <span className="material-symbols-outlined text-[14px]">tune</span>
                <span>Pekan 12</span>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {weekDays.map((d) => (
                <button
                  key={d.fullDate}
                  type="button"
                  onClick={() => handleDaySelect(d)}
                  className={`flex flex-col items-center py-2 px-1 rounded-lg transition-all ${
                    d.isActive
                      ? "bg-primary-container text-on-primary shadow-xs ring-2 ring-primary/20"
                      : "hover:bg-muted text-on-surface-variant"
                  }`}
                >
                  <span
                    className={`font-label-sm text-[11px] ${
                      d.isActive ? "text-on-primary-container" : "text-muted-foreground"
                    }`}
                  >
                    {d.dayName}
                  </span>
                  <span
                    className={`font-code-md text-xs mt-0.5 ${
                      d.isActive ? "font-bold text-on-primary" : "font-medium"
                    }`}
                  >
                    {d.dateNum}
                  </span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full mt-1 ${
                      d.isActive
                        ? "bg-primary-fixed"
                        : d.hasEvent
                        ? "bg-primary"
                        : "bg-outline-variant"
                    }`}
                  ></span>
                </button>
              ))}
            </div>
          </div>

          {/* Pinned / Important Announcement Banner (BR-SCH-07) */}
          {pinnedAnnouncement && !isPinnedDismissed && (
            <div className="relative overflow-hidden rounded-xl bg-surface-container-high p-4 shadow-xs border border-border/50 flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-tertiary-container text-on-tertiary-container flex items-center justify-center shrink-0">
                    <span
                      className="material-symbols-outlined text-[20px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      campaign
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant font-label-sm text-[11px] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">
                        push_pin
                      </span>
                      <span>Penting &amp; Pinned</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-card text-muted-foreground font-label-sm text-[11px]">
                      {pinnedAnnouncement.expiresAtStr || "Berlaku"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPinnedDismissed(true)}
                  aria-label="Tutup notifikasi pinned"
                  className="text-on-surface-variant hover:text-on-surface p-1"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              <div>
                <h2 className="font-headline-sm text-sm font-semibold text-on-surface leading-snug">
                  {pinnedAnnouncement.title}
                </h2>
                <p className="font-body-sm text-xs text-on-surface-variant line-clamp-2 mt-1">
                  {pinnedAnnouncement.bodyMarkdown}
                </p>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5 text-muted-foreground font-label-sm text-[11px]">
                  <span className="material-symbols-outlined text-[14px]">
                    groups
                  </span>
                  <span>{pinnedAnnouncement.targetAudienceLabel}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveAnnouncement(pinnedAnnouncement)}
                  className="text-primary font-label-sm text-xs flex items-center gap-0.5 hover:underline"
                >
                  <span>Baca Selengkapnya</span>
                  <span className="material-symbols-outlined text-[15px]">
                    arrow_forward
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Bottom Quick Reminder Card */}
          <div className="rounded-xl bg-surface-container-low p-3.5 flex items-center gap-3 border border-border/40">
            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shrink-0 text-primary">
              <span className="material-symbols-outlined text-[22px]">
                notifications_active
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-label-md text-xs font-semibold text-on-surface truncate">
                Notifikasi Otomatis Aktif
              </p>
              <p className="font-body-sm text-[11px] text-muted-foreground leading-tight">
                Pengingat dikirim 15 menit sebelum setiap agenda dimulai.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Tab View (Agenda vs Announcements) (col-span-7) */}
        <div className="lg:col-span-7 space-y-4">
          {activeTab === "agenda" && (
            <div className="space-y-4">
              {/* Category Filter Pills & Session Count */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-headline-sm text-sm font-semibold text-on-surface">
                    Jadwal {selectedDate ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).format(new Date(`${selectedDate}T12:00:00+07:00`)) : "Terpilih"}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-code-md text-xs font-semibold">
                    {filteredEvents.length} Sesi
                  </span>
                </div>

                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                  {[
                    { id: "all", label: "Semua" },
                    { id: "teknologi", label: "Teknologi" },
                    { id: "keagamaan", label: "Keagamaan" },
                    { id: "operasional", label: "Operasional" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategoryFilter(cat.id)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        categoryFilter === cat.id
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container text-on-surface hover:bg-accent"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Agenda Items Timeline List (SCH-002) */}
              <div className="space-y-3">
                {filteredEvents.length === 0 ? (
                  <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
                    <Illustration
                      src="/illustrations/undraw_done_erdp.svg"
                      alt="Belum ada agenda"
                      width={130}
                      height={90}
                    />
                    <div>
                      <p className="font-headline-sm text-base font-semibold text-on-surface">
                        Belum Ada Agenda Jadwal
                      </p>
                      <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                        Jadwal kajian, kelas teknologi, dan kegiatan santri akan ditampilkan di sini.
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className="rounded-xl bg-card p-4 sm:p-5 shadow-xs border border-border flex flex-col gap-3 transition-all hover:border-primary/40"
                    >
                    {/* Time & Status Badge */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-primary text-[18px]">
                          schedule
                        </span>
                        <span className="font-code-md text-xs sm:text-sm font-medium text-primary">
                          {evt.timeRangeStr}
                        </span>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded-full font-label-sm text-xs flex items-center gap-1 ${
                          evt.statusBadge === "on_schedule"
                            ? "bg-accent text-accent-foreground"
                            : evt.statusBadge === "location_changed"
                            ? "bg-warning/20 text-tertiary font-semibold"
                            : "bg-secondary-container text-on-secondary-container"
                        }`}
                      >
                        <span
                          className="material-symbols-outlined text-[13px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          {evt.statusBadge === "on_schedule"
                            ? "check_circle"
                            : evt.statusBadge === "location_changed"
                            ? "warning"
                            : "alarm"}
                        </span>
                        <span>{evt.statusLabel}</span>
                      </span>
                    </div>

                    {/* Category & Title */}
                    <div className="flex flex-col gap-1">
                      <span className="px-2 py-0.5 rounded bg-surface-container text-primary font-label-sm text-[10px] tracking-wide uppercase self-start">
                        {evt.categoryLabel}
                      </span>
                      <h3 className="font-headline-sm text-sm sm:text-base font-semibold text-on-surface">
                        {evt.title}
                      </h3>
                    </div>

                    {/* Location & Host Meta */}
                    <div className="space-y-1.5 pt-0.5 text-on-surface-variant font-body-sm text-xs">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-muted-foreground">
                          apartment
                        </span>
                        <span className="truncate">
                          {evt.location}
                          {evt.previousLocation && (
                            <span className="ml-1.5 line-through text-muted-foreground text-[11px]">
                              {evt.previousLocation}
                            </span>
                          )}
                        </span>
                      </div>

                      {(evt.speakerOrHost || evt.groupName) && (
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px] text-muted-foreground">
                            account_circle
                          </span>
                          <span className="truncate">
                            {evt.speakerOrHost || evt.groupName}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Bottom Action & Attendance Info */}
                    <div className="pt-2 flex items-center justify-between border-t border-border/40">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {evt.attendeesCount ? (
                          <span>+{evt.attendeesCount} santri terdaftar</span>
                        ) : (
                          <span>{evt.subNote || "Sesuai regulasi pesantren"}</span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedEvent(evt)}
                        className="px-3 py-1.5 rounded-lg bg-surface-container text-primary font-label-sm text-xs hover:bg-accent transition-colors flex items-center gap-1"
                      >
                        <span>{evt.actionLabel}</span>
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

          {/* TAB 2: Official Announcements Feed */}
          {activeTab === "announcements" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-headline-sm text-sm font-semibold text-on-surface">
                  Semua Pengumuman ({announcements.length})
                </span>

                <button
                  type="button"
                  onClick={() => setIsCreatingAnn(true)}
                  className="h-8 px-3 rounded-lg bg-primary text-on-primary font-label-sm text-xs flex items-center gap-1 hover:bg-primary-container transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Buat Pengumuman</span>
                </button>
              </div>

              <div className="space-y-3">
                {announcements.length === 0 ? (
                  <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
                    <Illustration
                      src="/illustrations/adapted/undraw_notify_drs8.svg"
                      alt="Belum ada pengumuman"
                      width={140}
                      height={103}
                    />
                    <div>
                      <p className="font-headline-sm text-base font-semibold text-on-surface">
                        Belum Ada Pengumuman
                      </p>
                      <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                        Pengumuman penting atau informasi pondok akan ditampilkan di sini.
                      </p>
                    </div>
                  </div>
                ) : (
                  announcements.map((ann) => (
                    <div
                      key={ann.id}
                      className={`p-4 sm:p-5 rounded-xl bg-card border shadow-xs space-y-3 transition-all ${
                        !ann.isRead
                          ? "border-primary ring-1 ring-primary/20"
                          : "border-border"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {ann.priority === "important" && (
                            <span className="px-2 py-0.5 rounded-full bg-error-container text-on-error-container text-[11px] font-semibold flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">
                                priority_high
                              </span>
                              Penting
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {ann.publishedAtStr}
                          </span>
                        </div>

                        {!ann.isRead ? (
                          <button
                            type="button"
                            onClick={() => handleMarkRead(ann.id)}
                            className="text-xs text-primary hover:underline font-medium"
                          >
                            Tandai Sudah Dibaca
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-success">
                              done_all
                            </span>
                            Sudah Dibaca
                          </span>
                        )}
                      </div>

                      <div>
                        <h3 className="font-headline-sm text-sm sm:text-base font-semibold text-on-surface">
                          {ann.title}
                        </h3>
                        <p className="font-body-sm text-xs sm:text-sm text-muted-foreground leading-relaxed mt-1">
                          {ann.bodyMarkdown}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs text-muted-foreground">
                        <span>Target: {ann.targetAudienceLabel}</span>
                        {ann.expiresAtStr && <span>Berlaku {ann.expiresAtStr}</span>}
                      </div>
                    </div>
                  )))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Dialog: Event Detail */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-card rounded-2xl w-full max-w-md p-5 shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="px-2 py-0.5 rounded bg-surface-container text-primary font-label-sm text-[10px] uppercase">
                {selectedEvent.categoryLabel}
              </span>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div>
              <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                {selectedEvent.title}
              </h3>
              <p className="font-code-md text-xs text-primary font-medium mt-1">
                {selectedEvent.timeRangeStr}
              </p>
            </div>

            <div className="space-y-2 text-xs text-on-surface bg-surface-container-low p-3 rounded-xl border border-border/50">
              <p>
                <strong>Lokasi:</strong> {selectedEvent.location}
              </p>
              {selectedEvent.previousLocation && (
                <p className="text-tertiary">
                  <strong>Catatan Perubahan:</strong> Dipindahkan dari{" "}
                  {selectedEvent.previousLocation}.
                </p>
              )}
              {selectedEvent.speakerOrHost && (
                <p>
                  <strong>Pemateri/Koordinator:</strong> {selectedEvent.speakerOrHost}
                </p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="h-9 px-4 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dialog: Read Full Announcement */}
      {activeAnnouncement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-card rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-xs font-semibold">
                Pengumuman Resmi Pondok OS
              </span>
              <button
                type="button"
                onClick={() => setActiveAnnouncement(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div>
              <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                {activeAnnouncement.title}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Diterbitkan pada {activeAnnouncement.publishedAtStr} • Target:{" "}
                {activeAnnouncement.targetAudienceLabel}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low text-xs sm:text-sm text-on-surface leading-relaxed whitespace-pre-line border border-border/50">
              {activeAnnouncement.bodyMarkdown}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  handleMarkRead(activeAnnouncement.id);
                  setActiveAnnouncement(null);
                }}
                className="h-9 px-4 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold shadow-xs"
              >
                Tandai Sudah Paham &amp; Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dialog: Buat Pengumuman Baru */}
      {isCreatingAnn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-card rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                Buat Pengumuman Resmi
              </h3>
              <button
                type="button"
                onClick={() => setIsCreatingAnn(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateAnnouncement} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">
                  Judul Pengumuman <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newAnnTitle}
                  onChange={(e) => setNewAnnTitle(e.target.value)}
                  placeholder="Contoh: Pembaruan Jadwal Kajian Akbar Bulanan"
                  className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface block">
                    Prioritas
                  </label>
                  <select
                    value={newAnnPriority}
                    onChange={(e) =>
                      setNewAnnPriority(e.target.value as "normal" | "important")
                    }
                    className="w-full h-10 px-2.5 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="normal">Normal</option>
                    <option value="important">Penting &amp; Pinned</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface block">
                    Target Audiens
                  </label>
                  <input
                    type="text"
                    value={newAnnAudience}
                    onChange={(e) => setNewAnnAudience(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">
                  Isi Pengumuman <span className="text-error">*</span>
                </label>
                <textarea
                  required
                  value={newAnnBody}
                  onChange={(e) => setNewAnnBody(e.target.value)}
                  rows={4}
                  placeholder="Tuliskan pengumuman resmi..."
                  className="w-full p-2.5 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsCreatingAnn(false)}
                  className="h-10 px-4 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-muted"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-10 px-5 rounded-xl bg-primary text-on-primary text-xs font-semibold shadow-xs hover:bg-primary-container"
                >
                  Terbitkan Pengumuman
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
