"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Avatar } from "@/components/ui/avatar";
import { UserProfile } from "@/lib/auth/types";
import { getUnreadNotificationCountAction } from "@/modules/notifications/actions";
import { useNotificationChanges } from "@/components/notifications/use-notification-changes";

interface MobileHeaderProps {
  user: UserProfile;
  title?: string;
  showBack?: boolean;
}

export function MobileHeader({ user, title }: MobileHeaderProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = React.useState(0);
  const countVersion = React.useRef(0);

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

  // Determine page title based on path if not explicitly provided
  const getPageTitle = () => {
    if (title) return title;
    if (pathname === "/" || pathname === "/beranda") return "Beranda";
    if (pathname.startsWith("/kehadiran")) return "Presensi Operasional";
    if (pathname.startsWith("/laporan")) return "Laporan Aktivitas";
    if (pathname.startsWith("/review")) return "Review Laporan";
    if (pathname.startsWith("/tugas")) return "Tugas & Proyek";
    if (pathname.startsWith("/jadwal")) return "Jadwal & Pengumuman";
    if (pathname.startsWith("/resources")) return "Resource Library";
    if (pathname.startsWith("/tim")) return "Direktori Tim";
    if (pathname.startsWith("/admin/users")) return "Kelola Pengguna IAM";
    if (pathname.startsWith("/admin/people")) return "Anggota & Reviewer";
    if (pathname.startsWith("/admin/analytics")) return "Analitik Operasional";
    if (pathname.startsWith("/admin/backup")) return "Backup & Pemulihan";
    if (pathname.startsWith("/admin/kehadiran")) return "Review Presensi";
    if (pathname.startsWith("/admin/notifications")) return "Uji Notifikasi";
    if (pathname.startsWith("/admin/audit")) return "Analitik & Audit";
    return "Pondok OS";
  };

  const roleLabel =
    user.role === "super_admin"
      ? "Super Admin"
      : user.role === "yayasan"
      ? "Yayasan"
      : user.role === "pengurus"
      ? "Pengurus"
      : user.role === "koordinator"
      ? "Koordinator"
      : "Santri";

  return (
    <header className="md:hidden fixed top-0 inset-x-0 z-50 bg-card shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-safe border-b border-border">
      <div className="h-16 px-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          <Image
            src="/idaroh-logo.svg"
            alt="IDAROH"
            width={126}
            height={39}
            priority
            className="h-8 w-auto max-w-[126px] shrink-0 object-contain"
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground font-label-sm text-[10px] leading-tight flex-shrink-0">
                {roleLabel}
              </span>
            </div>
            <span className="font-body-sm text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
              {getPageTitle()}
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Link
            href="/notifikasi"
            aria-label="Notifikasi Operasional"
            className="relative w-11 h-11 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-accent/40 active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-[22px]">notifications</span>
            {unreadCount > 0 && <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-error ring-2 ring-card" aria-label={`${unreadCount} notifikasi belum dibaca`} />}
          </Link>

          <Link href="/tim" className="w-11 h-11 flex items-center justify-center">
            <Avatar
              src={user.avatar_url}
              alt={user.full_name}
              fallback={user.full_name}
              size="md"
            />
          </Link>
        </div>
      </div>
    </header>
  );
}

