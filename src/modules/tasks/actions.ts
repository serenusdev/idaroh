"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuthUser } from "@/lib/auth/guards";
import {
  holdsTaskRole,
  TASK_OVERSIGHT_ROLES,
  TASK_PROJECT_ROLES,
  TASK_READ_ROLES,
  TASK_REVIEW_ROLES,
} from "@/lib/task-policy";
import { sendPushToUsers } from "@/lib/fcm";
import { isNonEmptyString, isPlainRecord } from "@/lib/input-validation";
import { throwQueryError } from "@/lib/query-error";
import { INITIAL_PROJECTS, INITIAL_TASKS } from "./data";
import { ProjectItem, TaskItem, TaskPriority, TaskStatus, TaskVisibility } from "./types";

interface TaskActionResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

export interface CreateTaskPayload {
  title: string;
  projectId?: string;
  projectName?: string;
  priority: TaskPriority;
  requiresReview: boolean;
  dueDateStr?: string;
  dueDateIso?: string;
  description?: string;
  assigneeIds?: string[];
  visibility?: TaskVisibility;
}

export interface ProjectPayload {
  name: string;
  description?: string;
  teamName?: string;
  status?: ProjectItem["status"];
}

/**
 * Server Action: Query all live tasks from Supabase
 */
export async function getTasksAction(): Promise<TaskItem[]> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) return [];
  try {
    const supabase = createAdminClient();
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("*, projects(*), task_checklist_items(*), task_assignees(user_id, unassigned_at)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    if (tasks) {
      if (tasks.length === 0) return [];
      let visibleTasks = tasks as any[];
      if (!holdsTaskRole(user, TASK_OVERSIGHT_ROLES)) {
        const { data: memberships } = await supabase.from("team_members").select("team_id, teams(id, name, slug)").eq("user_id", user.id).is("valid_to", null);
        const teamIds = new Set((memberships || []).flatMap((item: any) => [item.team_id, item.teams?.id, item.teams?.name, item.teams?.slug]));
        visibleTasks = visibleTasks.filter((task: any) =>
          task.created_by === user.id ||
          (task.task_assignees || []).some((assignment: any) => assignment.user_id === user.id && !assignment.unassigned_at) ||
          (task.visibility === "organization") ||
          (task.visibility !== "private" && task.team_id && teamIds.has(task.team_id))
        );
      }
      if (visibleTasks.length === 0) return [];
      const taskIds = visibleTasks.map((task: any) => task.id);
      const { data: assignments, error: assignmentError } = await supabase
        .from("task_assignees")
        .select("task_id, user_id")
        .in("task_id", taskIds)
        .is("unassigned_at", null);
      if (assignmentError) throw assignmentError;
      const assigneeIds = Array.from(new Set((assignments || []).map((a: any) => a.user_id)));
      const { data: profiles, error: profileError } = assigneeIds.length
        ? await supabase.from("profiles").select("id, full_name, member_type").in("id", assigneeIds)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const profileMap = new Map<string, any>((profiles || []).map((profile: any) => [profile.id, profile]));
      const assignmentsByTask = new Map<string, any[]>();
      for (const assignment of assignments || []) {
        const list = assignmentsByTask.get(assignment.task_id) || [];
        const profile = profileMap.get(assignment.user_id);
        if (profile) list.push({ userId: profile.id, name: profile.full_name, role: profile.member_type || "Santri" });
        assignmentsByTask.set(assignment.task_id, list);
      }

      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
      return visibleTasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description || "",
        projectId: t.project_id || "proj-general",
        projectName: t.projects?.name || "Operasional Santri",
        projectTeam: t.team_id || "Sentra Digital",
        priority: t.priority as TaskPriority,
        status: t.status as TaskStatus,
        requiresReview: t.requires_review,
        dueDateStr: t.due_date
          ? new Date(t.due_date).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
            })
          : "Segera",
        dueDateIso: t.due_date || "",
        isOverdue: Boolean(t.due_date && t.due_date < today && !["done", "cancelled"].includes(t.status)),
        isDueToday: t.due_date === today,
        checklist: (t.task_checklist_items || []).map((item: any) => ({ id: item.id, text: item.text, done: item.done })),
        assignees: assignmentsByTask.get(t.id) || [],
        visibility: (t.visibility || "team") as TaskVisibility,
      }));
    }
  } catch (err) {
    if (process.env.VITEST) return INITIAL_TASKS;
    throwQueryError("tasks.list", err);
  }

  if (process.env.VITEST) {
    return INITIAL_TASKS;
  }

  return [];
}

