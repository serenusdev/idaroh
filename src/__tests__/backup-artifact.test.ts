import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, buildBackupFiles, verifyBackupArtifactStructure } from "@/lib/backup-artifact";

describe("structured database backup artifact", () => {
  it("contains a manifest and one restore input per protected table", () => {
    const { files, manifest } = buildBackupFiles({ profiles: [{ id: "user-1" }] }, "2026-11-28T00:00:00.000Z");
    expect(verifyBackupArtifactStructure(files)).toBe(true);
    expect(manifest.timezone).toBe("Asia/Jakarta");
    expect(files).toHaveLength(BACKUP_TABLES.length + 1);
    expect(files.find((file) => file.name === "tables/profiles.json")?.body).toBeInstanceOf(Uint8Array);
  });

  it("rejects an incomplete artifact", () => {
    expect(verifyBackupArtifactStructure([{ name: "manifest.json", body: new Uint8Array() }])).toBe(false);
  });
});
