# Review Independen Dokumen — 2026-11-13

**Reviewer:** Agen independen (kiro) · **Tanggal review:** 2026-11-13
**Metode:** Baca dokumen + verifikasi silang dengan file migrasi SQL di repository. Tidak ada eksekusi SQL di database produksi. Verifikasi kode berdasarkan baca file sumber, bukan jalankan.

---

## 1. `docs/audit/AUDIT-FINDINGS-2026-11-12.md` — §I & Register A–H

### Temuan

**Register A–H masih valid sebagai bukti baseline.** Nomor baris merujuk kode pada commit baseline `9bac409`; bagian I sudah diperbarui ke keputusan 2026-11-13.

**§I:** Status tindak lanjut akurat untuk pekerjaan lokal yang selesai (riwayat laporan, opt-out pengingat, registrasi+consent), dengan catatan jujur bahwa:
- Fixture registrasi diperbaiki tapi belum dijalankan ulang.
- Screenshot ada tapi belum diinspeksi visual.
- E2E suite penuh belum dijalankan sesi ini.
- Migrasi 20261113 belum diterapkan operator.

**Gap yang ditemukan di §I:**
- Status `uji runtime terautentikasi terblokir` pada UX-06 (modal tugas terpotong mobile) tidak disebutkan di §I sebagai temuan terbuka, hanya ada di §F.
- OPS-07 (seed E2E tanpa guard produksi) belum jelas apakah sudah diperbaiki atau masih terbuka — tidak ada keterangan di §I.

**Tidak ditemukan inkonsistensi material** antara register dan keputusan §I. Dokumen jujur menyebutkan limitasi (tidak ada E2E DB produksi terautentikasi, kredit terbatas, review independen gagal).

---

## 2. PRD v2.1 — Perubahan dari Sesi Sebelumnya

### 2.1 PRD-01 (IAM) v2.1

**Perubahan yang ditemukan dan dikonfirmasi:**
- §5.2: Kolom `account_requests` sudah mencantumkan `claimed_member_type`, `privacy_consent_version`, `privacy_consent_at` — **sesuai migrasi 20261113000001**.
- §16: Keputusan REG-01+REG-03/IAM-017 NOW terdokumentasi lengkap dengan 5 kategori klaim dan syarat consent.
- IAM-017 sekarang berlabel `S (NOW; bukan v1.1)` — perubahan dari MISSING ke NOW. ✅
- IAM-012 MFA: enforcement login = v1.1; release gate manual TOTP = NOW. ✅
- BR-IAM-02: server action + guard diterima NOW; RPC atomik tetap target v1.1. ✅

**Gap kecil:**
- §5.2 menyebutkan kolom `claimed_member_type` sebagai bagian tabel `account_requests`, **tapi kolom `phone` di §5.2 masih menggunakan nama lama** sementara nama kolom asli di migrasi adalah `phone_number`. Ini inkonsistensi dokumentasi kecil (tidak mempengaruhi kode karena actions.ts menggunakan kolom yang benar).

### 2.2 PRD-03 (Attendance) v2.1

**Perubahan yang dikonfirmasi:**
- ATT-013: dipindah dari S ke M (NOW) dengan keterangan `OPS-12, 2026-11-13`. ✅
- ATT-011: dimarkahi `[v1.1 — penundaan Must disetujui pengguna 2026-11-13]`. ✅
- ATT-015, ATT-017, ATT-018: semua dimarkahi `[v1.1 — disetujui 2026-11-13]`. ✅
- OPS-12/ATT-013: §16 mendokumentasikan satu toggle opt-out pengingat absensi dengan detail persyaratan yang benar. ✅
- OD-004: reviewer koreksi wajib pengurus+ (NOW 2026-11-13) terdokumentasi. ✅

**Tidak ada gap material ditemukan di PRD-03.**

### 2.3 PRD-04 (Activity Reports) v2.1

