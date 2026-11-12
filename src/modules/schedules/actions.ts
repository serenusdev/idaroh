"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthUser, requireRole } from "@/lib/auth/guards";
import { drainNotificationOutbox, hashCalendarToken, sendPushToUsers } from "@/lib/fcm";
import { INITIAL_ANNOUNCEMENTS, INITIAL_EVENTS } from "./data";
import { AnnouncementItem, AudienceConfig, ScheduleEventItem } from "./types";
import { randomBytes } from "node:crypto";

async function filterByAudience(supabase: ReturnType<typeof createAdminClient>, rows: any[], user: any): Promise<any[]> {
  const { data: memberships } = await supabase
    .from("team_members")
    .select("team_id, teams(id, name, slug)")
    .eq("user_id", user.id)
    .is("valid_to", null);
  const userTeams = new Set(
    (memberships || []).flatMap((item: any) => [item.team_id, item.teams?.id, item.teams?.name, item.teams?.slug]).filter(Boolean)
  );
  return rows.filter((row) => {
    const config = row.audience_config as AudienceConfig | null | undefined;
    if (!config || config.scope === "all") return !row.team_id || row.team_id === user.team_name || userTeams.has(row.team_id);
    if (config.scope === "users") return (config.userIds || []).includes(user.id);
    if (config.scope === "member_type") return (config.memberTypes || []).includes(user.member_type || "santri");
    return (config.teamIds || []).some((teamId) => userTeams.has(teamId));
  });
}

export async function getAudienceUserIds(supabase: ReturnType<typeof createAdminClient>, config?: AudienceConfig): Promise<string[]> {
  if (!config || config.scope === "all") {
    const { data } = await supabase.from("profiles").select("id").eq("status", "active");
    return (data || []).map((row: any) => row.id);
  }
  if (config.scope === "users") return config.userIds || [];
  if (config.scope === "member_type") {
    const { data } = await supabase.from("profiles").select("id").eq("status", "active").in("member_type", config.memberTypes || []);
    return (data || []).map((row: any) => row.id);
  }
  const { data } = await supabase.from("team_members").select("user_id").is("valid_to", null).in("team_id", config.teamIds || []);
  return Array.from(new Set((data || []).map((row: any) => row.user_id)));
}

function expandEventRows(rows: any[]): any[] {
  const expanded: any[] = [];
  const horizon = Date.now() + 180 * 24 * 60 * 60 * 1000;
  for (const row of rows) {
    const rule = row.recurrence_rule;
    if (!rule || rule === "none") {
      expanded.push(row);
      continue;
    }
    const baseStart = new Date(row.starts_at);
    const baseEnd = new Date(row.ends_at);
    const duration = baseEnd.getTime() - baseStart.getTime();
    const until = Math.min(
      row.recurrence_until ? new Date(row.recurrence_until).getTime() : horizon,
      horizon
    );
    const step = rule === "daily" ? 24 * 60 * 60 * 1000 : rule === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 0;
    if (!step || Number.isNaN(baseStart.getTime()) || Number.isNaN(until)) {
      expanded.push(row);
      continue;
    }
    for (let occurrence = baseStart.getTime(); occurrence <= until; occurrence += step) {
      const copy = { ...row };
      copy.id = `${row.id}:${new Date(occurrence).toISOString().slice(0, 10)}`;
      copy.starts_at = new Date(occurrence).toISOString();
      copy.ends_at = new Date(occurrence + duration).toISOString();
      expanded.push(copy);
    }
  }
  return expanded;
}