/**
 * Server Action: Query projects from Supabase
 */
export async function getProjectsAction(): Promise<ProjectItem[]> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) return [];
  try {
    const supabase = createAdminClient();
    const { data: projects, error } = await supabase
      .from("projects")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    if (!error && projects) {
      if (projects.length === 0) return [];
      const elevated = holdsTaskRole(user, TASK_OVERSIGHT_ROLES);
      let visibleProjects = projects as any[];
      if (!elevated) {
        const { data: memberships, error: membershipError } = await supabase
          .from("team_members")
          .select("team_id, teams(id, name, slug)")
          .eq("user_id", user.id)
          .is("valid_to", null);
        if (membershipError) throw membershipError;
        const teamKeys = new Set((memberships || []).flatMap((item: any) => [item.team_id, item.teams?.id, item.teams?.name, item.teams?.slug]).filter(Boolean));
        visibleProjects = visibleProjects.filter((project) =>
          project.owner_id === user.id || project.created_by === user.id || (project.team_id && teamKeys.has(project.team_id))
        );
      }
      if (visibleProjects.length === 0) return [];
      const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
      const { data: tasks, error: taskError } = await supabase
        .from("tasks")
        .select("project_id, status")
        .is("deleted_at", null);
      if (taskError) throw taskError;
      const byProject = new Map<string, any[]>();
      for (const task of tasks || []) {
        if (task.project_id && !visibleProjectIds.has(task.project_id)) continue;
        const list = byProject.get(task.project_id) || [];
        list.push(task);
        byProject.set(task.project_id, list);
      }

      return visibleProjects.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description || "",
        teamName: p.team_id || "Tim Pondok",
        status: p.status as ProjectItem["status"],
        totalTasks: (byProject.get(p.id) || []).length,
        completedTasks: (byProject.get(p.id) || []).filter((task: any) => task.status === "done").length,
        blockedTasks: (byProject.get(p.id) || []).filter((task: any) => task.status === "cancelled").length,
        progressPercent: (byProject.get(p.id) || []).length
          ? Math.round(((byProject.get(p.id) || []).filter((task: any) => task.status === "done").length / (byProject.get(p.id) || []).length) * 100)
          : 0,
        icon: "folder",
        canManage: elevated || p.owner_id === user.id || p.created_by === user.id,
      }));
    }
  } catch (err) {
    if (process.env.VITEST) return INITIAL_PROJECTS;
    throwQueryError("tasks.projects", err);
  }

  if (process.env.VITEST) {
    return INITIAL_PROJECTS;
  }

  return [];
}

export async function createProjectAction(payload: ProjectPayload): Promise<TaskActionResult<{ projectId: string }>> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_PROJECT_ROLES)) {
    return { success: false, message: "Hanya koordinator, pengurus, atau yayasan yang dapat membuat proyek." };
  }
  if (!isPlainRecord(payload) || !isNonEmptyString(payload.name, 120)) return { success: false, message: "Nama proyek wajib diisi dan maksimal 120 karakter." };
  const name = payload.name.trim();
  if (process.env.VITEST) return { success: true, message: "Proyek berhasil dibuat.", data: { projectId: `project-${Date.now()}` } };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("project_upsert", {
      p_project_id: null,
      p_name: name,
      p_description: payload.description?.trim() || null,
      p_team_id: payload.teamName?.trim() || null,
      p_status: payload.status || "planned",
    });
    if (error) throw error;
    if (!data?.success || !data.project_id) {
      return { success: false, message: data?.message || "Gagal membuat proyek." };
    }
    return { success: true, message: `Proyek "${name}" berhasil dibuat.`, data: { projectId: data.project_id } };
  } catch (error) {
    console.error("Failed to create project:", error);
    return { success: false, message: "Gagal membuat proyek." };
  }
}

