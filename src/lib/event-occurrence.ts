const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OCCURRENCE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface EventRef {
  eventId: string;
  occurrenceDate: string | null;
}

export function isEventId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * A recurring agenda is one events row, but the schedule list shows it once per
 * day, so expandEventRows() keys those rows as `<event uuid>:<WIB date>`. That
 * string comes back on every mutation, and Postgres will not compare it against a
 * uuid column — the split has to happen before the query is built.
 *
 * The date half is the Asia/Jakarta calendar date, which is also the primary key
 * half of event_occurrence_exceptions, so a read path and a write path agree on
 * which day an operator meant.
 */
export function parseEventRef(value: unknown): EventRef | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) return null;
  const separator = value.indexOf(":");
  const eventId = separator === -1 ? value : value.slice(0, separator);
  if (!UUID_PATTERN.test(eventId)) return null;
  if (separator === -1) return { eventId, occurrenceDate: null };
  const occurrenceDate = value.slice(separator + 1);
  if (!OCCURRENCE_DATE_PATTERN.test(occurrenceDate)) return null;
  return { eventId, occurrenceDate };
}

export function occurrenceKey(eventId: string, occurrenceDate: string): string {
  return `${eventId}:${occurrenceDate}`;
}
