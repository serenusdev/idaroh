"use client";

import * as React from "react";
import { Illustration } from "@/components/ui/illustration";
import {
  ProjectItem,
  TaskItem,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
  TaskTimeFilter,
} from "@/modules/tasks/types";
import {
  createTaskAction,
  updateTaskAction,
  toggleChecklistItemAction,
  updateTaskStatusAction,
  getTasksAction,
  getProjectsAction,
  deleteTaskAction,
  addChecklistItemAction,
  updateChecklistItemAction,
  deleteChecklistItemAction,
  createProjectAction,
  updateProjectAction,
  archiveProjectAction,
} from "@/modules/tasks/actions";
import { TaskDiscussion } from "@/components/tasks/task-discussion";
import { useIdentity } from "@/components/auth/identity-context";
import { useCachedData } from "@/hooks/use-cached-data";
import { writeCache } from "@/lib/data-cache";

type ViewTab = "my_tasks" | "kanban" | "projects";

export default function TugasPage() {
  const { user } = useIdentity();
  const [activeTab, setActiveTab] = React.useState<ViewTab>("my_tasks");
  const [timeFilter, setTimeFilter] = React.useState<TaskTimeFilter>("all");
  const tasksQuery = useCachedData(`tasks:list:${user.id}`, getTasksAction);
  const projectsQuery = useCachedData(`tasks:projects:${user.id}`, getProjectsAction);
  const [tasks, setTasks] = React.useState<TaskItem[]>(tasksQuery.data ?? []);
  const [projects, setProjects] = React.useState<ProjectItem[]>(projectsQuery.data ?? []);

  React.useEffect(() => {
    if (tasksQuery.data) setTasks(tasksQuery.data);
  }, [tasksQuery.data]);
  React.useEffect(() => {
    if (projectsQuery.data) setProjects(projectsQuery.data);
  }, [projectsQuery.data]);
  // Sinkronkan salinan kerja ke cache agar kunjungan ulang langsung menampilkan
  // perubahan terakhir tanpa menunggu revalidasi.
  React.useEffect(() => {
    writeCache(`tasks:list:${user.id}`, tasks);
  }, [tasks, user.id]);
  React.useEffect(() => {
    writeCache(`tasks:projects:${user.id}`, projects);
  }, [projects, user.id]);
  const [toastMessage, setToastMessage] = React.useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // New Task Dialog State
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newProjectId, setNewProjectId] = React.useState(projects[0]?.id || "proj-general");
  const [newPriority, setNewPriority] = React.useState<TaskPriority>("normal");
  const [newDueDate, setNewDueDate] = React.useState("");
  const [newRequiresReview, setNewRequiresReview] = React.useState(false);
  const [newVisibility, setNewVisibility] = React.useState<TaskVisibility>("team");
  const [newDescription, setNewDescription] = React.useState("");
  const [editingTaskId, setEditingTaskId] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = React.useState(false);
  const [editingProjectId, setEditingProjectId] = React.useState<string | null>(null);
  const [isSavingProject, setIsSavingProject] = React.useState(false);
  const [projectForm, setProjectForm] = React.useState({
    name: "",
    description: "",
    teamName: "",
    status: "planned" as ProjectItem["status"],
  });

  // Filter tasks based on timeFilter
  const filteredTasks = React.useMemo(() => {
    return tasks.filter((t) => {
      if (timeFilter === "overdue") return t.isOverdue;
      if (timeFilter === "today") return t.isDueToday;
      if (timeFilter === "this_week") return t.isDueThisWeek;
      if (timeFilter === "later")
        return !t.isOverdue && !t.isDueToday && !t.isDueThisWeek;
      return true;
    });
  }, [tasks, timeFilter]);

  // Group tasks for "my_tasks" list view
  const urgentTasks = filteredTasks.filter((t) => t.isOverdue || t.priority === "urgent");
  const todayTasks = filteredTasks.filter(
    (t) => t.isDueToday && !t.isOverdue && t.priority !== "urgent"
  );
  const weekTasks = filteredTasks.filter(
    (t) => t.isDueThisWeek && !t.isDueToday && !t.isOverdue && t.priority !== "urgent"
  );
  const otherTasks = filteredTasks.filter(
    (t) =>
      !t.isOverdue &&
      !t.isDueToday &&
      !t.isDueThisWeek &&
      t.priority !== "urgent"
  );

  // Handle Mark Done or Status Change
  const handleStatusChange = async (task: TaskItem, targetStatus: TaskStatus) => {
    const res = await updateTaskStatusAction(
      task.id,
      targetStatus,
      task.requiresReview,
      task.status
    );

    if (res.success) {
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: res.newStatus } : t))
      );
      setToastMessage({ type: "success", text: res.message });
    } else {
      setToastMessage({ type: "error", text: res.message });
    }
  };

  // Handle Checklist Item Toggle
  const handleToggleChecklist = async (
    taskId: string,
    checklistId: string,
    currentDone: boolean
  ) => {
    const nextDone = !currentDone;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          return {
            ...t,
            checklist: t.checklist.map((c) =>
              c.id === checklistId ? { ...c, done: nextDone } : c
            ),
          };
        }
        return t;
      })
    );

    const result = await toggleChecklistItemAction(taskId, checklistId, nextDone);
    if (!result.success) {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, checklist: t.checklist.map((c) => c.id === checklistId ? { ...c, done: currentDone } : c) } : t));
      setToastMessage({ type: "error", text: result.message });
    }
  };

  const handleAddChecklist = async (taskId: string, text: string) => {
    const result = await addChecklistItemAction(taskId, text);
    setToastMessage({ type: result.success ? "success" : "error", text: result.message });
    if (result.success && result.data) {
      setTasks((prev) => prev.map((task) => task.id === taskId ? { ...task, checklist: [...task.checklist, { id: result.data!.itemId, text: text.trim(), done: false }] } : task));
    }
    return result.success;
  };

  const handleUpdateChecklist = async (taskId: string, checklistId: string, text: string) => {
    const result = await updateChecklistItemAction(taskId, checklistId, text);
    setToastMessage({ type: result.success ? "success" : "error", text: result.message });
    if (result.success) setTasks((prev) => prev.map((task) => task.id === taskId ? { ...task, checklist: task.checklist.map((item) => item.id === checklistId ? { ...item, text: text.trim() } : item) } : task));
  };

  const handleDeleteChecklist = async (taskId: string, checklistId: string) => {
    const result = await deleteChecklistItemAction(taskId, checklistId);
    setToastMessage({ type: result.success ? "success" : "error", text: result.message });
    if (result.success) setTasks((prev) => prev.map((task) => task.id === taskId ? { ...task, checklist: task.checklist.filter((item) => item.id !== checklistId) } : task));
  };

  // Handle Create Task Submission
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsCreating(true);
    try {
      const proj = projects.find((p) => p.id === newProjectId);
      const taskPayload = {
        title: newTitle,
        projectId: newProjectId,
        projectName: proj?.name || "Tugas Mandiri",
        priority: newPriority,
        requiresReview: newRequiresReview,
        dueDateStr: newDueDate,
        dueDateIso: newDueDate || undefined,
        description: newDescription,
        visibility: newVisibility,
      };
      const res = editingTaskId
        ? await updateTaskAction(editingTaskId, taskPayload)
        : await createTaskAction(taskPayload);

      if (res.success) {
        const nextTask: TaskItem = {
          id: editingTaskId || res.taskId || `tsk-${Date.now()}`,
          projectId: newProjectId,
          projectName: proj?.name || "Tugas Mandiri",
          projectTeam: proj?.teamName || "Santri",
          title: newTitle,
          description: newDescription,
          priority: newPriority,
          status: "todo",
          requiresReview: newRequiresReview,
          visibility: newVisibility,
          dueDateStr: newDueDate,
          isDueToday: Boolean(newDueDate && newDueDate === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())),
          checklist: [],
          assignees: [],
        };

        setTasks((prev) => editingTaskId
          ? prev.map((task) => task.id === editingTaskId ? { ...task, ...nextTask, status: task.status, checklist: task.checklist, assignees: task.assignees } : task)
          : [nextTask, ...prev]);
        setToastMessage({ type: "success", text: res.message });
        setIsDialogOpen(false);
        setNewTitle("");
        setNewDescription("");
        setNewVisibility("team");
        setEditingTaskId(null);
      } else {
        setToastMessage({ type: "error", text: res.message });
      }
    } catch {
      setToastMessage({
        type: "error",
        text: "Terjadi gangguan saat membuat tugas.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteTask = async (task: TaskItem) => {
    if (!window.confirm(`Arsipkan tugas "${task.title}"?`)) return;
    const result = await deleteTaskAction(task.id);
    setToastMessage({ type: result.success ? "success" : "error", text: result.message });
    if (result.success) setTasks((current) => current.filter((item) => item.id !== task.id));
  };

  const handleEditTask = (task: TaskItem) => {
    setEditingTaskId(task.id);
    setNewTitle(task.title);
    setNewProjectId(task.projectId || "proj-general");
    setNewPriority(task.priority);
    setNewDueDate(task.dueDateIso || "");
    setNewRequiresReview(task.requiresReview);
    setNewVisibility(task.visibility || "team");
    setNewDescription(task.description || "");
    setIsDialogOpen(true);
  };

  const openCreateProject = () => {
    setEditingProjectId(null);
    setProjectForm({ name: "", description: "", teamName: "", status: "planned" });
    setIsProjectDialogOpen(true);
  };

  const openEditProject = (project: ProjectItem) => {
    setEditingProjectId(project.id);
    setProjectForm({ name: project.name, description: project.description, teamName: project.teamName, status: project.status });
    setIsProjectDialogOpen(true);
  };

  const handleSaveProject = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSavingProject(true);
    const result = editingProjectId
      ? await updateProjectAction(editingProjectId, projectForm)
      : await createProjectAction(projectForm);
    setToastMessage({ type: result.success ? "success" : "error", text: result.message });
    if (result.success) {
      await projectsQuery.refresh();
      setIsProjectDialogOpen(false);
    }
    setIsSavingProject(false);
  };

  const handleArchiveProject = async (project: ProjectItem) => {
    if (!window.confirm(`Arsipkan proyek "${project.name}"? Task dan riwayatnya tetap dipertahankan.`)) return;
    const result = await archiveProjectAction(project.id);
    setToastMessage({ type: result.success ? "success" : "error", text: result.message });
    if (result.success) setProjects((current) => current.filter((item) => item.id !== project.id));
  };

  const overdueCount = tasks.filter((t) => t.isOverdue).length;
  const todayCount = tasks.filter((t) => t.isDueToday).length;
  const thisWeekCount = tasks.filter((t) => t.isDueThisWeek).length;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-24">
      {/* Toast Alert Notice */}
      {toastMessage && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between gap-3 text-sm font-medium shadow-xs transition-all ${
            toastMessage.type === "success"
              ? "bg-success/15 text-success border border-success/30"
              : toastMessage.type === "error"
              ? "bg-error/15 text-error border border-error/30"
              : "bg-surface-container text-primary border border-border"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">
              {toastMessage.type === "success"
                ? "check_circle"
                : toastMessage.type === "error"
                ? "error"
                : "info"}
            </span>
            <span>{toastMessage.text}</span>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Sub Header & Semester Meta */}
      <div className="flex flex-col space-y-1.5 pt-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h1 className="font-headline-sm text-headline-sm text-on-surface tracking-tight">
            Tugas Saya &amp; Proyek Tim
          </h1>
          <span className="px-3 py-1 rounded-full bg-accent text-accent-foreground font-label-sm text-label-sm shadow-xs self-start sm:self-auto">
            Semester Ganjil 2026/2027
          </span>
        </div>
        <p className="font-body-sm text-body-sm text-muted-foreground">
          Pantau kewajiban tahfidz, amanah divisi santri, dan target sprint mingguan.
        </p>
      </div>

      {/* Segmented Control Tabs */}
      <div className="p-1 rounded-xl bg-surface-container flex items-center shadow-inner max-w-lg">
        <button
          type="button"
          onClick={() => setActiveTab("my_tasks")}
          className={`flex-1 py-2 px-3 rounded-lg font-label-md text-label-md transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "my_tasks"
              ? "bg-card text-primary shadow-xs font-semibold"
              : "text-muted-foreground hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">task_alt</span>
          <span>Tugas Saya ({tasks.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("kanban")}
          className={`flex-1 py-2 px-3 rounded-lg font-label-md text-label-md transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "kanban"
              ? "bg-card text-primary shadow-xs font-semibold"
              : "text-muted-foreground hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">view_kanban</span>
          <span>Papan Tim</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("projects")}
          className={`flex-1 py-2 px-3 rounded-lg font-label-md text-label-md transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "projects"
              ? "bg-card text-primary shadow-xs font-semibold"
              : "text-muted-foreground hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">folder_open</span>
          <span>Daftar Proyek</span>
        </button>
      </div>

      {/* Main Responsive Grid Layout (Desktop 2-Column, Mobile Stack) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Spotlight Project & Project Statistics (Desktop Sticky) */}
        <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
          {/* Active Project Spotlight Card (TSK-007) */}
          <div className="p-4 sm:p-5 rounded-xl bg-card shadow-sm border border-border flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[22px]">
                    terminal
                  </span>
                </span>
                <div className="flex flex-col">
                  <span className="font-label-sm text-label-sm text-muted-foreground leading-tight">
                    Proyek Prioritas
                  </span>
                  <span className="font-headline-sm text-[16px] text-on-surface font-semibold leading-tight">
                    {projects[0]?.name || "Belum Ada Proyek"}
                  </span>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-md bg-secondary-container text-on-secondary-container font-label-sm text-xs">
                {projects[0]?.teamName || "Sentra Santri"}
              </span>
            </div>

            {/* Progress Ring & Metrics Row */}
            <div className="p-3.5 rounded-lg bg-surface flex items-center justify-between gap-3 border border-border/50">
              <div className="flex items-center gap-3">
                {/* Compact Progress SVG */}
                <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                  <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-surface-dim"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.5"
                    />
                    <path
                      className="text-primary-container"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeDasharray={`${projects[0]?.progressPercent || 0}, 100`}
                      strokeLinecap="round"
                      strokeWidth="3.5"
                    />
                  </svg>
                  <span className="absolute font-code-md text-xs font-bold text-primary">
                    {projects[0]?.progressPercent || 0}%
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="font-label-md text-label-md text-on-surface">
                    {projects[0]
                      ? `${projects[0].completedTasks} dari ${projects[0].totalTasks} Selesai`
                      : "0 dari 0 Selesai"}
                  </span>
                  <span className="font-body-sm text-xs text-muted-foreground flex items-center gap-1 font-medium">
                    <span className="material-symbols-outlined text-[14px]">flag</span>
                    {projects[0]?.blockedTasks || 0} tugas terhambat
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab("projects")}
                className="h-9 px-3 rounded-lg bg-surface-container text-primary font-label-sm text-xs flex items-center gap-1 hover:bg-accent transition-all"
              >
                <span>Detail</span>
                <span className="material-symbols-outlined text-[16px]">
                  chevron_right
                </span>
              </button>
            </div>

            {/* Quick KPI Project Counter */}
            <div className="grid grid-cols-2 gap-2 pt-1 text-center">
              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-border/40">
                <span className="text-xs text-muted-foreground block">
                  Total Proyek Aktif
                </span>
                <span className="font-headline-sm text-primary font-bold text-lg">
                  {projects.length}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-border/40">
                <span className="text-xs text-muted-foreground block">
                  Tugas Terselesaikan
                </span>
                <span className="font-headline-sm text-success font-bold text-lg">
                  {tasks.filter((t) => t.status === "done").length}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Visual Delight: Quote / Motivasi Santri */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-accent/40 via-surface-container to-accent/20 flex items-center gap-3 border border-border/40">
            <span className="material-symbols-outlined text-primary text-[24px] shrink-0">
              verified
            </span>
            <p className="font-body-sm text-xs sm:text-sm text-on-surface-variant italic leading-relaxed">
              &quot;Selesaikan amanah harian dengan tuntas sebelum azan berkumandang.&quot;
            </p>
          </div>

          {/* Button Tambah Tugas (Desktop) */}
          <button
            type="button"
            onClick={() => { setEditingTaskId(null); setIsDialogOpen(true); }}
            className="w-full h-12 rounded-xl bg-primary text-on-primary font-label-md flex items-center justify-center gap-2 shadow-sm hover:bg-primary-container transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">add_task</span>
            <span className="font-semibold">+ Tambah Tugas Baru</span>
          </button>
        </div>

        {/* Right Column: Dynamic Tab Content (col-span-8) */}
        <div className="lg:col-span-8 space-y-4">
          {activeTab === "my_tasks" && (
            <div className="space-y-4">
              {/* Horizontal Filter Chips */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 no-scrollbar -mx-2 px-2">
                <button
                  type="button"
                  onClick={() => setTimeFilter("all")}
                  className={`px-3.5 py-1.5 rounded-full font-label-sm text-label-sm shrink-0 flex items-center gap-1.5 transition-all ${
                    timeFilter === "all"
                      ? "bg-primary text-on-primary shadow-xs"
                      : "bg-surface-container text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[15px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    done
                  </span>
                  <span>Semua</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTimeFilter("overdue")}
                  className={`px-3.5 py-1.5 rounded-full font-label-sm text-label-sm shrink-0 flex items-center gap-1.5 transition-all ${
                    timeFilter === "overdue"
                      ? "bg-error text-on-error shadow-xs"
                      : "bg-error-container text-on-error-container"
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">error</span>
                  <span>Terlambat ({overdueCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTimeFilter("today")}
                  className={`px-3.5 py-1.5 rounded-full font-label-sm text-label-sm shrink-0 flex items-center gap-1.5 transition-all ${
                    timeFilter === "today"
                      ? "bg-primary text-on-primary shadow-xs"
                      : "bg-surface-container text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">today</span>
                  <span>Hari Ini ({todayCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTimeFilter("this_week")}
                  className={`px-3.5 py-1.5 rounded-full font-label-sm text-label-sm shrink-0 flex items-center gap-1.5 transition-all ${
                    timeFilter === "this_week"
                      ? "bg-primary text-on-primary shadow-xs"
                      : "bg-surface-container text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">date_range</span>
                  <span>Minggu Ini ({thisWeekCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTimeFilter("later")}
                  className={`px-3.5 py-1.5 rounded-full font-label-sm text-label-sm shrink-0 flex items-center gap-1.5 transition-all ${
                    timeFilter === "later"
                      ? "bg-primary text-on-primary shadow-xs"
                      : "bg-surface-container text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">schedule</span>
                  <span>Nanti</span>
                </button>
              </div>

              {/* Task Groups Section (TSK-009) */}
              <div className="space-y-4">
                {filteredTasks.length === 0 ? (
                  <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
                    <Illustration
                      src="/illustrations/undraw_done_erdp.svg"
                      alt="Belum ada tugas"
                      width={140}
                      height={95}
                    />
                    <div>
                      <p className="font-headline-sm text-base font-semibold text-on-surface">
                        Belum Ada Tugas Tercatat
                      </p>
                      <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                        Amanah tugas santri atau divisi akan tampil di sini. Tekan tombol &quot;+ Tambah Tugas Baru&quot; untuk memulai.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                {/* GROUP 1: Mendesak / Terlambat */}
                {urgentTasks.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5 text-error">
                        <span className="material-symbols-outlined text-[18px]">
                          warning
                        </span>
                        <h2 className="font-label-md text-label-md tracking-tight uppercase font-bold text-xs">
                          Mendesak / Terlambat
                        </h2>
                      </div>
                      <span className="font-code-md text-xs text-error px-2 py-0.5 rounded bg-error-container font-semibold">
                        {urgentTasks.length} Perlu Aksi Segera
                      </span>
                    </div>

                    {urgentTasks.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onStatusChange={handleStatusChange}
                        onToggleChecklist={handleToggleChecklist}
                        onDelete={handleDeleteTask}
                        onEdit={handleEditTask}
                        onAddChecklist={handleAddChecklist}
                        onUpdateChecklist={handleUpdateChecklist}
                        onDeleteChecklist={handleDeleteChecklist}
                      />
                    ))}
                  </div>
                )}

                {/* GROUP 2: Tenggat Hari Ini */}
                {todayTasks.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5 text-on-surface">
                        <span className="material-symbols-outlined text-[18px] text-primary">
                          alarm
                        </span>
                        <h2 className="font-label-md text-label-md tracking-tight uppercase font-bold text-xs">
                          Tenggat Hari Ini
                        </h2>
                      </div>
                      <span className="font-code-md text-xs text-muted-foreground px-2 py-0.5 rounded bg-surface-container">
                        {todayTasks.length} Tugas
                      </span>
                    </div>

                    {todayTasks.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onStatusChange={handleStatusChange}
                        onToggleChecklist={handleToggleChecklist}
                        onDelete={handleDeleteTask}
                        onEdit={handleEditTask}
                        onAddChecklist={handleAddChecklist}
                        onUpdateChecklist={handleUpdateChecklist}
                        onDeleteChecklist={handleDeleteChecklist}
                      />
                    ))}
                  </div>
                )}

                {/* GROUP 3: Minggu Ini */}
                {weekTasks.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5 text-on-surface">
                        <span className="material-symbols-outlined text-[18px] text-secondary">
                          date_range
                        </span>
                        <h2 className="font-label-md text-label-md tracking-tight uppercase font-bold text-xs">
                          Minggu Ini
                        </h2>
                      </div>
                      <span className="font-code-md text-xs text-muted-foreground px-2 py-0.5 rounded bg-surface-container">
                        {weekTasks.length} Tugas
                      </span>
                    </div>

                    {weekTasks.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onStatusChange={handleStatusChange}
                        onToggleChecklist={handleToggleChecklist}
                        onDelete={handleDeleteTask}
                        onEdit={handleEditTask}
                        onAddChecklist={handleAddChecklist}
                        onUpdateChecklist={handleUpdateChecklist}
                        onDeleteChecklist={handleDeleteChecklist}
                      />
                    ))}
                  </div>
                )}

                {/* GROUP 4: Nanti / Lainnya */}
                {otherTasks.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5 text-on-surface">
                        <span className="material-symbols-outlined text-[18px] text-muted-foreground">
                          schedule
                        </span>
                        <h2 className="font-label-md text-label-md tracking-tight uppercase font-bold text-xs">
                          Tugas Terjadwal
                        </h2>
                      </div>
                      <span className="font-code-md text-xs text-muted-foreground px-2 py-0.5 rounded bg-surface-container">
                        {otherTasks.length} Tugas
                      </span>
                    </div>

                    {otherTasks.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onStatusChange={handleStatusChange}
                        onToggleChecklist={handleToggleChecklist}
                        onDelete={handleDeleteTask}
                        onEdit={handleEditTask}
                        onAddChecklist={handleAddChecklist}
                        onUpdateChecklist={handleUpdateChecklist}
                        onDeleteChecklist={handleDeleteChecklist}
                      />
                    ))}
                  </div>
                )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Papan Tim (Kanban Board) */}
          {activeTab === "kanban" && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
              {(["todo", "in_progress", "in_review", "done"] as TaskStatus[]).map((colStatus) => {
                const colTasks = tasks.filter((t) => t.status === colStatus);
                const colLabels: Record<TaskStatus, { title: string; icon: string; color: string }> = {
                  todo: { title: "To Do", icon: "pending_actions", color: "text-muted-foreground" },
                  in_progress: { title: "In Progress", icon: "sync", color: "text-primary" },
                  in_review: { title: "In Review", icon: "rate_review", color: "text-tertiary" },
                  done: { title: "Done", icon: "task_alt", color: "text-success" },
                  cancelled: { title: "Cancelled", icon: "cancel", color: "text-error" },
                };

                const meta = colLabels[colStatus];

                return (
                  <div
                    key={colStatus}
                    className="p-3 bg-surface-container-low rounded-xl border border-border/60 flex flex-col space-y-3 min-h-[300px]"
                  >
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`material-symbols-outlined text-[18px] ${meta.color}`}>
                          {meta.icon}
                        </span>
                        <span className="font-label-md text-xs font-bold text-on-surface uppercase">
                          {meta.title}
                        </span>
                      </div>
                      <span className="w-5 h-5 rounded-full bg-card text-on-surface text-[11px] font-bold flex items-center justify-center border border-border">
                        {colTasks.length}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {colTasks.map((t) => (
                        <div
                          key={t.id}
                          className="p-3 bg-card rounded-lg shadow-2xs border border-border space-y-2 text-xs"
                        >
                          <span className="text-[10px] text-primary font-medium block">
                            {t.projectName}
                          </span>
                          <h4 className="font-label-md text-on-surface font-semibold text-xs leading-snug">
                            {t.title}
                          </h4>
                          <div className="flex items-center justify-between text-muted-foreground text-[11px] pt-1 border-t border-border/40">
                            <span>{t.dueDateStr}</span>
                            <span className="capitalize">{t.priority}</span>
                          </div>
                        </div>
                      ))}
                      {colTasks.length === 0 && (
                        <p className="text-center text-xs text-muted-foreground py-8">
                          Tidak ada tugas
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: Daftar Proyek */}
          {activeTab === "projects" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-on-surface">Siklus hidup proyek</p>
                <button type="button" onClick={openCreateProject} className="h-9 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container">
                  <span className="material-symbols-outlined text-[15px] align-middle mr-1">create_new_folder</span>
                  Proyek Baru
                </button>
              </div>
              {projects.length === 0 ? (
                <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
                  <Illustration
                    src="/illustrations/undraw_in-progress_2mox.svg"
                    alt="Belum ada proyek"
                    width={140}
                    height={95}
                  />
                  <div>
                    <p className="font-headline-sm text-base font-semibold text-on-surface">
                      Belum Ada Proyek Dibuat
                    </p>
                    <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                      Inisiatif dan proyek santri akan tampil di sini setelah ditambahkan oleh pembina atau koordinator.
                    </p>
                  </div>
                </div>
              ) : (
                projects.map((proj) => (
                  <div
                    key={proj.id}
                    className="p-4 sm:p-5 bg-card rounded-xl border border-border shadow-xs space-y-3"
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[22px]">
                          {proj.icon}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-headline-sm text-sm sm:text-base font-semibold text-on-surface">
                          {proj.name}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {proj.teamName} • Status: {proj.status}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-semibold">
                        {proj.progressPercent}% Selesai
                      </span>
                      {proj.canManage && <button type="button" onClick={() => openEditProject(proj)} className="h-8 px-2 rounded-lg border border-border text-[11px] font-semibold text-primary hover:bg-accent">Edit</button>}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {proj.description}
                  </p>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${proj.progressPercent}%` }}
                      ></div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{proj.completedTasks} dari {proj.totalTasks} tugas selesai</span>
                      <span>{proj.blockedTasks} tugas terhambat</span>
                    </div>
                  </div>
                  {proj.canManage && <button type="button" onClick={() => handleArchiveProject(proj)} className="text-left text-[11px] font-semibold text-destructive hover:underline">Arsipkan proyek</button>}
                </div>
              )))}
            </div>
          )}
        </div>
      </div>

      {/* Floating / Pinned Bottom Primary Action (Mobile only) */}
      <div className="pt-2 sticky bottom-2 lg:hidden">
        <button
          type="button"
          onClick={() => { setEditingTaskId(null); setIsDialogOpen(true); }}
          className="w-full h-12 rounded-xl bg-secondary-container hover:bg-accent text-on-secondary-fixed font-label-md text-label-md flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-[20px] text-primary">
            add_task
          </span>
          <span className="font-semibold text-primary">+ Tambah Tugas Baru</span>
        </button>
      </div>

      {/* Modal Dialog: Tambah Tugas Baru */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-card rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">
                  add_task
                </span>
                <h3 className="font-headline-sm text-base text-on-surface font-semibold">
                  {editingTaskId ? "Edit Tugas" : "Buat Tugas Baru"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDialogOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">
                  Judul Tugas <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Contoh: Implementasi endpoint API presensi"
                  className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface block">
                    Pilih Proyek
                  </label>
                  <select
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full h-10 px-2.5 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {projects.length === 0 ? (
                      <option value="proj-general">Operasional Santri</option>
                    ) : (
                      projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface block">
                    Prioritas
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full h-10 px-2.5 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="low">Rendah (Low)</option>
                    <option value="normal">Normal</option>
                    <option value="high">Tinggi (High)</option>
                    <option value="urgent">Mendesak (Urgent)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">
                  Tenggat Waktu
                </label>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">
                  Deskripsi Singkat (Opsional)
                </label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                  placeholder="Uraikan detail atau instruksi tugas..."
                  className="w-full p-2.5 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">
                  Cakupan Tugas
                </label>
                <select
                  value={newVisibility}
                  onChange={(e) => setNewVisibility(e.target.value as TaskVisibility)}
                  className="w-full h-10 px-2.5 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="private">Pribadi — hanya saya dan penanggung jawab</option>
                  <option value="team">Tim — anggota tim terkait</option>
                  <option value="organization">Organisasi — seluruh anggota aktif</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="req-review-cb"
                  checked={newRequiresReview}
                  onChange={(e) => setNewRequiresReview(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary"
                />
                <label
                  htmlFor="req-review-cb"
                  className="text-xs text-on-surface cursor-pointer select-none"
                >
                  Wajib Review oleh Ustadz/Pembina sebelum status Done (BR-TSK-06)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(false)}
                  className="h-10 px-4 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-muted"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="h-10 px-5 rounded-xl bg-primary text-on-primary text-xs font-semibold shadow-xs hover:bg-primary-container disabled:opacity-50"
                >
                  {isCreating ? "Menyimpan..." : editingTaskId ? "Simpan Perubahan" : "Buat Tugas"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isProjectDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-card rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-xl border border-border space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">create_new_folder</span>
                <h3 className="font-headline-sm text-base text-on-surface font-semibold">{editingProjectId ? "Edit Proyek" : "Buat Proyek Baru"}</h3>
              </div>
              <button type="button" onClick={() => setIsProjectDialogOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-on-surface">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <form onSubmit={handleSaveProject} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">Nama Proyek <span className="text-error">*</span></label>
                <input required maxLength={120} value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">Tim / Sentra</label>
                <input value={projectForm.teamName} onChange={(event) => setProjectForm({ ...projectForm, teamName: event.target.value })} placeholder="Contoh: Sentra Digital" className="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">Deskripsi</label>
                <textarea rows={3} value={projectForm.description} onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })} className="w-full p-2.5 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface block">Status</label>
                <select value={projectForm.status} onChange={(event) => setProjectForm({ ...projectForm, status: event.target.value as ProjectItem["status"] })} className="w-full h-10 px-2.5 rounded-lg bg-surface-container-low border border-border text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="planned">Direncanakan</option>
                  <option value="active">Aktif</option>
                  <option value="on_hold">Ditahan</option>
                  <option value="completed">Selesai</option>
                </select>
              </div>
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button type="button" onClick={() => setIsProjectDialogOpen(false)} className="h-10 px-4 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-muted">Batal</button>
                <button type="submit" disabled={isSavingProject} className="h-10 px-5 rounded-xl bg-primary text-on-primary text-xs font-semibold shadow-xs hover:bg-primary-container disabled:opacity-50">{isSavingProject ? "Menyimpan..." : editingProjectId ? "Simpan Perubahan" : "Buat Proyek"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * TaskCard Component
 */
function TaskCard({
  task,
  onStatusChange,
  onToggleChecklist,
  onDelete,
  onEdit,
  onAddChecklist,
  onUpdateChecklist,
  onDeleteChecklist,
}: {
  task: TaskItem;
  onStatusChange: (task: TaskItem, status: TaskStatus) => void;
  onToggleChecklist: (taskId: string, checklistId: string, currentDone: boolean) => void;
  onDelete: (task: TaskItem) => void;
  onEdit: (task: TaskItem) => void;
  onAddChecklist: (taskId: string, text: string) => Promise<boolean>;
  onUpdateChecklist: (taskId: string, checklistId: string, text: string) => Promise<void>;
  onDeleteChecklist: (taskId: string, checklistId: string) => Promise<void>;
}) {
  const [showDiscussion, setShowDiscussion] = React.useState(false);
  const [newChecklistText, setNewChecklistText] = React.useState("");
  const isDone = task.status === "done";
  const isInReview = task.status === "in_review";
  const completedChecklist = task.checklist.filter((c) => c.done).length;

  return (
    <div className="p-4 rounded-xl bg-card shadow-sm border border-border flex flex-col space-y-3 transition-all hover:border-primary/40">
      {/* Top Meta */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col space-y-1">
          <span className="font-label-sm text-xs text-primary flex items-center gap-1 font-medium">
            <span className="material-symbols-outlined text-[14px]">layers</span>
            {task.projectName}
          </span>
          <h3 className="font-headline-sm text-sm sm:text-base text-on-surface font-semibold leading-snug">
            {task.title}
          </h3>
        </div>

        <span
          className={`px-2 py-0.5 rounded-full font-label-sm text-xs shrink-0 flex items-center gap-1 ${
            task.priority === "urgent"
              ? "bg-error-container text-on-error-container"
              : task.priority === "high"
              ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
              : "bg-secondary-container text-on-secondary-container"
          }`}
        >
          {task.priority === "urgent" && (
            <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping"></span>
          )}
          <span className="capitalize">{task.priority}</span>
        </span>
      </div>

      {/* Date & Checklist Indicator */}
      <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-surface border border-border/40 text-xs">
        <div
          className={`flex items-center gap-1.5 ${
            task.isOverdue ? "text-error font-medium" : "text-on-surface-variant"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">
            {task.isOverdue ? "event_busy" : "schedule"}
          </span>
          <span className="font-code-md">{task.dueDateStr}</span>
        </div>

        {task.checklist.length > 0 ? (
          <div className="flex items-center justify-end gap-1.5 text-on-surface-variant">
            <span className="material-symbols-outlined text-[16px]">check_box</span>
            <span className="font-label-sm">
              Checklist {completedChecklist}/{task.checklist.length}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-end text-muted-foreground">
            {task.locationNote || "Tugas Mandiri"}
          </div>
        )}
      </div>

      {/* Checklist items interactive toggle */}
      {task.checklist.length > 0 && (
        <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-border/40 space-y-1.5">
          {task.checklist.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-2 cursor-pointer text-xs text-on-surface hover:text-primary transition-colors"
            >
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => onToggleChecklist(task.id, item.id, item.done)}
                className="w-3.5 h-3.5 rounded text-primary focus:ring-primary"
              />
              <span className={item.done ? "line-through text-muted-foreground" : ""}>
                {item.text}
              </span>
              <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); const next = window.prompt("Ubah checklist", item.text); if (next?.trim()) void onUpdateChecklist(task.id, item.id, next); }} className="ml-auto text-[10px] text-primary hover:underline">Edit</button>
              <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (window.confirm("Hapus checklist ini?")) void onDeleteChecklist(task.id, item.id); }} className="text-[10px] text-destructive hover:underline">Hapus</button>
            </label>
          ))}
          <form onSubmit={async (event) => { event.preventDefault(); if (!newChecklistText.trim()) return; const added = await onAddChecklist(task.id, newChecklistText); if (added) setNewChecklistText(""); }} className="flex gap-1.5 pt-1">
            <input value={newChecklistText} onChange={(event) => setNewChecklistText(event.target.value)} placeholder="Tambah item checklist" className="min-w-0 flex-1 h-7 rounded-md border border-border bg-card px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary" />
            <button type="submit" className="h-7 px-2 rounded-md bg-primary text-on-primary text-[11px] font-semibold">Tambah</button>
          </form>
        </div>
      )}

      {task.checklist.length === 0 && <form onSubmit={async (event) => { event.preventDefault(); if (!newChecklistText.trim()) return; const added = await onAddChecklist(task.id, newChecklistText); if (added) setNewChecklistText(""); }} className="flex gap-1.5"><input value={newChecklistText} onChange={(event) => setNewChecklistText(event.target.value)} placeholder="Tambah item checklist" className="min-w-0 flex-1 h-8 rounded-md border border-border bg-surface-container-low px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary" /><button type="submit" className="h-8 px-2 rounded-md border border-primary text-primary text-[11px] font-semibold">Tambah</button></form>}

      {/* Reviewer Note Warning (if In Review) */}
      {isInReview && (
        <div className="px-2.5 py-1.5 rounded-lg bg-warning/15 text-tertiary font-label-sm text-xs flex items-center gap-1.5 w-full">
          <span className="material-symbols-outlined text-[16px] text-tertiary">
            hourglass_top
          </span>
          <span className="truncate">
            Menunggu Review Pereview ({task.reviewerName || "Ustadz Pembina"})
          </span>
        </div>
      )}

      {/* Assignee & Action Buttons */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          {task.assignees.map((asg) => (
            <div key={asg.userId} className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-label-sm text-xs font-semibold">
                {asg.avatar || asg.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="font-label-sm text-xs text-on-surface leading-none">
                  {asg.name}
                </span>
                <span className="font-code-md text-muted-foreground text-[10px] leading-tight">
                  {asg.role}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {task.requiresReview && !isInReview && !isDone && (
          <button
            type="button"
            onClick={() => onStatusChange(task, "in_review")}
            className="h-10 rounded-lg bg-secondary-container hover:bg-secondary-container/80 text-on-secondary-container font-label-md text-xs flex items-center justify-center gap-1 transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">
              rate_review
            </span>
            <span>Ajukan Review</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onStatusChange(task, isDone ? "todo" : "done")}
          className={`h-10 rounded-lg font-label-md text-xs flex items-center justify-center gap-1 transition-all shadow-xs ${
            task.requiresReview && !isInReview && !isDone
              ? "col-span-1"
              : "col-span-2"
          } ${
            isDone
              ? "bg-success text-on-primary"
              : "bg-primary text-on-primary hover:bg-primary-container"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">
            {isDone ? "done_all" : "task_alt"}
          </span>
          <span>{isDone ? "Selesai (Dibuka Kembali?)" : "Tandai Selesai"}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onEdit(task)} className="h-8 rounded-lg border border-border text-[11px] font-semibold text-primary hover:bg-accent">
          Edit tugas
        </button>
        <button type="button" onClick={() => onDelete(task)} className="h-8 rounded-lg border border-border text-[11px] font-semibold text-muted-foreground hover:text-error hover:border-error/40">
          Arsipkan tugas
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowDiscussion((open) => !open)}
        className="h-9 rounded-lg border border-border text-xs font-semibold text-on-surface-variant hover:bg-surface-container flex items-center justify-center gap-1.5"
      >
        <span className="material-symbols-outlined text-[16px]">forum</span>
        {showDiscussion ? "Tutup diskusi" : "Komentar & lampiran"}
      </button>
      {showDiscussion && <TaskDiscussion taskId={task.id} />}
    </div>
  );
}