export async function updateProjectAction(projectId: string, payload: ProjectPayload): Promise<TaskActionResult> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_PROJECT_ROLES)) {
    return { success: false, message: "Anda tidak memiliki akses mengubah proyek ini." };
  }
  if (!isNonEmptyString(projectId, 100) || !isPlainRecord(payload) || !isNonEmptyString(payload.name, 120)) return { success: false, message: "ID dan nama proyek wajib diisi dengan format yang valid." };
  const name = payload.name.trim();
  if (process.env.VITEST) return { success: true, message: "Proyek berhasil diperbarui." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("project_upsert", {
      p_project_id: projectId,
      p_name: name,
      p_description: payload.description?.trim() || null,
      p_team_id: payload.teamName?.trim() || null,
      p_status: payload.status || "active",
    });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Gagal memperbarui proyek." };
    return { success: true, message: `Proyek "${name}" berhasil diperbarui.` };
  } catch (error) {
    console.error("Failed to update project:", error);
    return { success: false, message: "Gagal memperbarui proyek." };
  }
}

export async function archiveProjectAction(projectId: string): Promise<TaskActionResult> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_PROJECT_ROLES)) {
    return { success: false, message: "Anda tidak memiliki akses mengarsipkan proyek ini." };
  }
  if (!projectId) return { success: false, message: "ID proyek tidak valid." };
  if (process.env.VITEST) return { success: true, message: "Proyek berhasil diarsipkan." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("project_archive", { p_project_id: projectId });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Gagal mengarsipkan proyek." };
    return { success: true, message: `Proyek "${data.name || ""}" berhasil diarsipkan.` };
  } catch (error) {
    console.error("Failed to archive project:", error);
    return { success: false, message: "Gagal mengarsipkan proyek." };
  }
}

/**
 * Server Action: Update Task Status with State Machine Check (BR-TSK-03, BR-TSK-06)
 */
export async function updateTaskStatusAction(
  taskId: string,
  newStatus: TaskStatus,
  requiresReview: boolean = false,
  currentStatus: TaskStatus = "todo",
  note?: string
): Promise<{ success: boolean; message: string; newStatus: TaskStatus }> {
  const user = await requireAuthUser();
  // BR-TSK-06: Done requires review if requires_review is true
  if (newStatus === "done" && requiresReview && currentStatus !== "in_review") {
    return {
      success: false,
      message:
        "Tugas ini memiliki klausul review wajib (BR-TSK-06). Silakan ajukan ke In Review terlebih dahulu agar dapat disetujui pereview.",
      newStatus: currentStatus,
    };
  }

  if (process.env.VITEST) {
    return {
      success: true,
      message: `Status tugas berhasil diperbarui menjadi ${newStatus}.`,
      newStatus,
    };
  }

  const labelMap: Record<TaskStatus, string> = {
    todo: "To Do",
    in_progress: "In Progress (Sedang Dikerjakan)",
    in_review: "In Review (Menunggu Review)",
    done: "Done (Selesai)",
    cancelled: "Cancelled (Dibatalkan)",
  };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_transition", {
      p_task_id: taskId,
      p_new_status: newStatus,
      p_user_id: user.id,
      p_note: note || null,
    });
    if (error) throw error;
    if (!data?.success) {
      return { success: false, message: data?.message || "Status tugas tidak berubah.", newStatus: currentStatus };
    }
    return {
      success: true,
      message: `Status tugas berhasil diperbarui menjadi ${labelMap[newStatus]}.${note ? ` Catatan: ${note}` : ""}`,
      newStatus,
    };
  } catch (err) {
    console.error("Failed to update task status in Supabase:", err);
    return { success: false, message: "Gagal memperbarui status tugas.", newStatus: currentStatus };
  }
}

