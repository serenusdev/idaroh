"use client";

import { useState } from "react";

type RosterStudent = { id: string; nis: string; full_name: string; dorm_room: string | null; halaqah_group: string | null };
type ExistingCard = { student_id: string; status: string };

export default function ReportCardRoster({ termId, students, cards }: { termId: string; students: RosterStudent[]; cards: ExistingCard[] }) {
  const [rows, setRows] = useState(cards);
  const [busy, setBusy] = useState<string | null>(null);
  async function generate(student: RosterStudent) {
    setBusy(student.id);
    await fetch("/api/report-cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ termId, studentId: student.id, tahfidzData: {}, diniyahScores: [], adabScores: {}, attendanceSummary: { source: "manual" }, status: "draft" }) });
    setRows((current) => current.some((card) => card.student_id === student.id) ? current : [...current, { student_id: student.id, status: "draft" }]);
    setBusy(null);
  }
  return <section className="mb-6 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Roster santri</h2><div className="mt-3 divide-y divide-border">{students.map((student) => { const card = rows.find((item) => item.student_id === student.id); return <div key={student.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{student.full_name} <span className="text-sm text-muted-foreground">— {student.nis}</span></p><p className="text-xs text-muted-foreground">{student.halaqah_group ?? "Kelompok belum diisi"}</p></div><div className="flex items-center gap-3 text-sm"><span>{card ? (card.status === "published" ? "Terbit" : card.status === "draft" ? "Draf" : card.status) : "Belum dibuat"}</span>{!card && <button type="button" disabled={busy === student.id} onClick={() => void generate(student)} className="rounded bg-primary px-3 py-1 text-primary-foreground">{busy === student.id ? "Membuat…" : "Generate"}</button>}</div></div>; })}</div>{students.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Belum ada santri. Tambahkan santri melalui roster operasional.</p>}</section>;
}
