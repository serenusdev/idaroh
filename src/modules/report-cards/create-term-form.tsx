"use client";

import { useState } from "react";
import { createAcademicTermAction } from "./actions";

export default function CreateTermForm() {
  const [input, setInput] = useState({ code: "", name: "", startDate: "", endDate: "" });
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); const result = await createAcademicTermAction(input); setMessage(result.success ? "Term berhasil dibuat. Muat ulang halaman untuk memilihnya." : (result.message ?? "Term gagal dibuat.")); }
  return <form onSubmit={submit} className="mt-5 grid max-w-xl gap-3 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Tambah tahun ajaran / semester</h2><input required placeholder="Kode, mis. 2026-GANJIL" value={input.code} onChange={(e) => setInput({ ...input, code: e.target.value })} className="rounded border p-2" /><input required placeholder="Nama term" value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} className="rounded border p-2" /><label className="text-sm">Mulai (WIB)<input required type="date" value={input.startDate} onChange={(e) => setInput({ ...input, startDate: e.target.value })} className="mt-1 w-full rounded border p-2" /></label><label className="text-sm">Selesai (WIB)<input required type="date" value={input.endDate} onChange={(e) => setInput({ ...input, endDate: e.target.value })} className="mt-1 w-full rounded border p-2" /></label><button type="submit" className="rounded bg-primary px-4 py-2 text-primary-foreground">Simpan term</button>{message && <p role="status" aria-live="polite" className="text-sm">{message}</p>}</form>;
}
