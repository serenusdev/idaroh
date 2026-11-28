"use client";

import * as React from "react";
import { resolveGatePassTokenAction, scanGatePassAction } from "./actions";

type ResolvedPass = {
  status: string;
  student_full_name: string;
  nis: string;
  destination: string;
  due_back_at: string;
  allowed_action: "out" | "back" | null;
};

export function GatePassScanner({ onMessage }: { onMessage: (message: string) => void }) {
  const [token, setToken] = React.useState("");
  const [resolved, setResolved] = React.useState<ResolvedPass | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function resolve() {
    if (!token.trim()) return;
    setBusy(true);
    const result = await resolveGatePassTokenAction(token);
    setBusy(false);
    if (!result.success) {
      onMessage("message" in result ? (result.message ?? "QR tidak dapat diproses.") : "QR tidak dapat diproses.");
      setResolved(null);
      return;
    }
    setResolved(result.gatePass as ResolvedPass | null);
    if (!result.gatePass) onMessage("QR tidak ditemukan atau tidak dapat digunakan.");
  }

  async function scan() {
    if (!resolved?.allowed_action) return;
    setBusy(true);
    const result = await scanGatePassAction(token, resolved.allowed_action);
    setBusy(false);
    onMessage(result.success ? (resolved.allowed_action === "out" ? "Keluar tercatat." : "Kembali tercatat.") : result.message || "Pemindaian gagal.");
    if (result.success) {
      setToken("");
      setResolved(null);
    }
  }

  return <section className="space-y-3 rounded-xl border p-4" aria-labelledby="gate-scanner-title">
    <h2 id="gate-scanner-title" className="font-semibold">Pemindai E-Tasrih</h2>
    <p className="text-sm text-muted-foreground">Tempel hasil scan QR pada input ini. Kamera otomatis dapat ditambahkan saat perangkat mendukung BarcodeDetector; input manual tetap tersedia sebagai fallback.</p>
    <div className="flex gap-2"><input aria-label="Token QR E-Tasrih" value={token} onChange={(event) => setToken(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void resolve(); } }} placeholder="Scan atau tempel token QR" className="min-w-0 flex-1 rounded border p-2" /><button type="button" onClick={() => void resolve()} disabled={busy || !token.trim()} className="rounded bg-secondary px-3 py-2">Cari</button></div>
    {resolved && <div className="rounded-lg bg-surface-container-low p-3 text-sm" aria-live="polite"><p className="font-medium">{resolved.student_full_name} — {resolved.nis}</p><p>{resolved.destination}</p><p>Batas kembali: {new Date(resolved.due_back_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>{resolved.allowed_action ? <button type="button" onClick={() => void scan()} disabled={busy} className="mt-2 rounded bg-primary px-3 py-2 text-primary-foreground">{resolved.allowed_action === "out" ? "Catat Keluar" : "Catat Kembali"}</button> : <p className="mt-2 text-muted-foreground">Tidak ada tindakan yang tersedia untuk status ini.</p>}</div>}
  </section>;
}
