"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
  /** Show a simple back button instead of full breadcrumb on mobile */
  backHref?: string;
  backLabel?: string;
}

export function Breadcrumb({ items, className, backHref, backLabel }: BreadcrumbProps) {
  const back = backHref ?? items[items.length - 2]?.href;
  const backText = backLabel ?? items[items.length - 2]?.label ?? "Kembali";

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center", className)}>
      {/* Mobile: back button */}
      {back && (
        <Link
          href={back}
          className="sm:hidden flex items-center gap-1 text-primary font-label-sm text-sm font-semibold hover:underline"
        >
          <span aria-hidden="true" className="text-[18px] leading-none">‹</span>
          <span>{backText}</span>
        </Link>
      )}

      {/* Desktop: full breadcrumb */}
      <ol className="hidden sm:flex items-center gap-1 flex-wrap" itemScope itemType="https://schema.org/BreadcrumbList">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li
              key={index}
              className="flex items-center gap-1 font-body-sm text-sm"
              itemProp="itemListElement"
              itemScope
              itemType="https://schema.org/ListItem"
            >
              {index > 0 && (
                <span className="text-muted-foreground material-symbols-outlined text-[14px]" aria-hidden="true">
                  chevron_right
                </span>
              )}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="text-primary hover:underline"
                  itemProp="item"
                >
                  <span itemProp="name">{item.label}</span>
                </Link>
              ) : (
                <span
                  className={isLast ? "text-on-surface font-semibold" : "text-muted-foreground"}
                  aria-current={isLast ? "page" : undefined}
                  itemProp="name"
                >
                  {item.label}
                </span>
              )}
              <meta itemProp="position" content={String(index + 1)} />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
