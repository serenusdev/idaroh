"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

type Row = { id: string; student_id: string; status: string; tahfidz_data: Record<string, unknown>; diniyah_scores: unknown[]; adab_scores: Record<string, unknown>; attendance_summary: Record<string, unknown>; students: { nis: string; full_name: string } | null };
const column = createColumnHelper<Row>();

export default function ReportCardGrid({ termId, initialRows }: { termId: string; initialRows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  const timers = useRef<Record<string, number>>({});
  const update = useCallback((id: string, patch: Record<string, unknown>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...(patch.tahfidzData ? { tahfidz_data: patch.tahfidzData as Row["tahfidz_data"] } : {}) } : row));
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    window.clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(() => void fetch("/api/report-cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ termId, studentId: row.student_id, tahfidzData: patch.tahfidzData ?? row.tahfidz_data, diniyahScores: row.diniyah_scores, adabScores: row.adab_scores, attendanceSummary: row.attendance_summary, status: row.status }) }), 800);
  }, [rows, termId]);
  const columns = useMemo(() => [
    column.accessor((row) => row.students?.nis ?? "-", { id: "nis", header: "NIS" }),
    column.accessor((row) => row.students?.full_name ?? "-", { id: "name", header: "Santri" }),
    column.accessor("status", { header: "Status" }),
    column.display({ id: "tahfidz", header: "Tahfidz", cell: ({ row }) => <input className="w-32 rounded border px-2 py-1" defaultValue={String(row.original.tahfidz_data?.achieved_juz ?? "")} onChange={(event) => update(row.original.id, { tahfidzData: { ...row.original.tahfidz_data, achieved_juz: event.target.value } })} /> }),
  ], [update]);
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  return <div className="mt-6 overflow-x-auto rounded border"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr>{table.getHeaderGroups()[0].headers.map((header) => <th key={header.id} className="px-3 py-2 text-left">{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr></thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className="border-t">{row.getVisibleCells().map((cell) => <td key={cell.id} className="px-3 py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>;
}
