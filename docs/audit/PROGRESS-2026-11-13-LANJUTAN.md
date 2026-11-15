# Laporan Progres Lanjutan — 2026-11-13

**Ditulis:** 2026-11-13 (akhir sesi lanjutan)
**Baseline commit:** `9bac409` — semua perubahan di working tree `main`, **belum ada commit/push**
**Penulis:** Agen implementasi (kiro)

---

## 1. Ringkasan: Apa yang Selesai di Sesi Ini

Sesi lanjutan ini mengerjakan dua fase terpisah setelah handover awal.

### Fase 1 — Verifikasi & Stabilisasi

| Kegiatan | Hasil |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm run test -- --maxWorkers=2` | ✅ PASS — **297 test hijau** (31 file) |
| Playwright E2E | ❌ Sandbox OS memblokir peluncuran Chromium — bukan bug kode |
| Fixture `registration-consent.spec.ts` | Bundle terverifikasi via Node.js langsung |
| Review Independen Dokumen | ✅ Selesai → `docs/audit/REVIEW-INDEPENDEN-2026-11-13.md` |

Review independen mencakup validasi:
- SQL `xmin::text::bigint` & `SHARE ROW EXCLUSIVE` → valid dan masuk akal
- Kolom migrasi 20261113 → cocok dengan klaim dokumen
- PRD v2.1 keputusan → terdokumentasi lengkap
- Gap TRC-07 → seed `report_reminder` 21:00 vs PRD 19:30 masih open
- Inkonsistensi kecil PRD-01 §5.2 → menyebut `phone` tapi kolom asli `phone_number`

### Fase 2 — Implementasi Backlog §4

**11 item backlog diimplementasikan.** `typecheck ✅ | 326/326 test hijau (32 file)`.

---

## 2. Status Per Item Backlog

| Item | Status | File yang Diubah | Test Coverage |
|---|---|---|---|
| **UX-16** — Sembunyikan tombol non-admin di halaman jadwal | ✅ **Selesai** | `src/app/(app)/jadwal/page.tsx` | Pemeriksaan kondisi peran; tidak ada unit test terpisah (komponen UI) |
| **SEC-03** — Masking nomor HP robust | ✅ **Selesai** | `src/modules/people/actions.ts` | `src/__tests__/backlog-phase2.test.ts` (SEC-03 group) |
| **SEC-07** — Pesan error seragam anti-enumerasi | ✅ **Selesai** | `src/app/api/auth/login/route.ts`, `src/modules/iam/actions.ts` | `src/__tests__/backlog-phase2.test.ts` (SEC-07 group) + `src/__tests__/registration-consent.test.ts` (+6 test) |
| **FUNC-01** — Validasi durasi SQL | ✅ **Selesai** | `src/modules/reports/actions.ts`, `supabase/migrations/20261114000001_fix_duration_regex.sql` | `src/__tests__/backlog-phase2.test.ts` (FUNC-01 group) |
| **FUNC-02 + TRC-14** — `is_late` server-side + truncation menit | ✅ **Selesai** | `src/lib/auth/guards.ts` | `src/__tests__/backlog-phase2.test.ts` (FUNC-02/TRC-14 group) |
| **FUNC-15** — Hapus fallback fixture kontak | ✅ **Selesai** | `src/modules/people/actions.ts` | Dicakup oleh test SEC-03 yang diperbarui |
| **FUNC-26** — Perbaiki kondisi `projectId` terbalik | ✅ **Selesai** | `src/modules/tasks/actions.ts` | `src/__tests__/tasks.test.ts` (+1 test FUNC-26) |
| **TRC-02** — Layar pending untuk akun menunggu review | ✅ **Selesai** | `src/lib/auth/session.ts` | Dicakup oleh test session yang ada |
| **TRC-07** — Default pengingat laporan 19:30 | ✅ **Selesai** | `supabase/migrations/20261114000002_fix_report_reminder_default.sql` | `src/__tests__/backlog-phase2.test.ts` (TRC-07 group) |
| **REG-02** — Password min 10 karakter + HIBP | ✅ **Selesai** | `src/modules/iam/actions.ts`, `src/app/(auth)/register/page.tsx` | `src/__tests__/backlog-phase2.test.ts` (REG-02 group) + `src/__tests__/registration-consent.test.ts` (+6 test REG-02 batas 10 karakter) |
| **REG-04** — Rate limit per-IP registrasi | ✅ **Selesai** | `src/modules/iam/actions.ts` | `src/__tests__/backlog-phase2.test.ts` (REG-04 group) |

### Test Baru yang Ditambahkan (Fase 2)

| File | Deskripsi | Jumlah Test |
|---|---|---|
| `src/__tests__/backlog-phase2.test.ts` | Test utama Fase 2: SEC-03, FUNC-01, FUNC-02+TRC-14, FUNC-26, SEC-07, REG-02, TRC-07 | 28 test baru |
| `src/__tests__/registration-consent.test.ts` | +6 test: REG-02 batas 10 karakter, SEC-07 anti-enumerasi | +6 test |
| `src/__tests__/tasks.test.ts` | +1 test: FUNC-26 projectId pendek | +1 test |

**Total test akhir: 326 test hijau (32 file)**

---

---

## Fase 3 — P1 Batch 2

**Dikerjakan:** 2026-11-14 (sesi lanjutan setelah Fase 2)
**Baseline:** 326 test hijau (32 file) — tidak ada commit baru

### Item yang Selesai

| Item | File yang Diubah | Ringkasan |
|---|---|---|
| **SEC-02** | `src/modules/iam/actions.ts` | `resetUserSessionAction` kini memverifikasi hierarki pemanggil vs target sebelum reset sesi (pola `revokeDeviceTokenAction`); pengurus tidak bisa mencabut sesi super_admin/yayasan. |
| **SEC-04** | `src/modules/operations/actions.ts` | MIME allowlist diterapkan di `uploadTaskAttachmentAction` — hanya PDF, JPEG, PNG, WebP, DOCX, XLSX, MP4, WebM diterima; header `Content-Disposition: attachment` ditambahkan agar file tidak disajikan inline. |
| **FUNC-05** | `src/modules/iam/actions.ts` | `inviteUserByEmail` memeriksa duplikat email di `profiles` dan `account_requests` sebelum invite; pesan error seragam tanpa bocorkan status keberadaan akun. |
| **FUNC-06** | `src/modules/attendance/actions.ts` | `getAttendanceHistoryAction` menerima `targetUserId`; query di-scope per user dan hierarki pemanggil divalidasi sebelum mengambil data user lain. |

### Jumlah Test Setelah Sesi Ini

**357 test hijau (33 file)** — penambahan 31 test dari sesi ini (SEC-02, SEC-04, FUNC-05, FUNC-06 masing-masing dilengkapi test unit baru di `src/__tests__/backlog-phase3.test.ts`).

### Item P1/P2 yang Masih Terbuka Setelah Sesi Ini

**P1 yang belum ditangani (dari §3.1 dan AUDIT-FINDINGS §A/§C):**

| Item | Deskripsi |
|---|---|
| **SEC-01 / FUNC-04** | `adminUpdateUserAction` non-atomik + tanpa audit (RPC atomik beraudit; server action + guard sudah diterima sementara — RPC tetap terbuka) |
| **FUNC-03** | PDF font trace Vercel — perlu uji runtime produksi; fix preventif (outputFileTracingIncludes) disarankan sebelum deploy |
| **TRC-22** | `tasks.reviewer_id` tak pernah di-set → approve tugas requires_review mustahil dari koordinator/pembuat |
| **TRC-23** | UI tugas tanpa assignee picker + tanpa parser mention → penugasan tugas mustahil dari UI |
| **UX-01** | Identitas reviewer palsu hardcode di halaman review laporan |
| **UX-02** | Profil & MFA tak terjangkau di mobile (link hanya di desktop-header) |
| **UX-03** | Submit koreksi & exception kehadiran tanpa handling error (gagal = diam) |
| **UX-04** | Dashboard audit: angka palsu hardcode + alasan approve canned tertulis ke audit trail |
| **UX-05** | Alasan tolak permohonan di-bypass (default string hardcode) |
| **UX-06** | Modal tugas terpotong di layar kecil (tanpa max-height + overflow-y-auto) |
| **TRC-04** | Email keputusan (approve/reject akun) belum dikirim ke pemohon |
| **TRC-05** | Riwayat laporan pribadi santri — sudah diimplementasikan Fase 1, migrasi belum diterapkan operator |
| **OPS-02** | `account_requests` tanpa partial unique index `WHERE status='pending'` |
| **OPS-04** | Tanpa error monitoring/alerting (Sentry/log drain) |
| **OPS-07** | Seed E2E tanpa guard NODE_ENV — risiko kontaminasi produksi |
| **SEC-05** | Suspend tidak set `session_revoked_at` — sesi tidak dicabut seketika (bundle SEC-01) |

**P2 yang masih terbuka (ringkas, tunda v1.1 kecuali ditandai "sekarang"):**

| Item | Keterangan |
|---|---|
| **TRC-20** | Acara cancelled disembunyikan (bukan tampil "Dibatalkan") — perbaiki sekarang |
| **TRC-21** | Klaim UI "15 menit pengingat acara" palsu — hapus teks sekarang |
| **TRC-26** | Bio: guard terbalik + tulis ke kolom `notes` — perbaiki sekarang |
| **TRC-27** | Deep-link resource: query limit 100 + bidang kosong dibuang — perbaiki sekarang |
| **UX-07–UX-24** (selektif) | Pesan error mentah, empty vs error state, aksesibilitas (batch) — perbaiki sekarang |
| **SEC-07** | Enumerasi akun sisa (sudah sebagian diperbaiki Fase 2; sisa: registrasi path) |
| **TRC-24** | Progres proyek termasuk cancelled — tunda v1.1 |
| **FUNC-07/08/09/10** | Statistik dashboard, race kondisi perpustakaan — tunda v1.1 |
| **OPS-01** | Backup PITR — tugas operator (P0, segera) |
| **SEC-11/TRC-01** | Turnstile widget UI belum ada — jangan set secret sebelum widget rilis |

---

## 3. Yang Masih Terbuka

### 3.1 Item Backlog Belum Dikerjakan (dari §4 Handover)

Berikut item-item yang disebutkan di handover namun **tidak termasuk** dalam 11 item Fase 2:

| Item | Alasan Belum Dikerjakan |
|---|---|
| **SEC-01** — `adminUpdateUserAction` atomik + audit | Kompleks (RPC baru); ditunda per keputusan §8 handover (server action + guard diterima NOW; RPC atomik tetap v1.1) |
| **SEC-02** — `resetUserSessionAction` cek hierarki | Belum masuk backlog Fase 2 |
| **SEC-04** — MIME allowlist lampiran tugas | Belum masuk backlog Fase 2 |
| **FUNC-05** — Invite email existing tanpa cek | Belum masuk backlog Fase 2 |
| **FUNC-06** — Riwayat kehadiran admin tanpa scope user | Belum masuk backlog Fase 2 |
| **TRC-10/IAM-012** — MFA TOTP enforcement | Tunda v1.1 (keputusan pemilik §A.3); release gate = aktivasi manual TOTP oleh semua super_admin existing |
| **UX-23** — Konsolidasi model audiens | Tunda v1.1 (keputusan pemilik §A.9) |
| **TRC-25/PPL** — CRUD tim | Tunda v1.1; interim operator SQL (`docs/operator-team-sql.md`) |
| **TRC-30** — Dashboard koordinator | Tunda v1.1 (keputusan pemilik §A.6) |
| **FUNC-03** — PDF font trace Vercel | Membutuhkan uji runtime produksi; fix preventif disarankan sebelum deploy |

### 3.2 Item Sebagian / Gap yang Tersisa

| Issue | Detail |
|---|---|
| **TRC-07 (seed DB)** | Migrasi `20261114000002` sudah ditulis tetapi **belum diterapkan operator** ke DB produksi/staging. Gap 21:00 vs 19:30 tetap aktif di DB. |
| **FUNC-01 (regex durasi)** | Migrasi `20261114000001` sudah ditulis tetapi **belum diterapkan operator**. Semua laporan masih menggunakan durasi 60 menit di DB produksi. |
| **PRD-01 §5.2** | Kolom `phone` vs `phone_number` — inkonsistensi kecil dokumentasi (kode sudah benar). |
| **Inspeksi visual screenshot** | Screenshot E2E tersimpan tapi belum diinspeksi visual (sandbox memblokir browser). |
| **E2E suite penuh** | `npx playwright test --workers=2` belum bisa dijalankan di sandbox. Jalankan dari terminal normal. |
| **Review PRD baris-per-baris** | Preview sebagian dari sesi pertama; review penuh masih terbuka. |
| **Verifikasi operator-team-sql.md** | Query `xmin::text::bigint = txid_current() % 4294967296` dan lock `SHARE ROW EXCLUSIVE` belum diuji di DB nyata. Review ulang sebelum dipakai operator. |

---

## 4. Instruksi untuk Penerus

### 4.1 State Working Tree Saat Ini

**Baseline commit:** `9bac409` (tidak ada commit baru — ini kebijakan, bukan kelalaian)

**File yang dimodifikasi (M):**

| File | Diubah Oleh |
|---|---|
| `PRD-01` s/d `PRD-08` + `Pondok OS — Master PRD v2.0.md` | Fase 1 sesi awal (PRD ke v2.1) |
| `src/__tests__/notification-outbox-cron.test.ts` | Fase 1 sesi awal |
| `src/__tests__/tasks.test.ts` | Fase 2 (+1 test FUNC-26) |
| `src/app/(app)/admin/users/page.tsx` | Fase 1 sesi awal (consent lama tampil) |
| `src/app/(app)/jadwal/page.tsx` | Fase 2 (UX-16) |
| `src/app/(app)/laporan/page.tsx` | Fase 1 sesi awal (TRC-05 riwayat laporan) |
| `src/app/(app)/settings/profile/page.tsx` | Fase 1 sesi awal (OPS-12 toggle opt-out) |
| `src/app/(auth)/register/page.tsx` | Fase 1 sesi awal + Fase 2 (REG-02) |
| `src/app/api/auth/login/route.ts` | Fase 2 (SEC-07) |
| `src/app/api/cron/notifications/route.ts` | Fase 1 sesi awal (OPS-12 filter cron) |
| `src/components/layout/more-sheet.tsx` | Fase 1 sesi awal (link Pengaturan Profil) |
| `src/lib/auth/guards.ts` | Fase 2 (FUNC-02+TRC-14) |
| `src/lib/auth/session.ts` | Fase 2 (TRC-02) |
| `src/modules/iam/actions.ts` | Fase 1 sesi awal + Fase 2 (REG-02, REG-04, SEC-07) |
| `src/modules/notifications/actions.ts` | Fase 1 sesi awal (OPS-12) |
| `src/modules/people/actions.ts` | Fase 2 (SEC-03, FUNC-15) |
| `src/modules/reports/actions.ts` | Fase 1 sesi awal + Fase 2 (FUNC-01) |
| `src/modules/reports/types.ts` | Fase 1 sesi awal (TRC-05) |
| `src/modules/tasks/actions.ts` | Fase 2 (FUNC-26) |

**File baru (untracked, `??`):**

| File | Keterangan |
|---|---|
| `docs/ADR-2026-11-13-cron-job-org.md` | ADR cron eksternal |
| `docs/HANDOVER-2026-11-13.md` | Dokumen handover original |
| `docs/audit/AUDIT-FINDINGS-2026-11-12.md` | Register temuan audit |
| `docs/audit/REVIEW-INDEPENDEN-2026-11-13.md` | Review independen Fase 1 |
| `docs/audit/PROGRESS-2026-11-13-LANJUTAN.md` | **File ini** |
| `docs/operator-team-sql.md` | SQL operator tim (interim) |
| `e2e/attendance-reminder-preference.spec.ts` | Fixture E2E OPS-12 |
| `e2e/registration-consent.spec.ts` | Fixture E2E REG-01/03 |
| `e2e/report-history.spec.ts` | Fixture E2E TRC-05 |
| `src/__tests__/attendance-reminder-preference.test.ts` | Unit test OPS-12 |
| `src/__tests__/backlog-phase2.test.ts` | Unit test Fase 2 (28 test) |
| `src/__tests__/registration-consent.test.ts` | Unit test REG-01/03 |
| `src/__tests__/report-history.test.ts` | Unit test TRC-05 |
| `src/modules/iam/registration.ts` | Konstanta kategori/versi/notice |
| `supabase/migrations/20261113000001_registration_consent.sql` | Migrasi kolom consent ⚠️ belum diterapkan |
| `supabase/migrations/20261113000002_attendance_reminder_preference.sql` | Migrasi preferensi pengingat ⚠️ belum diterapkan |
| `supabase/migrations/20261114000001_fix_duration_regex.sql` | Migrasi fix regex durasi ⚠️ belum diterapkan |
| `supabase/migrations/20261114000002_fix_report_reminder_default.sql` | Migrasi fix default 19:30 ⚠️ belum diterapkan |

### 4.2 Migrasi yang Menunggu Operator

**4 migrasi file sudah ditulis, belum diterapkan ke DB produksi/staging:**

> ⚠️ **Jangan jalankan migrasi tanpa otorisasi pemilik.** Semua migrasi dirancang tanpa perubahan RLS/grant dan tanpa backfill — tapi tetap perlu review sebelum `supabase db push` atau `psql`.

| File | Isi | Prioritas |
|---|---|---|
| `supabase/migrations/20261113000001_registration_consent.sql` | Tambah kolom `claimed_member_type`, `privacy_consent_version`, `privacy_consent_at` ke `account_requests` | Wajib sebelum fitur registrasi consent aktif di produksi |
| `supabase/migrations/20261113000002_attendance_reminder_preference.sql` | Tambah kolom preferensi opt-out pengingat ke tabel profil | Wajib sebelum fitur toggle opt-out aktif di produksi |
| `supabase/migrations/20261114000001_fix_duration_regex.sql` | Perbaiki regex durasi laporan (backslash escaping SQL) | Wajib — semua laporan baru tercatat 60 menit sampai diterapkan |
| `supabase/migrations/20261114000002_fix_report_reminder_default.sql` | Ubah default seed `report_reminder` dari 21:00 ke 19:30 | Wajib — TRC-07, gap PRD aktif sampai diterapkan |

**Migrasi lama (20261101–20261112) dinyatakan sudah diterapkan** di handover sebelumnya. Verifikasi ulang dengan `supabase migration list` sebelum menerapkan yang baru.

### 4.3 Langkah Selanjutnya yang Direkomendasikan

1. **Jalankan E2E dari terminal normal** (bukan sandbox):
   ```bash
   npx playwright test e2e/registration-consent.spec.ts --workers=2
   npx playwright test --workers=2
   ```
   Verifikasi 0/5 Chromium adalah kendala sandbox, bukan bug kode.

2. **Inspeksi visual screenshot** setelah E2E berhasil:
   - `test-results/e2e/attendance-reminder-prefer-*/reminder-mobile.png`
   - `test-results/e2e/report-history-TRC-05-*/report-history-mobile.png`
   - Registrasi consent (jalankan ulang untuk generate)

3. **Terapkan migrasi** setelah otorisasi pemilik (urutan numerik):
   ```
   20261113000001 → 20261113000002 → 20261114000001 → 20261114000002
   ```

4. **Aktivasi TOTP manual** oleh semua super_admin existing — ini release gate wajib (keputusan §A.3).

5. **Review `docs/operator-team-sql.md`** oleh pihak kedua sebelum dipakai operator. Query audit `xmin::text::bigint` belum diuji di DB nyata.

6. **Commit working tree** (hanya setelah pemilik meminta):
   ```bash
   git add -A
   git commit -m "feat: fase 1-2 implementasi backlog audit 2026-11-13"
   ```
   Jangan push atau buat PR tanpa instruksi eksplisit.

7. **Item P1 yang belum ditangani** untuk sprint berikutnya (urutan prioritas):
   - SEC-02 — `resetUserSessionAction` tanpa cek hierarki
   - SEC-04 — MIME allowlist lampiran tugas
   - FUNC-05 — Invite email existing tanpa cek
   - FUNC-06 — Riwayat kehadiran admin tanpa scope user
   - FUNC-03 — PDF font trace Vercel (uji runtime produksi dulu)

### 4.4 Kendala Wajib yang Tetap Berlaku

| Aturan | Detail |
|---|---|
| **Tidak commit/push** | Semua perubahan di working tree; commit hanya atas permintaan pemilik eksplisit |
| **Tidak apply migrasi** | Butuh otorisasi pemilik; jalankan di staging dulu sebelum produksi |
| **RLS tidak boleh dilonggarkan** | Keputusan pemilik §A.4 — hardening bertahap, bukan relaksasi |
| **Service-role tidak boleh bocor ke klien** | `src/lib/supabase/admin.ts` hanya server |
| **Tidak seed user nyata tanpa izin** | E2E staging butuh akun terotorisasi |
| **Android wrapper di luar release gate** | Keputusan §A.5 |
| **MFA enforcement tunda v1.1** | Manual TOTP = release gate; enforcement login = v1.1 |

### 4.5 Jebakan Teknis yang Sudah Diketahui

| Masalah | Lokasi | Solusi/Catatan |
|---|---|---|
| Dev server mungkin masih hidup | Port 3001 | Cek dulu: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/login` — jangan start bila sudah hidup (task `b6lqzwzkx`) |
| Playwright gagal di sandbox | Semua E2E spec | Jalankan dari terminal macOS normal, bukan dari agen/sandbox |
| `test-results/` dibersihkan tiap run | Screenshot E2E | Jalankan ulang spec untuk regenerasi screenshot |
| PDF font trace Vercel | `src/lib/pdf.ts:15-23` | `next.config.mjs` tanpa `outputFileTracingIncludes` — bisa gagal di Vercel serverless; fix preventif: bundle font ke `src/` |
| `phone` vs `phone_number` di PRD-01 §5.2 | Dokumentasi saja | `actions.ts` sudah menggunakan nama kolom benar; hanya inkonsistensi doc |
| `operator-team-sql.md` belum reverifikasi | `docs/operator-team-sql.md` | Review independen kedua gagal (kredit); jangan dipakai operator sebelum reverifikasi |

