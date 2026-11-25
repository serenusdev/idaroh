import { describe, it, expect } from "vitest";
import {
  setTeamCoordinatorAction,
  revealContactNumberAction,
  updatePersonalBioAction,
} from "@/modules/people/actions";
import {
  PEOPLE_STATS,
  INITIAL_PEOPLE_PROFILES,
  INITIAL_TEAMS,
} from "@/modules/people/data";

describe("Stage 8 — People & Teams (PRD-07)", () => {
  it("atomically sets team coordinator per PRD-07 §4.3", async () => {
    const res = await setTeamCoordinatorAction(
      "team-1",
      "usr-salman",
      "Salman Al-Farisi"
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("berhasil ditetapkan sebagai Koordinator Tim");
  });

  it("enforces phone number privacy access control (BR-PPL-09, PRD-07 §4.2)", async () => {
    // 1. Owner can see own phone number
    const ownerRes = await revealContactNumberAction(
      "usr-salman",
      "santri",
      "usr-salman"
    );
    expect(ownerRes.success).toBe(true);
    expect(ownerRes.phoneNumber).not.toContain("•••");

    // 2. Pengurus/admin can see any member's phone number
    const adminRes = await revealContactNumberAction(
      "usr-fikri",
      "pengurus",
      "usr-fauzi"
    );
    expect(adminRes.success).toBe(true);
    expect(adminRes.phoneNumber).toBe("+62 821-9988-4420");

    // 3. Unauthorized third-party santri cannot see other member's unmasked phone
    const unauthorizedRes = await revealContactNumberAction(
      "usr-fikri",
      "santri",
      "usr-salman"
    );
    expect(unauthorizedRes.success).toBe(false);
    expect(unauthorizedRes.message).toContain("terproteksi privasi");
    expect(unauthorizedRes.phoneNumber).toContain("•••");
  });

  it("allows updating non-structural bio per BR-PPL-10", async () => {
    // §3.7 people.profile.update_self: the test identity is usr-santri-001, so that is the
    // only id this action accepts.
    const res = await updatePersonalBioAction(
      "usr-santri-001",
      "Santri Backend Developer & Penggiat open-source."
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("berhasil diperbarui");
  });

  it("refuses to write the bio of another account per BR-PPL-10", async () => {
    await expect(updatePersonalBioAction("usr-salman", "Bio orang lain")).rejects.toThrow(
      "FORBIDDEN"
    );
  });

  it("rejects bio longer than 500 characters and invalid user id (TRC-26)", async () => {
    const tooLong = await updatePersonalBioAction("usr-santri-001", "x".repeat(501));
    expect(tooLong.success).toBe(false);
    expect(tooLong.message).toContain("500");

    const invalidId = await updatePersonalBioAction("", "bio");
    expect(invalidId.success).toBe(false);
  });

  it("verifies consistency of people statistics and team hierarchy", () => {
    expect(PEOPLE_STATS.totalActiveMembers).toBe(38);
    expect(PEOPLE_STATS.totalTeams).toBe(4);
    expect(PEOPLE_STATS.santriCount).toBe(28);

    expect(INITIAL_PEOPLE_PROFILES.length).toBe(4);
    const salman = INITIAL_PEOPLE_PROFILES.find((p) => p.isCurrentUser);
    expect(salman).toBeDefined();
    expect(salman?.name).toBe("Salman Al-Farisi");
    expect(salman?.dutyFlags.attendanceRequired).toBe(true);

    expect(INITIAL_TEAMS).toHaveLength(4);
    const digitalTeam = INITIAL_TEAMS.find((t) => t.slug === "sentra-digital");
    expect(digitalTeam?.coordinatorName).toBe("Salman Al-Farisi");
    expect(digitalTeam?.memberCount).toBe(12);
  });
});

