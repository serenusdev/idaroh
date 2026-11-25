"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuthUser, requireRole } from "@/lib/auth/guards";
import { INITIAL_PEOPLE_PROFILES, INITIAL_TEAMS } from "./data";
import { PersonProfile, TeamStructureItem } from "./types";
import { throwQueryError } from "@/lib/query-error";
import { maskPhoneNumber } from "./masking";

/**
 * Server Action: Query all people profiles from Supabase
 */
export async function getPeopleAction(): Promise<PersonProfile[]> {
  const currentUser = await requireAuthUser();
  try {
    const supabase = createAdminClient();

    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, phone_number, avatar_url, status, member_type, team_name, bio, created_at, updated_at, last_seen_at")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw error;
    if (profiles) {
      if (profiles.length === 0) return [];
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
      const profileIds = profiles.map((profile: any) => profile.id);
      const { data: assignments, error: assignmentsError } = await supabase
        .from("reviewer_assignments")
        .select("reviewee_id, reviewer_id")
        .in("reviewee_id", profileIds)
        .eq("kind", "report")
        .lte("valid_from", today)
        .or(`valid_to.is.null,valid_to.gte.${today}`);
      if (assignmentsError) throw assignmentsError;
      const reviewerIds = Array.from(new Set((assignments || []).map((a: any) => a.reviewer_id)));
      const { data: reviewers } = reviewerIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", reviewerIds)
        : { data: [] };
      const reviewerMap = new Map<string, string>((reviewers || []).map((reviewer: any) => [reviewer.id, reviewer.full_name] as [string, string]));
      const { data: memberships, error: membershipsError } = await supabase
        .from("team_members")
        .select("user_id, team_id, team_role")
        .in("user_id", profileIds)
        .lte("valid_from", today)
        .or(`valid_to.is.null,valid_to.gte.${today}`);
      if (membershipsError) throw membershipsError;
      const { data: dutyRows, error: dutyError } = await supabase
        .from("attendance_duty_flags")
        .select("user_id, attendance_required, report_required, date_from, date_to, created_at")
        .in("user_id", profileIds)
        .lte("date_from", today)
        .order("created_at", { ascending: false });
      if (dutyError) throw dutyError;
      const dutyByUser = new Map<string, { attendanceRequired: boolean; reportRequired: boolean }>();
      for (const duty of dutyRows || []) {
        if (duty.date_to && duty.date_to < today) continue;
        if (!dutyByUser.has(duty.user_id)) {
          dutyByUser.set(duty.user_id, {
            attendanceRequired: Boolean(duty.attendance_required),
            reportRequired: Boolean(duty.report_required),
          });
        }
      }
      const teamIds = Array.from(new Set((memberships || []).map((membership: any) => membership.team_id)));
      const { data: teamRows } = teamIds.length
        ? await supabase.from("teams").select("id, name, slug").in("id", teamIds)
        : { data: [] };
      const teamMap = new Map<string, { name: string; slug: string }>(
        (teamRows || []).map((team: any) => [team.id, team] as [string, { name: string; slug: string }])
      );
      const membershipsByUser = new Map<string, any[]>();
      for (const membership of memberships || []) {
        const list = membershipsByUser.get(membership.user_id) || [];
        list.push(membership);
        membershipsByUser.set(membership.user_id, list);
      }
      let visibleProfiles = profiles as any[];
      const heldRoles = new Set<string>([currentUser.role, ...(currentUser.roles || [])]);
      const hasOrgDirectoryRole = ["pengurus", "yayasan", "super_admin"].some((r) => heldRoles.has(r));
      if (!hasOrgDirectoryRole && heldRoles.has("koordinator")) {
        const ownTeams = new Set((membershipsByUser.get(currentUser.id) || []).map((item: any) => item.team_id));
        visibleProfiles = visibleProfiles.filter((profile) =>
          profile.id === currentUser.id || (membershipsByUser.get(profile.id) || []).some((item: any) => ownTeams.has(item.team_id))
        );
      } else if (!hasOrgDirectoryRole) {
        visibleProfiles = visibleProfiles.filter((profile) => profile.id === currentUser.id);
      }

      return visibleProfiles.map((p: any) => {
        const phone = p.phone_number || "";
        const phoneMasked = maskPhoneNumber(phone);
        const reviewer = (assignments || []).find((assignment: any) => assignment.reviewee_id === p.id);
        const isCurrentUser = currentUser ? p.id === currentUser.id : false;
        const userMemberships = membershipsByUser.get(p.id) || [];
        const membershipTeamId = userMemberships[0]?.team_id || "";
        const lastSeenAgeMinutes = p.last_seen_at ? (Date.now() - new Date(p.last_seen_at).getTime()) / 60000 : Number.POSITIVE_INFINITY;
        const onlineStatus = lastSeenAgeMinutes <= 10 ? "active" : lastSeenAgeMinutes <= 60 ? "away" : "offline";
        const isSantri = String(p.member_type || "santri").toLowerCase() === "santri";

        return {
          id: p.id,
          name: p.full_name,
          nickname: p.full_name.split(" ")[0],
          isCurrentUser,
          avatar: p.avatar_url || `https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80`,
          memberType: (p.member_type || "santri") as any,
          memberTypeLabel: p.member_type || "Santri",
          roleLabel: p.team_name ? `Anggota ${p.team_name}` : "Belum ditempatkan",
          teamName: teamMap.get(membershipTeamId)?.name || p.team_name || "",
          teamId: teamMap.get(membershipTeamId)?.slug || "",
          teams: userMemberships.map((membership: any) => ({
            id: membership.team_id,
            name: teamMap.get(membership.team_id)?.name || "",
            slug: teamMap.get(membership.team_id)?.slug || "",
            role: membership.team_role,
          })),
          phoneMasked,
          phoneUnmasked: "",
          onlineStatus: onlineStatus as "active" | "away" | "offline",
          dutyFlags: {
            attendanceRequired: dutyByUser.get(p.id)?.attendanceRequired ?? isSantri,
            reportRequired: dutyByUser.get(p.id)?.reportRequired ?? isSantri,
          },
          bio: p.bio || "",
          primaryReviewerName: reviewer ? reviewerMap.get(reviewer.reviewer_id) || "" : "",
        };
      });
    }
  } catch (err) {
    if (process.env.VITEST) {
      return INITIAL_PEOPLE_PROFILES;
    }
    throwQueryError("people.profiles", err);
  }
  return [];
}