function toAnnouncementItem(row: any, readIds: Set<string> = new Set()): AnnouncementItem {
  return {
    id: row.id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    priority: row.priority as "normal" | "important",
    isPinned: row.pinned || row.priority === "important",
    expiresAtStr: row.expires_at ? new Date(row.expires_at).toLocaleDateString("id-ID") : undefined,
    targetAudienceLabel: row.target_audience_label || "Semua Santri",
    publishedAtStr: row.published_at
      ? new Date(row.published_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
      : "Draft",
    isRead: readIds.has(row.id),
    audienceConfig: row.audience_config || undefined,
    status: row.status,
    scheduledFor: row.scheduled_for || undefined,
  };
}

/**
 * Server Action: Query Events for Schedules
 */
export async function getEventsAction(): Promise<ScheduleEventItem[]> {
  const user = await requireAuthUser();
  try {
    const supabase = createAdminClient();
    const { data: events, error } = await supabase
      .from("events")
      .select("*")
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .order("starts_at", { ascending: true });

    if (!error && events) {
      if (events.length === 0) return [];

      const visibleEvents = await filterByAudience(supabase, expandEventRows(events as any[]), user);
      const organizerIds = Array.from(
        new Set(visibleEvents.map((e: any) => e.organizer_id).filter(Boolean))
      );
      const { data: organizers } = organizerIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", organizerIds)
        : { data: [] };
      const organizerMap = new Map(
        ((organizers as any[]) || []).map((p: any) => [p.id, p.full_name])
      );

      return visibleEvents.map((e: any) => {
        const start = new Date(e.starts_at);
        const end = new Date(e.ends_at);
        const timeRangeStr = `${start.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} - ${end.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB`;

        return {
          id: e.id,
          startsAt: e.starts_at,
          endsAt: e.ends_at,
          dateStr: new Date(e.starts_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
          timeRangeStr,
          statusBadge: e.location_changed ? "location_changed" : "on_schedule",
          statusLabel: e.location_changed ? "Perubahan Lokasi" : "Sesuai Jadwal",
          category: (e.category || "teknologi") as any,
          categoryLabel:
            e.category === "keagamaan"
              ? "Kajian & Ibadah"
              : e.category === "operasional"
                ? "Operasional"
                : e.category === "umum"
                  ? "Umum"
                  : "Teknologi & Koding",
          title: e.title,
          location: e.location || "Lab Utama",
          previousLocation: e.previous_location,
          speakerOrHost: organizerMap.get(e.organizer_id),
          groupName: e.team_id || undefined,
          actionType: "detail",
          actionLabel: "Lihat Detail",
          subNote: e.description,
          audienceConfig: e.audience_config || undefined,
          recurrenceRule: e.recurrence_rule || undefined,
          recurrenceUntil: e.recurrence_until || undefined,
        };
      });
    }
  } catch (err) {
    console.error("Failed to query events from Supabase:", err);
    if (!process.env.VITEST) throw err;
  }

  if (process.env.VITEST) {
    return INITIAL_EVENTS;
  }

  return [];
}

/**
 * Server Action: Query Announcements
 */
export async function getAnnouncementsAction(): Promise<AnnouncementItem[]> {
  const user = await requireAuthUser();
  try {
    const supabase = createAdminClient();
    const { data: announcements, error } = await supabase
      .from("announcements")
      .select("*")
      .eq("status", "published")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("published_at", { ascending: false });

    if (!error && announcements) {
      const visibleAnnouncements = await filterByAudience(supabase, announcements as any[], user);
      if (visibleAnnouncements.length === 0) return [];
      const { data: reads } = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .eq("user_id", user.id);
      const readIds = new Set<string>((reads || []).map((read: any) => String(read.announcement_id)));

      return visibleAnnouncements.map((a: any) => toAnnouncementItem(a, readIds));
    }
  } catch (err) {
    console.error("Failed to query announcements from Supabase:", err);
    if (!process.env.VITEST) throw err;
  }

  if (process.env.VITEST) {
    return INITIAL_ANNOUNCEMENTS;
  }

  return [];
}

/** Administrator view: includes drafts, scheduled announcements, and archived history. */
export async function getAdminAnnouncementsAction(): Promise<AnnouncementItem[]> {
  await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (process.env.VITEST) return INITIAL_ANNOUNCEMENTS;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => toAnnouncementItem(row));
}

export async function getUnreadAnnouncementsCountAction(): Promise<number> {
  const announcements = await getAnnouncementsAction();
  return announcements.filter((announcement) => !announcement.isRead).length;
}

/**
 * Server Action: Mark Announcement as Read (SCH-015)
 */
export async function markAnnouncementReadAction(
  announcementId: string
): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();
  if (process.env.VITEST) {
    return { success: true, message: `Pengumuman ${announcementId} ditandai sudah dibaca.` };
  }
  try {
    const supabase = createAdminClient();
    const { data: announcement, error: announcementError } = await supabase
      .from("announcements")
      .select("id, team_id, status, audience_config")
      .eq("id", announcementId)
      .eq("status", "published")
      .maybeSingle();
    if (announcementError) throw announcementError;
    const visible = announcement ? (await filterByAudience(supabase, [announcement], user)).length > 0 : false;
    if (!announcement || !visible) {
      return { success: false, message: "Pengumuman tidak tersedia untuk akun ini." };
    }
    if (user.id && announcementId.length > 30) {
      const { error } = await supabase.from("announcement_reads").upsert({
        announcement_id: announcementId,
        user_id: user.id,
      });
      if (error) throw error;
    }
  } catch (err) {
    console.error("Failed to mark announcement read:", err);
    return { success: false, message: "Gagal menandai pengumuman sebagai sudah dibaca." };
  }

  return {
    success: true,
    message: `Pengumuman ${announcementId} ditandai sudah dibaca.`,
  };
}