---

## 5. Referensi Dokumen

| Dokumen | Path | Keterangan |
|---|---|---|
| **Register Temuan Audit** | `docs/audit/AUDIT-FINDINGS-2026-11-12.md` | Register A–H (149 requirement, P0–P3) + §I keputusan 2026-11-13 |
| **Review Independen** | `docs/audit/REVIEW-INDEPENDEN-2026-11-13.md` | Verifikasi silang dokumen vs kode/migrasi |
| **Handover Original** | `docs/HANDOVER-2026-11-13.md` | State lengkap sebelum sesi lanjutan ini |
| **ADR Cron Job** | `docs/ADR-2026-11-13-cron-job-org.md` | Keputusan arsitektur cron eksternal (cron-job.org) |
| **Operator Team SQL** | `docs/operator-team-sql.md` | SQL interim manajemen tim (belum reverifikasi penuh) |
| **PRD-01 IAM** | `PRD-01 — Identity & Access Management v2.0.md` | v2.1 — keputusan REG, SEC, IAM |
| **PRD-03 Attendance** | `PRD-03 — Attendance v2.0.md` | v2.1 — OPS-12, ATT-013 M (NOW) |
| **PRD-04 Activity Reports** | `PRD-04 — Activity Reports v2.0.md` | v2.1 — TRC-05, TRC-07, TRC-09 |
| **PRD-05 Tasks** | `PRD-05 — Tasks & Projects v2.0.md` | v2.1 — FUNC-26, SEC-04 |
| **PRD-07 People** | `PRD-07 — People & Teams v2.0.md` | v2.1 — SEC-03, PPL-008, TRC-25 |
| **Master PRD** | `Pondok OS — Master PRD v2.0.md` | v2.1 — ringkasan semua keputusan |
| **Acceptance Checklist** | `docs/audit/ACCEPTANCE-CHECKLIST.md` | Syarat siap rilis (definisi §2 AUDIT-FINDINGS) |
| **Hardening Backlog** | `docs/audit/HARDENING-BACKLOG.md` | Item P1–P2 yang tunda v1.1 |
| **Execution Plan** | `docs/audit/EXECUTION-PLAN.md` | Rencana eksekusi audit |

---

*Dokumen ini dibuat otomatis oleh agen implementasi. Verifikasi silang dengan `git diff HEAD` untuk melihat semua perubahan aktual di working tree.*