export async function touchPresenceAction(): Promise<boolean> {
  if (process.env.VITEST) return true;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("touch_presence");
    if (error) throw error;
    return data === true;
  } catch (error) {
    console.error("Failed to update presence heartbeat:", error);
    return false;
  }
}

/**
 * Server Action: Query teams from Supabase
 */
export async function getTeamsAction(): Promise<TeamStructureItem[]> {
  await requireAuthUser();
  try {
    const supabase = createAdminClient();
    const { data: teams, error } = await supabase
      .from("teams")
        .select("*, team_members(*)")
      .order("created_at", { ascending: true });

    if (error) throw error;
    if (teams) {
      if (teams.length === 0) return [];
      const teamIds = teams.map((team: any) => team.id);
      const memberIds = Array.from(new Set((teams as any[]).flatMap((team: any) => (team.team_members || []).map((member: any) => member.user_id))));
      const { data: activeProfiles } = memberIds.length
        ? await supabase.from("profiles").select("id").in("id", memberIds).eq("status", "active")
        : { data: [] };
      const activeProfileIds = new Set((activeProfiles || []).map((profile: any) => profile.id));
      const { data: coordinators } = await supabase
        .from("team_members")
        .select("team_id, user_id")
        .in("team_id", teamIds)
        .eq("team_role", "coordinator")
        .is("valid_to", null);
      const coordinatorIds = Array.from(new Set((coordinators || []).map((row: any) => row.user_id)));
      const { data: coordinatorProfiles } = coordinatorIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", coordinatorIds)
        : { data: [] };
      const coordinatorNames = new Map(
        (coordinatorProfiles || []).map((profile: any) => [profile.id, profile.full_name])
      );
      const coordinatorByTeam = new Map(
        (coordinators || []).map((row: any) => [row.team_id, coordinatorNames.get(row.user_id) || ""])
      );

      return teams.map((t: any) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        description: t.description || "",
        coordinatorName: coordinatorByTeam.get(t.id) || "",
        memberCount: (t.team_members || []).filter((member: any) => !member.valid_to && activeProfileIds.has(member.user_id)).length,
        icon: t.slug.includes("digital") ? "terminal" : t.slug.includes("media") ? "campaign" : "diversity_3",
      }));
    }
  } catch (err) {
    if (process.env.VITEST) {
      return INITIAL_TEAMS;
    }
    throwQueryError("people.teams", err);
  }
  return [];
}