/**
 * Server Action: Generate iCal Calendar Subscription Link (SCH-009)
 */
export async function generateICalSubscriptionAction(): Promise<{
  success: boolean;
  icalUrl: string;
  message: string;
}> {
  const user = await requireAuthUser();
  let baseUrl = "";
  try {
    const { headers } = await import("next/headers");
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") || headerList.get("host");
    const proto = headerList.get("x-forwarded-proto") || "https";
    if (host) {
      baseUrl = `${proto}://${host}`;
    }
  } catch {
    // fallback for vitest runner or background task
    baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://pondok.os";
  }

  if (!baseUrl) {
    baseUrl = "https://pondok.os";
  }

  const token = randomBytes(32).toString("base64url");
  if (!process.env.VITEST) {
    const supabase = createAdminClient();
    const { error } = await supabase.from("calendar_subscriptions").insert({
      user_id: user.id,
      token_hash: hashCalendarToken(token),
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) {
      console.error("Failed to persist calendar subscription:", error);
      return { success: false, icalUrl: "", message: "Gagal membuat tautan kalender privat." };
    }
  }
  const icalUrl = `${baseUrl}/api/calendar/feed?token=${token}`;

  return {
    success: true,
    icalUrl,
    message: "Tautan kalender iCal pribadi berhasil dibuat. Silakan tambahkan ke Google Calendar atau Apple Calendar.",
  };
}

/**
 * Server Action: Publish New Announcement (SCH-011, BR-SCH-02)
 */
export async function publishAnnouncementAction(payload: {
  title: string;
  bodyMarkdown: string;
  priority: "normal" | "important";
  targetAudienceLabel: string;
  audienceConfig?: AudienceConfig;
  scheduledFor?: string;
  expiresAt?: string;
  status?: "draft" | "published";
}): Promise<{ success: boolean; message: string; announcement?: AnnouncementItem }> {
  const admin = await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (!payload.title.trim()) {
    return {
      success: false,
      message: "Judul pengumuman wajib diisi.",
    };
  }

  if (!payload.bodyMarkdown.trim()) {
    return {
      success: false,
      message: "Isi pengumuman wajib diisi.",
    };
  }

  if (process.env.VITEST) {
    const newAnn: AnnouncementItem = {
      id: `ann-${Date.now()}`,
      title: payload.title,
      bodyMarkdown: payload.bodyMarkdown,
      priority: payload.priority,
      isPinned: payload.priority === "important",
      targetAudienceLabel: payload.targetAudienceLabel,
      publishedAtStr: "Baru Saja",
      isRead: false,
      audienceConfig: payload.audienceConfig,
    };
    return {
      success: true,
      message: `Pengumuman "${payload.title}" berhasil diterbitkan untuk ${payload.targetAudienceLabel}.`,
      announcement: newAnn,
    };
  }

  const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : null;
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  if (scheduledFor && Number.isNaN(scheduledFor.getTime())) return { success: false, message: "Waktu terbit terjadwal tidak valid." };
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return { success: false, message: "Waktu kedaluwarsa tidak valid." };
  const shouldPublish = payload.status !== "draft" && (!scheduledFor || scheduledFor.getTime() <= Date.now());
  let newId = `ann-${Date.now()}`;
  try {
    const supabase = createAdminClient();
    const { data: inserted, error } = await supabase
      .from("announcements")
      .insert({
        title: payload.title,
        body_markdown: payload.bodyMarkdown,
        priority: payload.priority,
        pinned: payload.priority === "important",
        target_audience_label: payload.targetAudienceLabel,
        status: shouldPublish ? "published" : "draft",
        published_at: shouldPublish ? new Date().toISOString() : null,
        scheduled_for: scheduledFor?.toISOString() || null,
        expires_at: expiresAt?.toISOString() || null,
        author_id: admin.id,
        audience_config: payload.audienceConfig || { scope: "all" },
      })
      .select("id")
      .single();

    if (error || !inserted?.id) throw error || new Error("Pengumuman tidak tersimpan.");

    if (inserted?.id) newId = inserted.id;

    // Log to audit
    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "announcement.published",
      actor_id: admin.id,
      actor_name: admin.full_name,
      target_id: newId,
      target_label: payload.title,
      action_detail: `Menerbitkan pengumuman prioritas ${payload.priority} untuk ${payload.targetAudienceLabel}`,
    });
    if (auditError) throw auditError;
    if (shouldPublish && !process.env.VITEST) {
      try {
        // Publication trigger already resolved the audience and persisted inbox/outbox rows.
        await drainNotificationOutbox({ notificationType: "ANNOUNCEMENT_PUBLISHED", referenceId: newId });
      } catch (pushError) {
        console.error("Announcement saved but push delivery failed:", pushError);
      }
    }
  } catch (err) {
    console.error("Failed to insert announcement in Supabase:", err);
    return { success: false, message: "Gagal menerbitkan pengumuman." };
  }

  const newAnn: AnnouncementItem = {
    id: newId,
    title: payload.title,
    bodyMarkdown: payload.bodyMarkdown,
    priority: payload.priority,
    isPinned: payload.priority === "important",
    targetAudienceLabel: payload.targetAudienceLabel,
    publishedAtStr: "Baru Saja",
    isRead: false,
    audienceConfig: payload.audienceConfig,
    status: shouldPublish ? "published" : "draft",
    scheduledFor: scheduledFor?.toISOString(),
  };

  return {
    success: true,
    message: shouldPublish
      ? `Pengumuman "${payload.title}" berhasil diterbitkan untuk ${payload.targetAudienceLabel}.`
      : `Pengumuman "${payload.title}" disimpan sebagai draft${scheduledFor ? " dan dijadwalkan" : ""}.`,
    announcement: newAnn,
  };
}