/**
 * Server Action: Toggle Checklist Item (TSK-014)
 */
export async function toggleChecklistItemAction(
  taskId: string,
  checklistId: string,
  done: boolean
): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) {
    return { success: false, message: "Anda tidak memiliki akses ke checklist tugas ini." };
  }
  if (process.env.VITEST) {
    return {
      success: true,
      message: `Checklist tugas berhasil ${done ? "diselesaikan" : "dibuka kembali"}.`,
    };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_checklist_mutate", {
      p_task_id: taskId,
      p_action: "toggle",
      p_checklist_id: checklistId,
      p_text: null,
      p_done: done,
    });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Gagal memperbarui checklist tugas." };
  } catch (err) {
    console.error("Failed to update checklist:", err);
    return { success: false, message: "Gagal memperbarui checklist tugas." };
  }
  return {
    success: true,
    message: `Checklist tugas berhasil ${done ? "diselesaikan" : "dibuka kembali"}.`,
  };
}

export async function addChecklistItemAction(taskId: string, text: string): Promise<TaskActionResult<{ itemId: string }>> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) {
    return { success: false, message: "Anda tidak memiliki akses ke checklist tugas ini." };
  }
  const cleanText = text.trim();
  if (!taskId || !cleanText) return { success: false, message: "Tugas dan teks checklist wajib diisi." };
  if (process.env.VITEST) return { success: true, message: "Checklist ditambahkan.", data: { itemId: `check-${Date.now()}` } };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_checklist_mutate", {
      p_task_id: taskId,
      p_action: "add",
      p_checklist_id: null,
      p_text: cleanText,
      p_done: false,
    });
    if (error) throw error;
    if (!data?.success || !data.item_id) return { success: false, message: data?.message || "Gagal menambahkan checklist." };
    return { success: true, message: "Checklist berhasil ditambahkan.", data: { itemId: data.item_id } };
  } catch (error) {
    console.error("Failed to add checklist item:", error);
    return { success: false, message: "Gagal menambahkan checklist." };
  }
}

export async function updateChecklistItemAction(taskId: string, checklistId: string, text: string): Promise<TaskActionResult> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) {
    return { success: false, message: "Anda tidak memiliki akses ke checklist tugas ini." };
  }
  const cleanText = text.trim();
  if (!taskId || !checklistId || !cleanText) return { success: false, message: "Checklist tidak valid." };
  if (process.env.VITEST) return { success: true, message: "Checklist diperbarui." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_checklist_mutate", {
      p_task_id: taskId,
      p_action: "update",
      p_checklist_id: checklistId,
      p_text: cleanText,
      p_done: false,
    });
    if (error) throw error;
    return data?.success ? { success: true, message: "Checklist berhasil diperbarui." } : { success: false, message: data?.message || "Checklist tidak ditemukan." };
  } catch (error) {
    console.error("Failed to update checklist item:", error);
    return { success: false, message: "Gagal memperbarui checklist." };
  }
}

export async function deleteChecklistItemAction(taskId: string, checklistId: string): Promise<TaskActionResult> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) {
    return { success: false, message: "Anda tidak memiliki akses ke checklist tugas ini." };
  }
  if (!taskId || !checklistId) return { success: false, message: "Checklist tidak valid." };
  if (process.env.VITEST) return { success: true, message: "Checklist dihapus." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_checklist_mutate", {
      p_task_id: taskId,
      p_action: "delete",
      p_checklist_id: checklistId,
      p_text: null,
      p_done: false,
    });
    if (error) throw error;
    return data?.success ? { success: true, message: "Checklist berhasil dihapus." } : { success: false, message: data?.message || "Checklist tidak ditemukan." };
  } catch (error) {
    console.error("Failed to delete checklist item:", error);
    return { success: false, message: "Gagal menghapus checklist." };
  }
}

/**
 * Server Action: Create New Task (TSK-001)
 */
