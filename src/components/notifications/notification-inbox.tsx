"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/ui/error-state";
import { toSafeInternalPath } from "@/lib/safe-url";
import {
  getNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationItem,
} from "@/modules/notifications/actions";
import { useNotificationChanges } from "./use-notification-changes";

export function NotificationInbox({ userId }: { userId: string }) {
  const router = useRouter();
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const requestVersion = React.useRef(0);
  const [markingAll, setMarkingAll] = React.useState(false);

  const load = React.useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const nextItems = await getNotificationsAction();
      if (version !== requestVersion.current) return;
      setItems(nextItems);
      setLoadFailed(false);
    } catch (error) {
      if (version !== requestVersion.current) return;
      console.error("[notifications] load failed:", error);
      setLoadFailed(true);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  useNotificationChanges(userId, load);

  const openItem = async (item: NotificationItem) => {
    setActionError(null);
    if (!item.isRead) {
      try {
        const result = await markNotificationReadAction(item.id);
        if (result.success) {
          requestVersion.current += 1;
          setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, isRead: true } : entry)));
          window.dispatchEvent(new Event("notifications:changed"));
        } else {
          void load();
        }
      } catch (error) {
        console.error("[notifications] mark read failed:", error);
        setActionError("Status baca belum tersimpan. Coba lagi nanti.");
      }
    }
    const target = toSafeInternalPath(item.url);
    if (target && target !== "/notifikasi") router.push(target);
  };

  const markAllRead = async () => {
    setActionError(null);
    setMarkingAll(true);
    try {
      const result = await markAllNotificationsReadAction();
      if (!result.success) throw new Error(result.message);
      requestVersion.current += 1;
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      window.dispatchEvent(new Event("notifications:changed"));
    } catch (error) {
      console.error("[notifications] mark all read failed:", error);
      setActionError("Gagal menandai semua notifikasi. Coba lagi nanti.");
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-5 pb-20">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">NOT-001 · Pusat notifikasi</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Notifikasi operasional</h1>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground mt-1">Pengumuman, tugas, review, dan pengingat operasional untuk akunmu.</p>
          {items.some((item) => !item.isRead) && (
            <button type="button" onClick={markAllRead} disabled={markingAll} className="text-xs font-semibold text-primary hover:underline disabled:opacity-50">
              Tandai semua dibaca
            </button>
          )}
        </div>
      </header>
      {actionError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </p>
      )}
      {loadFailed && items.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">Pembaruan notifikasi gagal; data terakhir masih ditampilkan. <button type="button" onClick={() => void load()} className="text-primary underline">Coba lagi</button></p>
      )}
      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">Memuat notifikasi...</div>
      ) : loadFailed && items.length === 0 ? (
        <ErrorState
          title="Notifikasi Gagal Dimuat"
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Belum ada notifikasi baru.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => openItem(item)}
                className={`w-full text-left rounded-2xl border bg-card p-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.isRead ? "border-border" : "border-primary/40 bg-accent/20"}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-[11px] font-mono uppercase tracking-wider text-primary">
                      {item.type.replaceAll("_", " ")} · {new Date(item.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="block font-semibold text-on-surface mt-1">{item.title}</span>
                  </span>
                  {!item.isRead && <span className="mt-1 h-2.5 w-2.5 rounded-full bg-error shrink-0" aria-label="Belum dibaca" />}
                </span>
                <span className="block text-sm text-muted-foreground mt-3 whitespace-pre-wrap">{item.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