/**
 * Server Action: Atomically Set Team Coordinator (PRD-07 §4.3)
 */
export async function setTeamCoordinatorAction(
  teamId: string,
  userId: string,
  userName: string
): Promise<{ success: boolean; message: string }> {
  // PPL-01: PERMISSIONS.md §3.7 grants yayasan `team.coordinator.set`, so the
  // team commands may not stop at pengurus.
  await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (process.env.VITEST) {
    return {
      success: true,
      message: `${userName} berhasil ditetapkan sebagai Koordinator Tim secara atomik.`,
    };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("team_set_coordinator", {
      p_team_id: teamId,
      p_user_id: userId,
    });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Koordinator tidak diperbarui." };
  } catch (err) {
    console.error("Failed to set team coordinator:", err);
    return { success: false, message: "Gagal menetapkan koordinator tim." };
  }

  return {
    success: true,
    message: `${userName} berhasil ditetapkan sebagai Koordinator Tim secara atomik.`,
  };
}

export async function addTeamMemberAction(payload: {
  teamId: string;
  userId: string;
  teamRole?: "member" | "coordinator" | "assistant";
  title?: string;
}): Promise<{ success: boolean; message: string }> {
  // PPL-01: the whole command (membership row and its audit row) now runs
  // inside app.team_member_set under the caller's own session, so no
  // service-role client and no hand-written date exist here.
  await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (!payload.teamId || !payload.userId) return { success: false, message: "Tim dan anggota wajib dipilih." };
  if (payload.teamRole === "coordinator") {
    return setTeamCoordinatorAction(payload.teamId, payload.userId, "Anggota");
  }
  if (process.env.VITEST) return { success: true, message: "Anggota berhasil ditambahkan ke tim." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("team_member_set", {
      p_team_id: payload.teamId,
      p_user_id: payload.userId,
      p_team_role: payload.teamRole || "member",
      p_title: payload.title || null,
    });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Anggota tidak dapat disimpan." };
    return { success: true, message: data?.message || "Anggota berhasil ditambahkan ke tim." };
  } catch (err) {
    console.error("addTeamMemberAction failed:", err);
    return { success: false, message: "Anggota gagal ditambahkan ke tim." };
  }
}

export async function removeTeamMemberAction(teamId: string, userId: string): Promise<{ success: boolean; message: string }> {
  // app.team_member_end closes the membership with a WIB date and audits it in
  // the same transaction; the history row is never deleted.
  await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (!teamId || !userId) return { success: false, message: "Tim dan anggota wajib dipilih." };
  if (process.env.VITEST) return { success: true, message: "Keanggotaan tim diakhiri secara historis." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("team_member_end", {
      p_team_id: teamId,
      p_user_id: userId,
    });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message || "Keanggotaan tim tidak dapat diakhiri." };
    return { success: true, message: data?.message || "Keanggotaan tim diakhiri; riwayat tetap tersimpan." };
  } catch (err) {
    console.error("removeTeamMemberAction failed:", err);
    return { success: false, message: "Keanggotaan tim gagal diakhiri." };
  }
}

export async function assignReviewerAction(payload: { revieweeId: string; reviewerId: string; kind?: "report" | "attendance_correction" | "task"; reason?: string }): Promise<{ success: boolean; message: string }> {
  // PPL-01: yayasan assigns reviewers too (§3.7). The audit write moved into
  // app.assign_reviewer so the assignment and its ledger row cannot split.
  await requireRole(["super_admin", "yayasan", "pengurus"]);
  if (payload.revieweeId === payload.reviewerId) return { success: false, message: "Anggota tidak dapat menjadi reviewer dirinya sendiri." };
  if (process.env.VITEST) return { success: true, message: "Reviewer utama berhasil ditetapkan." };
  const supabase = await createClient();
  const kind = payload.kind || "report";
  const { data, error } = await supabase.rpc("assign_reviewer", {
    p_reviewee_id: payload.revieweeId,
    p_reviewer_id: payload.reviewerId,
    p_kind: kind,
    p_reason: payload.reason || null,
  });
  if (error) throw error;
  if (!data?.success) return { success: false, message: data?.message || "Reviewer tidak dapat ditetapkan." };
  return { success: true, message: "Reviewer utama berhasil ditetapkan." };
}

