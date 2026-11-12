"use client";

import { useEffect, useRef, useState } from "react";

export function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const applying = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const showUpdate = () => {
      if (disposed || !registration?.waiting || !navigator.serviceWorker.controller) return;
      setWaiting(registration.waiting);
      setUpdateAvailable(true);
      setDismissed(false);
    };
    const stateChanged = () => {
      if (installing?.state === "installed") showUpdate();
    };
    const updateFound = () => {
      installing?.removeEventListener("statechange", stateChanged);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", stateChanged);
    };
    const controllerChanged = () => {
      if (applying.current) {
        window.location.reload();
      } else if (registration?.active) {
        setWaiting(null);
        setUpdateAvailable(true);
        setDismissed(false);
      }
    };
    const checkUpdate = () => { void registration?.update().catch(() => undefined); };
    const hadController = Boolean(navigator.serviceWorker.controller);
    if (hadController) navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
    window.addEventListener("focus", checkUpdate);
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then((registered) => {
        if (disposed) return;
        registration = registered;
        showUpdate();
        registration.addEventListener("updatefound", updateFound);
        updateFound();
        checkUpdate();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
      window.removeEventListener("focus", checkUpdate);
      registration?.removeEventListener("updatefound", updateFound);
      installing?.removeEventListener("statechange", stateChanged);
    };
  }, []);

  if (!updateAvailable || dismissed) return null;
  const applyUpdate = () => {
    applying.current = true;
    if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
    else window.location.reload();
  };
  return (
    <aside role="status" className="fixed bottom-20 md:bottom-4 left-4 right-4 md:left-auto md:max-w-sm z-50 rounded-xl border border-border bg-card p-4 shadow-lg">
      <p className="text-sm font-semibold text-on-surface">Pembaruan IDAROH tersedia</p>
      <p className="mt-1 text-xs text-muted-foreground">Simpan perubahan Anda sebelum memuat ulang aplikasi.</p>
      <div className="mt-3 flex gap-3">
        <button type="button" onClick={applyUpdate} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Muat ulang</button>
        <button type="button" onClick={() => setDismissed(true)} className="rounded-lg px-3 py-2 text-xs text-muted-foreground">Nanti</button>
      </div>
    </aside>
  );
}
