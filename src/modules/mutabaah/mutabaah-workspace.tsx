"use client";

import { useState } from "react";
import MutabaahForm from "./mutabaah-form";

type Student = { id: string; full_name: string; nis: string };

export default function MutabaahWorkspace({ students, today, operator }: { students: Student[]; today: string; operator: boolean }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const student = students.find((item) => item.id === studentId);
  if (!student) return <section className="rounded-xl border border-border bg-card p-5 text-base text-muted-foreground">{operator ? "Belum ada santri. Tambahkan santri dari roster rapor atau minta admin menyiapkannya." : "Belum ada santri yang terhubung ke akun ini."}</section>;
  return <div className="space-y-4"><label className="block text-sm text-muted-foreground">Pilih santri<select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-input bg-card px-3 text-base text-on-surface">{students.map((item) => <option key={item.id} value={item.id}>{item.full_name} — {item.nis}</option>)}</select></label><MutabaahForm key={student.id} studentId={student.id} studentName={`${student.full_name} · NIS ${student.nis}`} today={today} operator={operator} /></div>;
}
