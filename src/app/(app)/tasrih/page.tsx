"use client";

import * as React from "react";
import Image from "next/image";
import { approveGatePassAction, cancelGatePassAction, getGatePassDashboardAction, requestGatePassAction } from "@/modules/gate-pass/actions";
import { useIdentity } from "@/components/auth/identity-context";
import QRCode from "qrcode";
import { hasAnyRole } from "@/lib/auth/role-utils";
import { GatePassScanner } from "@/modules/gate-pass/gate-pass-scanner";

interface GatePassRow {
  id: string;
  reason: string;
  destination: string;
  due_back_at: string;
  status: string;
  qr_token: string;
  actual_back_at: string | null;
  returned_late: boolean | null;
  late_minutes: number | null;
  students?: { full_name: string; nis: string } | null;
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
  const [message, setMessage] = React.useState("");
  const isOperator = user ? hasAnyRole(user, ["pengurus", "super_admin"]) : false;
  const refresh = React.useCallback(async () => {
    const response = await getGatePassDashboardAction();
    setRows(response.rows.map((row) => ({ ...row, students: Array.isArray(row.students) ? row.students[0] ?? null : row.students })) as GatePassRow[]);
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  async function submitRequest(event: React.FormEvent) { event.preventDefault(); const result = await requestGatePassAction(studentId, reason, destination, dueBackAt); setMessage(result.success ? "Pengajuan izin tersimpan." : result.message || "Pengajuan gagal."); if (result.success) { setReason(""); setDestination(""); setDueBackAt(""); void refresh(); } }
  async function review(id: string, approved: boolean) { const note = approved ? undefined : window.prompt("Alasan penolakan wajib diisi:", ""); if (!approved && !note?.trim()) return; const result = await approveGatePassAction(id, approved, note ?? undefined); setMessage(result.success ? "Status izin diperbarui." : result.message || "Pembaruan gagal."); void refresh(); }
  async function cancel(id: string) { const result = await cancelGatePassAction(id); setMessage(result.success ? "Pengajuan dibatalkan." : result.message || "Pembatalan gagal."); void refresh(); }
  const statusLabels: Record<string, string> = { pending: "Menunggu", approved: "Disetujui", out: "Sedang keluar", overdue: "Terlambat", returned: "Sudah kembali", rejected: "Ditolak", cancelled: "Dibatalkan" };
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-4"><header><h1 className="text-2xl font-bold">E-Tasrih</h1><p className="text-sm text-muted-foreground">Pengajuan, persetujuan, dan kartu QR izin keluar. Waktu ditafsirkan sebagai WIB.</p></header>{message && <p role="status" aria-live="polite" className="rounded-lg border p-3 text-sm">{message}</p>}<form onSubmit={submitRequest} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"><h2 className="sm:col-span-2 font-semibold">Ajukan izin keluar</h2>{isOperator && <input required value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="NIS santri" className="rounded border p-2" />}<input required value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Tujuan" className="rounded border p-2" /><input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan" className="rounded border p-2" /><label className="text-sm">Batas kembali (WIB)<input required type="datetime-local" value={dueBackAt} onChange={(e) => setDueBackAt(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><button type="submit" className="rounded bg-primary px-4 py-2 text-primary-foreground sm:col-span-2">Ajukan Tasrih</button></form>{isOperator && <GatePassScanner onMessage={setMessage} />}<section className="space-y-3"><h2 className="font-semibold">Daftar izin</h2>{rows.map((row) => <article key={row.id} className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 ${row.status === "overdue" ? "border-red-500 bg-red-50" : ""}`}><div><div className="flex flex-wrap gap-2"><span className="font-medium">{row.students?.full_name ?? "Santri"} — {row.students?.nis ?? "NIS tidak tersedia"}</span><span className="text-sm font-semibold">{statusLabels[row.status] ?? "Status tidak dikenal"}</span></div><p className="text-sm">{row.destination} · {row.reason}</p><p className="text-sm">Batas kembali: {new Date(row.due_back_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>{row.status === "returned" && row.returned_late && <p className="text-sm text-error">Kembali terlambat ({row.late_minutes ?? 0} menit)</p>}{isOperator && row.status === "pending" && <div className="mt-2 flex gap-2"><button type="button" onClick={() => void review(row.id, true)} className="rounded bg-green-600 px-3 py-1 text-white">Setujui</button><button type="button" onClick={() => void review(row.id, false)} className="rounded bg-red-600 px-3 py-1 text-white">Tolak</button></div>}{!isOperator && row.status === "pending" && <button type="button" onClick={() => void cancel(row.id)} className="mt-2 rounded bg-secondary px-3 py-1">Batalkan</button>}</div>{(row.status === "approved" || row.status === "out") && <GatePassQr token={row.qr_token} />}</article>)}{rows.length === 0 && <p className="text-sm text-muted-foreground">Belum ada izin.</p>}</section></main>;
}
