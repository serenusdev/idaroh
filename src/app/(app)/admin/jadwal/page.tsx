"use client";

import * as React from "react";
import Link from "next/link";
import { useIdentity } from "@/components/auth/identity-context";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Illustration } from "@/components/ui/illustration";
import { Modal } from "@/components/ui/modal";
import {
  getEventsAction,
  getAdminAnnouncementsAction,
  createEventAction,
  updateEventAction,
  deleteEventAction,
  setEventOccurrenceCancelledAction,
  publishAnnouncementAction,
  saveAnnouncementDraftAction,
  updateAnnouncementAction,
  deleteAnnouncementAction,
  getEventAudienceOptionsAction,
} from "@/modules/schedules/actions";
import type { ScheduleEventItem, AnnouncementItem } from "@/modules/schedules/types";
import type { CreateEventPayload } from "@/modules/schedules/actions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cacheKeys, invalidateAnnouncements, invalidateEvents } from "@/lib/cache-keys";
import {
  AGENDA_MANAGER_ROLES,
  AGENDA_WRITE_ROLES,
  holdsScheduleRole,
} from "@/lib/schedule-policy";

function toJakartaDateTimeLocal(value?: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * An edit form cannot express every audience the picker offers. This sentinel marks a stored
 * scope the picker has no option for, so submitting keeps the stored value instead of widening
 * it to the whole pondok (SCH-07). The server omits the key from the RPC payload when the
 * audience is undefined, and app.event_upsert() only replaces an audience it was given.
 */
const KEEP_STORED_AUDIENCE = "__keep_stored_audience__";

/**
 * The audience an agenda may be addressed to (SCH-02).
 *
 * A manager picks the whole pondok or any team. A coordinator only picks a team it
 * actively coordinates — the scopes §2 rule 1 forbids (an audience derived from
 * profiles.member_type) are not offered at all, because app.can_write_event_audience()
 * refuses them on the way in.
 *
 * ANN-CMD reuses the picker for announcements; only the noun changes, because the announcement
 * surface §3.6 grants the same tiers as the agenda surface.
 */
function AudiencePicker({
  tier,
  teams,
  value,
  onChange,
  subject = "agenda",
}: {
  tier: "manager" | "coordinator" | "none";
  teams: { id: string; name: string }[];
  value: string;
  onChange: (teamId: string) => void;
  subject?: string;
}) {
  if (tier === "none") {
    return (
      <p className="font-body-sm text-xs text-muted-foreground">
        {subject === "agenda"
          ? "Agenda hanya dapat ditandai untuk seluruh pondok oleh pengurus, yayasan, atau super admin."
          : "Pengumuman hanya dapat diterbitkan untuk seluruh pondok oleh pengurus, yayasan, atau super admin."}
      </p>
    );
  }
  const keepsStoredAudience = value === KEEP_STORED_AUDIENCE;
  return (
    <div className="space-y-2">
      <select
        id={subject === "agenda" ? "event-audience" : "announcement-audience"}
        name="audienceTeamId"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 px-3 rounded-xl border border-border bg-surface font-body-sm text-sm text-on-surface"
      >
        {keepsStoredAudience && (
          <option value={KEEP_STORED_AUDIENCE}>Audiens tersimpan (tidak diubah)</option>
        )}
        {tier === "manager" && <option value="">Seluruh pondok</option>}
        {teams.length === 0 && !keepsStoredAudience && (
          <option value="" disabled>
            Tidak ada tim yang dapat dipilih
          </option>
        )}
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            Tim: {team.name}
          </option>
        ))}
      </select>
      {keepsStoredAudience && (
        <p className="font-body-sm text-xs text-warning">
          {subject === "agenda"
            ? "Audiens agenda ini memakai konfigurasi lama (berbasis kategori anggota atau daftar"
            : "Audiens pengumuman ini memakai konfigurasi lama (berbasis kategori anggota atau daftar"}{" "}
          pengguna tertentu) dan tetap dipertahankan. Pilih seluruh pondok atau sebuah tim hanya
          jika audiensnya memang ingin diganti.
        </p>
      )}
      <p className="font-body-sm text-xs text-muted-foreground">
        {tier === "manager"
          ? "Pemirsa disimpan sebagai audiens pondok atau audiens tim; database yang menilai ulang hak Anda."
          : subject === "agenda"
            ? "Sebagai koordinator, agenda hanya dapat ditandai untuk tim yang Anda koordinatori."
            : "Sebagai koordinator, pengumuman hanya dapat diterbitkan untuk tim yang Anda koordinatori."}
      </p>
    </div>
  );
}


