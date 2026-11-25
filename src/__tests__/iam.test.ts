import { describe, it, expect } from "vitest";
import {
  approveAccountApplicationAction,
  rejectAccountApplicationAction,
  createManualAccountAction,
  resetUserSessionAction,
  deleteAvatarAction,
  updateProfileAction,
  adminUpdateUserAction,
} from "@/modules/iam/actions";

describe("Stage 2 — Identity & Access Management (IAM)", () => {
  it("approves account application with specified role per BR-IAM-01", async () => {
    const result = await approveAccountApplicationAction("applicant-card-1", "Santri • Sentra Digitalpreneur");
    expect(result.success).toBe(true);
    expect(result.message).toContain("berhasil disetujui");
    expect(result.message).toContain("Santri • Sentra Digitalpreneur");
  });

  it("requires rejection reason when rejecting account per BR-IAM-02", async () => {
    const emptyReasonResult = await rejectAccountApplicationAction("applicant-card-1", "   ");
    expect(emptyReasonResult.success).toBe(false);
    expect(emptyReasonResult.message).toContain("Alasan penolakan wajib diisi");

    const validReasonResult = await rejectAccountApplicationAction("applicant-card-1", "Penempatan belum sesuai kuota");
    expect(validReasonResult.success).toBe(true);
    expect(validReasonResult.message).toContain("telah ditolak");
  });

  it("creates manual account directly into active state (Pathway B Admin)", async () => {
    const payload = {
      fullName: "Bilal bin Rabah",
      email: "bilal@pondok.id",
      phone: "081234567890",
      role: "santri" as const,
      teamName: "Sentra Digitalpreneur",
    };
    const result = await createManualAccountAction(payload);
    expect(result.success).toBe(true);
    expect(result.message).toContain("berhasil dibuat dan langsung berstatus aktif");
  });

  it("revokes user session securely", async () => {
    const result = await resetUserSessionAction("usr-salman");
    expect(result.success).toBe(true);
    expect(result.message).toContain("berhasil dicabut");
  });

  it("prevents IDOR on deleteAvatarAction when path does not belong to caller (F-03)", async () => {
    const result = await deleteAvatarAction("victim-user-999/avatar.png");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Akses ditolak");
  });

  it("rejects path traversal attempts on deleteAvatarAction (F-03)", async () => {
    const result = await deleteAvatarAction("usr-santri-001/../other/avatar.png");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Akses ditolak");
  });

  it("rejects external or unverified avatar URLs on updateProfileAction (F-12)", async () => {
    const result = await updateProfileAction({
      fullName: "Salman Al-Farisi",
      phoneNumber: "081234567890",
      avatarUrl: "https://malicious-site.com/track.png",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("URL avatar tidak valid");
  });

  describe("adminUpdateUserAction (F-04 & F-13)", () => {
    it("rejects empty userId", async () => {
      const result = await adminUpdateUserAction("", { fullName: "Ahmad" });
      expect(result.success).toBe(false);
      expect(result.message).toContain("User ID tidak valid");
    });

    it("rejects empty or single-character full_name", async () => {
      const result = await adminUpdateUserAction("mock-test-01", { fullName: "A" });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Nama lengkap minimal 2 karakter");
    });

    it("rejects invalid status", async () => {
      const result = await adminUpdateUserAction("mock-test-01", { status: "hacked_status" });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Status akun tidak valid");
    });

    it("refuses a role outside the assignable set rather than comparing hierarchies", async () => {
      const superAdmin = await adminUpdateUserAction("mock-test-01", { roleKey: "super_admin" });
      expect(superAdmin.success).toBe(false);
      expect(superAdmin.message).toContain("Peran baru tidak valid");

      // "ustadz" is a category, not a role (§2 rule 1), so it can never be granted here.
      const category = await adminUpdateUserAction("mock-test-01", { roleKey: "ustadz" });
      expect(category.success).toBe(false);
      expect(category.message).toContain("Peran baru tidak valid");
    });

    it("refuses a member category outside the registration domain", async () => {
      const result = await adminUpdateUserAction("mock-test-01", { memberType: "makhdum" });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Kategori anggota tidak valid");
    });

    it("applies an update on a member account", async () => {
      const result = await adminUpdateUserAction("mock-test-santri", {
        fullName: "Ahmad Dahlan",
        phoneNumber: "08123456789",
        status: "active",
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain("berhasil diperbarui");
    });
  });
});