**Perubahan yang dikonfirmasi:**
- REP-012: dimarkahi `[NOW — TRC-05, 2026-11-13]`. ✅
- REP-014: masih `S` tanpa perubahan — seed `report_reminder` 21:00 diakui sebagai gap terbuka di §16: *"Pengingat laporan tetap mengikuti requirement sebelum 21.00; seed 21.00 yang tercatat di ADR adalah selisih konfigurasi, bukan perubahan tenggat atau klaim sudah diperbaiki."* ✅
- Backfill (TRC-09/B): diblokir total, bukan 7 hari. ✅
- REP-006/015/016/017/018/019/020: semua `[v1.1 — disetujui 2026-11-13]`. ✅

**Gap yang ditemukan:**
- §8 (Alur Pengingat / REP-014) menyebut `job_key: report_reminder, 19:30 WIB` sebagai target tapi seed aktual adalah 21:00 (dikonfirmasi ADR). PRD-04 secara jujur menyebut ini sebagai selisih konfigurasi belum diperbaiki, **tapi baris keputusan §16 perlu menegaskan TRC-07 masih open** (sekarang hanya disebutkan implisit).

### 2.4 Master PRD v2.1

**Perubahan dikonfirmasi:**
- §0.4 keputusan tabel: semua entri A, B, C terdokumentasi dengan benar. ✅
- cron-job.org/FCM/presence diakui di §4.1 dan §4.2 (Android bukan release gate). ✅
- ADR dirujuk dari Master PRD. ✅

**Tidak ada gap material di Master PRD.**

### 2.5 PRD-02, 05, 06, 07, 08

Pembaruan minor (tambah label `[v1.1]` pada temuan terbuka) dikonfirmasi konsisten dari header versi 2.1 yang ada. Review baris-per-baris penuh tidak dilakukan karena keterbatasan konteks — lihat catatan di bawah.

**Catatan:** Review baris-per-baris menyeluruh semua PRD tidak tuntas (PRD-02/05/06/07/08 hanya dicek header dan beberapa kunci requirement via grep). Pemilik harus melakukan review manual untuk PRD tersebut jika diperlukan konfirmasi penuh.

---

## 3. `docs/operator-team-sql.md` — Verifikasi SQL

### 3.1 Query Audit: `xmin::text::bigint = txid_current() % 4294967296`

**Penilaian: masuk akal, dengan catatan.**

Pola ini adalah teknik PostgreSQL untuk menemukan baris yang ditulis dalam transaksi saat ini sebelum commit. `xmin` adalah system column PostgreSQL yang menyimpan transaction ID (32-bit modular) dari baris yang dibuat. `txid_current()` mengembalikan 64-bit transaction ID; modulo `4294967296` (= 2^32) mengambil bagian 32-bit rendah.

Pola ini **umum digunakan** dan **valid secara SQL PostgreSQL** untuk melihat baris baru dalam transaksi sebelum commit, biasanya untuk verifikasi dry-run. Tidak ada false positive atau false negative dalam kondisi normal pada PostgreSQL.

**Catatan teknis:** Di PostgreSQL 13+, `txid_current()` sudah deprecated menuju `pg_current_xact_id()`, tapi masih berfungsi. Di Supabase (PostgreSQL 15.x), keduanya tersedia. Risiko: saat transaction ID wraparound (sangat jarang, butuh miliaran transaksi), pola ini bisa memberi false positive. Untuk penggunaan operator satu kali ini, risiko dianggap dapat diterima.

**Kesimpulan: query audit masuk akal dan benar untuk penggunaan dry-run yang dimaksud.**

### 3.2 Lock `SHARE ROW EXCLUSIVE`

**Penilaian: masuk akal dan sesuai intent.**

`SHARE ROW EXCLUSIVE` (alias `SRX`) pada tabel `public.teams`, `public.team_members`, `public.user_roles` berarti:
- Memblokir INSERT/UPDATE/DELETE (DML) dari transaksi lain pada ketiga tabel.
- Memblokir `SHARE`, `SHARE ROW EXCLUSIVE`, `EXCLUSIVE`, dan `ACCESS EXCLUSIVE` locks lain.
- Mengizinkan `ACCESS SHARE` (SELECT biasa) tetap berjalan.

