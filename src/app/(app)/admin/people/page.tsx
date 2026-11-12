"use client";

import * as React from "react";
import { useIdentity } from "@/components/auth/identity-context";
import { getPeopleAction, getTeamsAction, addTeamMemberAction, removeTeamMemberAction, assignReviewerAction, setTeamCoordinatorAction } from "@/modules/people/actions";
import type { PersonProfile, TeamStructureItem } from "@/modules/people/types";
import { UnauthorizedState } from "@/components/ui/unauthorized-state";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCachedData } from "@/hooks/use-cached-data";

export default function AdminPeoplePage() {
  const { user } = useIdentity();
  const peopleQuery = useCachedData("people:list", getPeopleAction);
  const teamsQuery = useCachedData("teams:structure", getTeamsAction);
  const people: PersonProfile[] = peopleQuery.data ?? [];
  const teams: TeamStructureItem[] = teamsQuery.data ?? [];
  const loading = peopleQuery.isLoading || teamsQuery.isLoading;
  const loadError = peopleQuery.error?.message || teamsQuery.error?.message || null;
  const [notice, setNotice] = React.useState<string | null>(null);
  const [memberForm, setMemberForm] = React.useState({ teamId: "", userId: "", teamRole: "member" as "member" | "coordinator" | "assistant" });
  const [reviewerForm, setReviewerForm] = React.useState({ revieweeId: "", reviewerId: "" });

  React.useEffect(() => {
    if (peopleQuery.data && teamsQuery.data) {
      const peopleData = peopleQuery.data;
      const teamsData = teamsQuery.data;
      setMemberForm((current) => ({ ...current, teamId: current.teamId || teamsData[0]?.id || "", userId: current.userId || peopleData[0]?.id || "" }));
      setReviewerForm((current) => ({ ...current, revieweeId: current.revieweeId || peopleData[0]?.id || "", reviewerId: current.reviewerId || peopleData[1]?.id || "" }));
    }
  }, [peopleQuery.data, teamsQuery.data]);

  const reload = () => {
    peopleQuery.refresh();
    teamsQuery.refresh();
  };

  if (loading) return <div className="min-h-[360px] grid place-items-center"><LoadingSpinner size="lg" /></div>;
  if (!["super_admin", "pengurus"].includes(user.role)) return <UnauthorizedState requiredRole="Super Admin / Pengurus" />;

  const submitMember = async (event: React.FormEvent) => {
    event.preventDefault();
    const selectedPerson = people.find((person) => person.id === memberForm.userId);
    const result = memberForm.teamRole === "coordinator"
      ? await setTeamCoordinatorAction(memberForm.teamId, memberForm.userId, selectedPerson?.name || "Anggota")
      : await addTeamMemberAction(memberForm);
    setNotice(result.message);
    if (result.success) reload();
  };
  const removeMember = async () => { const result = await removeTeamMemberAction(memberForm.teamId, memberForm.userId); setNotice(result.message); if (result.success) reload(); };
  const submitReviewer = async (event: React.FormEvent) => { event.preventDefault(); const result = await assignReviewerAction(reviewerForm); setNotice(result.message); if (result.success) reload(); };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 pb-20">
      <header><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">PPL-003 · Struktur &amp; Reviewer</p><h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface mt-1">Kelola anggota, tim, dan reviewer</h1><p className="text-sm text-muted-foreground mt-1">Setiap perubahan keanggotaan ditutup secara historis, bukan menghapus catatan lama.</p></header>
      {notice && <div className="rounded-xl border border-primary/30 bg-accent/30 p-3 text-sm text-on-surface" aria-live="polite">{notice}</div>}
      {loadError && <div className="rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error" role="alert">{loadError} <button type="button" className="ml-2 underline" onClick={reload}>Coba lagi</button></div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4"><div><h2 className="font-semibold text-on-surface">Kelola keanggotaan tim</h2><p className="text-xs text-muted-foreground mt-1">Koordinator utama hanya dapat dikelola satu per tim melalui aturan atomik. Pengakhiran menyimpan riwayat.</p></div><form onSubmit={submitMember} className="space-y-3"><label className="block text-xs text-muted-foreground">Anggota<select value={memberForm.userId} onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-border bg-surface-container-low px-2 text-sm">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="block text-xs text-muted-foreground">Tim<select value={memberForm.teamId} onChange={(e) => setMemberForm({ ...memberForm, teamId: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-border bg-surface-container-low px-2 text-sm">{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="block text-xs text-muted-foreground">Peran tim<select value={memberForm.teamRole} onChange={(e) => setMemberForm({ ...memberForm, teamRole: e.target.value as typeof memberForm.teamRole })} className="mt-1 w-full h-10 rounded-lg border border-border bg-surface-container-low px-2 text-sm"><option value="member">Anggota</option><option value="assistant">Asisten</option><option value="coordinator">Koordinator</option></select></label><div className="flex flex-wrap gap-2"><button type="submit" className="h-10 px-4 rounded-lg bg-primary text-on-primary text-xs font-semibold">Simpan keanggotaan</button><button type="button" onClick={removeMember} className="h-10 px-4 rounded-lg border border-border text-xs font-semibold text-error hover:bg-error-container/30">Akhiri keanggotaan</button></div></form></section>
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4"><div><h2 className="font-semibold text-on-surface">Tetapkan reviewer utama</h2><p className="text-xs text-muted-foreground mt-1">Assignment baru menutup assignment aktif sebelumnya tanpa kehilangan riwayat.</p></div><form onSubmit={submitReviewer} className="space-y-3"><label className="block text-xs text-muted-foreground">Reviewee<select value={reviewerForm.revieweeId} onChange={(e) => setReviewerForm({ ...reviewerForm, revieweeId: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-border bg-surface-container-low px-2 text-sm">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="block text-xs text-muted-foreground">Reviewer<select value={reviewerForm.reviewerId} onChange={(e) => setReviewerForm({ ...reviewerForm, reviewerId: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-border bg-surface-container-low px-2 text-sm">{people.filter((person) => person.id !== reviewerForm.revieweeId).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><button type="submit" className="h-10 px-4 rounded-lg bg-primary text-on-primary text-xs font-semibold">Tetapkan reviewer</button></form></section>
      </div>
      <section className="rounded-2xl border border-border bg-card overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-semibold text-on-surface">Daftar anggota aktif</h2><p className="text-xs text-muted-foreground mt-1">{people.length} profil terbaca sesuai scope akun.</p></div><div className="divide-y divide-border">{people.slice(0, 20).map((person) => <div key={person.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"><div><p className="text-sm font-medium text-on-surface">{person.name}</p><p className="text-xs text-muted-foreground">{person.memberTypeLabel} · {person.teamName || "Belum ditempatkan"} · Reviewer: {person.primaryReviewerName || "Belum ditetapkan"}</p></div><span className="text-[11px] rounded-full bg-surface-container px-2 py-1 text-muted-foreground">{person.dutyFlags.reportRequired ? "Wajib lapor" : "Tanpa laporan"}</span></div>)}</div></section>
    </div>
  );
}
