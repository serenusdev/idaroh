import { isDateOnly } from "@/lib/input-validation";
import type { UserProfile, UserRole } from "@/lib/auth/types";

/**
 * PERMISSIONS.md §3.8 — the single source of truth for the export surface.
 *
 * `analytics.export` grants yayasan/pengurus only; `super_admin` is explicitly
 * denied and koordinator has no export at all. `admin.audit.read` additionally
 * denies pengurus, so the audit dataset stays yayasan-only even for a caller
 * who holds the export permission.
 */
export const EXPORT_ROLES: readonly UserRole[] = ["pengurus", "yayasan"];
export const AUDIT_EXPORT_ROLES: readonly UserRole[] = ["yayasan"];
/** §3.8 `admin.audit.read`: yayasan and super_admin may read the trail; pengurus may not. */
export const AUDIT_READ_ROLES: readonly UserRole[] = ["yayasan", "super_admin"];

export const EXPORT_CATEGORIES = [
  "presensi",
  "presensi_laporan",
  "laporan",
  "tugas",
  "tugas_proyek",
  "users",
  "audit_logs",
] as const;

export type ExportCategory = (typeof EXPORT_CATEGORIES)[number];
export type ExportFileFormat = "csv" | "pdf";

export interface ExportFilterInput {
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface ResolvedExportFilters {
  dateFrom: string | null;
  dateTo: string | null;
}

export function isExportCategory(value: unknown): value is ExportCategory {
  return typeof value === "string" && (EXPORT_CATEGORIES as readonly string[]).includes(value);
}

export function holdsRole(user: UserProfile, roles: readonly UserRole[]): boolean {
  const held = new Set<UserRole>([user.role, ...(user.roles || [])]);
  return roles.some((role) => held.has(role));
}

export function exportRolesFor(category: ExportCategory): readonly UserRole[] {
  return category === "audit_logs" ? AUDIT_EXPORT_ROLES : EXPORT_ROLES;
}

/**
 * Date-only WIB calendar values. Anything that is not a real calendar date or
 * that spans backwards is refused before it can reach filter_criteria.
 */
export function validateExportFilters(
  filters?: ExportFilterInput | null,
): { ok: true; value: ResolvedExportFilters } | { ok: false; message: string } {
  const dateFrom = normalizeDate(filters?.dateFrom);
  const dateTo = normalizeDate(filters?.dateTo);
  if ((filters?.dateFrom && !dateFrom) || (filters?.dateTo && !dateTo)) {
    return { ok: false, message: "Rentang tanggal ekspor wajib berformat YYYY-MM-DD." };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { ok: false, message: "Tanggal awal ekspor harus mendahului tanggal akhir." };
  }
  return { ok: true, value: { dateFrom, dateTo } };
}

/**
 * Reads the filters persisted with an export request. Returns null when the
 * stored value is not a validated date pair: the caller then refuses instead
 * of silently widening the download back to the whole institution.
 */
export function parseStoredExportFilters(raw: unknown): ResolvedExportFilters | null {
  if (raw === null || raw === undefined) return { dateFrom: null, dateTo: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const criteria = raw as Record<string, unknown>;
  const rawFrom = typeof criteria.date_from === "string" ? criteria.date_from : null;
  const rawTo = typeof criteria.date_to === "string" ? criteria.date_to : null;
  const dateFrom = normalizeDate(rawFrom);
  const dateTo = normalizeDate(rawTo);
  if ((rawFrom && !dateFrom) || (rawTo && !dateTo)) return null;
  if (dateFrom && dateTo && dateFrom > dateTo) return null;
  return { dateFrom, dateTo };
}

/**
 * WIB (UTC+7, no DST) day boundaries for timestamp columns.
 */
export function wibDateRange(
  filters: ResolvedExportFilters,
): { startIso: string; endExclusiveIso: string } | null {
  if (!filters.dateFrom || !filters.dateTo) return null;
  const start = Date.parse(`${filters.dateFrom}T00:00:00+07:00`);
  const end = Date.parse(`${filters.dateTo}T00:00:00+07:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return {
    startIso: new Date(start).toISOString(),
    endExclusiveIso: new Date(end + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!isDateOnly(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}