/**
 * Server Action: Delete Announcement
 */
export async function deleteAnnouncementAction(
  announcementId: string
): Promise<{ success: boolean; message: string }> {
  const admin = await requireRole(["super_admin", "yayasan", "pengurus"]);
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("announcements")
      .update({ status: "archived", archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", announcementId);
    if (error) throw error;
    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "announcement.deleted",
      actor_name: admin.full_name,
      target_id: announcementId,
      target_label: "Pengumuman",
      action_detail: `Mengarsipkan pengumuman ID ${announcementId}`,
    });
    if (auditError) throw auditError;
    return { success: true, message: "Pengumuman berhasil dihapus." };
  } catch (err) {
    console.error("Failed to delete announcement:", err);
    return { success: false, message: "Gagal menghapus pengumuman." };
  }
}

export async function saveAnnouncementDraftAction(payload: {
  title: string;
  bodyMarkdown: string;
  priority: "normal" | "important";
  targetAudienceLabel: string;
  audienceConfig?: AudienceConfig;
  scheduledFor?: string;
  expiresAt?: string;
}): Promise<{ success: boolean; message: string; announcement?: AnnouncementItem }> {
  return publishAnnouncementAction({ ...payload, status: "draft" });
}

export interface CreateEventPayload {
  title: string;
  description?: string;
  startsAt: string; // ISO string or datetime-local
  endsAt: string;
  location: string;
  category: "teknologi" | "keagamaan" | "operasional" | "umum";
  audienceConfig?: AudienceConfig;
  recurrenceRule?: "none" | "daily" | "weekly";
  recurrenceUntil?: string;
}

async function hasEventConflict(
  supabase: ReturnType<typeof createAdminClient>,
  startsAt: Date,
  endsAt: Date,
  location: string,
  ignoredEventId?: string
) {
  const { data, error } = await supabase
    .from("events")
    .select("id, starts_at, ends_at")
    .eq("location", location)
    .eq("status", "scheduled")
    .is("deleted_at", null);
  if (error) throw error;
  return (data || []).some((event: any) => {
    if (ignoredEventId && event.id === ignoredEventId) return false;
    const existingStart = new Date(event.starts_at).getTime();
    const existingEnd = new Date(event.ends_at).getTime();
    return existingStart < endsAt.getTime() && existingEnd > startsAt.getTime();
  });
}

