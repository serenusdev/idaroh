# Laporan Audit & Remediasi IDAROH — 2026-11-28

## Ringkasan

Branch `fix/comprehensive-audit-nis-etasrih-and-polish` dibuat dari `main` pada commit `4120946`, yaitu baseline setelah PR #25. Baseline `main` terverifikasi: `tsc` lulus, lint lulus dengan warning yang sudah ada, test lulus (1308 passed, 6 skipped), dan build terblokir validasi environment karena `NEXT_PUBLIC_SUPABASE_URL` tidak tersedia di worktree baseline. Pada branch remediasi, suite terakhir lulus 103 file / 1402 test passed / 6 skipped.

Perbaikan terverifikasi melalui tes sumber/unit: telemetry, multi-role, NIS, E-Tasrih, mutabaah, rapor, analytics drilldown, branding, dan serialisasi error. Verifikasi runtime lokal CI kini juga lulus untuk migrasi, RLS matrix, browser E2E, dan DX-01 parity; tidak ada akses produksi digunakan.

## Status temuan F-01–F-21

| ID | Status | Bukti / catatan |
|---|---|---|
| F-01 | Terverifikasi diperbaiki | fake-pool merah sebelum patch, normalisasi date key + tes regresi hijau |
| F-02 | Terverifikasi diperbaiki | jalur `fetchLiveTelemetry` diuji tanpa hanya mengandalkan fixture |
| F-03 | Terverifikasi diperbaiki | hasil action terstruktur, fallback WIB, retry/error UI |
| F-04 | Ditunda/dugaan | pengukuran cold-start produksi/staging belum tersedia; reader terlarang tidak diubah |
| F-05 | Belum dapat diverifikasi | env `SUPABASE_DB_URL`/SSL pooler tidak tersedia; operator perlu memeriksa Vercel |
| F-06 | Terverifikasi diperbaiki | label header berasal dari roles multi-role, bukan hardcode Santri |
| F-07 | Terverifikasi diperbaiki | registri route title dan fallback IDAROH |
| F-08 | Diperbaiki secara kode, runtime belum diverifikasi | self-select RLS ada pada migrasi baru |
| F-09 | Terverifikasi diperbaiki | gender students nullable pada migrasi baru |
| F-10 | Diperbaiki secara kode, runtime belum diverifikasi | direct INSERT dicabut dan lifecycle RPC diperkeras |
| F-11 | Diperbaiki secara kode, runtime belum diverifikasi | overdue/cancel/returned-late lifecycle baru |
| F-12 | Diperbaiki secara kode, runtime belum diverifikasi | self-review gate pass ditolak |
| F-13 | Terverifikasi diperbaiki secara kode | form, status Indonesia, QR hanya approved/out, scanner fallback; E2E kamera belum ada |
| F-14 | Terverifikasi diperbaiki secara kode | roster dan tanggal WIB; DB RLS belum runtime |
| F-15 | Terverifikasi diperbaiki secara kode | create-term empty state dan roster dual-track |
| F-16 | Terverifikasi diperbaiki | semua metrik memakai ReadonlyKysely, D3 guard, tanpa limit 100 |
| F-17 | Terverifikasi diperbaiki secara UI | semua segmen menjadi button drilldown; konsistensi agregat vs baris perlu staging |
| F-18 | Terverifikasi diperbaiki pada sweep teridentifikasi | tes multi-role lulus; audit lanjutan tetap perlu review manual |
| F-19 | Terverifikasi diperbaiki untuk jalur yang diaudit | mapper unknown error dipakai query/background/export; sweep seluruh action masih berisiko residual |
| F-20 | Diblokir sebagian | pola pada `src/modules/reports/actions.ts` dan reader/berkas terlarang dilaporkan, tidak disentuh |
| F-21 | Dilaporkan sebagai selisih kebijakan | populasi telemetry berbasis `member_type` tidak diubah tanpa keputusan product owner |

## Perubahan database

Migrasi baru: `202612040001_students_auto_nis_and_sync.sql` (+down), `202612040003_gate_pass_hardening.sql` (+down), `202612040004_mutabaah_date_scope.sql` (+down), `202612040005_academic_terms_command.sql`, dan `202612040006_fix_student_audit_actor.sql` (+down). Semuanya dibuat setelah migrasi lama, idempoten sesuai cakupan, dan berakhir dengan reload schema. Tidak ada migrasi diterapkan ke produksi. Rollback gate pass mempertahankan kolom lifecycle untuk mencegah kehilangan data dependen; operator harus meninjau rollback sebelum penerapan.

## Keputusan K1–K8

Default prompt digunakan: K1 `returned` + penanda terlambat; K2 gender nullable; K3 blokir self-review berdasarkan student owner; K4 super_admin-only tidak menerima nama; K5 tidak menambah role ustadz; K6 populasi telemetry `member_type` dipertahankan dan dilaporkan; K7 30 hari; K8 approved kedaluwarsa menjadi cancelled.

## Aturan mutlak dan risiko

`src/modules/reports/actions.ts`, `src/lib/db/reader.ts`, migrasi trigger append-only, dan `PERMISSIONS.md` tidak diubah. Tiga artefak untracked terlarang tidak disentuh dan hash awal/final harus dicocokkan sebelum PR. Build final tetap memerlukan environment Supabase lengkap. Migrasi/RLS, E2E kamera, SSL pooler, konsistensi analytics terhadap data nyata, dan produksi belum diverifikasi.

## Tes terakhir

- `npx tsc --noEmit`: lulus pada setiap commit remediasi terakhir.
- `npm test`: 103 file, 1404 passed, 6 skipped.
- `npm run lint`: gate akhir exit 0 dengan warning existing.
- `npm run build`: gagal pada baseline dan gate akhir karena validasi environment (`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) tidak tersedia atau placeholder; perlu diulang dengan env non-produksi lengkap.
