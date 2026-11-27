"use client";

import * as React from "react";
import Link from "next/link";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { Illustration } from "@/components/ui/illustration";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useIdentity } from "@/components/auth/identity-context";
import { EXPORT_ROLES, holdsRole } from "@/lib/export-policy";
import { IAM_MUTATION_ROLES, IAM_READ_ROLES } from "@/lib/iam-policy";
import {
  getAccountRequestsAction,
  getActiveUsersAction,
  approveAccountApplicationAction,
  rejectAccountApplicationAction,
  createManualAccountAction,
  resetUserSessionAction,
  revokeDeviceTokenAction,
  adminUpdateUserAction,
  type AccountRequestItem,
  type ActiveUserItem,
} from "@/modules/iam/actions";
import { importMembersCsvAction } from "@/modules/operations/actions";
import { MEMBER_CATEGORIES } from "@/modules/iam/registration";
import type { ManualAccountPayload } from "@/modules/iam/types";
import type { UserRole } from "@/lib/auth/types";
import { getTeamsAction } from "@/modules/people/actions";
import type { TeamStructureItem } from "@/modules/people/types";
import { exportAuditedDataAction } from "@/modules/analytics/actions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cacheKeys, invalidateIamQueue } from "@/lib/cache-keys";

const MFA_EVIDENCE_LABEL: Record<ActiveUserItem["mfaEvidence"], string> = {
  none: "MFA: belum enroll",
  unverified: "MFA: belum diverifikasi",
  verified: "MFA: verified",
  unknown: "MFA: tidak diketahui",
};
const MFA_EVIDENCE_CLASS: Record<ActiveUserItem["mfaEvidence"], string> = {
  none: "bg-surface-container text-on-surface-variant",
  unverified: "bg-warning/15 text-tertiary",
  verified: "bg-success/15 text-success",
  unknown: "bg-surface-container text-muted-foreground",
};