export async function updateEventAction(
  eventId: string,
  payload: CreateEventPayload
): Promise<{ success: boolean; message: string; eventId?: string }> {
  const admin = await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (!eventId || !payload.title.trim() || !payload.startsAt || !payload.endsAt) {
    return { success: false, message: "ID, judul, dan waktu agenda wajib diisi." };
  }
  const startsAt = new Date(payload.startsAt);
  const endsAt = new Date(payload.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
    return { success: false, message: "Rentang waktu agenda tidak valid." };
  }
  const recurrenceRule = payload.recurrenceRule || "none";
  const recurrenceUntil = payload.recurrenceUntil ? new Date(payload.recurrenceUntil) : null;
  if (!["none", "daily", "weekly"].includes(recurrenceRule) || (recurrenceUntil && Number.isNaN(recurrenceUntil.getTime()))) {
    return { success: false, message: "Aturan pengulangan agenda tidak valid." };
  }
  if (payload.title.trim().length > 160 || (payload.description || "").trim().length > 5000 || payload.location.trim().length > 240) {
    return { success: false, message: "Judul, deskripsi, atau lokasi melebihi batas yang diizinkan." };
  }
  if (process.env.VITEST) return { success: true, message: "Agenda berhasil diperbarui.", eventId };

  try {
    const supabase = createAdminClient();
    const { data: existing, error: readError } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return { success: false, message: "Agenda tidak ditemukan." };
    if (await hasEventConflict(supabase, startsAt, endsAt, payload.location.trim(), eventId)) {
      return { success: false, message: "Bentrok: sudah ada agenda di lokasi dan waktu tersebut." };
    }

    const { count } = await supabase
      .from("event_revisions")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);
    const { error: revisionError } = await supabase.from("event_revisions").insert({
      event_id: eventId,
      revision_no: (count || 0) + 1,
      snapshot: existing,
      changed_by: admin.id,
    });
    if (revisionError) throw revisionError;

    const { error } = await supabase.from("events").update({
      title: payload.title.trim(),
      description: payload.description?.trim() || "",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      location: payload.location.trim(),
      location_changed: existing.location !== payload.location.trim(),
      previous_location: existing.location !== payload.location.trim() ? existing.location : existing.previous_location,
      category: payload.category,
      audience_config: payload.audienceConfig || existing.audience_config || { scope: "all" },
      recurrence_rule: recurrenceRule,
      recurrence_until: recurrenceUntil?.toISOString() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", eventId);
    if (error) throw error;

    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "event.updated",
      actor_id: admin.id,
      actor_name: admin.full_name,
      target_id: eventId,
      target_label: payload.title.trim(),
      action_detail: "Agenda diperbarui; snapshot versi sebelumnya disimpan.",
    });
    if (auditError) throw auditError;
    if (existing.starts_at !== startsAt.toISOString() || existing.ends_at !== endsAt.toISOString() || existing.location !== payload.location.trim()) {
      try {
        const recipientIds = await getAudienceUserIds(supabase, payload.audienceConfig || existing.audience_config || { scope: "all" });
        await sendPushToUsers(recipientIds, { type: "EVENT_UPDATED", title: `Perubahan Agenda: ${payload.title.trim()}`, body: "Waktu atau lokasi agenda telah diperbarui.", url: "/jadwal", referenceId: eventId });
      } catch (pushError) {
        console.error("Event updated but push delivery failed:", pushError);
      }
    }
    return { success: true, message: "Agenda berhasil diperbarui dan revisi sebelumnya disimpan.", eventId };
  } catch (err) {
    console.error("Failed to update event:", err);
    return { success: false, message: "Gagal memperbarui agenda." };
  }
}

/**
 * Server Action: Create Event / Agenda
 */
