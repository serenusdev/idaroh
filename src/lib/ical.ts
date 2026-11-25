/**
 * RFC 5545 property writer plus the recurrence mapping the /api/calendar/feed subscription
 * publishes. The step and horizon rules mirror expandEventRows() in the schedules module and
 * app.event_occurrence_spans() in the database: a recurring agenda is one row, and the day it
 * repeats on is the WIB calendar date of its base start shifted by whole days (Asia/Jakarta
 * has no daylight saving, so a whole-day shift of the base instant is the same wall-clock).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RECURRENCE_STEPS: Record<string, number> = { daily: 1, weekly: 7 };
const BYDAY: Record<string, string> = {
  Sun: "SU",
  Mon: "MO",
  Tue: "TU",
  Wed: "WE",
  Thu: "TH",
  Fri: "FR",
  Sat: "SA",
};

/**
 * A calendar client keeps the subscription and fetches on its own clock, so the feed has to
 * carry a bounded window: the same 180 days the schedule surface renders.
 */
export const FEED_HORIZON_DAYS = 180;

export function formatIcalInstant(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function escapeIcalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * RFC 5545 line folding: a content line is at most 75 octets and every continuation starts with
 * one space. Titles and locations here routinely exceed that, and an unfolded line is what makes
 * a client truncate a property mid-word.
 */
export function foldIcalLine(line: string): string {
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export function pushVEvent(lines: string[], properties: Array<[string, string]>): void {
  lines.push("BEGIN:VEVENT");
  for (const [name, value] of properties) {
    lines.push(foldIcalLine(`${name}:${value}`));
  }
  lines.push("END:VEVENT");
}

/** The WIB calendar date of an instant, as the `YYYY-MM-DD` key occurrence_date uses. */
export function wibDayKey(value: Date): string {
  return value.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

export function icalWeekday(value: Date): string {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    weekday: "short",
  }).format(value);
  return BYDAY[name] || "";
}

/** Whole WIB days between the base date of a series and one of its occurrence dates. */
export function dayOffsetFromBase(baseDayKey: string, occurrenceDayKey: string): number {
  const base = Date.parse(`${baseDayKey}T00:00:00Z`);
  const occurrence = Date.parse(`${occurrenceDayKey}T00:00:00Z`);
  if (Number.isNaN(base) || Number.isNaN(occurrence)) return NaN;
  return Math.round((occurrence - base) / DAY_MS);
}

export function occurrenceInstant(startsAt: Date, offsetDays: number): Date {
  return new Date(startsAt.getTime() + offsetDays * DAY_MS);
}

export type RecurrenceWindow = {
  /** 0 when the rule cannot be expanded (none, monthly, yearly). */
  stepDays: number;
  firstOffset: number;
  lastOffset: number;
  count: number;
};

const EMPTY_WINDOW: RecurrenceWindow = { stepDays: 0, firstOffset: 0, lastOffset: 0, count: 0 };

/**
 * Which whole-day offsets of a series fall inside [from, to], capped by recurrence_until.
 * Offsets are counted in days from the base instant, so the caller can rebuild each occurrence
 * without a second timezone conversion.
 */
export function recurrenceWindow(
  startsAt: Date,
  rule: string | null | undefined,
  until: Date | null,
  from: Date,
  to: Date,
): RecurrenceWindow {
  const stepDays = RECURRENCE_STEPS[rule || "none"] || 0;
  if (!stepDays) return EMPTY_WINDOW;
  const base = startsAt.getTime();
  const lastAllowed = until && until.getTime() < to.getTime() ? until.getTime() : to.getTime();
  if (lastAllowed < base) return { ...EMPTY_WINDOW, stepDays };

  // +-1 day of slack: an occurrence that starts before `from` can still run into the window.
  const lowest = Math.max(0, Math.floor((from.getTime() - base) / DAY_MS) - 1);
  const highest = Math.floor((lastAllowed - base) / DAY_MS);
  const firstOffset = Math.ceil(lowest / stepDays) * stepDays;
  const lastOffset = Math.floor(highest / stepDays) * stepDays;
  if (firstOffset > lastOffset) return { ...EMPTY_WINDOW, stepDays };

  return {
    stepDays,
    firstOffset,
    lastOffset,
    count: Math.floor((lastOffset - firstOffset) / stepDays) + 1,
  };
}
