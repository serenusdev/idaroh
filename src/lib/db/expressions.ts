import { sql, type RawBuilder } from "kysely";

/**
 * DX-01 — two expression helpers that exist so callers never hand-write the same raw SQL and never
 * cast a result.
 */

/**
 * `count()` returns bigint, which `pg` hands back as a *string*. The `::int` narrows it in the
 * database, so the driver parses a real number and no caller has to write `Number(...)` or lie to
 * the type system. The dashboards count rows of small tables; int4 is not a limit worth a bigint
 * round-trip.
 */
export function countInt(): RawBuilder<number> {
  return sql<number>`count(*)::int`;
}

/**
 * The whole-filtered-set size carried on every row of a page, so one statement answers both the
 * rows and `hasMore`.
 *
 * `count(*)::int over ()` is a syntax error — the cast binds before `OVER` can attach to the
 * function call — so the narrowing is written as an explicit `cast(… over () as int)`. Verified
 * against Postgres; `count(*) over ()` alone would arrive from `pg` as a string.
 */
export function countIntOver(): RawBuilder<number> {
  return sql<number>`cast(count(*) over () as int)`;
}

/**
 * Renders a date/timestamptz column as the exact JSON text PostgREST produced
 * (`2026-11-27T05:36:56.123456+00:00`) instead of a JS `Date`.
 *
 * The reader pins the session to UTC, and Postgres' json text is the ISO-8601 form with the offset,
 * so this preserves microseconds in the audit explorer and in the exported CSV. A nullable column
 * keeps the same shape: `MAX` over an empty set yields SQL NULL, which arrives as `null`.
 */
export function jsonText(qualifiedColumn: string): RawBuilder<string> {
  return sql<string>`to_jsonb(${sql.ref(qualifiedColumn)}) #>> '{}'`;
}

/** Same rendering for a nullable column, so the read model does not claim a value can never be null. */
export function jsonTextOrNull(qualifiedColumn: string): RawBuilder<string | null> {
  return sql<string | null>`to_jsonb(${sql.ref(qualifiedColumn)}) #>> '{}'`;
}

/**
 * The same JSON-text rendering applied to an aggregate, so "the most recent value of a nullable
 * column" costs no ORDER BY/LIMIT and therefore no bound parameter. MAX over an empty set is NULL,
 * which arrives as `null` rather than the zero a count would produce.
 */
export function jsonMaxText(qualifiedColumn: string): RawBuilder<string | null> {
  return sql<string | null>`to_jsonb(max(${sql.ref(qualifiedColumn)})) #>> '{}'`;
}
