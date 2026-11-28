import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashCalendarToken } from "@/lib/fcm";
import { throwQueryError } from "@/lib/query-error";
import {
  FEED_HORIZON_DAYS,
  dayOffsetFromBase,
  escapeIcalText,
  formatIcalInstant,
  foldIcalLine,
  icalWeekday,
  occurrenceInstant,
  pushVEvent,
  recurrenceWindow,
  wibDayKey,
} from "@/lib/ical";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/calendar/feed
 * Generates dynamic RFC 5545 iCalendar (.ics) subscription feed from Supabase events
 */
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token || token.length < 32) {
      return NextResponse.json({ error: "Calendar token wajib diisi." }, { status: 401 });
    }
    const supabase = createAdminClient();
    const { data: subscription, error: subscriptionError } = await supabase
      .from("calendar_subscriptions")
      .select("id, user_id, expires_at, revoked_at")
      .eq("token_hash", hashCalendarToken(token))
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (
      !subscription ||
      subscription.revoked_at ||
      new Date(subscription.expires_at).getTime() <= Date.now()
    ) {
      return NextResponse.json({ error: "Calendar token tidak valid atau sudah kedaluwarsa." }, { status: 401 });
    }

    const { data: owner, error: ownerError } = await supabase
      .from("profiles")
      .select("id, team_name, member_type, status")
      .eq("id", subscription.user_id)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner || owner.status !== "active") {
      return NextResponse.json({ error: "Akun pemilik kalender tidak aktif." }, { status: 403 });
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("team_members")
      .select("team_id, teams(id, name, slug)")
      .eq("user_id", owner.id)
      .is("valid_to", null);
    if (membershipError) throw membershipError;
    const ownerTeamKeys = new Set(
      (memberships || []).flatMap((item: { team_id: string; teams?: { id?: string; name?: string; slug?: string } | null }) => [
        item.team_id,
        item.teams?.id,
        item.teams?.name,
        item.teams?.slug,
      ]).filter(Boolean)
    );

    const { data: events, error } = await supabase
      .from("events")
      .select("*")
      .neq("status", "cancelled")
      .is("deleted_at", null)
      .order("starts_at", { ascending: true });

    // A calendar client caches what it is given, so a failed read has to be an HTTP error:
    // an empty-but-valid feed is stored as "the pondok has no agenda".
    if (error) throwQueryError("calendarFeed.events", error);

    const now = new Date();
    const prologue: Array<[string, string]> = [
      ["VERSION", "2.0"],
      ["PRODID", "-//Pondok Quran Abdurrahman bin Auf//IDAROH//ID"],
      ["CALSCALE", "GREGORIAN"],
      ["METHOD", "PUBLISH"],
      ["X-WR-CALNAME", "Agenda & Kajian IDAROH"],
      ["X-WR-TIMEZONE", "Asia/Jakarta"],
      ["X-WR-CALDESC", "Jadwal kegiatan santri, kajian kitab, dan operasional Pondok Quran Abdurrahman bin Auf"],
    ];
    const lines: string[] = ["BEGIN:VCALENDAR"];
    for (const [name, value] of prologue) {
      lines.push(foldIcalLine(`${name}:${value}`));
    }

    const visibleEvents = (events || []).filter((event: { audience_config?: Record<string, unknown>; team_id?: string | null }) => {
      const config = event.audience_config || { scope: "all" };
      if (config.scope === "users") return Array.isArray(config.userIds) && config.userIds.includes(owner.id);
      if (config.scope === "member_type") return Array.isArray(config.memberTypes) && config.memberTypes.includes(owner.member_type || "santri");
      if (config.scope === "team") return Array.isArray(config.teamIds) && config.teamIds.some((id) => ownerTeamKeys.has(id));
      return !event.team_id || event.team_id === owner.team_name || ownerTeamKeys.has(event.team_id);
    });

    const recurringIds = visibleEvents
      .filter((event: { recurrence_rule?: string | null }) => (event.recurrence_rule || "none") !== "none")
      .map((event: { id: string }) => event.id);
    // An unknown cancellation would publish a called-off day as an appointment, so this read
    // is as fatal as the events read above.
    const { data: exceptions, error: exceptionError } = recurringIds.length
      ? await supabase
          .from("event_occurrence_exceptions")
          .select("event_id, occurrence_date")
          .in("event_id", recurringIds)
      : { data: [] as Array<{ event_id: string; occurrence_date: string }> };
    if (exceptionError) throwQueryError("calendarFeed.occurrenceExceptions", exceptionError);

    const cancelledDays = new Map<string, string[]>();
    for (const row of (exceptions || []) as Array<{ event_id: string; occurrence_date: string }>) {
      const existing = cancelledDays.get(row.event_id) || [];
      existing.push(String(row.occurrence_date).slice(0, 10));
      cancelledDays.set(row.event_id, existing);
    }

    const windowFrom = new Date(now.getTime() - DAY_MS);
    const windowTo = new Date(now.getTime() + FEED_HORIZON_DAYS * DAY_MS);

    if (visibleEvents.length > 0) {
      for (const event of visibleEvents) {
        const start = new Date(event.starts_at);
        const end = new Date(event.ends_at);
        const rule = event.recurrence_rule || "none";
        const window = recurrenceWindow(
          start,
          rule,
          event.recurrence_until ? new Date(event.recurrence_until) : null,
          windowFrom,
          windowTo,
        );
        // A series that has no occurrence left inside the published window would otherwise be
        // projected from its base date forever by the client.
        if (window.stepDays > 0 && window.count === 0) continue;

        const exdates = window.stepDays > 0
          ? (cancelledDays.get(event.id) || [])
              .map((day) => dayOffsetFromBase(wibDayKey(start), day))
              .filter(
                (offset) =>
                  Number.isFinite(offset) &&
                  offset % window.stepDays === 0 &&
                  offset >= window.firstOffset &&
                  offset <= window.lastOffset,
              )
              .map((offset) => formatIcalInstant(occurrenceInstant(start, offset)))
              .sort()
          : [];
        if (window.stepDays > 0 && exdates.length >= window.count) continue;

        const properties: Array<[string, string]> = [
          ["UID", `${event.id}@pondok.os`],
          ["DTSTAMP", formatIcalInstant(now)],
          ["DTSTART", formatIcalInstant(start)],
          ["DTEND", formatIcalInstant(end)],
          ["SUMMARY", escapeIcalText(event.title)],
        ];
        if (event.description) {
          properties.push(["DESCRIPTION", escapeIcalText(event.description)]);
        }
        if (event.location) {
          properties.push(["LOCATION", escapeIcalText(event.location)]);
        }
        if (window.stepDays > 0) {
          const byday = rule === "weekly" ? `;BYDAY=${icalWeekday(start)}` : "";
          properties.push([
            "RRULE",
            `FREQ=${rule === "weekly" ? "WEEKLY" : "DAILY"}${byday};UNTIL=${formatIcalInstant(
              occurrenceInstant(start, window.lastOffset),
            )}`,
          ]);
          if (exdates.length > 0) {
            properties.push(["EXDATE", exdates.join(",")]);
          }
        }
        properties.push(["STATUS", "CONFIRMED"]);
        pushVEvent(lines, properties);
      }
    }

    lines.push("END:VCALENDAR");

    const icalContent = lines.join("\r\n");

    return new Response(icalContent, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="agenda-pondok.ics"',
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (err) {
    console.error("iCal feed error:", err);
    return NextResponse.json(
      { error: "Gagal memproses feed kalender" },
      { status: 500 }
    );
  }
}