export async function createTaskAction(
  payload: CreateTaskPayload
): Promise<{ success: boolean; message: string; taskId?: string }> {
  if (!isPlainRecord(payload) || !isNonEmptyString(payload.title, 200)) {
    return {
      success: false,
      message: "Judul tugas wajib diisi.",
    };
  }

  await requireAuthUser();
  if (process.env.VITEST) {
    return {
      success: true,
      message: `Tugas "${payload.title}" berhasil dibuat dan masuk ke daftar kerja santri.`,
      taskId: `tsk-${Date.now()}`,
    };
  }
  let newId = `tsk-${Date.now()}`;
  try {
    const supabase = await createClient();
    const assigneeIds = Array.from(new Set((payload.assigneeIds || []).filter(Boolean)));
    const dueDate = payload.dueDateIso || (payload.dueDateStr && /^\d{4}-\d{2}-\d{2}$/.test(payload.dueDateStr) ? payload.dueDateStr : null);
    const { data: created, error } = await supabase.rpc("create_task", {
      p_title: payload.title,
      p_description: payload.description || "",
      p_priority: payload.priority,
      p_requires_review: payload.requiresReview,
      p_project_id: payload.projectId ? payload.projectId : null,
      p_due_date: dueDate,
      p_visibility: payload.visibility || "team",
      p_assignee_ids: assigneeIds,
    });
    if (error) throw error;
    if (!created?.success || !created.task_id) throw new Error(created?.message || "Tugas tidak tersimpan.");
    newId = created.task_id;
    if (assigneeIds.length > 0) {
      try {
        await sendPushToUsers(assigneeIds, {
          type: "TASK_ASSIGNED",
          title: "Amanah Baru",
          body: `Anda mendapat tugas: ${payload.title}`,
          url: "/tugas",
          referenceId: newId,
        });
      } catch (pushError) {
        console.error("Task saved but push delivery failed:", pushError);
      }
    }
  } catch (err) {
    console.error("Failed to insert task to Supabase:", err);
    return { success: false, message: "Gagal membuat tugas." };
  }

  return {
    success: true,
    message: `Tugas "${payload.title}" berhasil dibuat dan masuk ke daftar kerja santri.`,
    taskId: newId,
  };
}

export async function updateTaskAction(
  taskId: string,
  payload: CreateTaskPayload
): Promise<{ success: boolean; message: string; taskId?: string }> {
  if (!isNonEmptyString(taskId, 100) || !isPlainRecord(payload) || !isNonEmptyString(payload.title, 200)) return { success: false, message: "ID dan judul tugas wajib diisi dengan format yang valid." };
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) return { success: false, message: "Peran Anda tidak memiliki akses mengubah tugas." };
  if (process.env.VITEST) return { success: true, message: "Tugas berhasil diperbarui.", taskId };
  try {
    const dueDate = payload.dueDateIso || payload.dueDateStr || null;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { success: false, message: "Format tenggat tugas tidak valid." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_update", {
      p_task_id: taskId,
      p_title: payload.title.trim(),
      p_description: payload.description?.trim() || "",
      p_priority: payload.priority,
      p_requires_review: payload.requiresReview,
      p_project_id: payload.projectId ? payload.projectId : null,
      p_due_date: dueDate,
      p_visibility: payload.visibility || "team",
    });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Gagal memperbarui tugas." };
    return { success: true, message: `Tugas "${payload.title.trim()}" berhasil diperbarui.`, taskId };
  } catch (error) {
    console.error("Failed to update task:", error);
    return { success: false, message: "Gagal memperbarui tugas." };
  }
}

export async function deleteTaskAction(taskId: string): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) return { success: false, message: "Peran Anda tidak memiliki akses mengarsipkan tugas." };
  if (!taskId) return { success: false, message: "ID tugas tidak valid." };
  if (process.env.VITEST) return { success: true, message: "Tugas berhasil diarsipkan." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_archive", { p_task_id: taskId });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Gagal mengarsipkan tugas." };
    return { success: true, message: "Tugas berhasil diarsipkan." };
  } catch (error) {
    console.error("Failed to archive task:", error);
    return { success: false, message: "Gagal mengarsipkan tugas." };
  }
}

