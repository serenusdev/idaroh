"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Illustration } from "@/components/ui/illustration";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { toSafeInternalPath } from "@/lib/safe-url";

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [turnstileToken, setTurnstileToken] = React.useState("");
  const [turnstileResetNonce, setTurnstileResetNonce] = React.useState(0);

  React.useEffect(() => {
    setIsHydrated(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, turnstileToken }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        mfaRequired?: boolean;
        mode?: string;
      };

      if (!response.ok || !result.success) {
        setErrorMessage(result.message || "Terjadi kesalahan saat masuk ke sistem.");
        // Reset Turnstile token and re-render the widget so the user must
        // complete a fresh challenge (tokens are single-use server-side).
        setTurnstileToken("");
        setTurnstileResetNonce((n) => n + 1);
        setIsLoading(false);
        return;
      }

      // The server route writes the SSR session cookies on this response.
      const next = toSafeInternalPath(new URLSearchParams(window.location.search).get("next"));
      if (result.mfaRequired) {
        const params = new URLSearchParams({ mode: result.mode === "enroll" ? "enroll" : "challenge" });
        if (next) params.set("next", next);
        window.location.assign(`/mfa?${params.toString()}`);
        return;
      }
      window.location.assign(next || "/");
    } catch {
      setErrorMessage("Tidak dapat terhubung ke server autentikasi. Silakan periksa koneksi Anda dan coba lagi.");
      setIsLoading(false);
    }
  };

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full flex flex-col lg:flex-row items-center justify-center gap-12 max-w-4xl">
        {/* Decorative side illustration — desktop only */}
        <div className="hidden lg:flex flex-col items-center justify-center gap-4 shrink-0" aria-hidden="true">
          <Illustration
            src="/illustrations/undraw_private-data_934y.svg"
            alt=""
            width={220}
            height={205}
          />
          <p className="text-sm text-muted-foreground text-center max-w-[220px] leading-relaxed">
            Platform operasional santri yang aman dan terpercaya.
          </p>
        </div>

        {/* Login card */}
      <div className="w-full max-w-md bg-card rounded-2xl border border-border p-6 sm:p-8 shadow-sm">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-6">
          <Image
            src="/idaroh-logo.svg"
            alt="IDAROH"
            width={220}
            height={69}
            priority
            className="h-14 w-auto max-w-[220px] object-contain"
          />
          <p className="font-body-sm text-[13px] text-muted-foreground mt-1">
            Platform Operasional Santri &amp; Pengurus
          </p>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-error/15 border border-error/30 text-error text-[13px] flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <form
          onSubmit={handleLogin}
          data-hydrated={isHydrated}
          className="space-y-4"
        >
          <Input
            label="Alamat Email"
            type="email"
            placeholder="nama@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <div className="space-y-1.5">
            <Input
              label="Kata Sandi"
              type="password"
              placeholder="Masukkan kata sandi"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

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
            {isLoading ? "Memproses Autentikasi..." : "Masuk ke Sistem"}
          </Button>
        </form>
        <div className="text-center mt-4">
          <Link href="/forgot-password" className="text-sm text-primary font-semibold hover:underline">
            Lupa kata sandi?
          </Link>
        </div>


        {/* Pathway to registration */}
        <div className="mt-6 pt-6 border-t border-border text-center">
          <p className="font-body-sm text-[13px] text-muted-foreground">
            Belum memiliki akun santri atau pengurus?{" "}
            <Link
              href="/register"
              className="text-primary font-semibold hover:underline"
            >
              Ajukan Akun Baru
            </Link>
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