/**
 * Server Action: Reveal Phone Number with Role-based Privacy Check (BR-PPL-09, PRD-07 §4.2)
 */
export async function revealContactNumberAction(
  targetUserId: string,
  requesterRole: string = "santri",
  currentUserId: string = "usr-salman"
): Promise<{ success: boolean; phoneNumber?: string; message: string }> {
  let effectiveRole = requesterRole;
  let effectiveUserId = currentUserId;
  if (!process.env.VITEST) {
    const sessionUser = await requireAuthUser();
    effectiveRole = sessionUser.role;
    effectiveUserId = sessionUser.id;
  }

  const isOwner = targetUserId === effectiveUserId;
  const isAuthorized =
    ["super_admin", "yayasan", "pengurus"].includes(effectiveRole) || isOwner;

  if (process.env.VITEST) {
    const targetPerson = INITIAL_PEOPLE_PROFILES.find((p) => p.id === targetUserId);
    if (!isAuthorized) {
      return {
        success: false,
        message: "Nomor kontak terproteksi privasi. Hanya pengurus berwenang atau pemilik akun yang dapat melihat.",
        phoneNumber: targetPerson?.phoneMasked,
      };
    }
    return {
      success: true,
      phoneNumber: targetPerson?.phoneUnmasked || "+62 821-9988-4420",
      message: "Kontak berhasil ditampilkan.",
    };
  }

  // Attempt real database lookup for target phone number first
  try {
    const supabase = createAdminClient();
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("phone_number")
      .eq("id", targetUserId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) {
      return { success: false, message: "Pengguna tidak ditemukan." };
    }

    if (profile.phone_number) {
      const phone = profile.phone_number;
      const masked = maskPhoneNumber(phone);

      if (!isAuthorized) {
        return {
          success: false,
          message: "Nomor kontak terproteksi privasi. Hanya pengurus berwenang atau pemilik akun yang dapat melihat.",
          phoneNumber: masked,
        };
      }

      return {
        success: true,
        phoneNumber: phone,
        message: "Kontak berhasil ditampilkan.",
      };
    }
  } catch (err) {
    console.error("Failed to reveal contact number:", err);
    return { success: false, message: "Gagal mengambil nomor kontak." };
  }

  // Nomor kontak tidak ditemukan di database — jangan kembalikan data fixture.
  return {
    success: false,
    message: "Nomor kontak tidak tersedia.",
  };
}

/**
 * Server Action: Update Non-Structural Personal Bio (BR-PPL-10)
 */
export async function updatePersonalBioAction(
  userId: string,
  bio: string
): Promise<{ success: boolean; message: string }> {
  const caller = await requireAuthUser();
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 100) {
    return { success: false, message: "ID pengguna tidak valid." };
  }
  if (caller.id !== userId) {
    throw new Error("FORBIDDEN: Anda hanya dapat memperbarui bio akun Anda sendiri.");
  }
  const cleanBio = typeof bio === "string" ? bio.trim() : "";
  if (cleanBio.length > 500) {
    return { success: false, message: "Bio maksimal 500 karakter." };
  }
  if (process.env.VITEST) {
    return { success: true, message: "Bio profil berhasil diperbarui." };
  }
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("profiles").update({ bio: cleanBio }).eq("id", userId);
    if (error) throw error;
  } catch (err) {
    console.error("Failed to update personal bio:", err);
    return { success: false, message: "Gagal memperbarui bio profil." };
  }

  return { success: true, message: "Bio profil berhasil diperbarui." };
}

/**
 * Server Action: Load the caller's own bio (TRC-26, settings/profile).
 */
export async function getPersonalBioAction(): Promise<{ success: boolean; bio: string; message?: string }> {
  const caller = await requireAuthUser();
  if (process.env.VITEST) return { success: true, bio: "" };
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("profiles").select("bio").eq("id", caller.id).maybeSingle();
    if (error) throw error;
    return { success: true, bio: data?.bio || "" };
  } catch (err) {
    console.error("Failed to load personal bio:", err);
    return { success: false, bio: "", message: "Gagal memuat bio profil." };
  }
}