export default function AdminJadwalPage() {
  const { user: currentUser } = useIdentity();
  const [activeTab, setActiveTab] = React.useState<"agenda" | "pengumuman">("agenda");

  // §3.6 grants schedule.event.* to the koordinator at scope own, while announcement.* and
  // the per-day cancel (SCH-01) stay on the manager tier. Which agenda a caller may write
  // is decided by the database; this only decides which surface is rendered and loaded.
  const isAgendaManager = holdsScheduleRole(currentUser, AGENDA_MANAGER_ROLES);
  const canManageEvents = holdsScheduleRole(currentUser, AGENDA_WRITE_ROLES);
  const canManageAnnouncements = isAgendaManager;

  // Data states
  // `admin:events` and not `events`: this fetch keeps the cancelled days so the restore control
  // has a row to act on, and the user surfaces hold their own key. Both keys carry the session id
  // and the active role (CACHE-01), so a manager cannot read a santri entry or vice versa.
  const queryClient = useQueryClient();
  const eventsQuery = useQuery({
    queryKey: cacheKeys.adminEvents(currentUser),
    queryFn: () => getEventsAction({ includeCancelledOccurrences: true }),
    enabled: canManageEvents,
  });
  const announcementsQuery = useQuery({
    queryKey: cacheKeys.adminAnnouncements(currentUser),
    queryFn: getAdminAnnouncementsAction,
    enabled: canManageAnnouncements,
  });
  // The audience options only change with team membership, so they may outlive the agenda lists.
  const audienceQuery = useQuery({
    queryKey: cacheKeys.audience(currentUser),
    queryFn: getEventAudienceOptionsAction,
    enabled: canManageEvents,
    staleTime: 5 * 60_000,
  });
  const events: ScheduleEventItem[] = eventsQuery.data ?? [];
  const announcements: AnnouncementItem[] = announcementsQuery.data ?? [];
  const isLoadingData = eventsQuery.isLoading || announcementsQuery.isLoading;
  const loadError = eventsQuery.error || announcementsQuery.error;
  const [feedbackNotice, setFeedbackNotice] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Modal states
  const [isEventModalOpen, setIsEventModalOpen] = React.useState(false);
  const [isAnnouncementModalOpen, setIsAnnouncementModalOpen] = React.useState(false);
  const [editingEventId, setEditingEventId] = React.useState<string | null>(null);
  const [editingAnnouncementId, setEditingAnnouncementId] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [occurrenceBusyId, setOccurrenceBusyId] = React.useState<string | null>(null);

  // Event form
  const [eventForm, setEventForm] = React.useState({
    title: "",
    category: "teknologi" as "teknologi" | "keagamaan" | "operasional" | "umum",
    startsAt: "",
    endsAt: "",
    location: "Lab Utama Pesantren",
    description: "",
    // "" means the whole pondok; any other value is a team id offered by
    // getEventAudienceOptionsAction() for this session.
    audienceTeamId: "",
    recurrenceRule: "none" as "none" | "daily" | "weekly",
    recurrenceUntil: "",
  });

  // Announcement form
  const [announcementForm, setAnnouncementForm] = React.useState({
    title: "",
    bodyMarkdown: "",
    priority: "normal" as "normal" | "important",
    targetAudienceLabel: "Semua Santri & Tim",
    // Same convention as the agenda picker: "" is the whole pondok, a team id addresses one team,
    // and the keep-sentinel carries an audience the picker cannot express (SCH-07, ANN-CMD).
    audienceTeamId: "",
    status: "published" as "draft" | "published",
    scheduledFor: "",
    expiresAt: "",
  });

  // The Server Actions stay the only write path (they are the layer that calls the RPC, checks
  // auth.uid() and writes audit_logs). A mutation here only owns the cache reset that follows a
  // committed write: the manager list, the user surfaces and the dashboard's data-cache copy.
  const eventSaveMutation = useMutation({
    mutationFn: (payload: CreateEventPayload) =>
      editingEventId ? updateEventAction(editingEventId, payload) : createEventAction(payload),
    onSettled: () => invalidateEvents(queryClient, currentUser),
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) => deleteEventAction(eventId),
    onSettled: () => invalidateEvents(queryClient, currentUser),
  });

  // SCH-01: one cancelled day changes the manager list (it keeps the exception rows) and the
  // user list (it hides them), so both keys go stale from this single place.
  const occurrenceMutation = useMutation({
    mutationFn: ({ evt, cancelled }: { evt: ScheduleEventItem; cancelled: boolean }) =>
      setEventOccurrenceCancelledAction(evt.id, cancelled),
    onSettled: () => invalidateEvents(queryClient, currentUser),
  });

  // The three announcement verbs share a payload, so one mutation carries the dispatch the
  // handler already made and owns the reset of both announcement keys (manager + user view).
  const announcementMutation = useMutation({
    mutationFn: (payload: Parameters<typeof publishAnnouncementAction>[0]) =>
      editingAnnouncementId
        ? updateAnnouncementAction(editingAnnouncementId, payload)
        : payload.status === "draft"
          ? saveAnnouncementDraftAction(payload)
          : publishAnnouncementAction(payload),
    onSettled: () => invalidateAnnouncements(queryClient, currentUser),
  });

  const announcementDeleteMutation = useMutation({
    mutationFn: (announcementId: string) => deleteAnnouncementAction(announcementId),
    onSettled: () => invalidateAnnouncements(queryClient, currentUser),
  });

  const myTeamKeys = new Set(
    (audienceQuery.data?.coordinated ?? []).flatMap((team) => [team.id, team.name])
  );
  const canEditEventRow = (evt: ScheduleEventItem) =>
    isAgendaManager ||
    Boolean(evt.groupName && myTeamKeys.has(evt.groupName)) ||
    (evt.audienceConfig?.teamIds ?? []).some((teamId) => myTeamKeys.has(String(teamId)));

  if (!canManageEvents) {
    return <UnauthorizedState requiredRole="Pengurus / Yayasan / Super Admin / Koordinator" />;
  }

  // Handle Event Submit
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedbackNotice(null);

    const payload: CreateEventPayload = {
      title: eventForm.title,
      category: eventForm.category,
      startsAt: eventForm.startsAt,
      endsAt: eventForm.endsAt,
      location: eventForm.location,
      description: eventForm.description,
      // An event audience is always all|team now; the team id doubles as events.team_id
      // so app.can_write_event_audience() can judge it against the caller's teams.
      // Undefined is the "leave the stored audience alone" signal (SCH-07).
      audienceConfig: eventForm.audienceTeamId === KEEP_STORED_AUDIENCE ? undefined
        : eventForm.audienceTeamId ? { scope: "team", teamIds: [eventForm.audienceTeamId] }
        : { scope: "all" },
      teamId: eventForm.audienceTeamId === KEEP_STORED_AUDIENCE ? undefined
        : eventForm.audienceTeamId || undefined,
      recurrenceRule: eventForm.recurrenceRule,
      recurrenceUntil: eventForm.recurrenceUntil || undefined,
    };
    const res = await eventSaveMutation.mutateAsync(payload);

    setIsSubmitting(false);
    if (res.success) {
      setFeedbackNotice({ type: "success", message: res.message });
      setIsEventModalOpen(false);
      setEditingEventId(null);
      setEventForm({
        title: "",
        category: "teknologi",
        startsAt: "",
        endsAt: "",
        location: "Lab Utama Pesantren",
        description: "",
        audienceTeamId: "",
        recurrenceRule: "none",
        recurrenceUntil: "",
      });
    } else {
      setFeedbackNotice({ type: "error", message: res.message });
    }
  };

  // Handle Event Delete
  const handleDeleteEvent = async (id: string, title: string) => {
    if (!confirm(`Hapus agenda "${title}" dari jadwal?`)) return;
    const res = await deleteEventMutation.mutateAsync(id);
    setFeedbackNotice({ type: res.success ? "success" : "error", message: res.message });
  };

  // SCH-01: one day of a recurring agenda can be cancelled without touching the
  // rest of the series. The row keeps its own id as the list key and the series id
  // in baseEventId, so only the day-level write uses the composite reference.
  const handleToggleOccurrence = async (evt: ScheduleEventItem) => {
    const restore = Boolean(evt.cancelledOccurrence);
    const dayLabel = evt.dateStr || evt.occurrenceDate || "hari itu";
    if (!confirm(restore
      ? `Pulihkan agenda "${evt.title}" pada ${dayLabel}?`
      : `Batalkan agenda "${evt.title}" hanya pada ${dayLabel}?`)) return;
    setOccurrenceBusyId(evt.id);
    setFeedbackNotice(null);
    const res = await occurrenceMutation.mutateAsync({ evt, cancelled: !restore });
    setOccurrenceBusyId(null);
    setFeedbackNotice({ type: res.success ? "success" : "error", message: res.message });
  };

  // The stored audience may name a team by id, slug or display name; the picker is keyed
  // by id, so the closest option is selected instead of silently dropping the value. A scope
  // the picker cannot offer at all resolves to the keep-sentinel rather than to "" (SCH-07).
  const audienceTeamValue = (evt: ScheduleEventItem) => {
    const scope = evt.audienceConfig?.scope;
    if (scope === undefined || scope === "all") return "";
    if (scope !== "team") return KEEP_STORED_AUDIENCE;
    const stored = String(evt.audienceConfig?.teamIds?.[0] ?? evt.groupName ?? "");
    // A team-scoped agenda whose team cannot be resolved is kept as stored too: defaulting to
    // "" would silently re-address the agenda to the whole pondok on an unrelated edit.
    if (!stored) return KEEP_STORED_AUDIENCE;
    const match = (audienceQuery.data?.teams ?? []).find(
      (team) => team.id === stored || team.name === stored
    );
    return match ? match.id : stored;
  };

  const handleEditEvent = (evt: ScheduleEventItem) => {
    setEditingEventId(evt.baseEventId || evt.id);
    setEventForm({
      title: evt.title,
      category: evt.category,
      startsAt: toJakartaDateTimeLocal(evt.startsAt),
      endsAt: toJakartaDateTimeLocal(evt.endsAt),
      location: evt.location,
      description: evt.subNote || "",
      audienceTeamId: audienceTeamValue(evt),
      recurrenceRule: (evt.recurrenceRule || "none") as typeof eventForm.recurrenceRule,
      recurrenceUntil: evt.recurrenceUntil ? toJakartaDateTimeLocal(evt.recurrenceUntil) : "",
    });
    setIsEventModalOpen(true);
  };

  // ANN-CMD: the announcement composer offers the same audience shapes the RPC accepts. The row's
  // team_id never reaches the client, so a stored team audience is matched from teamIds alone;
  // anything else resolves to the keep-sentinel rather than silently widening to the pondok.
  const announcementAudienceValue = (ann: AnnouncementItem) => {
    const scope = ann.audienceConfig?.scope;
    if (scope === undefined || scope === "all") return "";
    if (scope !== "team") return KEEP_STORED_AUDIENCE;
    const stored = String(ann.audienceConfig?.teamIds?.[0] ?? "");
    if (!stored) return KEEP_STORED_AUDIENCE;
    const match = (audienceQuery.data?.teams ?? []).find(
      (team) => team.id === stored || team.name === stored
    );
    return match ? match.id : stored;
  };

  const emptyAnnouncementForm = {
    title: "",
    bodyMarkdown: "",
    priority: "normal" as "normal" | "important",
    targetAudienceLabel: "Semua Santri & Tim",
    audienceTeamId: "",
    status: "published" as "draft" | "published",
    scheduledFor: "",
    expiresAt: "",
  };

  // Handle Announcement Submit
  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedbackNotice(null);

    const payload = {
      title: announcementForm.title,
      bodyMarkdown: announcementForm.bodyMarkdown,
      priority: announcementForm.priority,
      targetAudienceLabel: announcementForm.targetAudienceLabel,
      audienceConfig: announcementForm.audienceTeamId === KEEP_STORED_AUDIENCE ? undefined
        : announcementForm.audienceTeamId ? { scope: "team" as const, teamIds: [announcementForm.audienceTeamId] }
        : { scope: "all" as const },
      // The team id is what app.can_write_announcement_audience() judges a coordinator against,
      // so it travels beside the audience config rather than being derived from the label.
      teamId: announcementForm.audienceTeamId === KEEP_STORED_AUDIENCE ? undefined
        : announcementForm.audienceTeamId || undefined,
      status: announcementForm.status,
      scheduledFor: announcementForm.scheduledFor || undefined,
      expiresAt: announcementForm.expiresAt || undefined,
    };
    const res = await announcementMutation.mutateAsync(payload);

    setIsSubmitting(false);
    if (res.success) {
      setFeedbackNotice({ type: "success", message: res.message });
      setIsAnnouncementModalOpen(false);
      setEditingAnnouncementId(null);
      setAnnouncementForm(emptyAnnouncementForm);
    } else {
      setFeedbackNotice({ type: "error", message: res.message });
    }
  };

  const handleEditAnnouncement = (ann: AnnouncementItem) => {
    setEditingAnnouncementId(ann.id);
    setAnnouncementForm({
      ...emptyAnnouncementForm,
      title: ann.title,
      bodyMarkdown: ann.bodyMarkdown,
      priority: ann.priority,
      targetAudienceLabel: ann.targetAudienceLabel,
      audienceTeamId: announcementAudienceValue(ann),
      status: ann.status === "draft" ? "draft" : "published",
      scheduledFor: ann.scheduledFor ? toJakartaDateTimeLocal(ann.scheduledFor) : "",
    });
    setIsAnnouncementModalOpen(true);
  };

  // Handle Announcement Delete
  const handleDeleteAnnouncement = async (id: string, title: string) => {
    if (!confirm(`Hapus pengumuman "${title}"?`)) return;
    const res = await announcementDeleteMutation.mutateAsync(id);
    setFeedbackNotice({ type: res.success ? "success" : "error", message: res.message });
  };

  return (
    <div className="flex flex-col w-full pb-16 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-label-sm text-label-sm text-primary uppercase tracking-wider font-semibold">
              Panel Kendali Administrator
            </span>
            <span className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-label-sm text-[10px]">
              Full Akses
            </span>
          </div>
          <h1 className="font-headline-sm text-headline-sm text-on-surface tracking-tight mt-1">
            Kelola Jadwal Agenda &amp; Siaran Pengumuman
          </h1>
          <p className="font-body-sm text-body-sm text-muted-foreground mt-0.5">
            Tambah, perbarui, dan atur agenda kegiatan serta siaran pengumuman pondok secara terpusat.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === "agenda" ? (
            <button
              onClick={() => setIsEventModalOpen(true)}
              className="h-10 px-4 rounded-xl bg-primary text-on-primary hover:bg-primary-container font-label-md text-xs flex items-center gap-1.5 shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span>Tambah Agenda Baru</span>
            </button>
          ) : (
            <button
              onClick={() => setIsAnnouncementModalOpen(true)}
              className="h-10 px-4 rounded-xl bg-primary text-on-primary hover:bg-primary-container font-label-md text-xs flex items-center gap-1.5 shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">campaign</span>
              <span>Siarkan Pengumuman</span>
            </button>
          )}
        </div>
      </section>

      {/* Toast Feedback */}
      {feedbackNotice && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between gap-3 text-sm font-medium shadow-sm ${
            feedbackNotice.type === "success"
              ? "bg-success/15 text-success border border-success/30"
              : "bg-error/15 text-error border border-error/30"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">
              {feedbackNotice.type === "success" ? "check_circle" : "error"}
            </span>
            <p>{feedbackNotice.message}</p>
          </div>
          <button
            onClick={() => setFeedbackNotice(null)}
            className="text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex border-b border-border gap-6">
        <button
          onClick={() => setActiveTab("agenda")}
          className={`pb-3 font-label-md text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeTab === "agenda"
              ? "border-primary text-primary font-bold"
              : "border-transparent text-muted-foreground hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">calendar_month</span>
          <span>Agenda Kegiatan ({events.length})</span>
        </button>

        {canManageAnnouncements && (
          <button
            onClick={() => setActiveTab("pengumuman")}
            className={`pb-3 font-label-md text-sm flex items-center gap-2 border-b-2 transition-all ${
              activeTab === "pengumuman"
                ? "border-primary text-primary font-bold"
                : "border-transparent text-muted-foreground hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">campaign</span>
            <span>Siaran Pengumuman ({announcements.length})</span>
          </button>
        )}
      </div>

      {/* Content Area */}
      {loadError ? (
        <div role="alert" className="flex flex-col items-center justify-center p-12 bg-card rounded-xl border border-error/30 text-center">
          <span className="material-symbols-outlined text-[40px] text-error">error</span>
          <h3 className="font-headline-sm text-base font-semibold text-on-surface mt-2">Data Jadwal Gagal Dimuat</h3>
          <p className="font-body-sm text-xs text-muted-foreground mt-1 max-w-md">
            Sistem tidak dapat memuat agenda/pengumuman. Ini bukan berarti data kosong. Silakan coba lagi.
          </p>
          <button
            type="button"
            onClick={() => { void eventsQuery.refetch(); void announcementsQuery.refetch(); }}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Coba Lagi
          </button>
        </div>
      ) : isLoadingData ? (
        <div className="flex flex-col items-center justify-center p-12 bg-card rounded-xl border border-border">
          <LoadingSpinner size="md" />
          <p className="font-body-sm text-xs text-muted-foreground mt-2">Memuat data dari database...</p>
        </div>
      ) : activeTab === "agenda" ? (
        /* Agenda Table / Cards */
        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="bg-card rounded-2xl p-8 sm:p-10 text-center border border-dashed border-border flex flex-col items-center justify-center space-y-3">
              <Illustration
                src="/illustrations/undraw_done_erdp.svg"
                alt="Belum ada agenda kegiatan"
                width={130}
                height={90}
              />
              <div>
                <h3 className="font-headline-sm text-base font-semibold text-on-surface">
                  Belum Ada Agenda Kegiatan
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto mt-1 mb-4">
                  Belum ada jadwal yang dimasukkan ke dalam database. Tambahkan agenda baru untuk santri dan pengurus.
                </p>
              </div>
              <button
                onClick={() => setIsEventModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>Buat Agenda Sekarang</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {events.map((evt) => (
                <div
                  key={evt.id}
                  className="bg-card rounded-xl p-4 border border-border shadow-xs flex flex-col justify-between space-y-3 hover:border-primary/50 transition-all"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2.5 py-0.5 rounded-full bg-accent text-accent-foreground font-label-sm text-[11px] uppercase tracking-wider font-semibold">
                        {evt.categoryLabel || evt.category}
                      </span>
                      <span className="font-mono text-xs text-primary font-bold">
                        {evt.timeRangeStr}
                      </span>
                    </div>
                    <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                      {evt.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="material-symbols-outlined text-[16px]">location_on</span>
                      <span>{evt.location}</span>
                    </div>
                    {evt.subNote && (
                      <p className="text-xs text-muted-foreground bg-surface-container-low p-2 rounded-lg line-clamp-2">
                        {evt.subNote}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border/60">
                    <Link
                      href="/jadwal"
                      className="text-xs text-primary hover:underline flex items-center gap-1 font-label-sm"
                    >
                      <span>Lihat Tampilan Publik</span>
                      <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    </Link>
                    {canEditEventRow(evt) && (
                      <button
                        onClick={() => handleEditEvent(evt)}
                        className="h-8 px-2.5 rounded-lg text-primary hover:bg-primary/10 font-label-sm text-xs flex items-center gap-1 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                        <span>Edit</span>
                      </button>
                    )}
                    {/* A single-day cancel stays on the manager tier — app.event_occurrence_set()
                        checks the same three roles that may broadcast announcements (§3.6). */}
                    {evt.occurrenceDate && canManageAnnouncements && (
                      <button
                        onClick={() => handleToggleOccurrence(evt)}
                        disabled={occurrenceBusyId === evt.id}
                        className={`h-8 px-2.5 rounded-lg font-label-sm text-xs flex items-center gap-1 transition-colors disabled:opacity-50 ${
                          evt.cancelledOccurrence
                            ? "text-primary hover:bg-primary/10"
                            : "text-error hover:bg-error/10"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {evt.cancelledOccurrence ? "event_available" : "event_busy"}
                        </span>
                        <span>{evt.cancelledOccurrence ? "Pulihkan hari ini" : "Batalkan hari ini"}</span>
                      </button>
                    )}
                    {canEditEventRow(evt) && (
                      <button
                        onClick={() => handleDeleteEvent(evt.baseEventId || evt.id, evt.title)}
                        className="h-8 px-2.5 rounded-lg text-error hover:bg-error/10 font-label-sm text-xs flex items-center gap-1 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        <span>Hapus</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Announcements Table / Cards */
        <div className="space-y-3">
          {announcements.length === 0 ? (
            <div className="bg-card rounded-2xl p-8 sm:p-10 text-center border border-dashed border-border flex flex-col items-center justify-center space-y-3">
              <Illustration
                src="/illustrations/undraw_mail-sent_dagx.svg"
                alt="Belum ada siaran pengumuman"
                width={120}
                height={85}
              />
              <div>
                <h3 className="font-headline-sm text-base font-semibold text-on-surface">
                  Belum Ada Siaran Pengumuman
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto mt-1 mb-4">
                  Kirim pengumuman penting untuk santri dan tim pondok. Pengumuman penting akan disematkan di beranda.
                </p>
              </div>
              <button
                onClick={() => setIsAnnouncementModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>Buat Pengumuman Sekarang</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {announcements.map((ann) => (
                <div
                  key={ann.id}
                  className="bg-card rounded-xl p-4 sm:p-5 border border-border shadow-xs flex flex-col space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {ann.isPinned && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary/15 text-tertiary font-label-sm text-[11px] font-semibold">
                            <span className="material-symbols-outlined text-[13px]">push_pin</span>
                            Disematkan
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-surface-container text-muted-foreground font-label-sm text-[11px]">
                          {ann.targetAudienceLabel}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ann.publishedAtStr}
                        </span>
                      </div>
                      <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                        {ann.title}
                      </h3>
                    </div>

                    <button
                      onClick={() => handleEditAnnouncement(ann)}
                      className="h-8 px-2.5 rounded-lg text-primary hover:bg-primary/10 font-label-sm text-xs flex items-center gap-1 shrink-0 transition-colors"
                      title="Edit Pengumuman"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                    <button
                      onClick={() => handleDeleteAnnouncement(ann.id, ann.title)}
                      className="h-8 px-2.5 rounded-lg text-error hover:bg-error/10 font-label-sm text-xs flex items-center gap-1 shrink-0 transition-colors"
                      title="Hapus Pengumuman"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                      <span className="hidden sm:inline">Hapus</span>
                    </button>
                  </div>

                  <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed bg-surface-container-low p-3 rounded-lg whitespace-pre-wrap">
                    {ann.bodyMarkdown}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Tambah Agenda Baru */}
      {isEventModalOpen && (
        <Modal isOpen onClose={() => setIsEventModalOpen(false)} title="Tambah Agenda Kegiatan Baru" backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs" className="bg-card w-full max-w-lg rounded-2xl p-6 shadow-xl border border-border space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">event</span>
                <h3 className="font-headline-sm text-lg text-on-surface font-semibold">
                  Tambah Agenda Kegiatan Baru
                </h3>
              </div>
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateEvent} className="space-y-3.5">
              <div className="space-y-1">
                <label htmlFor="event-title" className="font-label-sm text-xs text-on-surface font-medium">
                  Judul Agenda <span className="text-error">*</span>
                </label>
                <input
                  id="event-title"
                  type="text"
                  required
                  value={eventForm.title}
                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                  placeholder="Contoh: Kajian Kitab Kuning Pagi atau Workshop IT"
                  className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="event-category" className="font-label-sm text-xs text-on-surface font-medium">
                    Kategori Agenda
                  </label>
                  <select
                    id="event-category"
                    value={eventForm.category}
                    onChange={(e) =>
                      setEventForm({
                        ...eventForm,
                        category: e.target.value as "teknologi" | "keagamaan" | "operasional" | "umum",
                      })
                    }
                    className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                  >
                    <option value="teknologi">Teknologi &amp; Koding</option>
                    <option value="keagamaan">Kajian &amp; Ibadah</option>
                    <option value="operasional">Operasional Pesantren</option>
                    <option value="umum">Umum</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="event-location" className="font-label-sm text-xs text-on-surface font-medium">
                    Lokasi Kegiatan <span className="text-error">*</span>
                  </label>
                  <input
                    id="event-location"
                    type="text"
                    required
                    value={eventForm.location}
                    onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                    placeholder="Contoh: Lab Komputer / Masjid Jami"
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="event-starts" className="font-label-sm text-xs text-on-surface font-medium">
                    Waktu Mulai <span className="text-error">*</span>
                  </label>
                  <input
                    id="event-starts"
                    type="datetime-local"
                    required
                    value={eventForm.startsAt}
                    onChange={(e) => setEventForm({ ...eventForm, startsAt: e.target.value })}
                    className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-xs sm:text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="event-ends" className="font-label-sm text-xs text-on-surface font-medium">
                    Waktu Selesai <span className="text-error">*</span>
                  </label>
                  <input
                    id="event-ends"
                    type="datetime-local"
                    required
                    value={eventForm.endsAt}
                    onChange={(e) => setEventForm({ ...eventForm, endsAt: e.target.value })}
                    className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-xs sm:text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="event-description" className="font-label-sm text-xs text-on-surface font-medium">
                  Deskripsi / Catatan Tambahan (Opsional)
                </label>
                <textarea
                  id="event-description"
                  rows={2}
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                  placeholder="Catatan materi, pemateri, atau persiapan peserta..."
                  className="w-full p-2.5 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="event-audience" className="font-label-sm text-xs text-on-surface font-medium">
                  Sasaran Peserta
                </label>
                {audienceQuery.isLoading ? (
                  <p className="font-body-sm text-xs text-muted-foreground">
                    Memuat pilihan audiens…
                  </p>
                ) : (
                  <AudiencePicker
                    tier={audienceQuery.data?.tier ?? "none"}
                    teams={audienceQuery.data?.teams ?? []}
                    value={eventForm.audienceTeamId}
                    onChange={(teamId) => setEventForm({ ...eventForm, audienceTeamId: teamId })}
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="event-recurrence" className="font-label-sm text-xs text-on-surface font-medium">Pengulangan</label>
                  <select id="event-recurrence" value={eventForm.recurrenceRule} onChange={(e) => setEventForm({ ...eventForm, recurrenceRule: e.target.value as typeof eventForm.recurrenceRule })} className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none">
                    <option value="none">Tidak berulang</option>
                    <option value="daily">Setiap hari</option>
                    <option value="weekly">Setiap minggu</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="event-recurrence-until" className="font-label-sm text-xs text-on-surface font-medium">Berulang sampai</label>
                  <input id="event-recurrence-until" type="datetime-local" value={eventForm.recurrenceUntil} onChange={(e) => setEventForm({ ...eventForm, recurrenceUntil: e.target.value })} disabled={eventForm.recurrenceRule === "none"} className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-xs border border-border focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50" />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsEventModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-muted-foreground hover:bg-muted font-label-md"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs shadow-xs hover:bg-primary-container disabled:opacity-50 transition-all flex items-center gap-1.5"
                >
                  {isSubmitting && <LoadingSpinner size="sm" />}
                  <span>Simpan Agenda</span>
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Modal: Buat Pengumuman Baru */}
      {isAnnouncementModalOpen && (
        <Modal isOpen onClose={() => setIsAnnouncementModalOpen(false)} title="Siarkan Pengumuman Baru" backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs" className="bg-card w-full max-w-lg rounded-2xl p-6 shadow-xl border border-border space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">campaign</span>
                <h3 className="font-headline-sm text-lg text-on-surface font-semibold">
                  Siarkan Pengumuman Baru
                </h3>
              </div>
              <button
                onClick={() => setIsAnnouncementModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateAnnouncement} className="space-y-3.5">
              <div className="space-y-1">
                <label htmlFor="ann-title" className="font-label-sm text-xs text-on-surface font-medium">
                  Judul Pengumuman <span className="text-error">*</span>
                </label>
                <input
                  id="ann-title"
                  type="text"
                  required
                  value={announcementForm.title}
                  onChange={(e) =>
                    setAnnouncementForm({ ...announcementForm, title: e.target.value })
                  }
                  placeholder="Contoh: Pembaruan SOP Lab Komputer atau Pengumuman Libur"
                  className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="ann-priority" className="font-label-sm text-xs text-on-surface font-medium">
                    Prioritas Siaran
                  </label>
                  <select
                    id="ann-priority"
                    value={announcementForm.priority}
                    onChange={(e) =>
                      setAnnouncementForm({
                        ...announcementForm,
                        priority: e.target.value as "normal" | "important",
                      })
                    }
                    className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                  >
                    <option value="normal">Normal</option>
                    <option value="important">Penting (Sematkan di Beranda)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="ann-target-label" className="font-label-sm text-xs text-on-surface font-medium">
                    Target Audiens
                  </label>
                  <input
                    id="ann-target-label"
                    type="text"
                    value={announcementForm.targetAudienceLabel}
                    onChange={(e) =>
                      setAnnouncementForm({
                        ...announcementForm,
                        targetAudienceLabel: e.target.value,
                      })
                    }
                    placeholder="Semua Santri & Tim"
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="announcement-audience" className="font-label-sm text-xs text-on-surface font-medium">
                  Audiens
                </label>
                <AudiencePicker
                  subject="pengumuman"
                  tier={audienceQuery.data?.tier ?? "none"}
                  teams={audienceQuery.data?.teams ?? []}
                  value={announcementForm.audienceTeamId}
                  onChange={(teamId) => setAnnouncementForm({ ...announcementForm, audienceTeamId: teamId })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="ann-status" className="font-label-sm text-xs text-on-surface font-medium">Workflow</label>
                  <select id="ann-status" value={announcementForm.status} onChange={(e) => setAnnouncementForm({ ...announcementForm, status: e.target.value as typeof announcementForm.status })} className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none">
                    <option value="published">Terbitkan</option>
                    <option value="draft">Simpan sebagai draft</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="ann-scheduled" className="font-label-sm text-xs text-on-surface font-medium">Terbit terjadwal (opsional)</label>
                  <input id="ann-scheduled" type="datetime-local" value={announcementForm.scheduledFor} onChange={(e) => setAnnouncementForm({ ...announcementForm, scheduledFor: e.target.value, status: e.target.value ? "draft" : announcementForm.status })} className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-xs border border-border focus:ring-2 focus:ring-primary focus:outline-none" />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="ann-expires" className="font-label-sm text-xs text-on-surface font-medium">Kedaluwarsa (opsional)</label>
                <input id="ann-expires" type="datetime-local" value={announcementForm.expiresAt} onChange={(e) => setAnnouncementForm({ ...announcementForm, expiresAt: e.target.value })} className="w-full h-10 px-2 rounded-lg bg-surface-container-low text-on-surface text-xs border border-border focus:ring-2 focus:ring-primary focus:outline-none" />
              </div>

              <div className="space-y-1">
                <label htmlFor="ann-body" className="font-label-sm text-xs text-on-surface font-medium">
                  Isi Pesan Pengumuman <span className="text-error">*</span>
                </label>
                <textarea
                  id="ann-body"
                  required
                  rows={4}
                  value={announcementForm.bodyMarkdown}
                  onChange={(e) =>
                    setAnnouncementForm({
                      ...announcementForm,
                      bodyMarkdown: e.target.value,
                    })
                  }
                  placeholder="Tuliskan isi pengumuman lengkap secara jelas..."
                  className="w-full p-2.5 rounded-lg bg-surface-container-low text-on-surface text-sm border border-border focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsAnnouncementModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-muted-foreground hover:bg-muted font-label-md"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs shadow-xs hover:bg-primary-container disabled:opacity-50 transition-all flex items-center gap-1.5"
                >
                  {isSubmitting && <LoadingSpinner size="sm" />}
                  <span>{announcementForm.status === "draft" ? "Simpan Draft" : "Terbitkan Pengumuman"}</span>
                </button>
              </div>
            </form>
        </Modal>
      )}
    </div>
  );
}
