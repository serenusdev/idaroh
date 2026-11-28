import { describe, it, expect, vi, afterEach } from "vitest";
import { friendlyActionError } from "@/lib/action-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("friendlyActionError (UX-07)", () => {
  it("memetakan error unique constraint Supabase ke pesan ramah", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = friendlyActionError(
      new Error('duplicate key value violates unique constraint "account_requests_email_key"'),
      "Gagal menyimpan.",
    );
    expect(msg).toBe("Data sudah ada. Periksa kembali isian Anda.");
  });

  it("memetakan error RLS ke pesan akses", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = friendlyActionError(
      new Error("new row violates row-level security policy for table \"reports\""),
      "Gagal.",
    );
    expect(msg).toBe("Anda tidak memiliki akses untuk tindakan ini.");
  });

  it("memetakan error sesi/JWT ke pesan masuk kembali", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = friendlyActionError(new Error("JWT expired"), "Gagal.");
    expect(msg).toBe("Sesi Anda telah berakhir. Silakan masuk kembali.");
  });

  it("memetakan error jaringan ke pesan koneksi", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = friendlyActionError(new Error("fetch failed"), "Gagal.");
    expect(msg).toBe("Koneksi ke server bermasalah. Silakan coba lagi.");
  });

  it("memetakan error TOTP/MFA ke pesan kode tidak valid", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = friendlyActionError(new Error("Invalid TOTP code"), "Kode MFA tidak valid.");
    expect(msg).toBe("Kode MFA tidak valid atau kedaluwarsa.");
  });

  it("meneruskan pesan Indonesia yang disengaja (bukan teknis)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = friendlyActionError(
      new Error("Anda tidak dapat mereview koreksi Anda sendiri."),
      "Gagal.",
    );
    expect(msg).toBe("Anda tidak dapat mereview koreksi Anda sendiri.");
  });

  it("mengembalikan fallback untuk error teknis tak dikenal", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = friendlyActionError(
      new Error('column "foo" of relation "bar" does not exist'),
      "Gagal menyimpan data.",
    );
    expect(msg).toBe("Gagal menyimpan data.");
  });

  it("mengembalikan fallback bila error kosong", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(friendlyActionError(null, "Fallback.")).toBe("Fallback.");
    expect(friendlyActionError(new Error(""), "Fallback.")).toBe("Fallback.");
  });

  it("mengekstrak pesan dari objek error Supabase tanpa menghasilkan [object Object]", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(friendlyActionError({ message: "ALREADY_CHECKED_IN_TODAY" }, "Fallback.")).toBe("ALREADY_CHECKED_IN_TODAY");
    expect(friendlyActionError({ error: { message: "Sesi tidak valid." } }, "Fallback.")).toBe("Sesi tidak valid.");
    expect(friendlyActionError({ code: "23514", details: "attendance_records constraint" }, "Fallback.")).toBe("Fallback.");
  });
});