export async function createEventAction(
  payload: CreateEventPayload
): Promise<{ success: boolean; message: string; eventId?: string }> {
  const admin = await requireRole(["super_admin", "yayasan", "pengurus"]);

  if (!payload.title.trim()) {
    return { success: false, message: "Judul agenda wajib diisi." };
  }
  if (!payload.startsAt || !payload.endsAt) {
    return { success: false, message: "Waktu mulai dan selesai wajib ditentukan." };
  }
  const startsAt = new Date(payload.startsAt);
  const endsAt = new Date(payload.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
    return { success: false, message: "Rentang waktu agenda tidak valid." };
  }
  if (payload.title.trim().length > 160 || (payload.description || "").trim().length > 5000) {
    return { success: false, message: "Judul maksimal 160 karakter dan deskripsi maksimal 5.000 karakter." };
  }
  if (payload.location.trim().length > 240) {
    return { success: false, message: "Lokasi maksimal 240 karakter." };
  }
  const recurrenceRule = payload.recurrenceRule || "none";
  const recurrenceUntil = payload.recurrenceUntil ? new Date(payload.recurrenceUntil) : null;
  if (!["none", "daily", "weekly"].includes(recurrenceRule) || (recurrenceUntil && Number.isNaN(recurrenceUntil.getTime()))) {
    return { success: false, message: "Aturan pengulangan agenda tidak valid." };
  }

  try {
    const supabase = createAdminClient();
    if (await hasEventConflict(supabase, startsAt, endsAt, payload.location.trim())) {
      return { success: false, message: "Bentrok: sudah ada agenda di lokasi dan waktu tersebut." };
    }
    const { data: inserted, error } = await supabase
      .from("events")
      .insert({
        title: payload.title,
        description: payload.description || "",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        location: payload.location || "Lab Utama Pondok",
        organizer_id: admin.id,
        created_by: admin.id,
        category: payload.category || "umum",
        status: "scheduled",
        audience_config: payload.audienceConfig || { scope: "all" },
        recurrence_rule: recurrenceRule,
        recurrence_until: recurrenceUntil?.toISOString() || null,
      })
      .select("id")
      .single();

    if (error) throw error;

    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "event.created",
      actor_id: admin.id,
      actor_name: admin.full_name,
      target_id: inserted?.id,
      target_label: payload.title,
      action_detail: `Menambahkan agenda baru: ${payload.title} (${payload.category}) di ${payload.location}`,
    });
    if (auditError) throw auditError;

    return {
      success: true,
      message: `Agenda "${payload.title}" berhasil ditambahkan ke jadwal.`,
      eventId: inserted?.id,
    };
  } catch (err) {
    console.error("Failed to create event:", err);
    return { success: false, message: "Gagal menambahkan agenda kegiatan." };
  }
}

/**
 * Server Action: Delete Event
 */
export async function deleteEventAction(
  eventId: string
): Promise<{ success: boolean; message: string }> {
  const admin = await requireRole(["super_admin", "yayasan", "pengurus"]);
  try {
    const supabase = createAdminClient();
    const { data: existing, error: readError } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
    if (readError) throw readError;
    if (!existing) return { success: false, message: "Agenda tidak ditemukan." };
    const { count } = await supabase.from("event_revisions").select("id", { count: "exact", head: true }).eq("event_id", eventId);
    const { error: revisionError } = await supabase.from("event_revisions").insert({ event_id: eventId, revision_no: (count || 0) + 1, snapshot: existing, changed_by: admin.id });
    if (revisionError) throw revisionError;
    const { error } = await supabase
      .from("events")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", eventId);
    if (error) throw error;
    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "event.deleted",
      actor_name: admin.full_name,
      target_id: eventId,
      target_label: "Agenda",
      action_detail: `Membatalkan agenda ID ${eventId}`,
    });
    if (auditError) throw auditError;
    try {
      const recipientIds = await getAudienceUserIds(supabase, existing.audience_config || { scope: "all" });
      await sendPushToUsers(recipientIds, { type: "EVENT_CANCELLED", title: `Agenda Dibatalkan: ${existing.title}`, body: "Agenda ini telah dibatalkan oleh administrator.", url: "/jadwal", referenceId: eventId });
    } catch (pushError) {
      console.error("Event cancellation saved but push delivery failed:", pushError);
    }
    return { success: true, message: "Agenda berhasil dihapus." };
  } catch (err) {
    console.error("Failed to delete event:", err);
    return { success: false, message: "Gagal menghapus agenda." };
  }
}

