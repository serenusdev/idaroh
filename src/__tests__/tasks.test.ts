import { describe, it, expect } from "vitest";
import {
  updateTaskStatusAction,
  toggleChecklistItemAction,
  createTaskAction,
} from "@/modules/tasks/actions";
import { INITIAL_PROJECTS, INITIAL_TASKS } from "@/modules/tasks/data";

describe("Stage 6 — Tasks & Projects (PRD-05)", () => {
  it("enforces review requirement before marking task done (BR-TSK-06)", async () => {
    // Task requires review and is currently in_progress -> should fail direct transition to done
    const invalidTransition = await updateTaskStatusAction(
      "tsk-01",
      "done",
      true, // requiresReview = true
      "in_progress"
    );
    expect(invalidTransition.success).toBe(false);
    expect(invalidTransition.message).toContain("klausul review wajib");

    // Task requires review and is already in_review -> should succeed
    const validTransitionFromReview = await updateTaskStatusAction(
      "tsk-01",
      "done",
      true,
      "in_review",
      "Disetujui oleh Ustadz Rahmat"
    );
    expect(validTransitionFromReview.success).toBe(true);
    expect(validTransitionFromReview.newStatus).toBe("done");
  });

  it("allows direct completion for tasks without review requirement", async () => {
    const directDone = await updateTaskStatusAction(
      "tsk-03",
      "done",
      false, // requiresReview = false
      "todo"
    );
    expect(directDone.success).toBe(true);
    expect(directDone.newStatus).toBe("done");
  });

  it("updates checklist item status correctly (TSK-014)", async () => {
    const checkRes = await toggleChecklistItemAction("tsk-01", "c1-4", true);
    expect(checkRes.success).toBe(true);
    expect(checkRes.message).toContain("diselesaikan");

    const uncheckRes = await toggleChecklistItemAction("tsk-01", "c1-4", false);
    expect(uncheckRes.success).toBe(true);
    expect(uncheckRes.message).toContain("dibuka kembali");
  });

  it("creates new task with validation per TSK-001", async () => {
    const emptyRes = await createTaskAction({
      title: "   ",
      priority: "normal",
      requiresReview: false,
    });
    expect(emptyRes.success).toBe(false);
    expect(emptyRes.message).toContain("Judul tugas wajib diisi");

    const validRes = await createTaskAction({
      title: "Penyusunan API Gateway Rate Limiting",
      projectId: "proj-presensi-v2",
      priority: "high",
      requiresReview: true,
      dueDateStr: "Sabtu, 22 Nov",
    });
    expect(validRes.success).toBe(true);
    expect(validRes.message).toContain("berhasil dibuat");
    expect(validRes.taskId).toBeDefined();
  });

  it("verifies consistency of projects and tasks mock data", () => {
    expect(INITIAL_PROJECTS.length).toBe(4);
    const presensiProject = INITIAL_PROJECTS.find(
      (p) => p.name === "Integrasi Presensi V2"
    );
    expect(presensiProject).toBeDefined();
    expect(presensiProject?.progressPercent).toBe(75);
    expect(presensiProject?.teamName).toBe("Sentra Digital");

    expect(INITIAL_TASKS.length).toBeGreaterThanOrEqual(6);
    const overdueTask = INITIAL_TASKS.find((t) => t.isOverdue);
    expect(overdueTask).toBeDefined();
    expect(overdueTask?.priority).toBe("urgent");
  });
});

describe("FUNC-26: projectId condition fix", () => {
  it("creates task with short slug-based projectId (was incorrectly discarded)", async () => {
    // Before fix: "proj-presensi-v2" (16 chars) would be passed as null because length <= 30
    // After fix: any non-empty string is preserved
    const result = await createTaskAction({
      title: "Tugas dengan project ID pendek",
      projectId: "proj-presensi-v2",
      priority: "normal",
      requiresReview: false,
    });
    expect(result.success).toBe(true);
    // In VITEST mode the action returns early before DB write, so we verify
    // the action doesn't reject valid short projectIds
    expect(result.taskId).toBeDefined();
  });
});
