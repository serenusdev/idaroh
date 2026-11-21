"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { resolveEmailRedirectOrigin } from "@/lib/auth/email-redirect-origin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");
    const redirectTo = `${resolveEmailRedirectOrigin()}/reset-password`;
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (resetError) setError("Permintaan reset password gagal. Periksa email dan konfigurasi email Supabase.");
    else setMessage("Jika email terdaftar, tautan untuk membuat password baru sudah dikirim.");
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border p-6 sm:p-8 shadow-sm">
        <Image src="/idaroh-logo.svg" alt="IDAROH" width={220} height={69} className="h-14 w-auto mx-auto object-contain" priority />
        <h1 className="text-xl font-bold text-on-surface text-center mt-5">Lupa kata sandi?</h1>
        <p className="text-sm text-muted-foreground text-center mt-2">Masukkan email akun untuk menerima tautan pemulihan.</p>
        {message && <p className="mt-4 p-3 rounded-xl bg-success/15 text-success text-sm">{message}</p>}
        {error && <p className="mt-4 p-3 rounded-xl bg-error/15 text-error text-sm">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4 mt-5">
          <Input label="Alamat Email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>{loading ? "Mengirim..." : "Kirim tautan pemulihan"}</Button>
        </form>
        <Link href="/login" className="block text-center text-sm text-primary font-semibold mt-5 hover:underline">Kembali ke login</Link>
      </div>
    </main>
  );
}
