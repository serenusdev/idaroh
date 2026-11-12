import { describe, expect, it } from "vitest";
import {
  addTaskCommentAction,
  createBackupManifestAction,
  getAnalyticsDrilldownAction,
  getOperationalAnalyticsAction,
  importMembersCsvAction,
  sendTestPushAction,
} from "@/modules/operations/actions";

describe("Operations expansion", () => {
  it("returns source-backed analytics shape with drill-down", async () => {
    const summary = await getOperationalAnalyticsAction("2026-11-01", "2026-11-02");
    expect(summary.attendance.population).toBeGreaterThan(0);
    const rows = await getAnalyticsDrilldownAction("tasks_overdue", "2026-11-01", "2026-11-02");
    expect(rows[0]?.status).toBe("tasks_overdue");
  });

  it("validates CSV imports before placing members in the approval queue", async () => {
    const result = await importMembersCsvAction("anggota.csv", "full_name,email,member_type\nAhmad,ahmad@example.com,santri\nInvalid,nope,santri");
    expect(result.success).toBe(true);
    expect(result.importedRows).toBe(1);
    expect(result.rejectedRows).toBe(1);
  });

  it("keeps collaboration, backup, and push flows callable", async () => {
    expect((await addTaskCommentAction("task-1", "Mohon cek kembali lampirannya.")).success).toBe(true);
    expect((await createBackupManifestAction("database")).success).toBe(true);
    expect((await createBackupManifestAction("restore_test")).success).toBe(false);
    expect((await sendTestPushAction()).sent).toBe(1);
  });
});
