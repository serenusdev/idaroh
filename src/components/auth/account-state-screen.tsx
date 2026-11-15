"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Illustration } from "@/components/ui/illustration";
import { createClient } from "@/lib/supabase/client";
import { cleanupPushNotifications } from "@/lib/notifications";
import { getAdminContact } from "@/lib/admin-contact";
import type { AccountStatus } from "@/lib/auth/types";

export type AccountStateScreenProps =
  | { kind: "identity_error"; traceId: string }
  | { kind: "role_missing"; email: string }
  | { kind: "profile_missing"; email: string }
  | { kind: "inactive"; email: string; status: AccountStatus };

const STATUS_COPY: Partial<Record<AccountStatus, { title: string; description: string }>> = {
  pending: {
    title: "Akun Menunggu Persetujuan",
    description: "Permohonan akun Anda sedang ditinjau administrator. Anda dapat masuk setelah akun disetujui.",
  },
  approved: {
    title: "Akun Sedang Diaktifkan",
    description: "Akun Anda sudah disetujui namun belum aktif sepenuhnya. Hubungi administrator bila status ini bertahan.",
  },
  rejected: {
    title: "Permohonan Akun Ditolak",
    description: "Permohonan akun Anda tidak disetujui. Hubungi administrator untuk informasi lebih lanjut.",
  },
  suspended: {
    title: "Akun Ditangguhkan",
    description: "Akses akun Anda sedang ditangguhkan oleh administrator. Hubungi administrator untuk pemulihan akses.",
  },
  deactivated: {
    title: "Akun Dinonaktifkan",
    description: "Akun Anda telah dinonaktifkan. Hubungi administrator bila Anda memerlukan akses kembali.",
  },
};

function describe(props: AccountStateScreenProps) {
  switch (props.kind) {
    case "identity_error":
      return {
        title: "Identitas Belum Dapat Diverifikasi",
        description: "Sistem gagal menghubungi layanan akun. Sesi Anda tetap aman; silakan coba lagi beberapa saat lagi.",
        illustration: "/illustrations/undraw_connection-failed_obln.svg",
        retryable: true,
      };
    case "role_missing":
      return {
        title: "Peran Akun Belum Ditetapkan",
        description: "Akun Anda aktif tetapi belum memiliki peran. Administrator perlu menetapkan peran sebelum Anda dapat menggunakan sistem.",
        illustration: "/illustrations/undraw_team-permissions_1lrk.svg",
        retryable: true,
      };
    case "profile_missing":
      return {
        title: "Profil Akun Belum Tersedia",
        description: "Akun login Anda belum terhubung dengan profil anggota. Hubungi administrator untuk menyelesaikan pendaftaran.",
        illustration: "/illustrations/undraw_profile_9xdn.svg",
        retryable: true,
      };
    case "inactive": {
      const copy = STATUS_COPY[props.status] ?? {
        title: "Akun Tidak Aktif",
        description: "Akun Anda belum dapat digunakan. Hubungi administrator.",
      };
      return {
        ...copy,
        illustration: "/illustrations/undraw_blocked_ldel.svg",
        retryable: props.status === "pending" || props.status === "approved",
      };
    }
  }
}

export function AccountStateScreen(props: AccountStateScreenProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);
  const [retrying, startRetry] = React.useTransition();
  const { title, description, illustration, retryable } = describe(props);
  const adminContact = getAdminContact();
  const showContact = props.kind !== "identity_error";

  const [logoutError, setLogoutError] = React.useState<string | null>(null);
  const handleLogout = async () => {
    setSigningOut(true);
    setLogoutError(null);
    try {
      await cleanupPushNotifications();
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError("Gagal keluar dari akun. Silakan coba lagi.");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-5 bg-background px-4 text-center">
      <Illustration src={illustration} alt="" width={160} height={110} />
      <div className="flex flex-col items-center gap-2 max-w-md">
        <h1 className="font-headline-sm text-[18px] font-semibold text-on-surface">{title}</h1>
        <p className="font-body-sm text-[13px] text-muted-foreground leading-relaxed">{description}</p>
        {"email" in props && props.email && (
          <p className="font-body-sm text-[12px] text-muted-foreground">Masuk sebagai {props.email}</p>
        )}
        {props.kind === "identity_error" && (
          <p className="font-mono text-[11px] text-muted-foreground/70">Kode pelacakan: {props.traceId}</p>
        )}
      </div>
      {showContact && (
        <div className="flex flex-col items-center gap-2 max-w-md rounded-xl border border-border bg-card px-4 py-3">
          <p className="font-label-sm text-[12px] font-semibold text-on-surface">Butuh bantuan administrator?</p>
          {adminContact.whatsappUrl || adminContact.email ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {adminContact.whatsappUrl && (
                <a
                  href={adminContact.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-on-primary text-[12px] font-semibold"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">chat</span>
                  WhatsApp Admin
                </a>
              )}
              {adminContact.email && (
                <a
                  href={`mailto:${adminContact.email}`}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-on-surface text-[12px] font-semibold"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">mail</span>
                  {adminContact.email}
                </a>
              )}
            </div>
          ) : (
            <p className="font-body-sm text-[12px] text-muted-foreground">
              Hubungi administrator pondok melalui pengurus tim Anda untuk bantuan akun.
            </p>
          )}
        </div>
      )}
      {logoutError && <p role="alert" className="text-sm text-destructive">{logoutError}</p>}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {retryable && (
          <Button variant="default" onClick={() => startRetry(() => router.refresh())} isLoading={retrying}>
            Coba Lagi
          </Button>
        )}
        <Button variant="outline" onClick={handleLogout} isLoading={signingOut}>
          Keluar
        </Button>
      </div>
    </main>
  );
}
