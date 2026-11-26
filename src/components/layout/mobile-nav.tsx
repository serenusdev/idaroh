"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MoreSheet } from "./more-sheet";
import { UserProfile } from "@/lib/auth/types";
import { AUDIT_READ_ROLES, holdsRole } from "@/lib/export-policy";
import { holdsReportReviewRole, REPORT_REVIEW_ROLES } from "@/lib/report-policy";

interface MobileNavProps {
  user: UserProfile;
}

export function MobileNav({ user }: MobileNavProps) {
  const pathname = usePathname();
  const [isMoreOpen, setIsMoreOpen] = React.useState(false);

  const isActive = (path: string) => {
    if (path === "/" || path === "/beranda") {
      return pathname === "/" || pathname === "/beranda";
    }
    return pathname.startsWith(path);
  };

  const isAdminOrPengurus =
    user.role === "super_admin" ||
    user.role === "yayasan" ||
    user.role === "pengurus";

  const isKoordinator = user.role === "koordinator";

  // RVS-01: the manager sheet used to assume the review queue belonged to every manager. §3.4 says
  // otherwise — yayasan and super_admin are `—` for report.review — so the entry follows the same
  // pair getReviewQueueAction guards, across every role the account holds.
  const canReview = holdsReportReviewRole(user, REPORT_REVIEW_ROLES);

  const navItems = isAdminOrPengurus
    ? [
        {
          label: "Beranda",
          href: "/",
          icon: "dashboard",
          active: isActive("/") && !isMoreOpen,
        },
        ...(canReview ? [{
          label: "Review",
          href: "/review",
          icon: "fact_check",
          active: isActive("/review") && !isMoreOpen,
        }] : []),
        {
          label: "Jadwal",
          href: "/admin/jadwal",
          icon: "calendar_month",
          active: (isActive("/admin/jadwal") || isActive("/jadwal")) && !isMoreOpen,
        },
        // §3.8 admin.audit.read belongs to yayasan and super_admin; a plain
        // pengurus gets no audit shortcut.
        ...(holdsRole(user, AUDIT_READ_ROLES) ? [{
          label: "Audit",
          href: "/admin/audit",
          icon: "monitoring",
          active: isActive("/admin/audit") && !isMoreOpen,
        }] : []),
      ]
    : isKoordinator
    ? [
        {
          label: "Beranda",
          href: "/",
          icon: "dashboard",
          active: isActive("/") && !isMoreOpen,
        },
        {
          label: "Review",
          href: "/review",
          icon: "fact_check",
          active: isActive("/review") && !isMoreOpen,
        },
        {
          label: "Laporan",
          href: "/laporan",
          icon: "edit_document",
          active: isActive("/laporan") && !isMoreOpen,
        },
        {
          label: "Jadwal",
          href: "/jadwal",
          icon: "calendar_month",
          active: isActive("/jadwal") && !isMoreOpen,
        },
      ]
    : [
        {
          label: "Beranda",
          href: "/",
          icon: "dashboard",
          active: isActive("/") && !isMoreOpen,
        },
        {
          label: "Kehadiran",
          href: "/kehadiran",
          icon: "how_to_reg",
          active: isActive("/kehadiran") && !isMoreOpen,
        },
        {
          label: "Laporan",
          href: "/laporan",
          icon: "edit_document",
          active: isActive("/laporan") && !isMoreOpen,
        },
        {
          label: "Jadwal",
          href: "/jadwal",
          icon: "calendar_month",
          active: isActive("/jadwal") && !isMoreOpen,
        },
      ];

  const isOtherActive = !navItems.some((it) => it.active);

  return (
    <>
      <nav
        aria-label="Navigasi Utama Mobile"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 pb-safe bg-card shadow-[0_-2px_12px_rgba(0,0,0,0.05)] border-t border-border"
      >
        <div className="flex items-center justify-around h-16 px-1 max-w-lg mx-auto">
          {navItems.map((item) => {
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "flex-1 min-w-[56px] h-12 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all",
                  item.active
                    ? "text-primary font-semibold"
                    : "text-on-surface-variant hover:text-primary"
                )}
              >
                <span className="material-symbols-outlined text-[22px]">
                  {item.icon}
                </span>
                <span className="font-label-sm text-[11px] tracking-tight truncate">
                  {item.label}
                </span>
              </Link>
            );
          })}

          {/* Lainnya button */}
          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            className={cn(
              "flex-1 min-w-[56px] h-12 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all",
              isOtherActive || isMoreOpen
                ? "text-primary font-semibold"
                : "text-on-surface-variant hover:text-primary"
            )}
          >
            <span className="material-symbols-outlined text-[22px]">grid_view</span>
            <span className="font-label-sm text-[11px] tracking-tight truncate">
              Lainnya
            </span>
          </button>
        </div>
      </nav>

      {/* More menu drawer */}
      <MoreSheet
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        user={user}
      />
    </>
  );
}

