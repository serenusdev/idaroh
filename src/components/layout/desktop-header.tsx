"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { formatOperationalDateTime } from "@/lib/utils";
import { UserProfile } from "@/lib/auth/types";
import { Avatar } from "@/components/ui/avatar";
import { getUnreadNotificationCountAction } from "@/modules/notifications/actions";
import { useNotificationChanges } from "@/components/notifications/use-notification-changes";

interface DesktopHeaderProps {
  user: UserProfile;
}

export function DesktopHeader({ user }: DesktopHeaderProps) {
  const pathname = usePathname();
  const [currentDateTime, setCurrentDateTime] = React.useState<string>(
    formatOperationalDateTime()
  );
  const [unreadCount, setUnreadCount] = React.useState(0);
  const countVersion = React.useRef(0);

  React.useEffect(() => {
    // Update live clock every minute
    const interval = setInterval(() => {
      setCurrentDateTime(formatOperationalDateTime());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const refreshUnread = React.useCallback(() => {
    const version = ++countVersion.current;
    getUnreadNotificationCountAction()
      .then((count) => { if (version === countVersion.current) setUnreadCount(count); })
      .catch((error) => console.error("[notifications] unread count failed:", error));
  }, []);

  React.useEffect(() => {
    refreshUnread();
    return () => { countVersion.current += 1; };
  }, [pathname, refreshUnread]);

  useNotificationChanges(user.id, refreshUnread);

  const getPageTitle = () => {
    if (pathname === "/" || pathname === "/beranda") return "Beranda Santri";
    if (pathname.startsWith("/kehadiran")) return "Presensi Operasional";
    if (pathname.startsWith("/laporan")) return "Laporan Aktivitas Harian";
    if (pathname.startsWith("/review")) return "Antrean Review Laporan";
    if (pathname.startsWith("/tugas")) return "Tugas & Proyek";
    if (pathname.startsWith("/jadwal")) return "Jadwal & Pengumuman";
    if (pathname.startsWith("/resources")) return "Resource Library";
    if (pathname.startsWith("/tim")) return "Direktori Tim & Orang";
    if (pathname.startsWith("/admin/users")) return "Kelola Pengguna IAM";
    if (pathname.startsWith("/admin/people")) return "Anggota & Reviewer";
    if (pathname.startsWith("/admin/analytics")) return "Analitik Operasional";
    if (pathname.startsWith("/admin/backup")) return "Backup & Pemulihan";
    if (pathname.startsWith("/admin/kehadiran")) return "Review Presensi";
    if (pathname.startsWith("/admin/notifications")) return "Uji Notifikasi";
    if (pathname.startsWith("/admin/audit")) return "Dasbor Analitik & Audit";
    return "Pondok OS";
  };

  return (
    <header className="hidden md:flex h-16 fixed top-0 right-0 left-64 bg-card border-b border-border z-30 px-6 items-center justify-between">
      {/* Page Title & Context */}
      <div className="flex items-center gap-4 min-w-0">
        <Image
          src="/idaroh-logo.svg"
          alt="IDAROH"
          width={126}
          height={39}
          priority
          className="h-8 w-auto shrink-0 object-contain"
        />
        <span className="h-7 w-px bg-border shrink-0" aria-hidden="true" />
        <h1 className="font-headline-sm text-headline-sm text-on-surface">
          {getPageTitle()}
        </h1>
      </div>

      {/* Utilities: Server Clock, Sync Status, Notifications */}
      <div className="flex items-center gap-4">
        {/* Live Server Clock & Sync Pill */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low text-success border border-success/20">
            <span className="material-symbols-outlined text-[15px]">cloud_done</span>
            <span className="font-label-sm text-[11px] font-medium leading-tight">
              Server Sinkron
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-muted-foreground text-[12px] font-mono px-2 py-1 rounded-md bg-surface-container">
            <span className="material-symbols-outlined text-[15px]">schedule</span>
            <span>{currentDateTime}</span>
          </div>
        </div>

        {/* Notifications */}
        <Link
          href="/notifikasi"
          type="button"
          aria-label="Notifikasi Operasional"
          className="relative w-10 h-10 flex items-center justify-center rounded-xl text-on-surface-variant hover:text-primary hover:bg-accent/40 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[22px]">notifications</span>
          {unreadCount > 0 && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-error ring-2 ring-card" aria-label={`${unreadCount} notifikasi belum dibaca`} />}
        </Link>

        {/* User Mini Profile Link to Profile Page */}
        <Link
          href="/settings/profile"
          className="flex items-center gap-2 pl-2 border-l border-border hover:opacity-80 transition-opacity"
          title="Buka Pengaturan Profil Saya"
        >
          <Avatar
            src={user.avatar_url}
            alt={user.full_name}
            fallback={user.full_name}
            size="md"
          />
          <div className="flex flex-col text-left">
            <span className="font-label-md text-[13px] text-on-surface leading-tight font-medium hover:text-primary">
              {user.full_name}
            </span>
            <span className="font-body-sm text-[11px] text-muted-foreground leading-tight">
              {user.team_name || "Santri"}
            </span>
          </div>
        </Link>
      </div>
    </header>
  );
}

