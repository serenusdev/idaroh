# Rencana Audit & Remediasi 2026-11-28

Branch kerja: `fix/comprehensive-audit-nis-etasrih-and-polish`
Baseline target: `main` setelah merge PR #25 (`4120946`)

Status menggunakan istilah `TERVERIFIKASI` hanya setelah perintah/tes benar-benar dijalankan; hasil pembacaan saja dicatat sebagai `DUGAAN`.

## FASE 0 — baseline & inventaris

- [x] Catat status working tree, commit `main`, dan hash tiga berkas untracked terlarang. **TERVERIFIKASI:** `main`=`4120946`; hash dicatat di inventaris.
- [x] Jalankan baseline dari worktree `main`: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`. **TERVERIFIKASI:** tsc/lint/test lulus; build gagal pre-existing karena `NEXT_PUBLIC_SUPABASE_URL` missing.
- [x] Inventaris rute, Server Action, RPC/RLS, dan temuan awal ke `docs/audit/INVENTORY-2026-11-28.md`. **TERVERIFIKASI:** file dibuat dari pemeriksaan repo.
- [x] Catat konflik/spesifikasi yang diblokir aturan mutlak sebelum remediasi. **TERVERIFIKASI:** berkas terlarang, build tanpa env, dan F-20/F-21 dicatat di inventaris/laporan.

## FASE 1 — remediasi berurutan

- [x] 1. Pustaka bersama: `role-utils`, helper WIB, mapper error, registri judul rute; tes merah → hijau. **TERVERIFIKASI:** commit `479fb5e`, tes helper lulus.
- [x] 2. UI/header, judul rute, dan branding pada area `src`; tes. **TERVERIFIKASI:** commit `b34bec6`, suite lulus.
- [x] 3. Sweep `roles[]` dan union navigasi; tes matriks multi-role. **TERVERIFIKASI:** commit `c502179`, tes kontrak lama diperbarui transparan, suite lulus.
- [x] 4. Telemetry: reproduksi F-01/F-02, hasil terstruktur, UI retry/error, dan pengukuran F-04/F-05 yang tersedia. **TERVERIFIKASI:** commit `0743b3c`; merah→hijau fake-pool; F-04/F-05 runtime belum tersedia.
- [x] 5. DB students: auto-NIS, nullable gender, ensure/backfill/triggers, self-select RLS, rollback; tes kontrak dan DB bila tersedia. **TERVERIFIKASI:** commit `d6030b5`, tes kontrak hijau; DB runtime belum tersedia.
- [x] 6. DB E-Tasrih: hardening, lifecycle, resolve/cancel/list RPC, rollback; tes siklus dan direct-RPC. **TERVERIFIKASI:** commit `ca3a2f4`, tes kontrak hijau; RLS/direct-RPC runtime belum tersedia.
- [x] 7. UI/server action E-Tasrih, QR, scanner fallback, dan E2E non-produksi bila akun tersedia. **TERVERIFIKASI:** commit `d84b9dd`, tsc/suite lulus; E2E kamera/DB belum tersedia.
- [x] 8. Mutaba'ah: roster, tanggal WIB, summary, RPC, dan empty state. **TERVERIFIKASI:** commit `ecf6d28`, kontrak + suite lulus; DB RLS belum runtime.
- [x] 9. Rapor: term, roster dual-track, generate idempoten, dan empty state. **TERVERIFIKASI:** commit `79148a6`, tsc/suite lulus; DB/RLS generate runtime belum tersedia.
- [x] 10. Analytics drill-down via ReadonlyKysely, seluruh metrik kartu, konsistensi kontrak, D3. **TERVERIFIKASI:** commit `6a75feb` + `733b833`; tsc/suite lulus.
- [x] 11. Sweep serialisasi error dan jalur waktu yang aman. **TERVERIFIKASI sebagian:** commit `6ea7e12`, tes serialisasi lulus; cold-start/dead-link penuh masih dilaporkan sebagai risiko.
- [x] 12. Rebranding sisa, Android/ICS/export/email, dan allowlist. **TERVERIFIKASI:** commit `a528b1b`, tsc/suite lulus; identifier/URL yang diizinkan dipertahankan.
- [x] 13. Dokumen audit, delta izin, dan rujukan dokumen. **TERVERIFIKASI:** laporan dan `PERMISSIONS-DELTA-2026-11-28.md` dibuat; struktur PRD sudah berada di `docs/product` pada baseline.

## FASE 2 — verifikasi & laporan

- [ ] Jalankan tes baru/yang diperbarui dengan bukti merah sebelum dan hijau sesudah perbaikan.
- [x] Jalankan `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` pada hasil akhir. **TERVERIFIKASI:** tsc lulus, lint exit 0 dengan warning existing, test 103/1402/6; build terblokir validasi env Turnstile/Supabase.
- [ ] Verifikasi diff kosong pada berkas terlarang dan hash tiga berkas untracked tetap sama.
- [x] Tulis `docs/audit/AUDIT-REMEDIASI-2026-11-28.md` dengan status F-01..F-21, keputusan K1–K8, risiko, dan tindakan operator.
- [x] Commit atomik sesuai §7; branch siap ditinjau tanpa push ke `origin/main` atau apply migrasi produksi.

## Bukti eksekusi

- Baseline `main`: terverifikasi di worktree disposable: tsc/lint/test lulus; build gagal karena environment Supabase placeholder/missing.
- Hash artefak terlarang: dicatat di `docs/audit/INVENTORY-2026-11-28.md`; final hash check masih harus dijalankan.
- Suite terakhir lokal: 103 file, 1404 passed, 6 skipped; lint final exit 0 dengan warning existing; build lokal terblokir env non-produksi yang belum lengkap. CI database-integration lulus termasuk RLS, E2E, dan DX-01 parity.

