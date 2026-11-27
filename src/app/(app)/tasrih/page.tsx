"use client";

import * as React from "react";
import Image from "next/image";
import { approveGatePassAction, getGatePassDashboardAction, requestGatePassAction, scanGatePassAction } from "@/modules/gate-pass/actions";
import { useIdentity } from "@/components/auth/identity-context";
import QRCode from "qrcode";

interface GatePassRow {
  id: string;
  reason: string;
  destination: string;
  due_back_at: string;
  status: string;
  qr_token: string;
}

function GatePassQr({ token }: { token: string }) {
  const [src, setSrc] = React.useState("");
  React.useEffect(() => { void QRCode.toDataURL(token, { margin: 1, width: 128 }).then(setSrc); }, [token]);
  return src ? <Image src={src} alt="QR E-Tasrih" width={96} height={96} unoptimized className="rounded bg-white p-1" /> : null;
}

export default function TasrihPage() {
  const { user } = useIdentity();
  const [rows, setRows] = React.useState<GatePassRow[]>([]);
  const [studentId, setStudentId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [dueBackAt, setDueBackAt] = React.useState("");
  const [qrToken, setQrToken] = React.useState("");
  const [message, setMessage] = React.useState("");
  const isOperator = user?.roles?.some((role) => role === "pengurus" || role === "super_admin") || user?.role === "pengurus" || user?.role === "super_admin";
  const refresh = React.useCallback(async () => setRows((await getGatePassDashboardAction()).rows), []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  async function submitRequest(event: React.FormEvent) { event.preventDefault(); const result = await requestGatePassAction(studentId, reason, destination, new Date(dueBackAt).toISOString()); setMessage(result.success ? "Pengajuan izin tersimpan." : result.message || "Pengajuan gagal."); if (result.success) { setReason(""); setDestination(""); void refresh(); } }
  async function review(id: string, approved: boolean) { const result = await approveGatePassAction(id, approved); setMessage(result.success ? "Status izin diperbarui." : result.message || "Pembaruan gagal."); void refresh(); }
  async function scan(direction: "out" | "back") { const result = await scanGatePassAction(qrToken, direction); setMessage(result.success ? `Scan ${direction === "out" ? "keluar" : "kembali"} berhasil.` : result.message || "Scan gagal."); if (result.success) { setQrToken(""); void refresh(); } }
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-4"><header><h1 className="text-2xl font-bold">E-Tasrih / Gate Pass</h1><p className="text-sm text-muted-foreground">Pengajuan, persetujuan, dan scan QR izin keluar berbasis NIS.</p></header>{message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}<form onSubmit={submitRequest} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"><h2 className="sm:col-span-2 font-semibold">Ajukan izin keluar</h2><input required value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="NIS santri" className="rounded border p-2" /><input required value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Tujuan" className="rounded border p-2" /><input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan" className="rounded border p-2" /><input required type="datetime-local" value={dueBackAt} onChange={(e) => setDueBackAt(e.target.value)} className="rounded border p-2" /><button className="rounded bg-primary px-4 py-2 text-primary-foreground sm:col-span-2">Ajukan Tasrih</button></form>{isOperator && <section className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">Scan QR</h2><input value={qrToken} onChange={(e) => setQrToken(e.target.value)} placeholder="Tempel / scan qr_token" className="w-full rounded border p-2" /><div className="flex gap-2"><button onClick={() => void scan("out")} className="rounded bg-primary px-3 py-2 text-primary-foreground">Catat Keluar</button><button onClick={() => void scan("back")} className="rounded bg-secondary px-3 py-2">Catat Kembali</button></div></section>}<section className="space-y-3"><h2 className="font-semibold">Dasbor izin aktif</h2>{rows.map((row) => <article key={row.id} className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 ${row.status === "overdue" ? "border-red-500 bg-red-50" : ""}`}><div><div className="flex flex-wrap gap-2"><span className="font-medium">{row.destination} — {row.reason}</span><span className="text-sm font-semibold">{row.status}</span></div><p className="text-sm">Batas kembali: {new Date(row.due_back_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>{isOperator && row.status === "pending" && <div className="mt-2 flex gap-2"><button onClick={() => void review(row.id, true)} className="rounded bg-green-600 px-3 py-1 text-white">Setujui</button><button onClick={() => void review(row.id, false)} className="rounded bg-red-600 px-3 py-1 text-white">Tolak</button></div>}</div><GatePassQr token={row.qr_token} /></article>)}{rows.length === 0 && <p className="text-sm text-muted-foreground">Belum ada izin aktif.</p>}</section></main>;
}
