export const BACKUP_TABLES = [
  "profiles",
  "attendance_records",
  "daily_reports",
  "tasks",
  "events",
  "announcements",
  "students",
  "academic_terms",
  "report_cards",
  "stored_files",
  "notification_dispatches",
  "mutabaah_logs",
  "halaqah_logs",
  "gate_passes",
  "task_attachments",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupFile {
  name: string;
  body: Uint8Array;
}

export interface BackupManifest {
  format: "idaroh-database-backup";
  version: 1;
  generated_at: string;
  timezone: "Asia/Jakarta";
  tables: Record<string, { path: string; row_count: number }>;
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));

export function buildBackupFiles(rowsByTable: Record<string, unknown[]>, generatedAt: string): { files: BackupFile[]; manifest: BackupManifest } {
  const tables = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, { path: `tables/${table}.json`, row_count: rowsByTable[table]?.length ?? 0 }]),
  );
  const manifest: BackupManifest = {
    format: "idaroh-database-backup",
    version: 1,
    generated_at: generatedAt,
    timezone: "Asia/Jakarta",
    tables,
  };
  const files: BackupFile[] = [
    { name: "manifest.json", body: encode(manifest) },
    ...BACKUP_TABLES.map((table) => ({ name: `tables/${table}.json`, body: encode(rowsByTable[table] ?? []) })),
  ];
  return { files, manifest };
}

export function verifyBackupArtifactStructure(files: readonly BackupFile[]): boolean {
  const names = new Set(files.map((file) => file.name));
  if (!names.has("manifest.json")) return false;
  return BACKUP_TABLES.every((table) => names.has(`tables/${table}.json`));
}