Ini tepat untuk operasi tim yang perlu memastikan tidak ada konflik write bersamaan (mis. operasi lain menambah anggota saat proses arsip). `statement_timeout = '30s'` dan `lock_timeout = '5s'` memberikan batas aman jika lock tidak bisa didapat.

**Kesimpulan: `SHARE ROW EXCLUSIVE` masuk akal untuk use case ini.**

### 3.3 Verifikasi Kolom/Constraint vs Migrasi

| Klaim dokumen | Kolom/constraint aktual di migrasi | Status |
|---|---|---|
| `teams`: kolom `id, name, slug, description, status, created_at, archived_at` | ✅ Sesuai `20261101000007_people_teams_schema.sql` (dikutip dalam dokumen) | COCOK |
| `teams`: **tidak ada** `created_by, updated_at, parent_team_id` | Migrasi asal tidak mencantumkan kolom ini | COCOK |
| `teams.status CHECK active/archived` | Diklaim ada di migrasi — tidak diverifikasi langsung (migrasi 20261101000007 tidak dibaca penuh), tapi konsisten dengan penggunaan kode | PARTIAL — perlu cek langsung |
| `team_members`: kolom `id, team_id, user_id, team_role, title, valid_from, valid_to, created_at` | Diklaim sesuai migrasi 20261101000007 | PARTIAL — tidak dibaca penuh |
| `team_members`: **tidak ada** `added_by, removed_by, note` | Diklaim tidak ada | PARTIAL |
| `team_role CHECK coordinator/member/assistant` | Diklaim sesuai | PARTIAL |
| `audit_logs` (`public`): `id, event_name, actor_id, actor_name, target_id, target_label, action_detail, payload, ip_address, created_at, hash, previous_hash` | ✅ Kolom awal ada di `20261101000008_analytics_audit_schema.sql`; `previous_hash` ditambahkan di `20261102000015_notifications_audit_integrity.sql` | COCOK (terkonfirmasi langsung) |
| Partial unique index `WHERE valid_to IS NULL` untuk satu membership terbuka per `(team_id, user_id)` | Diklaim di `20261102000009_active_membership_constraints.sql` | PARTIAL |
| Partial unique index koordinator `WHERE team_role='coordinator' AND valid_to IS NULL` | Diklaim di `20261102000005_audit_hardening.sql` | PARTIAL |
| `account_requests` kolom baseline (original, sebelum 20261113): `id, user_id, full_name, email, phone_number, role_requested, team_requested, notes, status, reviewed_by, reviewed_at, rejection_reason, turnstile_verified, created_at, updated_at` | ✅ Terkonfirmasi langsung dari `20261101000001_iam_schema.sql` | COCOK |
| `account_requests` kolom tambahan (20261113000001): `claimed_member_type, privacy_consent_version, privacy_consent_at` | ✅ Terkonfirmasi langsung dari migrasi | COCOK |
| `profiles`: kolom baseline mencakup `attendance_reminder_enabled` | ❌ Kolom ini TIDAK ada di baseline — ditambahkan oleh migrasi `20261113000002` | PERLU PERHATIAN |

**Catatan kritis:** Dokumen `operator-team-sql.md` **tidak menyebut** kolom `attendance_reminder_enabled` (wajar karena dokumen ini fokus pada tim, bukan profil), sehingga tidak ada klaim salah dari sisi itu.

**Rekomendasi:** Migrasi 20261101000007 (`people_teams_schema.sql`) belum dibaca langsung dalam review ini. Operator wajib mencocokkan schema aktual di environment dengan klaim dokumen sebelum menjalankan SQL, sesuai prasyarat §2 dokumen itu sendiri.

### 3.4 Catatan Tambahan Operator SQL

