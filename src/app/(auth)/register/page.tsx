"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Illustration } from "@/components/ui/illustration";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { submitAccountApplicationAction } from "@/modules/iam/actions";
import { MEMBER_CATEGORIES, REGISTRATION_PRIVACY_NOTICE, REGISTRATION_PRIVACY_VERSION } from "@/modules/iam/registration";

function getPasswordStrength(password: string): { label: string; color: string; level: number } {
  if (password.length === 0) return { label: "", color: "", level: 0 };
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { label: "Lemah", color: "bg-error", level: 1 };
  if (score <= 3) return { label: "Sedang", color: "bg-warning", level: 2 };
  return { label: "Kuat", color: "bg-success", level: 3 };
}

export default function RegisterPage() {
  const [submitted, setSubmitted] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [formData, setFormData] = React.useState({
    fullName: "",
    email: "",
    phone: "",
    claimedMemberType: "santri",
    privacyConsent: false,
    teamName: "Sentra Santri",
    notes: "",
    password: "",
    confirmPassword: "",
    website: "",
  });
  const [passwordError, setPasswordError] = React.useState("");
  const [turnstileToken, setTurnstileToken] = React.useState("");
  const [turnstileResetNonce, setTurnstileResetNonce] = React.useState(0);

  const passwordStrength = getPasswordStrength(formData.password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setErrorMessage("");

    // Client-side password validation
    if (formData.password.length < 10) {
      setPasswordError("Kata sandi minimal 10 karakter.");
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setPasswordError("Konfirmasi kata sandi tidak cocok.");
      return;
    }

    if (isLoading) return;
    if (!formData.privacyConsent) {
      setErrorMessage("Persetujuan kebijakan privasi wajib diberikan sebelum mengajukan akun.");
      return;
    }
    setIsLoading(true);
    try {
      const res = await submitAccountApplicationAction({
        fullName: formData.fullName,
        email: formData.email,
        phoneNumber: formData.phone,
        claimedMemberType: formData.claimedMemberType,
        privacyConsent: formData.privacyConsent,
        privacyConsentVersion: REGISTRATION_PRIVACY_VERSION,
        teamRequested: formData.teamName,
        notes: formData.notes,
        password: formData.password,
        website: formData.website,
        turnstileToken,
      });
      if (res.success) {
        setSubmitted(true);
      } else {
        setErrorMessage(res.message);
        // Reset Turnstile token and re-render the widget so the user must
        // complete a fresh challenge (tokens are single-use server-side).
        setTurnstileToken("");
        setTurnstileResetNonce((n) => n + 1);
      }
    } catch {
      setErrorMessage("Pengajuan belum dapat dikirim. Silakan coba lagi.");
    } finally {
      setIsLoading(false);
    }
  };

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full flex flex-col lg:flex-row items-center justify-center gap-12 max-w-4xl">
        {/* Decorative side illustration — desktop only, hidden after success */}
        {!submitted && (
          <div className="hidden lg:flex flex-col items-center justify-center gap-4 shrink-0" aria-hidden="true">
            <Illustration
              src="/illustrations/undraw_profile_9xdn.svg"
              alt=""
              width={220}
              height={125}
            />
            <p className="text-sm text-muted-foreground text-center max-w-[220px] leading-relaxed">
              Daftarkan akun Anda dan mulai bergabung dengan komunitas IDAROH.
            </p>
          </div>
        )}

        {/* Registration card */}
        <div className="w-full max-w-lg bg-card rounded-2xl border border-border p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center text-white font-bold text-xl shadow-sm mb-3">
              P
            </div>
            <h2 className="font-headline-sm text-[22px] text-on-surface font-bold">
              Pengajuan Akun IDAROH
            </h2>
            <p className="font-body-sm text-[13px] text-muted-foreground mt-1">
              Semua pengajuan akun diverifikasi pengurus. Kategori yang dipilih tidak memberikan hak akses secara otomatis.
            </p>
          </div>

          {errorMessage && (
            <div role="alert" className="mb-4 p-3 rounded-xl bg-error/15 border border-error/30 text-error text-[13px] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {submitted ? (
            <div className="flex flex-col items-center text-center py-4 space-y-4">
              <Illustration
                src="/illustrations/undraw_mail-sent_dagx.svg"
                alt="Pengajuan Berhasil Dikirim"
                width={130}
                height={90}
              />
              <div>
                <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                  Pengajuan Berhasil Dikirim
                </h3>
                <p className="font-body-sm text-body-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                  Permohonan akun Anda telah masuk ke antrean verifikasi IAM. Periksa email dan buka tautan konfirmasi terlebih dahulu; setelah itu administrator pondok akan meninjau dan mengaktifkan akun Anda.
                </p>
              </div>
              <Link href="/login" className="w-full pt-2">
                <Button variant="primary" size="lg" className="w-full">
                  Kembali ke Halaman Masuk
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
              {/* Honeypot: hidden from users but present for bots. Autofill
                  resistances (randomized-looking name exceptions, ignore
                  hints, non-focusable, off-screen) stop password managers
                  from populating it and rejecting real registrations. */}
              <input
                aria-hidden="true"
                tabIndex={-1}
                name="website"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                readOnly
                onFocus={(e) => e.target.blur()}
                className="pointer-events-none absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden opacity-0"
              />
              <Input
                label="Nama Lengkap"
                type="text"
                placeholder="Contoh: Ahmad Zaki"
                value={formData.fullName}
                onChange={(e) =>
                  setFormData({ ...formData, fullName: e.target.value })
                }
                required
              />

              <Input
                label="Alamat Email"
                type="email"
                placeholder="nama@email.com"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                required
              />

              <Input
                label="Nomor WhatsApp"
                type="tel"
                placeholder="08123456789"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                required
              />

              {/* Password field */}
              <div className="space-y-1.5">
                <Input
                  label="Kata Sandi"
                  type="password"
                  placeholder="Minimal 10 karakter"
                  value={formData.password}
                  onChange={(e) => {
                    setFormData({ ...formData, password: e.target.value });
                    setPasswordError("");
                  }}
                  required
                />
                {/* Password strength indicator */}
                {formData.password.length > 0 && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="flex gap-1 flex-1">
                      {[1, 2, 3].map((level) => (
                        <div
                          key={level}
                          className={`h-1 flex-1 rounded-full transition-all ${
                            passwordStrength.level >= level
                              ? passwordStrength.color
                              : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                    <span
                      className={`font-label-sm text-[11px] font-semibold ${
                        passwordStrength.level === 1
                          ? "text-error"
                          : passwordStrength.level === 2
                          ? "text-tertiary"
                          : "text-success"
                      }`}
                    >
                      {passwordStrength.label}
                    </span>
                  </div>
                )}
              </div>

              {/* Confirm Password field */}
              <div className="space-y-1">
                <Input
                  label="Konfirmasi Kata Sandi"
                  type="password"
                  placeholder="Ulangi kata sandi"
                  value={formData.confirmPassword}
                  onChange={(e) => {
                    setFormData({ ...formData, confirmPassword: e.target.value });
                    setPasswordError("");
                  }}
                  required
                />
                {passwordError && (
                  <p className="text-error text-[12px] flex items-center gap-1 mt-0.5">
                    <span className="material-symbols-outlined text-[14px]">error</span>
                    {passwordError}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="claimed-member-type" className="font-label-sm text-label-sm text-on-surface block">
                    Kategori Keanggotaan
                  </label>
                  <select
                    id="claimed-member-type"
                    value={formData.claimedMemberType}
                    onChange={(e) =>
                      setFormData({ ...formData, claimedMemberType: e.target.value })
                    }
                    aria-describedby="membership-claim-help"
                    required
                    className="w-full h-11 px-3 rounded-xl bg-surface-container text-on-surface font-body-md text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {MEMBER_CATEGORIES.map((category) => (
                      <option key={category.value} value={category.value}>{category.label}</option>
                    ))}
                  </select>
                  <p id="membership-claim-help" className="text-xs text-muted-foreground">Sebagai klaim saja; peran dan hak akses ditetapkan admin.</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="requested-team" className="font-label-sm text-label-sm text-on-surface block">
                    Tim / Sentra yang Dituju
                  </label>
                  <input
                    id="requested-team"
                    type="text"
                    placeholder="Contoh: Tim Media / IT"
                    value={formData.teamName}
                    onChange={(e) =>
                      setFormData({ ...formData, teamName: e.target.value })
                    }
                    className="w-full h-11 px-3 rounded-xl bg-surface-container text-on-surface font-body-md text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="application-notes" className="font-label-sm text-label-sm text-on-surface block">
                  Catatan Permohonan (Opsional)
                </label>
                <textarea
                  id="application-notes"
                  maxLength={500}
                  rows={2}
                  placeholder="Alasan pendaftaran atau rekomendasi ustadz..."
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  className="w-full p-3 rounded-xl bg-surface-container text-on-surface font-body-md text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <section aria-label="Persetujuan privasi" className="rounded-xl border border-border p-3 space-y-3">
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    Kebijakan privasi pendaftaran
                  </summary>
                  <div id="registration-privacy-notice" className="pt-2 space-y-2 text-xs text-muted-foreground leading-relaxed">
                    <p>Versi {REGISTRATION_PRIVACY_VERSION}</p>
                    {REGISTRATION_PRIVACY_NOTICE.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                </details>
                <label htmlFor="privacy-consent" className="flex min-h-11 items-start gap-3 py-2 text-sm text-on-surface cursor-pointer">
                  <input
                    id="privacy-consent"
                    type="checkbox"
                    required
                    checked={formData.privacyConsent}
                    onChange={(e) => setFormData({ ...formData, privacyConsent: e.target.checked })}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  />
                  <span>Saya telah membaca dan menyetujui kebijakan privasi pendaftaran versi {REGISTRATION_PRIVACY_VERSION}.</span>
                </label>
              </section>

              {/* Turnstile bot-protection widget (SEC-11 + TRC-01) */}
              {siteKey && (
                <div className="flex justify-center py-1">
                  <TurnstileWidget
                    siteKey={siteKey}
                    onToken={setTurnstileToken}
                    onExpire={() => setTurnstileToken("")}
                    onError={() => setTurnstileToken("")}
                    onScriptError={() => setTurnstileToken("")}
                    resetNonce={turnstileResetNonce}
                  />
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full mt-2"
                disabled={isLoading}
              >
                {isLoading ? "Mengirimkan Permohonan..." : "Kirim Pengajuan Akun"}
              </Button>

              <div className="pt-4 border-t border-border text-center">
                <p className="font-body-sm text-[13px] text-muted-foreground">
                  Sudah memiliki akun?{" "}
                  <Link
                    href="/login"
                    className="text-primary font-semibold hover:underline"
                  >
                    Masuk ke Sistem
                  </Link>
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
