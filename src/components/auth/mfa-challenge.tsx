"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Illustration } from "@/components/ui/illustration";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { createClient } from "@/lib/supabase/client";
import { cleanupPushNotifications } from "@/lib/notifications";
import { listMfaFactorsAction, enrollMfaAction, verifyMfaAction } from "@/modules/iam/actions";

export interface MfaChallengeProps {
  mode: "challenge" | "enroll";
  next: string | null;
  email: string;
}

export function MfaChallenge({ mode, next, email }: MfaChallengeProps) {
  const router = useRouter();
  const [factorId, setFactorId] = React.useState<string | null>(null);
  const [setup, setSetup] = React.useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [loadingFactors, setLoadingFactors] = React.useState(mode === "challenge");
  const [busy, setBusy] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  const destination = next || "/";

  React.useEffect(() => {
    if (mode !== "challenge") return;
    let active = true;
    setLoadingFactors(true);
    listMfaFactorsAction()
      .then((factors) => {
        if (!active) return;
        const verified = factors.find((factor) => factor.status === "verified");
        if (verified) setFactorId(verified.id);
        else setMessage({ type: "error", text: "Faktor MFA terverifikasi tidak ditemukan. Hubungi administrator." });
      })
      .catch(() => {
        if (active) setMessage({ type: "error", text: "Gagal memuat faktor MFA. Silakan coba lagi." });
      })
      .finally(() => {
        if (active) setLoadingFactors(false);
      });
    return () => {
      active = false;
    };
  }, [mode]);

  const handleEnroll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enrollMfaAction();
      if (result.success && result.data) {
        setSetup(result.data);
        setFactorId(result.data.factorId);
        setMessage({ type: "success", text: result.message });
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch {
      setMessage({ type: "error", text: "Gagal memulai enrollment MFA." });
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    const id = setup?.factorId ?? factorId;
    if (!id || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await verifyMfaAction(id, code);
      if (result.success) {
        setMessage({ type: "success", text: "Verifikasi berhasil. Mengalihkan..." });
        window.location.assign(destination);
        return;
      }
      setMessage({ type: "error", text: result.message });
      setCode("");
    } catch {
      setMessage({ type: "error", text: "Gagal memverifikasi kode MFA." });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setSigningOut(true);
    setMessage(null);
    try {
      await cleanupPushNotifications();
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      router.replace("/login");
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "Gagal keluar dari akun. Silakan coba lagi." });
    } finally {
      setSigningOut(false);
    }
  };

  const showEnroll = mode === "enroll" && !setup;
  const showVerify = Boolean(setup) || (mode === "challenge" && Boolean(factorId));

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-5 bg-background px-4 py-8 text-center">
      <Illustration src="/illustrations/undraw_protection-enabled_pve7.svg" alt="" width={160} height={110} />
      <div className="flex flex-col items-center gap-2 max-w-md">
        <h1 className="font-headline-sm text-[18px] font-semibold text-on-surface">
          {mode === "enroll" ? "Aktifkan Verifikasi Dua Langkah" : "Verifikasi Dua Langkah"}
        </h1>
        <p className="font-body-sm text-[13px] text-muted-foreground leading-relaxed">
          {mode === "enroll"
            ? "Akun Anda memerlukan MFA. Pindai QR dengan aplikasi authenticator, lalu masukkan kode 6 angka untuk mengaktifkan."
            : "Masukkan kode 6 angka dari aplikasi authenticator Anda untuk menyelesaikan login."}
        </p>
        {email && <p className="font-body-sm text-[12px] text-muted-foreground">Masuk sebagai {email}</p>}
      </div>

      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          className={`text-sm max-w-md ${message.type === "success" ? "text-success" : "text-destructive"}`}
        >
          {message.text}
        </p>
      )}

      {loadingFactors ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingSpinner size="sm" /> Memuat faktor MFA...
        </p>
      ) : showEnroll ? (
        <Button variant="primary" onClick={handleEnroll} isLoading={busy}>
          Aktifkan MFA
        </Button>
      ) : showVerify ? (
        <form onSubmit={handleVerify} className="w-full max-w-xs space-y-3 text-left">
          {setup?.qrCode && (
            // Supabase returns the QR as an inline SVG data URL; next/image cannot optimize it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={setup.qrCode} alt="QR code MFA" className="w-44 h-44 mx-auto bg-white p-2 rounded-lg" />
          )}
          {setup?.secret && (
            <p className="text-xs text-muted-foreground text-center">
              Secret manual: <code className="font-mono text-on-surface">{setup.secret}</code>
            </p>
          )}
          <Input
            label="Kode Autentikasi"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="Kode 6 angka"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          <Button type="submit" variant="primary" className="w-full" isLoading={busy}>
            Verifikasi
          </Button>
        </form>
      ) : null}

      <Button variant="outline" onClick={handleLogout} isLoading={signingOut}>
        Keluar
      </Button>
    </main>
  );
}