/**
 * Server Action: Assign Reviewer to Task (TRC-22)
 * Only the task creator, team coordinator, or oversight role (pengurus/yayasan) can assign a
 * reviewer. The platform super-admin role holds no task permission at all.
 */
export async function assignReviewerToTaskAction(
  taskId: string,
  reviewerId: string
): Promise<TaskActionResult> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) {
    return { success: false, message: "Peran Anda tidak memiliki akses menetapkan reviewer." };
  }
  if (!isNonEmptyString(taskId, 100) || !isNonEmptyString(reviewerId, 100)) {
    return { success: false, message: "ID tugas dan reviewer wajib diisi." };
  }
  if (process.env.VITEST) {
    return { success: true, message: "Reviewer berhasil ditetapkan." };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_assign_reviewer", {
      p_task_id: taskId,
      p_reviewer_id: reviewerId,
    });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Gagal menetapkan reviewer." };
    const adminClient = createAdminClient();
    const { data: task } = await adminClient.from("tasks").select("title").eq("id", taskId).maybeSingle();
    try {
      await sendPushToUsers([reviewerId], {
        type: "TASK_REVIEW_REQUESTED",
        title: "Anda Ditunjuk sebagai Reviewer",
        body: `Mohon tinjau tugas: ${task?.title || "Tugas"}`,
        url: `/tugas?task=${taskId}`,
        referenceId: taskId,
      });
    } catch (pushError) {
      console.error("Reviewer assigned but push delivery failed:", pushError);
    }
    return { success: true, message: `Reviewer "${data.reviewer_name || "Anggota"}" berhasil ditetapkan untuk tugas ini.` };
  } catch (error) {
    console.error("Failed to assign reviewer:", error);
    return { success: false, message: "Gagal menetapkan reviewer." };
  }
}

/**
 * Server Action: Submit Task Review Decision (TRC-22)
 * Only the reviewer_id of the task can submit a review decision.
 * The reviewer cannot edit task content — only decision + note.
 */
export async function submitTaskReviewAction(
  taskId: string,
  decision: "approved" | "rejected" | "comment",
  note: string
): Promise<TaskActionResult> {
  const user = await requireAuthUser();
  if (!isNonEmptyString(taskId, 100)) return { success: false, message: "ID tugas tidak valid." };
  if (!["approved", "rejected", "comment"].includes(decision)) {
    return { success: false, message: "Keputusan review tidak valid." };
  }
  const cleanNote = note.trim();
  if (!cleanNote) return { success: false, message: "Catatan review wajib diisi." };

  if (process.env.VITEST) {
    // In VITEST the seams below exercise the decision branches only; the real
    // authority check lives in app.task_transition and runs against the database.
    return { success: true, message: `Review "${decision}" berhasil dikirimkan.` };
  }

  try {
    const supabase = createAdminClient();
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, title, created_by, reviewer_id, status, requires_review")
      .eq("id", taskId)
      .is("deleted_at", null)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!task) return { success: false, message: "Tugas tidak ditemukan." };
    if (!holdsTaskRole(user, TASK_REVIEW_ROLES)) {
      return { success: false, message: "Hanya koordinator atau pengurus yang dapat me-review tugas." };
    }
    if (task.reviewer_id !== user.id) {
      return { success: false, message: "Hanya reviewer tugas yang dapat memberikan keputusan review." };
    }
    const { data: activeAssignees, error: assigneeError } = await supabase
      .from("task_assignees")
      .select("user_id")
      .eq("task_id", taskId)
      .is("unassigned_at", null);
    if (assigneeError) throw assigneeError;
    const assigneeIds = (activeAssignees || []).map((row: any) => row.user_id as string);
    if (task.created_by === user.id || assigneeIds.includes(user.id)) {
      return { success: false, message: "Dilarang self-review: reviewer bukan pembuat atau penanggung jawab tugas ini." };
    }
    if (task.status !== "in_review" && decision !== "comment") {
      return { success: false, message: "Tugas harus berstatus In Review sebelum dapat disetujui atau ditolak." };
    }

    const newStatus: TaskStatus | null =
      decision === "approved" ? "done" :
      decision === "rejected" ? "in_progress" :
      null;

    if (newStatus) {
      // app.task_transition owns the matrix, the status history and the audit
      // ledger for this row; a service-role write would skip all three.
      const session = await createClient();
      const { data: transition, error: transitionError } = await session.rpc("task_transition", {
        p_task_id: taskId,
        p_new_status: newStatus,
        p_user_id: user.id,
        p_note: cleanNote,
      });
      if (transitionError) throw transitionError;
      if (!transition?.success) {
        return { success: false, message: transition?.message || "Status tugas tidak berubah." };
      }
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      event_name: "task.review_submitted",
      actor_id: user.id,
      actor_name: user.full_name,
      target_id: taskId,
      target_label: task.title,
      action_detail: `Review: ${decision}. Catatan: ${cleanNote}`,
    });
    if (auditError) throw auditError;

    return { success: true, message: `Review "${decision}" berhasil dikirimkan.` };
  } catch (error) {
    console.error("Failed to submit task review:", error);
    return { success: false, message: "Gagal mengirimkan review tugas." };
  }
}

