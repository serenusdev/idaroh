"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "warning" | "default";
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  variant = "destructive",
  isLoading = false,
}: ConfirmDialogProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const confirmBtnRef = React.useRef<HTMLButtonElement>(null);

  // Focus trap + initial focus
  React.useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    confirmBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const iconMap = {
    destructive: { icon: "delete", color: "text-error", bg: "bg-error/10" },
    warning: { icon: "warning", color: "text-tertiary", bg: "bg-tertiary/10" },
    default: { icon: "info", color: "text-primary", bg: "bg-primary/10" },
  };
  const { icon, color, bg } = iconMap[variant];

  const confirmBtnClass = {
    destructive: "bg-error text-on-error hover:bg-error/90",
    warning: "bg-tertiary-container text-on-tertiary-container hover:bg-tertiary-container/80",
    default: "bg-primary text-on-primary hover:bg-primary-container",
  }[variant];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? "confirm-dialog-desc" : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-sm bg-card rounded-2xl p-6 shadow-2xl border border-border space-y-4 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-start gap-4">
          <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", bg)}>
            <span className={cn("material-symbols-outlined text-[22px]", color)}>{icon}</span>
          </div>
          <div className="min-w-0">
            <h2 id="confirm-dialog-title" className="font-headline-sm text-[16px] font-semibold text-on-surface">
              {title}
            </h2>
            {description && (
              <p id="confirm-dialog-desc" className="font-body-sm text-[13px] text-muted-foreground mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 h-11 rounded-xl bg-surface-container border border-border text-on-surface font-label-md text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              "flex-1 h-11 rounded-xl font-label-md text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50",
              confirmBtnClass
            )}
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Memproses...</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