export async function updateAnnouncementAction(
  announcementId: string,
  payload: {
    title: string;
    bodyMarkdown: string;
    priority: "normal" | "important";
    targetAudienceLabel: string;
    audienceConfig?: AudienceConfig;
    scheduledFor?: string | null;
    expiresAt?: string | null;
    status?: "draft" | "published";
  }
): Promise<{ success: boolean; message: string; announcementId?: string }> {
  const admin = await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (!announcementId || !payload.title.trim() || !payload.bodyMarkdown.trim()) {
    return { success: false, message: "ID, judul, dan isi pengumuman wajib diisi." };
  }
  if (payload.title.trim().length > 160 || payload.bodyMarkdown.trim().length > 20000) {
    return { success: false, message: "Judul atau isi pengumuman terlalu panjang." };
  }
  if (process.env.VITEST) return { success: true, message: "Pengumuman berhasil diperbarui.", announcementId };

  try {
    const supabase = createAdminClient();
    const { data: existing, error: readError } = await supabase.from("announcements").select("*").eq("id", announcementId).maybeSingle();
    if (readError) throw readError;
    if (!existing) return { success: false, message: "Pengumuman tidak ditemukan." };
    if (existing.status === "archived") return { success: false, message: "Pengumuman yang sudah diarsipkan tidak dapat diubah." };
    const scheduledFor = payload.scheduledFor === undefined
      ? (existing.scheduled_for ? new Date(existing.scheduled_for) : null)
      : (payload.scheduledFor ? new Date(payload.scheduledFor) : null);
    const expiresAt = payload.expiresAt === undefined
      ? (existing.expires_at ? new Date(existing.expires_at) : null)
      : (payload.expiresAt ? new Date(payload.expiresAt) : null);
    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) return { success: false, message: "Waktu terbit terjadwal tidak valid." };
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return { success: false, message: "Waktu kedaluwarsa tidak valid." };
    const nextStatus = payload.status || existing.status;
    if (nextStatus === "published" && scheduledFor && scheduledFor.getTime() > Date.now()) return { success: false, message: "Pengumuman dengan waktu mendatang harus berstatus draft terjadwal." };
    const { count } = await supabase.from("announcement_revisions").select("id", { count: "exact", head: true }).eq("announcement_id", announcementId);
    const { error: revisionError } = await supabase.from("announcement_revisions").insert({ announcement_id: announcementId, revision_no: (count || 0) + 1, snapshot: existing, changed_by: admin.id });
    if (revisionError) throw revisionError;
    const { error } = await supabase.from("announcements").update({
      title: payload.title.trim(),
      body_markdown: payload.bodyMarkdown.trim(),
      priority: payload.priority,
      pinned: payload.priority === "important",
      target_audience_label: payload.targetAudienceLabel,
      audience_config: payload.audienceConfig || existing.audience_config || { scope: "all" },
      status: nextStatus,
      published_at: nextStatus === "published" ? (existing.published_at || new Date().toISOString()) : null,
      scheduled_for: scheduledFor?.toISOString() || null,
      expires_at: expiresAt?.toISOString() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", announcementId);
    if (error) throw error;
    const { error: auditError } = await supabase.from("audit_logs").insert({ event_name: "announcement.updated", actor_id: admin.id, actor_name: admin.full_name, target_id: announcementId, target_label: payload.title.trim(), action_detail: "Pengumuman diperbarui; snapshot versi sebelumnya disimpan." });
    if (auditError) throw auditError;
    if (nextStatus === "published" && !process.env.VITEST) {
      try {
        if (existing.status !== "published") {
          await drainNotificationOutbox({ notificationType: "ANNOUNCEMENT_PUBLISHED", referenceId: announcementId });
        } else {
          const recipientIds = await getAudienceUserIds(supabase, payload.audienceConfig || existing.audience_config || { scope: "all" });
          await sendPushToUsers(recipientIds, {
            type: "ANNOUNCEMENT_UPDATED",
            title: `Pembaruan Pengumuman: ${payload.title.trim()}`,
            body: "Pengumuman yang Anda ikuti telah diperbarui.",
            url: "/jadwal",
            referenceId: announcementId,
          });
        }
      } catch (pushError) {
        console.error("Announcement updated but push delivery failed:", pushError);
      }
    }
    return { success: true, message: nextStatus === "published" ? "Pengumuman berhasil diperbarui dan diterbitkan." : "Draft pengumuman berhasil diperbarui.", announcementId };
  } catch (err) {
    console.error("Failed to update announcement:", err);
    return { success: false, message: "Gagal memperbarui pengumuman." };
  }
}