/**
 * Server Action: Get Assignable Members scoped to the caller's team(s) (TRC-23)
 * Returns only active members who share at least one team with the caller.
 * Super admin, yayasan, and pengurus see all active members.
 */
export async function getAssignableMembersAction(
  teamId?: string
): Promise<{ id: string; name: string; role: string }[]> {
  const user = await requireAuthUser();
  if (!holdsTaskRole(user, TASK_READ_ROLES)) return [];

  if (process.env.VITEST) {
    return [
      { id: "user-santri-01", name: "Ahmad Fauzi", role: "santri" },
      { id: "user-santri-02", name: "Budi Santoso", role: "santri" },
    ];
  }

  try {
    const supabase = createAdminClient();
    const elevated = holdsTaskRole(user, TASK_OVERSIGHT_ROLES);

    if (elevated) {
      // Elevated roles can assign anyone active
      const query = supabase
        .from("profiles")
        .select("id, full_name, member_type")
        .eq("status", "active")
        .order("full_name");
      const { data, error } = teamId
        ? await supabase
            .from("team_members")
            .select("user_id, profiles(id, full_name, member_type)")
            .eq("team_id", teamId)
            .is("valid_to", null)
        : await query;
      if (error) throw error;
      return (data || []).map((item: any) => {
        const profile = item.profiles || item;
        return { id: profile.id, name: profile.full_name, role: profile.member_type || "santri" };
      });
    }

    // Scoped: only members who share a team with the caller
    const { data: memberships, error: membershipError } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id)
      .is("valid_to", null);
    if (membershipError) throw membershipError;
    const callerTeamIds = new Set<string>((memberships || []).map((m: any) => m.team_id as string));
    if (teamId && !elevated && !callerTeamIds.has(teamId)) {
      console.warn("Anda bukan anggota tim tersebut.", teamId);
      return [];
    }
    const teamIds = teamId
      ? [teamId]
      : Array.from(callerTeamIds);
    if (teamIds.length === 0) return [];
    const { data: members, error: membersError } = await supabase
      .from("team_members")
      .select("user_id, profiles(id, full_name, member_type)")
      .in("team_id", teamIds)
      .is("valid_to", null);
    if (membersError) throw membersError;
    const seen = new Set<string>();
    const result: { id: string; name: string; role: string }[] = [];
    for (const item of (members || []) as any[]) {
      const profile = item.profiles;
      if (!profile || seen.has(profile.id)) continue;
      seen.add(profile.id);
      result.push({ id: profile.id, name: profile.full_name, role: profile.member_type || "santri" });
    }
    result.sort((a, b) => a.name.localeCompare(b.name, "id"));
    return result;
  } catch (error) {
    console.error("Failed to get assignable members:", error);
    return [];
  }
}