- Default `ROLLBACK` terpasang dengan benar — tidak ada perubahan yang dipersistenkan tanpa eksplisit mengganti ke `COMMIT`. ✅
- Guard `NULLIF(btrim(v_reason),'')` dan `v_actor IS NULL` mencegah eksekusi tanpa parameter lengkap. ✅
- Tidak ada `DELETE`, tidak ada perubahan RLS/grant, tidak ada perubahan schema. ✅
- INSERT ke `audit_logs` dalam transaksi yang sama, sebelum pratinjau SELECT. ✅
- Dry-run audit log **juga di-rollback** bersama mutasi — dokumen jujur menyebutkan ini di §"Penerapan dan penghentian". ✅

---

## 4. `docs/ADR-2026-11-13-cron-job-org.md` — Gap Terbuka

### 4.1 Gap Seed `report_reminder` 21:00 vs PRD 19:30

**Status: GAP TERBUKA, belum ditangani.**

| Aspek | Detail |
|---|---|
| Seed aktual | `report_reminder` = 21:00 WIB (terkonfirmasi `20261112000004_cron_job_schedules.sql:23`) |
| PRD-04 requirement | REP-014: *"Pengingat in-app sebelum 21.00 (mis. 19.30, 20.30)"* |
| ADR | Mengakui gap ini sebagai *"selisih yang harus ditangani/dibuktikan oleh pekerjaan implementasi/operasi terpisah"* |
| Master PRD §0.4 | Menyebut audit minta perbaikan TRC-07 (default 19:30) di §"Perbaiki sekarang" tapi **keputusan pengguna 2026-11-13 tidak secara eksplisit menyebutkan TRC-07** dalam tabel NOW/B/C |
| PRD-04 §16 | Menyebut *"seed 21.00 yang tercatat di ADR adalah selisih konfigurasi, bukan perubahan tenggat atau klaim sudah diperbaiki"* |

**Kesimpulan:** Gap ini diakui oleh semua dokumen tapi **belum diselesaikan**. Seed 21:00 berarti pengingat laporan dikirim tepat saat tenggat, bukan sebelumnya — ini merusak manfaat pengingat. Konfigurasi UI admin sudah tersedia (admin/cron) untuk mengubah, tapi perlu tindakan operator.

**Rekomendasi:** Pemilik perlu memutuskan apakah mengubah seed default menjadi 19:30 via migrasi baru, atau menginstruksikan operator untuk mengubah via admin UI setelah deployment. TRC-07 ada di daftar "Perbaiki sekarang" di register AUDIT-FINDINGS §H tetapi tidak masuk ke daftar keputusan eksplisit §I.

### 4.2 Gap Lain yang Diamati di ADR

- ADR tidak mencantumkan ID kedua job provider, jadwal aktual, pemilik, atau bukti heartbeat — sesuai ekspektasi (ADR hanya dokumen keputusan desain, bukan bukti operasional). ✅
- Pernyataan `HTTP 200 dapat berarti skipped/not_scheduled/already_processed` sudah ada sebagai peringatan. ✅
- FCM sebagai delivery channel tidak dijelaskan detail bagaimana relay dari cron ke FCM — ini wajar untuk ADR level desain. Tidak ada gap kritis.

---

## 5. Ringkasan Temuan dan Rekomendasi

### 5.1 Temuan Kritis / Perlu Tindak Lanjut

| # | Temuan | Dokumen | Rekomendasi |
|---|---|---|---|
| F1 | **TRC-07 masih open**: seed `report_reminder` 21:00 vs PRD 19:30 — pengingat tepat saat tenggat, bukan sebelumnya | ADR, PRD-04 | Pemilik putuskan: migrasi ubah seed ke 19:30, atau instruksi operator via admin UI |
| F2 | **Migrasi 20261113 belum diterapkan operator**: dua fitur NOW (consent, opt-out) tidak aktif di production | AUDIT-FINDINGS §I | Operator terapkan setelah otorisasi |
| F3 | **Fixture registrasi (browser E2E) belum rerun**: perbaikan sudah ada tapi belum dikonfirmasi hijau | AUDIT-FINDINGS §I | Jalankan `npx playwright test e2e/registration-consent.spec.ts` |
| F4 | **Screenshot mobile belum diinspeksi visual** | AUDIT-FINDINGS §I | Jalankan test + lihat PNG |
| F5 | **Review baris-per-baris PRD-02/05/06/07/08 tidak tuntas** | — | Review manual oleh pemilik atau agen dengan konteks cukup |

