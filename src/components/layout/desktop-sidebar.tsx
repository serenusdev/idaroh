"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { UserProfile } from "@/lib/auth/types";
import { Avatar } from "@/components/ui/avatar";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cleanupPushNotifications } from "@/lib/notifications";

interface DesktopSidebarProps {
  user: UserProfile;
}

export function DesktopSidebar({ user }: DesktopSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (path: string) => {
    if (path === "/" || path === "/beranda") {
      return pathname === "/" || pathname === "/beranda";
    }
    return pathname.startsWith(path);
  };

  const handleLogout = async () => {
    await cleanupPushNotifications();
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const isAdminOrPengurus =
    user.role === "super_admin" ||
    user.role === "yayasan" ||
    user.role === "pengurus";

  const mainNav = [
    { label: "Beranda", href: "/", icon: "dashboard" },
    { label: "Presensi Harian", href: "/kehadiran", icon: "how_to_reg" },
    { label: "Laporan Aktivitas", href: "/laporan", icon: "edit_document" },
    { label: "Review Laporan", href: "/review", icon: "fact_check" },
    { label: "Tugas & Proyek", href: "/tugas", icon: "task_alt" },
    { label: "Jadwal & Agenda", href: "/jadwal", icon: "calendar_month" },
  ];

  const libraryNav = [
    { label: "Resource Library", href: "/resources", icon: "menu_book" },
    { label: "Direktori Tim", href: "/tim", icon: "groups" },
  ];

  const adminNav = [
    { label: "Analitik Operasional", href: "/admin/analytics", icon: "monitoring" },
    { label: "Anggota & Reviewer", href: "/admin/people", icon: "groups" },
    { label: "Backup & Pemulihan", href: "/admin/backup", icon: "backup" },
    { label: "Uji Notifikasi", href: "/admin/notifications", icon: "notifications_active" },
    { label: "Jadwal Otomatis", href: "/admin/cron", icon: "schedule" },
    { label: "Kelola Pengguna IAM", href: "/admin/users", icon: "manage_accounts" },
    { label: "Kelola Jadwal & Siaran", href: "/admin/jadwal", icon: "edit_calendar" },
    { label: "Kelola Resource Library", href: "/admin/resources", icon: "library_books" },
    { label: "Review Presensi", href: "/admin/kehadiran", icon: "fact_check" },
    { label: "Analitik & Audit Log", href: "/admin/audit", icon: "monitoring" },
  ];

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
    <aside className="hidden md:flex flex-col w-64 fixed left-0 top-0 bottom-0 bg-card border-r border-border z-40">
      {/* Brand & Organization */}
      <div className="h-16 px-5 flex items-center gap-3 border-b border-border">
        <Image
          src="/idaroh-icon.svg"
          alt="IDAROH"
          width={36}
          height={36}
          priority
          className="w-9 h-9 rounded-xl shrink-0 object-contain shadow-sm"
        />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-headline-sm text-headline-sm text-primary font-bold tracking-tight leading-none">
              IDAROH
            </span>
            <span className="px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground font-label-sm text-[10px] leading-tight flex-shrink-0">
              {roleLabel}
            </span>
          </div>
          <span className="font-body-sm text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
            Pondok Quran Abdurrahman bin Auf
          </span>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Main Group */}
        <div>
          <p className="px-3 text-[11px] font-label-sm uppercase tracking-wider text-muted-foreground mb-1.5">
            Operasional Utama
          </p>
          <div className="space-y-0.5">
            {mainNav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl font-label-md text-label-md transition-all",
                    active
                      ? "bg-accent/70 text-primary font-semibold shadow-xs"
                      : "text-on-surface-variant hover:text-primary hover:bg-accent/30"
                  )}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Resources Group */}
        <div>
          <p className="px-3 text-[11px] font-label-sm uppercase tracking-wider text-muted-foreground mb-1.5">
            Pustaka &amp; Tim
          </p>
          <div className="space-y-0.5">
            {libraryNav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl font-label-md text-label-md transition-all",
                    active
                      ? "bg-accent/70 text-primary font-semibold shadow-xs"
                      : "text-on-surface-variant hover:text-primary hover:bg-accent/30"
                  )}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Admin Group */}
        {isAdminOrPengurus && (
          <div>
            <p className="px-3 text-[11px] font-label-sm uppercase tracking-wider text-muted-foreground mb-1.5">
              Administrasi
            </p>
            <div className="space-y-0.5">
              {adminNav.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl font-label-md text-label-md transition-all",
                      active
                        ? "bg-accent/70 text-primary font-semibold shadow-xs"
                        : "text-on-surface-variant hover:text-primary hover:bg-accent/30"
                    )}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* User profile & actions */}
      <div className="p-3 border-t border-border bg-card">
        <div className="flex items-center justify-between p-2 rounded-xl bg-surface-container/60 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar
              src={user.avatar_url}
              alt={user.full_name}
              fallback={user.full_name}
              size="md"
            />
            <div className="min-w-0">
              <p className="font-label-md text-label-md text-on-surface truncate">
                {user.full_name}
              </p>
              <p className="font-body-sm text-[11px] text-muted-foreground truncate">
                {user.team_name || user.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Keluar"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-card transition-colors flex-shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

