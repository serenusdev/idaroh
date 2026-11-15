"use client";

import * as React from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useIdentity } from "@/components/auth/identity-context";
import {
  getAttendanceReminderPreferenceAction,
  updateAttendanceReminderPreferenceAction,
} from "@/modules/notifications/actions";
import {
  getPersonalBioAction,
  updatePersonalBioAction,
} from "@/modules/people/actions";
import {
  updateProfileAction,
  uploadAvatarAction,
  deleteAvatarAction,
  changePasswordAction,
  listMfaFactorsAction,
  enrollMfaAction,
  verifyMfaAction,
  unenrollMfaAction,
  type MfaFactorItem,
} from "@/modules/iam/actions";

function AttendanceReminderSettings() {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
  const saving = React.useRef(false);

  React.useEffect(() => {
    let active = true;
    setIsLoading(true);
    setEnabled(null);
    setMessage(null);
    const load = async () => {
      try {
        const result = await getAttendanceReminderPreferenceAction();
        if (!active) return;
        if (result.success) setEnabled(result.enabled);
        else setMessage({ type: "error", text: result.message });
      } catch {
        if (active) setMessage({ type: "error", text: "Gagal memuat pengingat presensi. Silakan coba lagi." });
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [retry]);

  const save = async (nextEnabled: boolean) => {
    if (enabled === null || saving.current) return;
    saving.current = true;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await updateAttendanceReminderPreferenceAction(nextEnabled);
      if (result.success) setEnabled(result.enabled);
      setMessage({ type: result.success ? "success" : "error", text: result.message });
    } catch {
      setMessage({ type: "error", text: "Gagal menyimpan pengingat presensi. Silakan coba lagi." });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return (
    <section aria-labelledby="attendance-reminder-heading" className="bg-card rounded-2xl border border-border p-5 sm:p-6 shadow-xs space-y-4">
      <div>
        <h2 id="attendance-reminder-heading" className="font-label-md text-[15px] font-semibold text-on-surface">Pengingat Presensi</h2>
        <p id="attendance-reminder-description" className="text-[13px] text-muted-foreground mt-1">
          Pengingat untuk check-in kehadiran. Pengingat laporan dan notifikasi lainnya tidak berubah.
        </p>
      </div>
      {isLoading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoadingSpinner size="sm" /> Memuat pengaturan pengingat presensi...</p>
      ) : enabled !== null ? (
        <label className={`flex min-h-11 items-center justify-between gap-4 ${isSaving ? "cursor-wait" : "cursor-pointer"}`}>
          <span className="text-sm text-on-surface">Aktifkan pengingat presensi</span>
          <span className="relative inline-flex shrink-0">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={isSaving}
              onChange={(event) => { void save(event.target.checked); }}
              aria-describedby="attendance-reminder-description"
              className="peer sr-only"
            />
            <span aria-hidden="true" className="h-6 w-11 rounded-full bg-surface-container-high border border-border transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-disabled:opacity-50" />
            <span aria-hidden="true" className="absolute left-1 top-1 h-4 w-4 rounded-full bg-on-surface transition-transform peer-checked:translate-x-5 peer-checked:bg-on-primary peer-disabled:opacity-50" />
          </span>
        </label>
      ) : (
        <button type="button" onClick={() => setRetry((value) => value + 1)} className="h-11 px-4 rounded-xl border border-border text-sm text-on-surface hover:bg-muted">Coba lagi</button>
      )}
      {isSaving && <p role="status" className="text-sm text-muted-foreground">Menyimpan pengingat presensi...</p>}
      {message && <p role={message.type === "error" ? "alert" : "status"} className={`text-sm ${message.type === "success" ? "text-success" : "text-error"}`}>{message.text}</p>}
    </section>
  );
}

function PersonalBioSettings({ userId }: { userId: string }) {
  const [bio, setBio] = React.useState("");
  const [savedBio, setSavedBio] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    setIsLoading(true);
    getPersonalBioAction()
      .then((result) => {
        if (!active) return;
        if (result.success) {
          setBio(result.bio);
          setSavedBio(result.bio);
        } else {
          setMessage({ type: "error", text: result.message || "Gagal memuat bio profil." });
        }
      })
      .catch(() => { if (active) setMessage({ type: "error", text: "Gagal memuat bio profil." }); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [userId]);

  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await updatePersonalBioAction(userId, bio);
      setMessage({ type: result.success ? "success" : "error", text: result.message });
      if (result.success) setSavedBio(bio.trim());
    } catch {
      setMessage({ type: "error", text: "Gagal menyimpan bio profil." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-labelledby="personal-bio-heading" className="bg-card rounded-2xl border border-border p-5 sm:p-6 shadow-xs space-y-4">
      <div>
        <h2 id="personal-bio-heading" className="font-label-md text-[15px] font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">badge</span>
          Bio Singkat
        </h2>
        <p className="text-[13px] text-muted-foreground mt-1">
          Bio non-struktural yang tampil di direktori anggota (BR-PPL-10). Maksimal 500 karakter.
        </p>
      </div>
      {isLoading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoadingSpinner size="sm" /> Memuat bio...</p>
      ) : (
        <>
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={500}
            rows={3}
            aria-label="Bio singkat"
            placeholder="Contoh: Santri backend developer & penggiat open-source."
            className="w-full p-3 rounded-xl bg-surface-container text-on-surface text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">{bio.length}/500</span>
            <button
              type="button"
              onClick={() => { void save(); }}
              disabled={isSaving || bio.trim() === savedBio}
              className="h-10 px-4 rounded-xl bg-primary text-on-primary text-sm font-semibold disabled:opacity-50"
            >
              {isSaving ? "Menyimpan..." : "Simpan Bio"}
            </button>
          </div>
        </>
      )}
      {message && <p role={message.type === "error" ? "alert" : "status"} className={`text-sm ${message.type === "success" ? "text-success" : "text-error"}`}>{message.text}</p>}
    </section>
  );
}

export default function ProfileSettingsPage() {
  const { user: currentUser } = useIdentity();

  // Profile form
  const [fullName, setFullName] = React.useState(currentUser.full_name || "");
  const [phoneNumber, setPhoneNumber] = React.useState(currentUser.phone_number || "");
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(currentUser.avatar_url || null);
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = React.useState(false);
  const [profileMsg, setProfileMsg] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  // Track unsaved changes (UX-20)
  const savedFullName = currentUser.full_name || "";
  const savedPhone = currentUser.phone_number || "";
  const hasUnsavedProfileChanges = fullName !== savedFullName || phoneNumber !== savedPhone || !!avatarFile;

  // Password form
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isChangingPassword, setIsChangingPassword] = React.useState(false);
  const [passwordMsg, setPasswordMsg] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
  const [mfaFactors, setMfaFactors] = React.useState<MfaFactorItem[]>([]);
  const [mfaSetup, setMfaSetup] = React.useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = React.useState("");
  const [mfaMsg, setMfaMsg] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    listMfaFactorsAction().then(setMfaFactors).catch(() => setMfaFactors([]));
  }, []);

  const handleEnrollMfa = async () => {
    setMfaMsg(null);
    const result = await enrollMfaAction();
    if (result.success && result.data) setMfaSetup(result.data);
    setMfaMsg({ type: result.success ? "success" : "error", text: result.message });
  };

  const handleVerifyMfa = async () => {
    if (!mfaSetup) return;
    const result = await verifyMfaAction(mfaSetup.factorId, mfaCode);
    setMfaMsg({ type: result.success ? "success" : "error", text: result.message });
    if (result.success) {
      setMfaSetup(null);
      setMfaCode("");
      setMfaFactors(await listMfaFactorsAction());
    }
  };

  const handleUnenrollMfa = async (factorId: string) => {
    const result = await unenrollMfaAction(factorId);
    setMfaMsg({ type: result.success ? "success" : "error", text: result.message });
    if (result.success) setMfaFactors(await listMfaFactorsAction());
  };

  // Warn before unload when there are unsaved changes (UX-20)
  React.useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedProfileChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedProfileChanges]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setAvatarFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setAvatarPreview(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setIsSavingProfile(true);

    let finalAvatarUrl = avatarUrl || undefined;
    let uploadedStoragePath: string | undefined;
    try {
      if (avatarFile) {
        const fd = new FormData();
        fd.append("avatar", avatarFile);
        const uploadRes = await uploadAvatarAction(fd);
        if (!uploadRes.success || !uploadRes.data) {
          setProfileMsg({ type: "error", text: uploadRes.message });
          return;
        }
        finalAvatarUrl = uploadRes.data.avatarUrl;
        uploadedStoragePath = uploadRes.data.storagePath;
      }

      const res = await updateProfileAction({ fullName, phoneNumber, avatarUrl: finalAvatarUrl });
      if (!res.success) {
        if (uploadedStoragePath) await deleteAvatarAction(uploadedStoragePath);
        setProfileMsg({ type: "error", text: res.message });
        return;
      }

      setAvatarUrl(finalAvatarUrl || null);
      setAvatarPreview(null);
      setAvatarFile(null);
      setProfileMsg({ type: "success", text: res.message });
    } catch (error) {
      if (uploadedStoragePath) await deleteAvatarAction(uploadedStoragePath);
      setProfileMsg({ type: "error", text: error instanceof Error ? error.message : "Gagal menyimpan profil." });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword.length < 8) {
      setPasswordMsg({ type: "error", text: "Kata sandi minimal 8 karakter." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Konfirmasi kata sandi tidak cocok." });
      return;
    }

    setIsChangingPassword(true);
    const res = await changePasswordAction(currentPassword, newPassword);
    setPasswordMsg({ type: res.success ? "success" : "error", text: res.message });
    if (res.success) {
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
    }
    setIsChangingPassword(false);
  };

  const displayAvatar = avatarPreview || avatarUrl;
  const initials = fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "?";

  return (
    <div className="w-full max-w-2xl mx-auto pb-12 space-y-6">
      {/* Breadcrumb (UX-17) */}
      <Breadcrumb
        items={[
          { label: "Beranda", href: "/" },
          { label: "Pengaturan Profil" },
        ]}
        className="mb-2"
      />

      {/* Page header */}
      <div>
        <h1 className="font-headline-sm text-[22px] font-bold text-on-surface tracking-tight">
          Pengaturan Profil
        </h1>
        <p className="font-body-sm text-[13px] text-muted-foreground mt-0.5">
          Kelola informasi profil dan keamanan akun Anda.
        </p>
      </div>

      {/* Profile Form */}
      <div className="bg-card rounded-2xl border border-border p-5 sm:p-6 shadow-xs space-y-5">
        <h2 className="font-label-md text-[15px] font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">person</span>
          Informasi Profil
        </h2>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          {/* Avatar upload */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-primary font-bold text-xl overflow-hidden shrink-0">
              {displayAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayAvatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="h-9 px-3 rounded-lg bg-surface-container border border-border text-on-surface font-label-sm text-[13px] flex items-center gap-1.5 cursor-pointer hover:bg-muted transition-colors">
                <span className="material-symbols-outlined text-[16px]">upload</span>
                <span>Unggah Foto</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={handleAvatarChange}
                />
              </label>
              <p className="font-body-sm text-[11px] text-muted-foreground">JPEG, PNG, WebP — maks. 2MB</p>
            </div>
          </div>

          {/* Full name */}
          <div className="space-y-1.5">
            <label htmlFor="profile-full-name" className="font-label-sm text-label-sm text-on-surface block">Nama Lengkap</label>
            <input
              id="profile-full-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full h-11 px-3 rounded-xl bg-surface-container text-on-surface text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Phone number */}
          <div className="space-y-1.5">
            <label htmlFor="profile-phone" className="font-label-sm text-label-sm text-on-surface block">Nomor Telepon</label>
            <input
              id="profile-phone"
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="08xxxxxxxxxx"
              className="w-full h-11 px-3 rounded-xl bg-surface-container text-on-surface text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Read-only fields */}
          <div className="space-y-1.5">
            <label htmlFor="profile-email" className="font-label-sm text-label-sm text-muted-foreground block">Email (tidak dapat diubah)</label>
            <input
              id="profile-email"
              type="email"
              value={currentUser.email}
              readOnly
              disabled
              className="w-full h-11 px-3 rounded-xl bg-muted text-muted-foreground text-sm border border-border cursor-not-allowed"
            />
          </div>

          {profileMsg && (
            <div
              className={`p-3 rounded-xl text-[13px] flex items-center gap-2 ${
                profileMsg.type === "success"
                  ? "bg-success/15 text-success border border-success/30"
                  : "bg-error/15 text-error border border-error/30"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {profileMsg.type === "success" ? "check_circle" : "error"}
              </span>
              {profileMsg.text}
            </div>
          )}

          {/* Unsaved changes indicator (UX-20) */}
          {hasUnsavedProfileChanges && (
            <div className="flex items-center gap-2 text-xs text-tertiary bg-tertiary/10 border border-tertiary/20 rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-[15px]">edit</span>
              <span>Ada perubahan yang belum disimpan</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSavingProfile}
            className="h-11 px-6 rounded-xl bg-primary text-on-primary font-label-md text-sm font-semibold flex items-center gap-2 shadow-xs hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isSavingProfile ? (
              <>
                <LoadingSpinner size="sm" />
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">save</span>
                <span>Simpan Perubahan</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Keyed by the resolved identity so another account never sees stale preferences. */}
      <PersonalBioSettings key={`bio-${currentUser.id}`} userId={currentUser.id} />
      <AttendanceReminderSettings key={currentUser.id} />

      {/* Password Change */}
      <div className="bg-card rounded-2xl border border-border p-5 sm:p-6 shadow-xs space-y-5">
        <h2 className="font-label-md text-[15px] font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">lock</span>
          Ubah Kata Sandi
        </h2>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="profile-current-password" className="font-label-sm text-label-sm text-on-surface block">Kata Sandi Lama</label>
            <input
              id="profile-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Masukkan kata sandi saat ini"
              autoComplete="current-password"
              required
              className="w-full h-11 px-3 rounded-xl bg-surface-container text-on-surface text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="profile-new-password" className="font-label-sm text-label-sm text-on-surface block">Kata Sandi Baru</label>
            <input
              id="profile-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              required
              className="w-full h-11 px-3 rounded-xl bg-surface-container text-on-surface text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="profile-confirm-password" className="font-label-sm text-label-sm text-on-surface block">Konfirmasi Kata Sandi</label>
            <input
              id="profile-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Ulangi kata sandi baru"
              required
              className="w-full h-11 px-3 rounded-xl bg-surface-container text-on-surface text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {passwordMsg && (
            <div
              className={`p-3 rounded-xl text-[13px] flex items-center gap-2 ${
                passwordMsg.type === "success"
                  ? "bg-success/15 text-success border border-success/30"
                  : "bg-error/15 text-error border border-error/30"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {passwordMsg.type === "success" ? "check_circle" : "error"}
              </span>
              {passwordMsg.text}
            </div>
          )}

          <button
            type="submit"
            disabled={isChangingPassword}
            className="h-11 px-6 rounded-xl bg-surface-container border border-border text-on-surface font-label-md text-sm font-semibold flex items-center gap-2 hover:bg-muted transition-colors disabled:opacity-50"
          >
            {isChangingPassword ? (
              <>
                <LoadingSpinner size="sm" />
                <span>Memperbarui...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">lock_reset</span>
                <span>Perbarui Kata Sandi</span>
              </>
            )}
          </button>
        </form>
      </div>

      <div className="bg-card rounded-2xl border border-border p-5 sm:p-6 shadow-xs space-y-5">
        <div>
          <h2 className="font-label-md text-[15px] font-semibold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[18px]">phonelink_lock</span>
            Verifikasi Dua Langkah (MFA)
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1">Lindungi akun dengan aplikasi authenticator berbasis TOTP.</p>
        </div>
        {mfaFactors.filter((factor) => factor.status === "verified").length > 0 ? (
          <div className="space-y-2">
            {mfaFactors.filter((factor) => factor.status === "verified").map((factor) => (
              <div key={factor.id} className="flex items-center justify-between rounded-xl bg-success/10 border border-success/30 p-3">
                <span className="text-sm font-semibold text-success">{factor.friendlyName} aktif</span>
                <button type="button" onClick={() => handleUnenrollMfa(factor.id)} className="text-xs font-semibold text-error hover:underline">Cabut</button>
              </div>
            ))}
          </div>
        ) : !mfaSetup ? (
          <button type="button" onClick={handleEnrollMfa} className="h-10 px-4 rounded-xl bg-primary text-on-primary text-sm font-semibold">Aktifkan MFA</button>
        ) : (
          <div className="space-y-3 rounded-xl bg-surface-container-low p-4">
            {mfaSetup.qrCode && (
              // Supabase returns the QR as an inline SVG data URL; next/image cannot optimize it.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mfaSetup.qrCode} alt="QR code MFA" className="w-44 h-44 mx-auto bg-white p-2 rounded-lg" />
            )}
            <p className="text-xs text-muted-foreground">Secret manual: <code className="font-mono text-on-surface">{mfaSetup.secret}</code></p>
            <input value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" maxLength={6} placeholder="Kode 6 angka" className="w-full h-10 px-3 rounded-lg bg-card border border-border text-sm" />
            <button type="button" onClick={handleVerifyMfa} className="h-10 px-4 rounded-xl bg-primary text-on-primary text-sm font-semibold">Verifikasi MFA</button>
          </div>
        )}
        {mfaMsg && <p className={`text-xs ${mfaMsg.type === "success" ? "text-success" : "text-error"}`}>{mfaMsg.text}</p>}
      </div>
    </div>
  );
}