### 5.2 Temuan Minor / Dokumentasi

| # | Temuan | Dokumen | Dampak |
|---|---|---|---|
| M1 | PRD-01 §5.2 menyebut `phone` tapi kolom asli adalah `phone_number` di migrasi | PRD-01 | Inkonsistensi dokumentasi kecil; kode sudah benar |
| M2 | Kolom `teams` dan `team_members` di `operator-team-sql.md` belum diverifikasi langsung dari `20261101000007` (hanya dikutip tanpa dibaca migrasi asli dalam review ini) | operator-team-sql.md | Operator tetap wajib cocokkan schema sebelum pakai |
| M3 | OPS-07 (seed E2E tanpa guard NODE_ENV) tidak disebut di §I AUDIT-FINDINGS sebagai closed/open | AUDIT-FINDINGS §I | Tambahkan status di §I |
| M4 | TRC-07 tidak masuk tabel keputusan eksplisit §I AUDIT-FINDINGS meski ada di daftar "Perbaiki sekarang" §H | AUDIT-FINDINGS §I | Klarifikasi apakah TRC-07 sudah diputuskan tunda atau masih open |

### 5.3 Konfirmasi Valid

| Aspek | Status |
|---|---|
| `xmin::text::bigint = txid_current() % 4294967296` masuk akal secara SQL | ✅ VALID |
| `SHARE ROW EXCLUSIVE` masuk akal untuk operasi tim | ✅ VALID |
| Kolom `audit_logs` (`public`) cocok dengan migrasi (termasuk `previous_hash` dari 20261102000015) | ✅ COCOK |
| Kolom `account_requests` tambahan cocok dengan migrasi 20261113000001 | ✅ COCOK |
| `attendance_reminder_enabled` di migrasi 20261113000002 — tidak ada perubahan RLS/grant | ✅ SESUAI CONSTRAINT |
| ADR mengakui gap 21:00 vs 19:30 secara jujur | ✅ JUJUR |
| PRD-01 §16 keputusan IAM-017 NOW — terdokumentasi lengkap | ✅ LENGKAP |
| PRD-03 §16 keputusan ATT-013 M NOW — terdokumentasi lengkap | ✅ LENGKAP |

---

---

## 6. Status Verifikasi (Dijalankan selama Review)

| Pemeriksaan | Hasil |
|---|---|
| `npm run typecheck` | ✅ **PASS** — 0 error TypeScript |
| `npm run test -- --maxWorkers=2` | ✅ **PASS** — 31 file, **297 test hijau** |
| `npx playwright test e2e/registration-consent.spec.ts` | ❌ **GAGAL** — **Sandbox OS memblokir peluncuran Chromium** (browser crash signal 6 di headed mode; timeout di headless mode). Semua 5 test timeout dengan pesan "sandbox restrictions may have contributed". Ini constraint environment, bukan bug kode. |
| E2E attendance/report-history | ❌ Tidak dapat dijalankan — alasan sama (sandbox memblokir browser) |
| Screenshot mobile | ❌ Tidak ada — test-results dibersihkan oleh run yang gagal, tidak dapat diregenerasi tanpa browser |

**Catatan kritis tentang E2E:** Esbuild bundle berhasil diverifikasi langsung via Node.js (627ms, semua boundary mock benar, `resolveDir: root` aktif, `getCurrentUserAction` terdaftar). Kode fixture sudah benar sesuai handover. Hambatan adalah sandbox environment yang memblokir Chromium. Pemilik perlu menjalankan Playwright dari terminal normal (di luar sandbox) untuk memverifikasi 5/5 green.

*Review ini mencakup baca dokumen + verifikasi kode migrasi + jalankan typecheck & unit test. Tidak ada SQL yang dieksekusi di database, tidak ada secret yang dibaca. Temuan verifikasi partial (PARTIAL di tabel §3.3) perlu dikonfirmasi ulang oleh operator langsung di environment.*