export default function AdminUsersPage() {
  const { user: currentUser } = useIdentity();
  // §3.1: the queue and every account mutation are super_admin only. yayasan and pengurus keep
  // the read-only member console, so the controls below are hidden rather than left to fail.
  const canDecideIam = holdsRole(currentUser, IAM_MUTATION_ROLES);
  const [activeTab, setActiveTab] = React.useState<"queue" | "active" | "archived">(
    canDecideIam ? "queue" : "active"
  );
  const [selectedRoleFilter, setSelectedRoleFilter] = React.useState("Semua");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isManualModalOpen, setIsManualModalOpen] = React.useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = React.useState(false);
  const [rejectionTargetId, setRejectionTargetId] = React.useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [rejectError, setRejectError] = React.useState<string | null>(null);
  const [isRejecting, setIsRejecting] = React.useState(false);

  // Admin edit user modal state
  const [editUserTarget, setEditUserTarget] = React.useState<ActiveUserItem | null>(null);
  const [editUserForm, setEditUserForm] = React.useState({
    fullName: "",
    phoneNumber: "",
    status: "active",
    teamName: "",
    // Two independent fields: the granted role (user_roles) and the descriptive category
    // (profiles.member_type). §2 rule 1 forbids one overwriting the other.
    roleKey: "",
    memberType: "",
  });
  const [editUserMsg, setEditUserMsg] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isEditingUser, setIsEditingUser] = React.useState(false);
  // Confirm dialog for destructive actions (UX-04)
  const [adminConfirmDialog, setAdminConfirmDialog] = React.useState<{
    isOpen: boolean; title: string; description?: string; onConfirm: () => void;
  }>({ isOpen: false, title: "", onConfirm: () => {} });
  const [adminToast, setAdminToast] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  // Dynamic Data — CACHE-01 Batch 3. `admin:active-users` and `teams:structure` were global Map
  // entries, so this console (the most privileged read surface in the app) could be served rows that
  // another account had fetched minutes earlier in the same browser. The list now also reads straight
  // from the cache instead of a useState mirror: the mirror is what let a local patch leak into the
  // next account's view.
  const queryClient = useQueryClient();
  const requestsQuery = useQuery({
    queryKey: cacheKeys.accountRequests(currentUser),
    queryFn: getAccountRequestsAction,
    enabled: canDecideIam,
  });
  const usersQuery = useQuery({ queryKey: cacheKeys.activeUsers(currentUser), queryFn: getActiveUsersAction });
  const teamsQuery = useQuery({ queryKey: cacheKeys.teams(currentUser), queryFn: getTeamsAction });
  const accountRequests: AccountRequestItem[] = requestsQuery.data ?? [];
  const activeUsers: ActiveUserItem[] = usersQuery.data ?? [];
  const teams: TeamStructureItem[] = teamsQuery.data ?? [];
  const isLoading = requestsQuery.isLoading || usersQuery.isLoading;

  // Approval state tracker for interactive tactile feedback
  const [approvedCards, setApprovedCards] = React.useState<Record<string, string>>({});
  const [rejectedCards, setRejectedCards] = React.useState<Record<string, string>>({});
  const [resetSessions, setResetSessions] = React.useState<Record<string, boolean>>({});
  const [revokedDevices, setRevokedDevices] = React.useState<Record<string, boolean>>({});
  const [processingCards, setProcessingCards] = React.useState<Record<string, boolean>>({});

  // Manual Account Creation Form State
  const [manualForm, setManualForm] = React.useState<ManualAccountPayload>({
    fullName: "",
    email: "",
    phone: "",
    role: "santri",
    memberType: "santri",
    teamName: "Sentra Digitalpreneur",
    notes: "",
  });
  const [manualSuccessMsg, setManualSuccessMsg] = React.useState("");
  const [isImportModalOpen, setIsImportModalOpen] = React.useState(false);
  const [importFileName, setImportFileName] = React.useState("members.csv");
  const [importCsv, setImportCsv] = React.useState("");
  const [importFeedback, setImportFeedback] = React.useState<string | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [isExportingUsers, setIsExportingUsers] = React.useState(false);
  const [exportFeedback, setExportFeedback] = React.useState<string | null>(null);

  // Role and team picked per applicant, plus the reason an approval failed
  const [applicantRoles, setApplicantRoles] = React.useState<Record<string, string>>({});
  const [applicantTeams, setApplicantTeams] = React.useState<Record<string, string>>({});
  const [approveErrors, setApproveErrors] = React.useState<Record<string, string>>({});

  // The three reads moved together before (one prefix reset per key), so one helper does it now.
  const reload = () => {
    void invalidateIamQueue(queryClient, currentUser);
  };

  const exportUsers = async () => {
    setIsExportingUsers(true);
    setExportFeedback(null);
    try {
      const result = await exportAuditedDataAction("csv", "users", currentUser?.full_name);
      if (result.success && result.downloadUrl) {
        window.location.assign(result.downloadUrl);
      } else {
        setExportFeedback(result.message || "Ekspor rekap akun gagal.");
      }
    } catch {
      setExportFeedback("Ekspor rekap akun gagal. Silakan coba lagi.");
    } finally {
      setIsExportingUsers(false);
    }
  };

  if (!holdsRole(currentUser, IAM_READ_ROLES)) {
    return <UnauthorizedState requiredRole="Super Admin / Pengurus / Yayasan" />;
  }

  // §3.8 analytics.export excludes super_admin; the account recap download
  // follows the same set that the action and route enforce.
  const heldRoles = new Set<string>([currentUser.role, ...(currentUser.roles || [])]);
  const canExportAccounts = EXPORT_ROLES.some((role) => heldRoles.has(role));

  // Whoever reaches the queue is super_admin (§3.1), so the whole assignable set is on offer.
  // super_admin is absent because the RPC refuses to mint it from a user screen.
  const roleOptions: Array<{ value: UserRole; label: string }> = [
    { value: "santri", label: "Santri" },
    { value: "koordinator", label: "Koordinator" },
    { value: "pengurus", label: "Pengurus" },
    { value: "yayasan", label: "Yayasan" },
  ];

  // Default to the team the applicant asked for, else the first team, so an
  // approved member always lands in a real team.
  const defaultTeamId = (applicant: AccountRequestItem) => {
    const requested = applicant.teamRequested.trim().toLowerCase();
    return teams.find((team) => team.name.trim().toLowerCase() === requested)?.id ?? teams[0]?.id ?? "";
  };

  const handleApprove = async (applicant: AccountRequestItem) => {
    const cardId = applicant.id;
    if (processingCards[cardId]) return; // guard double-click
    setProcessingCards((prev) => ({ ...prev, [cardId]: true }));
    setApproveErrors((prev) => {
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
    const role = applicantRoles[cardId] || "santri";
    const teamId = applicantTeams[cardId] ?? defaultTeamId(applicant);
    const roleLabel = roleOptions.find((option) => option.value === role)?.label || role;
    const teamName = teams.find((team) => team.id === teamId)?.name;
    try {
      const res = await approveAccountApplicationAction(cardId, role, teamId || null);
      if (res.success) {
        setApprovedCards((prev) => ({ ...prev, [cardId]: teamName ? `${roleLabel} • ${teamName}` : roleLabel }));
        reload();
      } else {
        setApproveErrors((prev) => ({ ...prev, [cardId]: res.message }));
      }
    } catch (err) {
      console.error("Failed to approve account:", err);
      setApproveErrors((prev) => ({ ...prev, [cardId]: "Gagal menyetujui akun. Silakan coba lagi." }));
    } finally {
      setProcessingCards((prev) => ({ ...prev, [cardId]: false }));
    }
  };

  const openRejectDialog = (cardId: string) => {
    setRejectionTargetId(cardId);
    setRejectionReason("");
    setRejectError(null);
    setIsRejectModalOpen(true);
  };

  const handleConfirmReject = async () => {
    if (!rejectionTargetId || isRejecting) return;
    const reason = rejectionReason.trim();
    if (!reason) {
      setRejectError("Alasan penolakan wajib diisi sebelum menolak permohonan.");
      return;
    }
    setIsRejecting(true);
    setRejectError(null);
    try {
      const res = await rejectAccountApplicationAction(rejectionTargetId, reason);
      if (res.success) {
        setRejectedCards((prev) => ({ ...prev, [rejectionTargetId]: reason }));
        reload();
        setIsRejectModalOpen(false);
      } else {
        setRejectError(res.message || "Gagal menolak permohonan. Silakan coba lagi.");
      }
    } catch {
      setRejectError("Terjadi kesalahan saat menolak permohonan. Silakan coba lagi.");
    } finally {
      setIsRejecting(false);
    }
  };

  const handleResetSession = (userId: string) => {
    setAdminConfirmDialog({
      isOpen: true,
      title: "Cabut semua sesi & perangkat pengguna ini?",
      description: "Pengguna akan keluar dari semua perangkat dan harus masuk kembali. Tindakan ini tidak dapat dibatalkan.",
      onConfirm: async () => {
        setAdminConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        const res = await resetUserSessionAction(userId);
        if (res.success) {
          setResetSessions((prev) => ({ ...prev, [userId]: true }));
        } else {
          setAdminToast({ type: "error", text: res.message });
        }
      },
    });
  };

  const handleRevokeDevice = (userId: string, deviceId: string) => {
    setAdminConfirmDialog({
      isOpen: true,
      title: "Cabut akses push dari perangkat ini?",
      description: "Perangkat tidak akan lagi menerima notifikasi push. Tindakan ini tidak dapat dibatalkan.",
      onConfirm: async () => {
        setAdminConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        const res = await revokeDeviceTokenAction(deviceId);
        if (res.success) {
          setRevokedDevices((prev) => ({ ...prev, [deviceId]: true }));
          // The list is cache state now, so the optimistic patch goes through setQueryData. It stays
          // a local UI patch: the revoked device row still comes from the next read, not from here.
          queryClient.setQueryData<ActiveUserItem[]>(cacheKeys.activeUsers(currentUser), (prev) =>
            (prev ?? []).map((item) =>
              item.id === userId
                ? {
                    ...item,
                    devices: item.devices.filter((device) => device.id !== deviceId),
                    devicesCount: Math.max(0, item.devicesCount - 1),
                    deviceInfo: item.devices.length > 1 ? `${item.devices.length - 1} Perangkat Aktif` : "Belum ada perangkat terhubung",
                  }
                : item,
            ),
          );
        }
        if (!res.success) setAdminToast({ type: "error", text: res.message });
      },
    });
  };

  const openEditUser = (user: ActiveUserItem) => {
    setEditUserTarget(user);
    setEditUserForm({
      fullName: user.fullName,
      phoneNumber: "",
      status: user.status,
      teamName: user.teamName,
      roleKey: user.roles.find((held) => roleOptions.some((option) => option.value === held)) || user.role,
      memberType: user.memberType || "",
    });
    setEditUserMsg(null);
  };

  const performSaveEditUser = async () => {
    if (!editUserTarget) return;
    setIsEditingUser(true);
    setEditUserMsg(null);
    try {
      const res = await adminUpdateUserAction(editUserTarget.id, {
        fullName: editUserForm.fullName,
        phoneNumber: editUserForm.phoneNumber,
        status: editUserForm.status,
        teamName: editUserForm.teamName,
        // The RPC rotates the entire active role set, so an untouched select must not be sent as
        // a change; the category is a separate column and always travels on its own.
        roleKey:
          editUserForm.roleKey && !editUserTarget.roles.includes(editUserForm.roleKey)
            ? editUserForm.roleKey
            : undefined,
        memberType: editUserForm.memberType || undefined,
      });
      setEditUserMsg({ type: res.success ? "success" : "error", text: res.message });
      if (res.success) {
        reload();
        setTimeout(() => setEditUserTarget(null), 1200);
      }
    } catch {
      setEditUserMsg({ type: "error", text: "Gagal menyimpan perubahan. Silakan coba lagi." });
    } finally {
      setIsEditingUser(false);
    }
  };

  const handleSaveEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUserTarget) return;
    const nextStatus = editUserForm.status;
    const isDestructive =
      (nextStatus === "suspended" || nextStatus === "deactivated") &&
      nextStatus !== editUserTarget.status;
    if (isDestructive) {
      const actionLabel = nextStatus === "suspended" ? "menangguhkan" : "menonaktifkan permanen";
      setAdminConfirmDialog({
        isOpen: true,
        title: `Konfirmasi ${actionLabel} akun?`,
        description: `Akun ${editUserTarget.fullName} akan kehilangan akses setelah status diubah. Perubahan ini tercatat pada audit log.`,
        onConfirm: () => {
          setAdminConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          void performSaveEditUser();
        },
      });
      return;
    }
    void performSaveEditUser();
  };

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await createManualAccountAction(manualForm);
    if (res.success) {
      setManualSuccessMsg(res.message);
      reload();
      setTimeout(() => {
        setManualSuccessMsg("");
        setIsManualModalOpen(false);
        setManualForm({
          fullName: "",
          email: "",
          phone: "",
          role: "santri",
          memberType: "santri",
          teamName: "Sentra Digitalpreneur",
          notes: "",
        });
      }, 1500);
    }
  };

  const handleImportMembers = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsImporting(true);
    setImportFeedback(null);
    try {
      const result = await importMembersCsvAction(importFileName, importCsv);
      setImportFeedback(`${result.message}${result.errors.length ? ` ${result.errors.slice(0, 3).join(" ")}` : ""}`);
      if (result.success) {
        reload();
        setImportCsv("");
      }
    } catch {
      setImportFeedback("Impor gagal diproses. Periksa format CSV lalu coba lagi.");
    } finally {
      setIsImporting(false);
    }
  };

  const pendingRequests = accountRequests.filter((r) => r.status === "pending" || !r.status);
  const activeUsersList = activeUsers.filter((u) => u.status === "active");
  const suspendedUsersList = activeUsers.filter(
    (u) => u.status === "suspended" || u.status === "deactivated"
  );

  // One predicate backs both the chip counts and the list, so a chip never advertises a number
  // the search box disagrees with. "Ustadz" is a profiles.member_type category (§2 rule 1) and
  // no longer hides inside the pengurus role; every other chip follows the granted roles.
  const matchesRoleFilter = (item: ActiveUserItem, label: string) =>
    label === "Semua" ||
    (label === "Ustadz"
      ? (item.memberType || "").toLowerCase() === "ustadz"
      : item.roles.some((held) => held.toLowerCase().includes(label.toLowerCase())));

  const filteredActiveUsers = activeUsersList.filter((u) => {
    const matchesSearch =
      !searchQuery ||
      u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch && matchesRoleFilter(u, selectedRoleFilter);
  });

  return (
    <div className="flex flex-col w-full pb-8 max-w-4xl mx-auto">
      {/* 1. Content Context Header */}
      <div className="flex flex-col gap-1 mb-4">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-mono text-[12px] tracking-tight font-semibold">
            PRD-01 • IAM &amp; ACCESS
          </span>
          <span className="font-mono text-[12px] text-muted-foreground">IAM-001</span>
        </div>
        <h2 className="font-headline-lg text-headline-lg font-bold text-on-surface">
          Kelola Akses &amp; Akun
        </h2>
        <p className="font-body-md text-body-md text-muted-foreground">
          Persetujuan pendaftaran santri, manajemen sesi aktif, dan kontrol peran berbasis RBAC.
        </p>
      </div>

      {/* 2. Security Notice Banner */}
      <div className="rounded-xl bg-card p-3.5 mb-5 shadow-sm border border-border">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 mt-0.5">
            <span className="material-symbols-outlined text-[20px]">shield</span>
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-label-sm text-label-sm text-primary uppercase tracking-wide font-semibold">
                BR-IAM-01 &amp; BR-IAM-04
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">• Guard Aktif</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 leading-snug">
              Registrasi publik tidak aktif otomatis. Persetujuan admin mutlak diperlukan sebelum hak akses diberikan. Akun Super Admin dilindungi kebijakan zero-revoke.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Segmented Tabs Navigation */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted mb-5">
        {canDecideIam && (
          <button
            className={`flex-1 py-2 px-2.5 rounded-lg font-label-sm text-label-sm shadow-sm flex items-center justify-center gap-1.5 transition-all ${
              activeTab === "queue"
                ? "bg-card text-primary font-semibold shadow-xs"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
            onClick={() => setActiveTab("queue")}
            type="button"
          >
            <span>Antrean</span>
            {pendingRequests.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-error text-white font-mono text-[11px] leading-tight font-bold">
                {pendingRequests.length}
              </span>
            )}
          </button>
        )}

        <button
          className="w-full h-11 rounded-xl bg-secondary-container text-on-secondary-container font-label-md text-sm flex items-center justify-center gap-2 transition-all hover:bg-secondary-fixed"
          type="button"
          onClick={() => { setImportFeedback(null); setIsImportModalOpen(true); }}
        >
          <span className="material-symbols-outlined text-[19px]">upload_file</span>
          <span>Impor Anggota dari CSV</span>
        </button>
        <button
          className={`flex-1 py-2 px-2.5 rounded-lg font-label-sm text-label-sm flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "active"
              ? "bg-card text-primary font-semibold shadow-xs"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
          onClick={() => setActiveTab("active")}
          type="button"
        >
          <span>Aktif</span>
          <span className="text-muted-foreground font-mono text-[11px]">
            {activeUsersList.length}
          </span>
        </button>
        <button
          className={`flex-1 py-2 px-2.5 rounded-lg font-label-sm text-label-sm flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "archived"
              ? "bg-card text-primary font-semibold shadow-xs"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
          onClick={() => setActiveTab("archived")}
          type="button"
        >
          <span>Ditangguhkan</span>
          <span className="text-muted-foreground font-mono text-[11px]">
            {suspendedUsersList.length}
          </span>
        </button>
      </div>

      {/* TAB 1: QUEUE — §3.1 makes the decision surface super_admin only. */}
      {canDecideIam && activeTab === "queue" && (
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2">
              <span className="font-headline-sm text-headline-sm text-on-surface">
                Antrean Registrasi Mandiri
              </span>
              {pendingRequests.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
              )}
            </div>
            <span className="font-mono text-[12px] text-muted-foreground">
              {pendingRequests.length === 0
                ? "Tidak ada antrean"
                : `${pendingRequests.length} Menunggu`}
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 text-center bg-card rounded-xl border border-border text-muted-foreground">
              <span className="material-symbols-outlined text-[32px] animate-spin text-primary">
                progress_activity
              </span>
              <p className="font-body-sm text-[13px] mt-2">Memuat antrean registrasi...</p>
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
              <Illustration
                src="/illustrations/undraw_done_erdp.svg"
                alt="Tidak ada antrean pendaftaran"
                width={130}
                height={90}
              />
              <div>
                <p className="font-headline-sm text-base font-semibold text-on-surface">
                  Tidak Ada Permohonan Pendaftaran
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                  Calon santri atau pengurus yang mendaftar mandiri akan muncul di sini untuk verifikasi hak akses RBAC.
                </p>
              </div>
            </div>
          ) : (
            pendingRequests.map((applicant) => (
              <div
                key={applicant.id}
                className={`rounded-xl bg-card p-4 shadow-sm flex flex-col gap-3.5 transition-all border border-border ${
                  approvedCards[applicant.id] ? "bg-accent/30 border-success/30" : ""
                } ${rejectedCards[applicant.id] ? "bg-error-container/20 border-error/30" : ""}`}
                id={applicant.id}
              >
                {approvedCards[applicant.id] ? (
                  <div className="py-3 px-2 flex items-center justify-center gap-2 text-success font-label-md text-label-md">
                    <span className="material-symbols-outlined text-[20px]">check_circle</span>
                    <span>Akun Berhasil Disetujui ({approvedCards[applicant.id]})</span>
                  </div>
                ) : rejectedCards[applicant.id] ? (
                  <div className="py-3 px-2 flex items-center justify-center gap-2 text-destructive font-label-md text-label-md">
                    <span className="material-symbols-outlined text-[20px]">cancel</span>
                    <span>Permohonan Ditolak: {rejectedCards[applicant.id]}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-headline-sm text-headline-sm flex-shrink-0 font-bold">
                          {applicant.initials}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-label-md text-label-md text-on-surface font-semibold truncate">
                              {applicant.fullName}
                            </span>
                          </div>
                          <span className="font-body-sm text-body-sm text-muted-foreground truncate">
                            {applicant.email}
                          </span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-[12px] text-muted-foreground">
                              {applicant.phoneNumber}
                            </span>
                            <span className="text-muted-foreground font-mono text-[12px]">•</span>
                            <span className="inline-flex items-center gap-0.5 font-mono text-[12px] text-success">
                              <span className="material-symbols-outlined text-[14px]">security</span>
                              Turnstile Valid
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-warning/15 text-tertiary font-label-sm text-label-sm flex-shrink-0 font-semibold">
                        Baru
                      </span>
                    </div>

                    {/* Detail Box Metadata */}
                    <div className="rounded-lg bg-surface-container-low p-2.5 flex flex-col gap-1.5 border border-border/40">
                      <div className="flex items-center justify-between font-label-sm text-label-sm">
                        <span className="text-muted-foreground">Klaim Kategori:</span>
                        <span className="text-on-surface font-semibold capitalize">
                          {applicant.claimedMemberType ?? "Belum tercatat"} ({applicant.teamRequested})
                        </span>
                      </div>
                      <div className="flex items-center justify-between font-mono text-[12px]">
                        <span className="text-muted-foreground">Waktu Pengajuan:</span>
                        <span className="text-on-surface-variant">{applicant.createdAt}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Kategori tidak menentukan peran. Tetapkan hak akses secara terpisah di bawah.</p>
                      <p className="text-xs text-muted-foreground">
                        Persetujuan privasi: {applicant.privacyConsentVersion && applicant.privacyConsentAt
                          ? `versi ${applicant.privacyConsentVersion} · ${new Date(applicant.privacyConsentAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`
                          : "Belum tercatat (pengajuan lama atau impor)."}
                      </p>
                      {applicant.notes && applicant.notes !== "-" && (
                        <div className="pt-1 mt-0.5">
                          <p className="font-body-sm text-[13px] text-on-surface-variant italic bg-card/60 p-2 rounded">
                            &quot;{applicant.notes}&quot;
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Role Assignment Configuration (RBAC Quick Pick) */}
                    <div className="flex flex-col gap-1.5">
                      <label
                        className="font-label-sm text-label-sm text-muted-foreground flex items-center gap-1 font-semibold"
                        htmlFor={`role-select-${applicant.id}`}
                      >
                        <span className="material-symbols-outlined text-[15px]">badge</span>
                        Alokasi Peran RBAC &amp; Penugasan Sentra:
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="relative">
                          <select
                            className="w-full h-11 px-3 pr-8 rounded-lg bg-surface-container font-label-md text-label-md text-on-surface appearance-none focus:outline-none focus:ring-2 focus:ring-primary transition-all border border-border"
                            id={`role-select-${applicant.id}`}
                            aria-label="Peran"
                            value={applicantRoles[applicant.id] || "santri"}
                            onChange={(e) =>
                              setApplicantRoles({
                                ...applicantRoles,
                                [applicant.id]: e.target.value,
                              })
                            }
                          >
                            {roleOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-[20px]">
                            arrow_drop_down
                          </span>
                        </div>
                        <div className="relative">
                          <select
                            className="w-full h-11 px-3 pr-8 rounded-lg bg-surface-container font-label-md text-label-md text-on-surface appearance-none focus:outline-none focus:ring-2 focus:ring-primary transition-all border border-border"
                            id={`team-select-${applicant.id}`}
                            aria-label="Tim / Sentra"
                            value={applicantTeams[applicant.id] ?? defaultTeamId(applicant)}
                            onChange={(e) =>
                              setApplicantTeams({
                                ...applicantTeams,
                                [applicant.id]: e.target.value,
                              })
                            }
                          >
                            {teams.map((team) => (
                              <option key={team.id} value={team.id}>
                                {team.name}
                              </option>
                            ))}
                            <option value="">Tanpa tim</option>
                          </select>
                          <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-[20px]">
                            arrow_drop_down
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Decision Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        className="h-11 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                        onClick={() => openRejectDialog(applicant.id)}
                        type="button"
                        disabled={!!processingCards[applicant.id]}
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                        Tolak
                      </button>
                      <button
                        className="h-11 rounded-lg bg-primary text-on-primary font-label-md text-label-md flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all disabled:opacity-60"
                        onClick={() => handleApprove(applicant)}
                        type="button"
                        disabled={!!processingCards[applicant.id]}
                      >
                        {processingCards[applicant.id] ? (
                          <>
                            <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                            Memproses...
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-[18px]">check_circle</span>
                            Setujui Akun
                          </>
                        )}
                      </button>
                    </div>
                    {approveErrors[applicant.id] && (
                      <p className="text-[13px] text-error flex items-start gap-1.5" role="alert">
                        <span className="material-symbols-outlined text-[16px] mt-px">error</span>
                        <span>{approveErrors[applicant.id]}</span>
                      </p>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 2: ACTIVE USERS & SECURITY SESSIONS */}
      {activeTab === "active" && (
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm text-on-surface">
                Pengguna Aktif &amp; Sesi
              </span>
              <span className="font-body-sm text-body-sm text-muted-foreground">
                Audit hak akses, perangkat aktif, dan status MFA
              </span>
            </div>
          </div>

          {/* Search and Quick Role Chips */}
          <div className="flex flex-col gap-2">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[20px]">
                search
              </span>
              <input
                className="w-full h-11 pl-10 pr-4 rounded-xl bg-card font-body-sm text-body-sm text-on-surface placeholder:text-muted-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all border border-border"
                placeholder="Cari nama, email, atau peran..."
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              {["Semua", "Santri", "Ustadz", "Koordinator"].map((label) => {
                const chip = `${label} (${activeUsersList.filter((u) => matchesRoleFilter(u, label)).length})`;
                const active = selectedRoleFilter === label;
                return (
                  <button
                    key={chip}
                    onClick={() => setSelectedRoleFilter(label)}
                    className={`px-3 py-1.5 rounded-full font-label-sm text-label-sm flex-shrink-0 transition-all ${
                      active
                        ? "bg-primary text-on-primary font-semibold"
                        : "bg-card text-on-surface-variant shadow-sm border border-border hover:bg-muted"
                    }`}
                    type="button"
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active User List */}
          <div className="flex flex-col gap-2.5">
            {isLoading ? (
              <div className="p-8 text-center bg-card rounded-xl border border-border text-muted-foreground">
                <span className="material-symbols-outlined text-[32px] animate-spin text-primary">
                  progress_activity
                </span>
                <p className="font-body-sm text-[13px] mt-2">Memuat daftar pengguna aktif...</p>
              </div>
            ) : filteredActiveUsers.length === 0 ? (
              <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
                <Illustration
                  src="/illustrations/undraw_team-permissions_1lrk.svg"
                  alt="Belum ada pengguna terdaftar"
                  width={150}
                  height={104}
                />
                <div>
                  <p className="font-headline-sm text-base font-semibold text-on-surface">
                    Belum Ada Pengguna Aktif
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                    Gunakan tombol &quot;Buat Akun Manual (Jalur B Admin)&quot; di bawah untuk menambahkan pengguna baru secara langsung.
                  </p>
                </div>
              </div>
            ) : (
              filteredActiveUsers.map((user) => (
                <div
                  key={user.id}
                  className="rounded-xl bg-card p-3.5 shadow-sm flex flex-col gap-2.5 border border-border"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed font-headline-sm text-headline-sm flex-shrink-0 font-bold">
                        {user.initials}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-label-md text-label-md text-on-surface font-semibold truncate">
                            {user.fullName}
                          </span>
                          <span className="w-2 h-2 rounded-full bg-success" />
                        </div>
                        <span className="font-body-sm text-body-sm text-muted-foreground truncate">
                          {user.email}
                        </span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="px-2 py-0.2 rounded-md bg-accent text-accent-foreground font-mono text-[11px] font-semibold">
                            {user.role}
                          </span>
                          {user.memberType && user.memberType !== user.role && (
                            <span className="px-2 py-0.2 rounded-md bg-surface-container-high text-on-surface-variant font-mono text-[11px]">
                              {user.memberType}
                            </span>
                          )}
                          <span className="px-2 py-0.2 rounded-md bg-surface-container text-on-surface-variant font-mono text-[11px]">
                            {user.teamName}
                          </span>
                        </div>
                      </div>
                    </div>
                    {canDecideIam && (
                      <button
                        type="button"
                        onClick={() => openEditUser(user)}
                        className="h-8 px-2.5 rounded-lg bg-surface-container border border-border text-on-surface-variant font-label-sm text-[12px] flex items-center gap-1 hover:bg-muted transition-colors shrink-0"
                      >
                        <span className="material-symbols-outlined text-[15px]">edit</span>
                        Edit
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-muted-foreground">shield</span>
                    <span className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold ${MFA_EVIDENCE_CLASS[user.mfaEvidence]}`}>
                      {MFA_EVIDENCE_LABEL[user.mfaEvidence]}
                    </span>
                  </div>
                  <div className="pt-2 flex items-center justify-between bg-surface-container-low px-3 py-2 rounded-lg border border-border/40">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[17px] text-primary">
                        smartphone
                      </span>
                      <div className="flex flex-col">
                        <span className="font-mono text-[12px] text-on-surface leading-tight font-medium">
                          {resetSessions[user.id] ? "0 Sesi & Perangkat (Telah Dicabut)" : user.deviceInfo}
                        </span>
                      </div>
                    </div>
                    {resetSessions[user.id] ? (
                        <span className="text-[11px] font-mono text-success">Sesi &amp; Perangkat Dicabut</span>
                    ) : canDecideIam ? (
                      <button
                        className="px-2.5 py-1 rounded-md bg-card text-destructive font-label-sm text-label-sm active:scale-95 shadow-xs transition-all border border-border hover:bg-destructive/10"
                        onClick={() => handleResetSession(user.id)}
                        type="button"
                      >
                        Cabut Sesi &amp; Perangkat
                      </button>
                    ) : null}
                  </div>
                  {user.devices.length > 0 && !resetSessions[user.id] && (
                    <div className="flex flex-wrap gap-1.5">
                      {user.devices.filter((device) => !revokedDevices[device.id]).map((device) => (
                        <div key={device.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-on-surface-variant">
                          <span className="material-symbols-outlined text-[14px]">{device.platform === "web" ? "language" : "smartphone"}</span>
                          <span>{device.label}</span>
                          {canDecideIam && (
                            <button type="button" onClick={() => handleRevokeDevice(user.id, device.id)} className="text-destructive hover:underline">Cabut</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ARCHIVED / SUSPENDED */}
      {activeTab === "archived" && (
        <div className="flex flex-col gap-3 mb-6">
          {suspendedUsersList.length === 0 ? (
            <div className="p-8 sm:p-10 text-center bg-card rounded-2xl border border-dashed border-border flex flex-col items-center justify-center space-y-3">
              <Illustration
                src="/illustrations/undraw_blocked_ldel.svg"
                alt="Tidak ada akun ditangguhkan"
                width={120}
                height={85}
              />
              <div>
                <p className="font-headline-sm text-base font-semibold text-on-surface">
                  Tidak Ada Akun yang Ditangguhkan
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                  Semua akun terdaftar dalam status tertib. Akun yang dinonaktifkan akan tercatat di sini.
                </p>
              </div>
            </div>
          ) : (
            suspendedUsersList.map((user) => (
              <div
                key={user.id}
                className="rounded-xl bg-card p-4 shadow-sm border border-border flex items-center justify-between"
              >
                <div>
                  <h4 className="font-headline-sm text-[16px] text-on-surface font-semibold">
                    {user.fullName}
                  </h4>
                  <p className="font-body-sm text-[12px] text-muted-foreground">
                    {user.email} • {user.teamName}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-sm text-[11px] font-semibold">
                  {user.status === "suspended" ? "Ditangguhkan (Suspended)" : "Nonaktif Permanen"}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* 4. Bottom Fast Actions Section (PRD-01 §3.2 Pathway B) */}
      <div className="flex flex-col gap-2.5 mt-2">
        {/* §3.1: minting an account and granting its first role is super_admin only. */}
        {canDecideIam && (
          <button
            className="w-full h-12 rounded-xl bg-primary text-on-primary font-label-md text-label-md flex items-center justify-center gap-2 shadow-md active:scale-98 transition-all hover:bg-primary-container"
            type="button"
            onClick={() => setIsManualModalOpen(true)}
          >
            <span className="material-symbols-outlined text-[20px]">person_add</span>
            <span>Buat Akun Manual (Jalur B Admin)</span>
          </button>
        )}

        <div className="flex items-center justify-between gap-2">
          {canExportAccounts && (
            <button
              className="flex-1 h-11 rounded-xl bg-card text-on-surface-variant font-label-sm text-label-sm shadow-sm flex items-center justify-center gap-1.5 active:bg-muted transition-all border border-border hover:bg-surface-container"
              type="button"
              onClick={exportUsers}
              disabled={isExportingUsers}
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              {isExportingUsers ? "Menyiapkan..." : "Unduh Rekap Akun"}
            </button>
          )}
          <Link
            href="/admin/audit"
            className="flex-1 h-11 rounded-xl bg-card text-on-surface-variant font-label-sm text-label-sm shadow-sm flex items-center justify-center gap-1.5 active:bg-muted transition-all border border-border hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[18px]">history</span>
            Log Audit IAM
          </Link>
        </div>
        {exportFeedback && (
          <p className="text-center text-xs text-error" role="alert">{exportFeedback}</p>
        )}

        <p className="text-center font-mono text-[11px] text-muted-foreground mt-1">
          Pondok OS IAM Module v2.0 • Sesuai standar ISO/IEC 27001 Access Control
        </p>
      </div>

      {/* MODAL 1: Jalur B Manual Account Creation */}
      {isImportModalOpen && (
        <Modal
          isOpen
          onClose={() => setIsImportModalOpen(false)}
          title="Impor anggota dari CSV"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          className="bg-card w-full max-w-xl rounded-2xl border border-border shadow-2xl p-5 sm:p-6 space-y-4"
        >
            <div className="flex items-start justify-between pb-3 border-b border-border">
              <div><h3 className="font-headline-sm text-headline-sm text-on-surface">Impor anggota dari CSV</h3><p className="text-xs text-muted-foreground mt-1">Baris yang lolos validasi masuk ke antrean persetujuan akun; tidak langsung aktif.</p></div>
              <button type="button" onClick={() => setIsImportModalOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"><span className="material-symbols-outlined text-[18px]">close</span></button>
            </div>
            <form onSubmit={handleImportMembers} className="space-y-3">
              <input type="file" accept=".csv,text/csv" aria-label="Berkas CSV anggota" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; setImportFileName(file.name); const reader = new FileReader(); reader.onload = () => setImportCsv(String(reader.result || "")); reader.readAsText(file); }} className="w-full text-xs text-muted-foreground" />
              <textarea value={importCsv} aria-label="Isi CSV anggota" onChange={(e) => setImportCsv(e.target.value)} rows={8} placeholder={'full_name,email,phone_number,member_type,team_name\nAhmad,ahmad@example.com,0812...,santri,Sentra Digitalpreneur'} className="w-full rounded-xl border border-border bg-surface-container-low p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary" required />
              <p className="text-[11px] text-muted-foreground">Kolom wajib: <code>full_name</code>, <code>email</code>. Kolom tambahan: <code>phone_number</code>, <code>member_type</code>, <code>team_name</code>, <code>attendance_required</code>, <code>report_required</code>.</p>
              {importFeedback && <div className="rounded-lg bg-surface-container-low p-3 text-xs text-on-surface" aria-live="polite">{importFeedback}</div>}
              <div className="flex justify-end gap-2 pt-2 border-t border-border"><button type="button" onClick={() => setIsImportModalOpen(false)} className="px-4 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted">Batal</button><button type="submit" disabled={isImporting} className="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold disabled:opacity-50">{isImporting ? "Memproses…" : "Validasi & Impor"}</button></div>
            </form>
        </Modal>
      )}

      {isManualModalOpen && (
        <Modal
          isOpen
          onClose={() => setIsManualModalOpen(false)}
          title="Buat Akun Santri (Jalur B Admin)"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
          className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-2xl p-5 sm:p-6 space-y-4"
        >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">person_add</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">
                  Buat Akun Santri (Jalur B Admin)
                </h3>
              </div>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {manualSuccessMsg ? (
              <div className="py-6 text-center text-success flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[36px]">check_circle</span>
                <p className="font-label-md text-label-md">{manualSuccessMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleCreateManual} className="space-y-3.5">
                <div>
                  <label htmlFor="manual-full-name" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                    Nama Lengkap
                  </label>
                  <input
                    id="manual-full-name"
                    required
                    type="text"
                    placeholder="Contoh: Bilal bin Rabah"
                    className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[15px] focus:outline-none focus:ring-2 focus:ring-primary"
                    value={manualForm.fullName}
                    onChange={(e) => setManualForm({ ...manualForm, fullName: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="manual-email" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                    Alamat Email (atau sintetis santri)
                  </label>
                  <input
                    id="manual-email"
                    required
                    type="email"
                    placeholder="nama@pondok.id"
                    className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[15px] focus:outline-none focus:ring-2 focus:ring-primary"
                    value={manualForm.email}
                    onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="manual-phone" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                    Nomor WhatsApp
                  </label>
                  <input
                    id="manual-phone"
                    required
                    type="tel"
                    placeholder="08123456789"
                    className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[15px] focus:outline-none focus:ring-2 focus:ring-primary"
                    value={manualForm.phone}
                    onChange={(e) => setManualForm({ ...manualForm, phone: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="manual-role" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                    Peran (user_roles)
                  </label>
                  <select
                    id="manual-role"
                    className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[15px] focus:outline-none focus:ring-2 focus:ring-primary"
                    value={manualForm.role}
                    onChange={(e) => setManualForm({ ...manualForm, role: e.target.value as UserRole })}
                  >
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="manual-member-type" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                    Kategori Anggota (member_type)
                  </label>
                  <select
                    id="manual-member-type"
                    className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[15px] focus:outline-none focus:ring-2 focus:ring-primary"
                    value={manualForm.memberType}
                    onChange={(e) => setManualForm({ ...manualForm, memberType: e.target.value })}
                  >
                    {MEMBER_CATEGORIES.map((category) => (
                      <option key={category.value} value={category.value}>{category.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Kategori hanya menjelaskan siapa orangnya (mis. Ustadz) dan tidak mengubah hak akses peran di atas.
                  </p>
                </div>

                <div>
                  <label htmlFor="manual-team" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                    Penugasan Sentra
                  </label>
                  <select
                    id="manual-team"
                    className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[15px] focus:outline-none focus:ring-2 focus:ring-primary"
                    value={manualForm.teamName}
                    onChange={(e) => setManualForm({ ...manualForm, teamName: e.target.value })}
                  >
                    <option value="Sentra Digitalpreneur">Sentra Digitalpreneur</option>
                    <option value="Sentra Dakwah Media">Sentra Dakwah Media</option>
                    <option value="Sentra Agropreneur">Sentra Agropreneur</option>
                  </select>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsManualModalOpen(false)}
                    className="flex-1 h-11 rounded-xl bg-card border border-border text-on-surface-variant font-label-md"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="flex-1 h-11 rounded-xl bg-primary text-white font-label-md shadow-sm"
                  >
                    Terbitkan Akun Aktif
                  </button>
                </div>
              </form>
            )}
        </Modal>
      )}

      {/* MODAL 2: Rejection Reason Confirmation */}
      {isRejectModalOpen && (
        <Modal
          isOpen
          onClose={() => setIsRejectModalOpen(false)}
          title="Tolak Permohonan Akun"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
          className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-5 space-y-3.5"
        >
            <div className="flex items-center gap-2 text-destructive">
              <span className="material-symbols-outlined text-[24px]">warning</span>
              <h3 className="font-headline-sm text-headline-sm text-on-surface">
                Tolak Permohonan Akun
              </h3>
            </div>
            <p className="font-body-sm text-[13px] text-muted-foreground">
              Sesuai BR-IAM-02, setiap penolakan akun wajib disertai alasan yang dicatat ke log audit.
            </p>

            <div>
              <label htmlFor="rejection-reason" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                Alasan Penolakan
              </label>
              <textarea
                id="rejection-reason"
                required
                rows={3}
                placeholder="Tuliskan alasan penolakan untuk arsip audit..."
                className="w-full p-3 rounded-xl bg-surface-container border border-border text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
                value={rejectionReason}
                onChange={(e) => { setRejectionReason(e.target.value); if (rejectError) setRejectError(null); }}
              />
            </div>

            {rejectError && (
              <div role="alert" className="rounded-xl border border-error/30 bg-error-container/30 p-3 text-[13px] text-error">
                {rejectError}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsRejectModalOpen(false)}
                disabled={isRejecting}
                className="flex-1 h-11 rounded-xl bg-card border border-border text-on-surface-variant font-label-md disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={isRejecting || !rejectionReason.trim()}
                className="flex-1 h-11 rounded-xl bg-destructive text-white font-label-md shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isRejecting && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                {isRejecting ? "Memproses..." : "Konfirmasi Tolak"}
              </button>
            </div>
        </Modal>
      )}
      {/* MODAL 3: Admin Edit User */}
      {editUserTarget && (
        <Modal
          isOpen
          onClose={() => setEditUserTarget(null)}
          title="Edit Profil Pengguna"
          backdropClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
          className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-5 space-y-4"
        >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">manage_accounts</span>
                <h3 className="font-headline-sm text-[17px] text-on-surface font-semibold">
                  Edit Profil Pengguna
                </h3>
              </div>
              <button
                onClick={() => setEditUserTarget(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveEditUser} className="space-y-3.5">
              <div>
                <label htmlFor="edit-full-name" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">Nama Lengkap</label>
                <input
                  id="edit-full-name"
                  type="text"
                  required
                  value={editUserForm.fullName}
                  onChange={(e) => setEditUserForm({ ...editUserForm, fullName: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="edit-phone" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">Nomor Telepon</label>
                <input
                  id="edit-phone"
                  type="tel"
                  value={editUserForm.phoneNumber}
                  onChange={(e) => setEditUserForm({ ...editUserForm, phoneNumber: e.target.value })}
                  placeholder="08xxxxxxxxxx"
                  className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="edit-status" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">Status Akun</label>
                <select
                  id="edit-status"
                  value={editUserForm.status}
                  onChange={(e) => setEditUserForm({ ...editUserForm, status: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="active">Aktif</option>
                  <option value="suspended">Ditangguhkan</option>
                  <option value="deactivated">Nonaktif Permanen</option>
                </select>
              </div>
              <div>
                <label htmlFor="edit-team" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">Tim / Sentra</label>
                <input
                  id="edit-team"
                  type="text"
                  value={editUserForm.teamName}
                  onChange={(e) => setEditUserForm({ ...editUserForm, teamName: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="edit-role" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                  Peran (user_roles)
                </label>
                <select
                  id="edit-role"
                  value={editUserForm.roleKey}
                  onChange={(e) => setEditUserForm({ ...editUserForm, roleKey: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                  {!roleOptions.some((option) => option.value === editUserForm.roleKey) && (
                    <option value={editUserForm.roleKey}>
                      {editUserForm.roleKey} (tidak dapat ditetapkan dari layar ini)
                    </option>
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="edit-member-type" className="font-label-sm text-label-sm text-on-surface font-semibold block mb-1">
                  Kategori Anggota (member_type)
                </label>
                <select
                  id="edit-member-type"
                  value={editUserForm.memberType}
                  onChange={(e) => setEditUserForm({ ...editUserForm, memberType: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-surface-container border border-border text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {MEMBER_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Mengubah peran tidak mengubah kategori, dan sebaliknya: kategori bersifat deskriptif (§2 aturan 1).
                </p>
              </div>

              {editUserMsg && (
                <div className={`p-3 rounded-xl text-[13px] flex items-center gap-2 ${
                  editUserMsg.type === "success"
                    ? "bg-success/15 text-success border border-success/30"
                    : "bg-error/15 text-error border border-error/30"
                }`}>
                  <span className="material-symbols-outlined text-[16px]">
                    {editUserMsg.type === "success" ? "check_circle" : "error"}
                  </span>
                  {editUserMsg.text}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditUserTarget(null)}
                  className="flex-1 h-11 rounded-xl bg-card border border-border text-on-surface-variant font-label-md"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isEditingUser}
                  className="flex-1 h-11 rounded-xl bg-primary text-white font-label-md shadow-sm disabled:opacity-60"
                >
                  {isEditingUser ? "Menyimpan..." : "Simpan Perubahan"}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Admin toast notifications (UX-05) */}
      {adminToast && (
        <div
          className={`fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg text-sm font-medium max-w-sm w-full mx-4 ${
            adminToast.type === "success"
              ? "bg-card border-success/30 text-success"
              : "bg-card border-error/30 text-error"
          }`}
          role="status"
        >
          <span className="material-symbols-outlined text-[20px] shrink-0">
            {adminToast.type === "success" ? "check_circle" : "error"}
          </span>
          <p className="flex-1">{adminToast.text}</p>
          <button onClick={() => setAdminToast(null)} aria-label="Tutup" className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={adminConfirmDialog.isOpen}
        onClose={() => setAdminConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={adminConfirmDialog.onConfirm}
        title={adminConfirmDialog.title}
        description={adminConfirmDialog.description}
        confirmLabel="Ya, Lanjutkan"
        variant="destructive"
      />
    </div>
  );
}
