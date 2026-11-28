# Pondok OS — Master PRD

**Versi:** 2.1 (Production-Ready Draft; bukan sertifikasi siap rilis) · **Tanggal:** 2026-11-13 (baseline 31 Oktober 2026) · **Menggantikan:** PRD Suite v1.0 **Organisasi:** Yayasan Pondok Quran Digitalpreneur Abdurrahman bin Auf Cirebon **Bahasa produk:** Indonesia · **Zona waktu:** Asia/Jakarta (WIB)

---

## 0. Cara Membaca Dokumen Ini

### 0.1 Rangkaian Dokumen

| Kode | Dokumen |
| --- | --- |
| Master | Visi, scope, kebijakan, stack, konvensi lintas modul (dokumen ini) |
| PRD-01 | Identity & Access Management (IAM) |
| PRD-02 | Resource Library (LIB) |
| PRD-03 | Attendance (ATT) |
| PRD-04 | Activity Reports (REP) |
| PRD-05 | Tasks & Projects (TSK) |
| PRD-06 | Schedules & Announcements (SCH) |
| PRD-07 | People & Teams (PPL) |
| PRD-08 | Analytics & Administration (ADM) |

Aturan prioritas: jika PRD modul bertentangan dengan Master, **Master menang** kecuali PRD modul menyatakan eksplisit "meng-override Master" beserta alasannya.

### 0.2 Label Status (wajib dipahami)

Setiap aturan di seluruh PRD diberi label supaya tidak ada yang tertukar antara fakta dan usulan:

| Label | Arti | Boleh diubah developer? |
| --- | --- | --- |
| **\[TERKONFIRMASI\]** | Sudah diputuskan pemilik/pondok | Tidak, perlu persetujuan tertulis |
| **\[REKOMENDASI\]** | Usulan teknis/produk dengan alasan; default sementara | Ya, dengan catatan keputusan |
| **\[TERBUKA\]** | Belum diputuskan (lihat OD-xxx) | Jangan dikarang; bangun agar *configurable* |

### 0.3 Prioritas dan ID

- **MoSCoW:** **M** = Must (wajib rilis modul), **S** = Should, **C** = Could, **W** = Won't (sekarang).
- ID requirement: `PREFIX-NNN` (IAM-001, ATT-003, dst). ID tidak dipakai ulang. Requirement yang dibatalkan ditandai *Dibatalkan*, bukan dihapus.
- ID keputusan terbuka: `OD-NNN`. ID aturan bisnis: `BR-<PREFIX>-NN`.

### 0.4 Keputusan Audit Disetujui — 2026-11-13

**[TERKONFIRMASI oleh pengguna]** NOW = wajib ditangani untuk rilis awal yang diaudit; **v1.1 = rilis produk lanjutan**, bukan versi dokumen (dokumen ini 2.1). Keputusan bertanggal ini dan catatan keputusan modul meng-override baseline R0–R4 hanya untuk item yang disebut. Requirement asal, prioritas MoSCoW, model target, dan acceptance terkait tetap disimpan; label v1.1 berarti ditunda secara eksplisit, **bukan selesai atau dihapus**. Item lain tidak otomatis ditunda. Perubahan ini hanya dokumentasi; tidak membuktikan deployment, guard, MFA, scheduler, atau tes telah berhasil.

| Keputusan | Cakupan yang disetujui |
| --- | --- |
| TRC-05 / REP-012 | **M NOW:** riwayat laporan pribadi berupa daftar sederhana; tanggal, status pengumpulan/review terpisah, akses detail milik sendiri. Bukan hanya laporan hari ini. |
| OPS-12 / ATT-013 | **M NOW:** satu toggle opt-out pengingat absensi per pengguna, dipersistenkan dan dihormati pengiriman in-app/push. Prioritas asal ATT-013 adalah S; keputusan ini menaikkannya menjadi M. Bukan pusat preferensi lengkap. |
| TRC-10 / IAM-012 | Enforcement MFA saat login **v1.1**. **Release gate NOW:** seluruh Super Admin yang sudah ada wajib mengaktifkan dan memverifikasi TOTP secara manual; operator mencatat bukti tanpa secret/recovery code. Ini kontrol operasional, bukan klaim aplikasi memaksa MFA/AAL2. |
| TRC-28 / FUNC-16 | Otorisasi NOW di app-layer (identitas server, akun aktif, role, scope, guard tests), dengan RLS sebagai defense-in-depth; **RLS tidak boleh dinonaktifkan atau dilonggarkan**. Perubahan peran memakai server action + guard; RPC atomik beraudit tetap **target v1.1**, belum dinyatakan sudah diperbaiki. |
| TRC-29 / OD-010 | FCM, presence/heartbeat, dan scheduler eksternal **cron-job.org** diakui sebagai bagian sistem. Android/Capacitor wrapper diakui keberadaannya tetapi **dikecualikan dari release gate**; tidak menjadikan native app wajib rilis. Presence bukan bukti absensi. |
| TRC-30 / ADM-001 | Rilis awal cukup **dua view**: santri/pribadi dan admin gabungan, tetap ber-scope. Dashboard khusus koordinator (tim) serta pemisahan view Yayasan/Super Admin disimpan sebagai **v1.1**. |
| TRC-25 / PPL-002 | CRUD tim melalui aplikasi **v1.1**, termasuk penundaan Must asal yang disetujui. Interim: operator mengelola lewat [prosedur SQL tim](docs/operator-team-sql.md), transaksi beraudit, tanpa hapus. |
| UX-23 / SCH-012 | Konsolidasi model audiens **v1.1**; target semua/peran/tim/individu tetap dipertahankan. Tidak boleh memperluas akses atau menyamakan kategori anggota dengan role otorisasi. |
| REG-01 / REG-03 / IAM-017 | **NOW:** lima kategori klaim keanggotaan: Santri, Ustadz, Pengurus, Yayasan, Lainnya; bukan role auth dan tidak memberi hak akses. Checkbox privasi + versi dan waktu server persetujuan disimpan; IAM-017 (termasuk persetujuan ulang saat versi berubah) bukan deferral. |
| B: REG-05 / REG-07 | **NOW:** nomor HP wajib dan terlindungi; validasi manual di server diterima, **Zod tidak diwajibkan**. Baseline HP opsional dan Zod wajib dicatat sebagai aturan asal, bukan kontrak aktif. |
| B: TRC-09 / OD-016 | **NOW:** pembuatan/pengiriman awal laporan tanggal lampau (backfill) diblokir. Terlambat setelah 21.00 pada hari yang sama tetap diterima; revisi laporan yang sudah terkirim mengikuti REP-009. Kontrak asal backfill 7 hari/izin pengurus disimpan sebagai **v1.1**. |
| B: TRC-12 / OD-004 | Reviewer koreksi absensi **pengurus+** (pengurus, yayasan, super_admin) yang berwenang; koordinator saja tidak cukup. Tetap larang review diri sendiri dan wajib audit. |
| B: SCH-007 | Bentrok jadwal yang terdeteksi **ditolak**, bukan hanya peringatan. |
| B: PPL-008 | Direktori koordinator terbatas anggota **tim yang dipimpinnya**, bukan seluruh organisasi; pembatasan juga di server, termasuk pencarian/detail. |

**C — daftar deferral v1.1 yang disetujui (prioritas asal tetap ada pada baris modul):**

| Modul | Requirement v1.1 |
| --- | --- |
| IAM | IAM-018; **IAM-017 tetap NOW** |
| ATT | **ATT-011 (M: penundaan eksplisit disetujui)**, ATT-015 (S), ATT-017, ATT-018 |
| REP | REP-006, REP-015, REP-016, REP-017, REP-018, REP-019, REP-020 |
| LIB | LIB-009, LIB-013, LIB-014, LIB-016, LIB-017 (asal W untuk rilis awal) |
| TSK | TSK-013, TSK-015, TSK-016, TSK-020 |
| SCH | SCH-018, SCH-020 |
| PPL | PPL-010, PPL-012, PPL-014, PPL-016 |
| ADM | ADM-005, ADM-013, ADM-017 |

ATT-011 benar-benar **M** pada baseline root PRD-03 baris 126; ATT-015 **S** pada baris 130. Antrean hari tertutup (ATT-011) dikeluarkan dari release gate dengan persetujuan eksplisit ini; status `no_checkin` tetap bukan alpa otomatis. Keberadaan snapshot/presence tidak memenuhi antrean atau layar live tersebut.

Rincian scheduler dan batas bukti operasi: [ADR cron-job.org](docs/ADR-2026-11-13-cron-job-org.md). Kriteria rilis tetap membutuhkan bukti terpisah; tidak ada SQL, tes, atau perubahan provider yang dijalankan oleh pembaruan dokumentasi ini.

---

## 1. Ringkasan Eksekutif

Pondok OS adalah **platform operasional internal** (bukan website profil) yang menyatukan absensi, laporan aktivitas harian, tugas/proyek, jadwal, pengumuman, struktur tim, dan pustaka pengetahuan pondok dalam satu sistem dengan kontrol akses berbasis peran.

Saat ini kegiatan tersebar di WhatsApp, spreadsheet, dan dokumen terpisah. Absensi lewat WhatsApp tidak terstruktur dan sulit diaudit; laporan harian tidak konsisten; pengetahuan (Everything Library) hidup di Google Sheets.

**Visi:** platform operasional yang mudah diakses, mudah dirawat, dan menjaga kesinambungan institusi — tidak bergantung pada satu individu.

**Misi:** (1) memusatkan sumber daya dan informasi, (2) membuat catatan kehadiran yang andal, (3) membuat dokumentasi aktivitas yang konsisten, (4) menertibkan koordinasi tugas, (5) menyatukan kanal pengumuman dan jadwal, (6) menjaga memori institusi, (7) memberi wawasan operasional bagi yang berwenang.

---

## 2. Prinsip Produk

1. **Satu platform, modul terhubung** — identitas, tim, dan audit dipakai bersama.
2. **Least privilege** — akses minimum sesuai tanggung jawab; tidak semua pengguna setara.
3. **Praktis, bukan birokratis** — field seminimal mungkin, alur secepat mungkin (check-in ≤ 2 ketuk).
4. **Integritas data** — setiap data penting punya pemilik, timestamp server, dan riwayat perubahan.
5. **Mobile-first untuk operasional harian** — check-in dan laporan harus nyaman di smartphone.
6. **Bertahap** — rilis per modul, arsitektur tetap satu.
7. **Kepemilikan institusi** — data, kode, dan akses infrastruktur dimiliki yayasan, bukan perorangan.
8. **Jangan mengarang kebijakan** — hal yang belum diputuskan dibangun *configurable* dan dicatat sebagai OD.
9. **Hindari overengineering** — fitur harus menjawab kebutuhan operasional nyata.

---

## 3. Pengguna dan Peran (ringkas)

Detail lengkap, permission, dan state akun ada di **PRD-01**.

| Peran | Fokus | Catatan |
| --- | --- | --- |
| Super Admin | Administrasi platform (akun, konfigurasi, audit) | Kewenangan teknis, bukan otomatis kewenangan institusional |
| Yayasan | Pengawasan dan kebijakan institusi | Akses ringkasan/laporan sesuai kewenangan |
| Pengurus | Operasional harian, monitoring, review | Termasuk pereview laporan sesuai penugasan |
| Koordinator | Memimpin tim | Peran **bercakupan tim** (scoped), bukan global |
| Santri | Check-in, laporan harian, tugas | Peran dasar mayoritas pengguna |

**\[TERKONFIRMASI\]** Satu pengguna dapat memiliki lebih dari satu peran/tanggung jawab; akses dibatasi menurut penugasan dan keanggotaan tim.

**Celah yang ditemukan:** dokumen awal menyebut *ustadz* sebagai pereview laporan, tetapi "Ustadz" tidak ada dalam daftar peran. Lihat **OD-014**.

---

## 4. Ruang Lingkup

### 4.1 In Scope

Autentikasi & persetujuan akun; RBAC; dashboard; Resource Library (migrasi Everything Library); absensi; laporan aktivitas harian; tugas & proyek; jadwal & pengumuman; orang & tim; analitik & administrasi; audit log; notifikasi in-app. **[2026-11-13]** FCM (termasuk dukungan native), presence/heartbeat, dan scheduler eksternal cron-job.org diakui; cakupan release gate mengikuti §0.4.

### 4.2 Out of Scope (rilis awal)

Website publik/profil; registrasi publik bebas; akuntansi/keuangan; payroll; LMS penuh; ujian online; aplikasi native iOS/Android sebagai produk wajib rilis; perangkat biometrik; GPS wajib; pengenalan wajah; penilaian kinerja berbasis AI; integrasi eksternal yang belum disetujui. **[2026-11-13]** Baseline mengecualikan native iOS/Android; Android/Capacitor wrapper yang sudah ada kini diakui, tetapi **di luar release gate**. FCM dan cron-job.org adalah integrasi yang disetujui, bukan scope drift yang harus dicabut.

### 4.3 Catatan tentang "Registrasi"

Registrasi bersifat **pengajuan akun** yang wajib disetujui admin. Endpoint pengajuan bersifat publik secara teknis sehingga wajib dilindungi anti-bot dan rate limit (PRD-01).

---

## 5. Kebijakan Operasional

### 5.1 Terkonfirmasi

| ID | Kebijakan | Status |
| --- | --- | --- |
| BR-OPS-01 | Hari operasional rutin: Senin–Sabtu; Minggu bebas kewajiban absensi & laporan | TERKONFIRMASI |
| BR-OPS-02 | Check-in mandiri; waktu = **waktu server**, bukan perangkat | TERKONFIRMASI |
| BR-OPS-03 | Tepat waktu: s.d. 08.00 WIB · Toleransi: 08.01–08.15 · Terlambat: setelah 08.15 | TERKONFIRMASI |
| BR-OPS-04 | Semua santri wajib laporan aktivitas individu harian, batas 21.00 WIB | TERKONFIRMASI |
| BR-OPS-05 | Laporan terlambat tetap boleh dikirim dan wajib ditandai terlambat | TERKONFIRMASI |
| BR-OPS-06 | Status pengumpulan dan status review dipisah | TERKONFIRMASI |
| BR-OPS-07 | Review oleh ustadz/pengurus sesuai penugasan; tanpa kewajiban review di hari yang sama | TERKONFIRMASI |
| BR-OPS-08 | Registrasi harus disetujui admin sebelum akun aktif | TERKONFIRMASI |
| BR-OPS-09 | Koreksi absensi mengikuti kondisi dan persetujuan pihak berwenang | TERKONFIRMASI |
| BR-OPS-10 | Spreadsheet Everything Library tidak langsung dimatikan; migrasi bertahap + validasi | TERKONFIRMASI |

### 5.2 Interpretasi Teknis yang Perlu Dikonfirmasi (OD-013)

Aturan "sampai 08.00" dan "08.01–08.15" ambigu pada tingkat detik (mis. 08:00:40 atau 08:15:30). **\[REKOMENDASI\]** Klasifikasi dihitung dari waktu server yang **dipotong ke menit** (WIB): menit ≤ 08:00 → tepat waktu; 08:01–08:15 → toleransi; ≥ 08:16 → terlambat. Alasannya selaras dengan rentang yang ditulis pemilik. Batas ini harus disimpan sebagai konfigurasi, bukan hardcode.

### 5.3 Prinsip Kebijakan Berversi

**\[REKOMENDASI → wajib\]** Semua parameter kebijakan (jam batas, hari operasional, tanggal libur) disimpan sebagai **kebijakan berversi** (`effective_from`). Klasifikasi absensi/laporan dihitung saat kejadian dan **disimpan beserta `policy_version_id`**, sehingga mengubah jam batas di masa depan tidak mengubah data historis.

---

## 6. Register Keputusan Terbuka (Konsolidasi)

Semua OD dikumpulkan di sini. Kolom *Default sementara* adalah yang dipakai developer sampai ada keputusan; sistem harus dibangun agar mudah berpindah ke opsi lain.

| ID | Keputusan | Default sementara (REKOMENDASI) | Modul |
| --- | --- | --- | --- |
| OD-001 | Apakah pengurus/anggota yayasan wajib laporan harian | Tidak wajib; kewajiban ditentukan flag `report_required` per profil | REP |
| OD-002 | Status final yang tidak check-in setelah 08.15 | Tampil "Belum Check-in" (unrecorded); **tidak** otomatis "Alpa"; butuh peninjauan | ATT |
| OD-003 | Laporan boleh diedit setelah kirim sebelum review | Boleh, selama belum berstatus `approved`; tiap edit disimpan sebagai revisi | REP |
| OD-004 | Siapa menyetujui koreksi absensi | **Diputuskan 2026-11-13: pengurus+ berwenang; koordinator saja ditolak.** Asal: pengurus ditugaskan; level konfigurable (1 level) | ATT |
| OD-005 | Delegasi review | Tidak ada delegasi; penugasan ulang oleh admin | REP |
| OD-006 | Retensi data | Tidak ada penghapusan otomatis sampai diputuskan; arsip logis | Semua |
| OD-007 | Pengecualian pelaporan saat izin/cuti | Hari dengan status izin/sakit disetujui = tidak wajib lapor | REP/ATT |
| OD-008 | Hierarki peran final & matriks permission | Matriks default di PRD-01 | IAM |
| OD-009 | Metode verifikasi akun / identitas login | Email + persetujuan admin; fallback akun dibuatkan admin | IAM |
| OD-010 | Kanal notifikasi | **2026-11-13: in-app dan FCM/push diakui; Android wrapper bukan release gate.** Asal: in-app lalu Web Push; WhatsApp tetap ditunda | Semua |
| OD-011 | Kategori laporan tetap atau configurable | Configurable (tabel), isi awal dari usulan | REP |
| OD-012 | Pengecualian absensi untuk kegiatan khusus | Kalender non-operasional/pengecualian per tanggal | ATT |
| OD-013 | Batas detik klasifikasi absensi | Dipotong ke menit (5.2) | ATT |
| OD-014 | Posisi "Ustadz" dalam model peran | Atribut `member_type` + peran Pengurus dengan kapabilitas reviewer | IAM/PPL |
| OD-015 | Jendela buka check-in (paling awal) & batas akhir check-in terlambat | Buka 04.00, tutup 23.59; configurable | ATT |
| OD-016 | Batas mundur pengiriman laporan tanggal lampau | **NOW (2026-11-13): backfill diblokir. v1.1 (kontrak asal): 7 hari configurable**, izin pengurus di luar batas | REP |
| OD-017 | Satu laporan/hari berisi banyak item aktivitas atau satu aktivitas saja | Satu laporan/hari, 1–N item | REP |
| OD-018 | Pengguna di bawah 18 tahun (anak) & persetujuan data pribadi | Wajib dikonsultasikan; minimalkan data | Semua |
| OD-019 | Jumlah pengguna dan puncak beban | Asumsi 50–500 pengguna | Teknis |
| OD-020 | Pemilik produk, maintainer teknis, dan pemegang akses infrastruktur | Wajib ditetapkan sebelum Release 1 | Governance |

---

## 7. Arsitektur dan Stack

### 7.1 Penilaian Jujur terhadap Stack Awal

Stack awal (Next.js + TypeScript, Tailwind + shadcn/ui, Supabase, Vercel, GitHub) **tepat** untuk proyek ini: satu developer, RBAC + data relasional, kebutuhan RLS di level database, dan target web responsif. Aku **tidak** menyarankan ganti fondasinya. Yang kurang bukan pilihan teknologinya, tapi **lapisan produksi di sekitarnya**: migrasi terversi, tes RLS, job terjadwal, observability, backup, dan perlindungan endpoint publik. Itu yang ditambahkan di bawah.

### 7.2 Keputusan Stack

| Lapisan | Keputusan | Alasan |
| --- | --- | --- |
| Framework | **Next.js (App Router) + TypeScript strict** | Server Components + Server Actions cocok untuk CRUD internal; satu bahasa |
| UI | **Tailwind CSS + shadcn/ui** (Radix) | Aksesibel, dimiliki kode sendiri, cepat |
| Database | **PostgreSQL (Supabase)** | Constraint, trigger, RLS, pg\_cron; cocok untuk integritas absensi |
| Auth | **Supabase Auth** (email+password; TOTP MFA untuk peran tinggi) | Sudah terintegrasi dengan RLS |
| Storage | **Supabase Storage** (bucket privat + signed URL + policy) | Satu sistem otorisasi |
| Hosting | **Vercel** | Deploy sederhana; lihat catatan paket 7.4 |
| Validasi | **Server-side wajib; manual diterima, Zod opsional** (2026-11-13) | Asal: Zod bersama form/server; keputusan B menghapus kewajiban library, bukan validasi |
| Form | **React Hook Form** + resolver Zod | Form ringan, mobile friendly |
| Data klien | Server Components default; **TanStack Query** hanya untuk interaksi interaktif (mis. kanban, polling notifikasi) | Hindari kompleksitas state |
| Tanggal/zona | **date-fns** + timezone helper; semua kalkulasi kebijakan di **DB** | Menghindari bug zona waktu di klien |
| Migrasi | **Supabase CLI** (SQL migration di repo) + `supabase gen types` | Skema terversi, reproducible |
| Tes | **Vitest** (unit), **Playwright** (E2E), **pgTAP** (tes RLS & fungsi DB) | RLS salah = kebocoran data; wajib dites otomatis |
| Job terjadwal | **cron-job.org eksternal → Route Handler terproteksi** (NOW, 2026-11-13; [ADR](docs/ADR-2026-11-13-cron-job-org.md)) | Asal: pg\_cron + Edge Functions/Route Handler; bukan scheduler aktif yang boleh diasumsikan. Waktu bisnis tetap di aplikasi/DB |
| Email transaksional | **Resend** (atau SMTP kustom di Supabase Auth) | Pengiriman email andal; domain terverifikasi |
| Anti-bot | **Cloudflare Turnstile** pada form pengajuan akun | Endpoint publik rawan spam |
| Rate limiting | Upstash Redis atau tabel rate-limit di DB (pilih saat implementasi) | Login, pengajuan akun, ekspor |
| Observability | **Sentry** (error) + log Vercel + Supabase logs; uptime monitor eksternal | Deteksi masalah sebelum pengguna lapor |
| CI/CD | **GitHub Actions**: lint, typecheck, tes, pgTAP, migrasi staging, preview deploy | Gerbang kualitas otomatis |
| Kualitas kode | ESLint + Prettier (atau Biome), pnpm, Husky ringan | Konsistensi |
| PWA (Phase 3+) | Manifest + service worker + Web Push | Notifikasi di smartphone tanpa WhatsApp |

### 7.3 Alternatif yang Dipertimbangkan dan Tidak Dipilih

| Alternatif | Alasan tidak dipilih |
| --- | --- |
| Laravel + Filament | Sangat cepat untuk admin CRUD, tetapi pindah bahasa/ekosistem dan hosting; keunggulan tidak sebanding untuk developer TypeScript |
| Prisma/Drizzle sebagai jalur data utama | ORM yang konek langsung (service role) **mem-bypass RLS**, melemahkan prinsip "otorisasi di database". Boleh dipakai terbatas untuk skrip migrasi/laporan, bukan jalur request pengguna |
| tRPC / GraphQL | Server Actions + RPC Postgres sudah cukup; menambah lapisan tanpa manfaat |
| Firebase sebagai database utama | Model NoSQL kurang cocok untuk relasi, audit, dan laporan; **bukan penolakan FCM**, yang diakui untuk push pada 2026-11-13 |
| Self-hosted Supabase/VPS | Beban operasional tinggi untuk tim kecil; pertimbangkan hanya jika kedaulatan data mewajibkan |

### 7.4 Catatan Produksi yang Sering Terlewat

1. **Supabase paket gratis tidak layak untuk produksi** (proyek bisa di-pause saat tidak aktif, tanpa backup terjamin). Gunakan paket berbayar dan aktifkan backup harian; pertimbangkan PITR untuk data absensi.
2. **Region:** pilih region terdekat Indonesia (Singapura) untuk Supabase dan Vercel Functions agar latensi check-in kecil.
3. **Vercel paket Hobby** dibatasi untuk penggunaan non-komersial/personal; periksa syarat terbaru dan pilih paket sesuai status yayasan sebelum produksi.
4. **Peran tidak boleh disimpan di `user_metadata`** (dapat diubah pengguna). Gunakan tabel `user_roles` + fungsi RLS; klaim di JWT hanya sebagai optimasi (custom access token hook) belakangan.
5. **Service role key** hanya di server, tidak pernah di klien; dipakai hanya untuk job terjadwal dan tugas admin yang diaudit.
6. **Satu akun pemilik infrastruktur milik yayasan** (GitHub org, Vercel, Supabase, domain, email) dengan minimal 2 admin — mencegah *bus factor* satu orang.

### 7.5 Pembagian Tanggung Jawab Lapisan

| Lapisan | Tanggung jawab | Tidak boleh |
| --- | --- | --- |
| **Database** | Invarian: waktu server, klasifikasi, unik per hari, state machine, RLS, audit trigger | Berisi logika tampilan |
| **Service (TypeScript)** | Otorisasi app-layer (sesi, status, role, scope), guard tests, orkestrasi, validasi server manual/Zod, notifikasi, ekspor, integrasi | Melonggarkan/menonaktifkan RLS atau menghitung waktu absensi di klien |
| **UI** | Presentasi, UX, aksesibilitas | Menjadi satu-satunya pembatas akses |

**[2026-11-13] Aturan aktif:** aturan keamanan harus ditegakkan di server tepercaya, bukan UI. Guard app-layer wajib sebelum penggunaan service-role yang melewati RLS; RLS tetap defense-in-depth dan tidak boleh dilonggarkan. Invarian data (unik, waktu server, integritas transaksi) tetap di database. **Kontrak asal/target konsolidasi v1.1:** "jika sebuah aturan harus tetap benar walau klien dimodifikasi, aturan itu hidup di database"; tidak boleh dibaca sebagai klaim seluruh action saat ini sudah berotorisasi lewat DB.

### 7.6 Struktur Repo (usulan)

```
/supabase/migrations   # SQL berversi
/supabase/tests        # pgTAP (RLS, fungsi)
/src/modules/<modul>/  # actions, queries, schemas(zod), components, types
/src/lib/              # supabase client, auth, time, errors, audit
/src/app/(auth|app)/   # route group
/docs/                 # PRD, ADR (Architecture Decision Record)
```

Setiap keputusan teknis penting dicatat sebagai **ADR** singkat. Struktur usulan asal: `/docs/adr`; keputusan 2026-11-13 memakai lokasi yang sudah ada, [docs/ADR-2026-11-13-cron-job-org.md](docs/ADR-2026-11-13-cron-job-org.md).

### 7.7 Lingkungan

| Env | Tujuan | Data |
| --- | --- | --- |
| Local | Pengembangan (Supabase CLI) | Seed fiktif |
| Staging | UAT & uji migrasi | Salinan anonim / data uji |
| Production | Pengguna nyata | Data asli; akses terbatas |

Migrasi diuji di staging sebelum produksi. Tidak ada perubahan skema manual lewat dashboard produksi.

---

## 8. Konvensi Data Lintas Modul

| Topik | Konvensi |
| --- | --- |
| Primary key | `uuid` (`gen_random_uuid()`); ID bisnis terbaca (mis. nomor anggota) sebagai kolom terpisah |
| Waktu | `timestamptz` (UTC di DB); tampil WIB di UI |
| Tanggal operasional | Kolom `date` yang dihitung dari `AT TIME ZONE 'Asia/Jakarta'` di database, bukan dari klien |
| Kolom standar | `created_at, updated_at, created_by, updated_by` |
| Penghapusan | **Soft delete** (`deleted_at`) untuk resource/tugas/pengumuman. **Tanpa hapus** untuk absensi, laporan, audit — koreksi lewat catatan baru |
| Status | Enum Postgres/`check` untuk state machine stabil; tabel lookup untuk daftar yang dapat dikonfigurasi (kategori) |
| Penamaan | Tabel/kolom `snake_case` Inggris; label UI Indonesia dikelola di satu kamus istilah |
| Skema | `public` (data aplikasi), `app` (fungsi helper/otorisasi), `audit` (log). Tabel di `public` wajib RLS aktif |
| RLS | **Default deny**; policy eksplisit per operasi. Tidak ada tabel `public` tanpa RLS |
| Idempoten | Operasi yang bisa terkirim dua kali (check-in, kirim laporan) memakai constraint unik atau idempotency key |
| Referensi pengguna | Seluruh modul memakai `profiles.id` (= `auth.users.id`) sebagai identitas tunggal |

---

## 9. Model Otorisasi Lintas Modul

### 9.1 Format Permission

`<modul>.<sumber_daya>.<aksi>` dengan **cakupan (scope)**: `own` (miliknya), `assigned` (sesuai penugasan reviewer), `team` (tim yang ia pimpin/ikuti), `all` (seluruh organisasi).

Contoh: `attendance.record.read` dengan scope `team`.

Peran memberi sekumpulan permission+scope; penugasan peran dapat **bercakupan** (global atau tim tertentu). **[NOW, 2026-11-13]** Cek akses request ada di app-layer melalui identitas server, status aktif, role dan scope, dibuktikan guard tests; RLS tetap defense-in-depth tanpa pelonggaran. **[v1.1 — kontrak konsolidasi asal]** Cek akses database lewat `app.has_permission(...)` di seluruh RLS/RPC tetap target, bukan klaim implementasi setiap action sudah memakai helper ini.

### 9.2 Matriks Kapabilitas Ringkas (default, mengikuti OD-008)

| Kapabilitas | Santri | Koordinator | Pengurus | Yayasan | Super Admin |
| --- | --- | --- | --- | --- | --- |
| Check-in & lihat absensi sendiri | ✓ | ✓ | ✓ | opsional | — |
| Lihat absensi tim / semua | — | tim | semua/ditugaskan | semua (baca) | konfigurasi saja |
| Laporan harian sendiri | ✓ | ✓ | OD-001 | OD-001 | — |
| Review laporan | — | tim (jika ditugaskan) | ditugaskan | — | — |
| Buat tugas/proyek | — | tim | ✓ | ✓ | — |
| Publikasi pengumuman/jadwal | — | tim | ✓ | ✓ | — |
| Kelola Resource Library | — | — | ✓ | ✓ | ✓ |
| Setujui akun & atur peran | — | — | — | — | ✓ |
| Analitik organisasi | — | tim | ✓ | ✓ | terbatas |
| Audit log | — | — | — | baca | ✓ |

**\[REKOMENDASI\]** Super Admin dengan sengaja **tidak otomatis** mendapat akses isi laporan harian dan data personal santri (pemisahan administrasi platform vs kewenangan institusi). Catatan jujur: siapa pun yang memegang akses database teknis tetap *secara teknis* bisa melihat data; karena itu akses itu dibatasi, dicatat, dan dipegang minimal 2 orang tepercaya.

---

## 10. Standar Lintas Modul

### 10.1 Katalog Event Notifikasi

Kanal awal: **in-app** (OD-010). Setiap event punya kunci agar PRD modul dan implementasi konsisten.

| Kunci event | Penerima | Modul |
| --- | --- | --- |
| `account.request_received` | Admin | IAM |
| `account.approved` / `account.rejected` | Pemohon (email) | IAM |
| `attendance.checkin_reminder` | Pengguna wajib absen | ATT |
| `attendance.correction_requested` / `.decided` | Pereview / pemohon | ATT |
| `report.deadline_reminder` | Santri belum kirim | REP |
| `report.submitted` | Pereview | REP |
| `report.revision_requested` / `.approved` | Santri | REP |
| `task.assigned` / `.status_changed` / `.due_soon` / `.review_requested` | Assignee / pembuat / pereview | TSK |
| `event.created` / `.changed` / `.reminder` | Audiens | SCH |
| `announcement.published` | Audiens | SCH |
| `team.membership_changed` | Anggota | PPL |

Aturan: notifikasi dibuat dalam transaksi yang sama dengan peristiwa asalnya (tabel `notifications`), pengiriman kanal lain bersifat asinkron dan *best effort*. Pengguna dapat menandai dibaca. Tidak ada notifikasi berisi data sensitif lengkap — cukup tautan ke halaman terlindungi.

### 10.2 File dan Storage

- Bucket **privat**; akses lewat signed URL berumur pendek + policy storage yang mengikuti kepemilikan record.
- Batas default: 5 MB/file gambar & dokumen, daftar tipe MIME diizinkan (gambar, PDF, dokumen kantor); nilai final configurable.
- Nama file disanitasi; path `bucket/<modul>/<record_id>/<uuid>.<ext>`; metadata di tabel `files` (owner, record, mime, size, checksum).
- Pindai malware: **\[REKOMENDASI Could\]** bila ada budget; minimal validasi tipe dan ukuran di server.

### 10.3 Audit

- Tabel `audit.audit_logs` **append-only** (REVOKE UPDATE/DELETE, hanya trigger/fungsi yang menulis).
- Kolom: `id, occurred_at, actor_id, actor_role_snapshot, action, entity_type, entity_id, before, after, reason, request_id`.
- Data sensitif (password, token) tidak pernah masuk log. Isi `before/after` diredaksi per entitas.
- Wajib diaudit: persetujuan/penolakan akun, perubahan peran/tim, koreksi & keputusan absensi, review laporan, perubahan konfigurasi kebijakan, ekspor data, perubahan resource.

### 10.4 Penanganan Error dan UX

- Kode error domain yang stabil (mis. `ATT_ALREADY_CHECKED_IN`, `REP_DEADLINE_PASSED_BACKFILL_LIMIT`) dipetakan ke pesan Indonesia yang jelas.
- Setiap aksi mengubah data memberi umpan balik eksplisit (toast/status). Aksi gagal tidak boleh meninggalkan data setengah jadi — gunakan transaksi.
- Empty state, loading state, dan error state wajib ada di setiap layar.
- Kosakata konsisten (kamus istilah): *Check-in*, *Toleransi*, *Terlambat*, *Belum Check-in*, *Laporan*, *Peninjau*, *Revisi*.

### 10.5 API dan Pagination

- Mutasi dari UI: Server Actions memanggil RPC/tabel terproteksi RLS. Route Handler hanya untuk ekspor, webhook, dan endpoint cron (diautentikasi secret).
- Daftar besar wajib **keyset/cursor pagination**, default 25–50 baris.
- **[NOW, 2026-11-13]** Semua input divalidasi di server, tidak hanya di klien; validasi manual diterima, Zod opsional. Asal: Zod diwajibkan; keputusan B mengganti kewajiban library, bukan pemeriksaan input.

### 10.6 Aksesibilitas dan Responsif

- Target WCAG 2.1 AA untuk alur utama; ukuran sentuh ≥ 44 px; kontras memadai; label form jelas; navigasi keyboard berfungsi.
- Breakpoint: smartphone (utama), tablet, desktop. Alur harian dirancang untuk satu tangan di layar ≤ 390 px.
- Dukungan koneksi lambat: payload kecil, skeleton loading, retry aman.

---

## 11. Persyaratan Non-Fungsional (target usulan)

Target angka di bawah adalah **\[REKOMENDASI\]** dan diverifikasi saat uji beban; jumlah pengguna nyata belum diketahui (OD-019).

| Aspek | Target |
| --- | --- |
| Performa halaman | Dashboard LCP p75 ≤ 2,5 dtk di 4G perangkat menengah |
| Check-in | Respons server p95 ≤ 1 dtk; satu operasi tunggal, payload minimal |
| Beban puncak | Lonjakan di 07.45–08.15 (check-in) dan 20.30–21.00 (laporan); sistem harus tahan 100% pengguna aktif mengakses dalam ±10 menit tanpa penurunan fungsi inti. Query berat (analitik) tidak boleh berjalan pada jendela ini |
| Ketersediaan | ≥ 99,5% per bulan (realistis untuk Vercel+Supabase berbayar) |
| RPO/RTO | RPO ≤ 24 jam (dasar), ≤ 15 menit jika PITR aktif; RTO ≤ 4 jam |
| Keamanan | Tidak ada tabel tanpa RLS; semua tes otorisasi lulus sebelum rilis |
| Aksesibilitas | WCAG 2.1 AA alur utama |
| Kompatibilitas | Dua versi mayor terakhir Chrome, Safari, Edge, Firefox; Android & iOS browser |
| Pemeliharaan | Cakupan tes ≥ 80% untuk modul aturan bisnis kritis (ATT, REP, IAM) |

---

## 12. Keamanan dan Privasi

### 12.1 Ancaman Utama dan Kontrol

| Ancaman | Kontrol |
| --- | --- |
| Eskalasi hak akses (pemohon mengangkat diri jadi admin) | NOW: server action + guard; tidak ada policy tulis peran untuk pengguna; guard "super admin terakhir" tetap diwajibkan. v1.1: kontrak asal RPC admin atomik beraudit, belum diklaim terpenuhi |
| Akun belum disetujui mengakses data | NOW: guard status aktif di server + RLS tetap default-deny; v1.1: konsolidasi kontrak asal helper `app.is_active_member()` di setiap policy |
| Manipulasi waktu absensi | Waktu hanya dari `now()` server di RPC; klien tidak mengirim waktu |
| IDOR (membuka data orang lain lewat ID) | Guard kepemilikan/penugasan/tim di app-layer + guard tests; RLS berbasis `auth.uid()` + scope dan tes pgTAP terpisah; tidak ada pelonggaran RLS |
| Spam pengajuan akun / brute force | Turnstile, rate limit, pesan error seragam (anti user enumeration) |
| Kebocoran file | Bucket privat, signed URL singkat, policy storage |
| Injeksi/XSS (terutama konten Markdown Resource Library) | Parameterized query; sanitasi render Markdown; CSP ketat |
| Penyalahgunaan ekspor | Permission ekspor khusus, audit setiap ekspor, batas baris |
| Sesi dicuri | Cookie httpOnly/secure, rotasi refresh token, pencabutan sesi saat suspend |
| Kehilangan data | Backup + uji pemulihan berkala (kuartalan) |

### 12.2 Privasi dan Data Pribadi

- Kumpulkan hanya data yang dibutuhkan (minimisasi). Tidak ada GPS/biometrik.
- Santri kemungkinan ada yang **di bawah 18 tahun**; di Indonesia pemrosesan data pribadi anak punya ketentuan khusus (UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi). Ini bukan nasihat hukum — **konsultasikan dengan pihak yang kompeten** sebelum produksi (OD-018): dasar pemrosesan, persetujuan wali, dan retensi.
- Hak pengguna: melihat data sendiri; permintaan koreksi; prosedur penonaktifan akun.
- Halaman kebijakan privasi internal dan persetujuan penggunaan saat pengajuan akun (**\[REKOMENDASI Must\]**).

---

## 13. Strategi Kualitas

### 13.1 Piramida Tes

| Tingkat | Alat | Fokus |
| --- | --- | --- |
| Database | pgTAP | RLS per tabel/peran, fungsi klasifikasi, state machine, constraint |
| Unit | Vitest | Validasi server manual/Zod (asal Zod), util, logika service, guard tests role/status/scope |
| E2E | Playwright | Alur kritis: pengajuan→persetujuan→login, check-in, kirim & review laporan |
| Manual/UAT | Pilot pengguna | Kenyamanan mobile, kosakata, kasus tepi |

Wajib ada **tes batas waktu**: 08:00:00, 08:00:59, 08:01:00, 08:15:59, 08:16:00, 20:59:59, 21:00:00, pergantian hari 23:59→00:00 WIB, dan hari Minggu.

### 13.2 Definition of Done

Fitur selesai jika: (1) requirement terdokumentasi, (2) aturan bisnis diimplementasi di lapisan yang benar, (3) otorisasi terverifikasi dengan tes, (4) error/edge case tertangani, (5) tes otomatis lulus di CI, (6) alur diuji di mobile, (7) dokumentasi/ADR diperbarui, (8) stakeholder menyetujui.

### 13.3 Observability dan Operasi

- Sentry untuk error; log terstruktur dengan `request_id`; dashboard uptime.
- Alarm: kegagalan job terjadwal, lonjakan error check-in, kegagalan backup.
- Runbook: pemulihan database, rotasi secret, pencabutan akses, penanganan insiden kebocoran data.
- Backup: backup harian Supabase + salinan terjadwal terenkripsi ke penyimpanan terpisah; **uji pemulihan kuartalan** (backup yang belum pernah diuji dianggap tidak ada).

---

## 14. Roadmap dan Kriteria Rilis

Tanpa estimasi tanggal karena kapasitas pengembang belum dikonfirmasi; urutan dan *exit criteria* yang mengikat. **[2026-11-13]** Tabel R0–R4 adalah baseline; pengecualian NOW/v1.1 §0.4 mengikat release gate awal: dua view dashboard, SQL tim interim, ATT-011 ditunda eksplisit, TOTP manual seluruh Super Admin existing, dan Android wrapper dikecualikan. Tidak ada deferral implisit atas requirement lain.

| Rilis | Isi | Exit criteria |
| --- | --- | --- |
| **R0 Fondasi** | Repo, CI, env staging/prod, skema dasar, helper RLS, design system, ADR awal | CI hijau; deploy preview jalan; tes RLS dasar jalan |
| **R1 Platform MVP** | IAM, Dashboard dasar, People (profil dasar), Resource Library + migrasi | Pengajuan→persetujuan→login berjalan; admin kelola peran; Everything Library terimpor tanpa kehilangan data diam-diam |
| **R2 Operasi Harian** | Attendance, Koreksi, Laporan, Review, Pengingat | Check-in akurat di batas waktu; laporan terkirim & ditinjau; pilot 1–2 minggu dengan pengguna terpilih |
| **R3 Koordinasi Tim** | Teams penuh, Tasks & Projects, Jadwal, Pengumuman, Notifikasi + PWA/Web Push | Tugas ditugaskan & dilacak; pengumuman tertarget |
| **R4 Intelijen Operasional** | Analitik, ekspor, administrasi lanjut, hardening | Ekspor andal; backup terbukti dipulihkan; audit lengkap |

**Catatan urutan:** dokumen awal menaruh *People & Teams* di Phase 3, tetapi Attendance/Reports butuh penugasan pereview dan keanggotaan tim. **Dependensi minimum PPL (profil, tim dasar, penugasan pereview) harus masuk R1/R2.** Ini perbaikan terhadap roadmap v1.0.

**Strategi peluncuran:** pilot terbatas → perluasan bertahap → matikan WhatsApp-absensi hanya setelah satu siklus (mis. satu bulan) berjalan paralel dan stabil. Spreadsheet Everything Library dipertahankan sebagai referensi (read-only) sampai migrasi diverifikasi.

---

## 15. Risiko

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Struktur organisasi belum jelas | Permission salah | Validasi peran & jalur pelaporan sebelum R2; matriks configurable |
| Data pengguna tidak lengkap | Penugasan gagal | Verifikasi data saat persetujuan akun |
| Pengecualian absensi tak terdefinisi | Catatan keliru | Kalender non-operasional + alur koreksi; OD-002/007/012 |
| Backlog review laporan | Laporan menumpuk | Antrean pereview, penugasan ulang, metrik backlog |
| Scope terlalu luas | Rilis molor | Rilis bertahap; Should/Could ditunda |
| Kesalahan migrasi spreadsheet | Data tidak konsisten | Staging table, laporan error impor, dual-run |
| Akses tak sah | Insiden privasi | RLS + tes + MFA peran tinggi + audit |
| Adopsi rendah | Data operasional tidak lengkap | Pilot, UX sederhana, pelatihan singkat |
| Ketergantungan satu developer | Kontinuitas | Repo & akun milik yayasan; ADR; runbook; minimal 2 admin teknis |
| Lonjakan beban jam 08.00/21.00 | Check-in gagal | Operasi tunggal ringan, uji beban, hindari query berat |
| Data anak & kepatuhan privasi | Risiko hukum | OD-018, minimisasi data |

---

## 16. Tata Kelola dan Perubahan

- **Peran governance** (OD-020): Product Owner, perwakilan operasional, maintainer teknis, pereview modul, penyetuju administratif.
- **Perubahan kebijakan terkonfirmasi** (jam absensi, deadline laporan, permission, tanggung jawab institusi) hanya boleh dilakukan dengan **persetujuan tertulis** pihak berwenang, dicatat sebagai versi kebijakan baru (5.3) dan ADR/catatan perubahan PRD.
- **Versi dokumen:** setiap perubahan requirement menaikkan versi minor dan dicatat di *Change Log* (di bawah).

### Change Log

| Versi | Tanggal | Perubahan |
| --- | --- | --- |
| 1.0 | — | PRD Suite awal (draft) |
| 2.0 | 31 Okt 2026 | Dipecah 9 dokumen; stack diperkuat; model otorisasi, konvensi data, NFR terukur, kebijakan berversi, 20 OD terkonsolidasi; roadmap diperbaiki |
| 2.1 | 2026-11-13 | Keputusan audit pengguna (§0.4): NOW/v1.1 eksplisit di seluruh root PRD, prioritas ATT-011 M dan ATT-015 S dikonfirmasi, gate TOTP manual, otorisasi app-layer + RLS tanpa pelonggaran, dua view awal, integrasi diakui, ADR scheduler dan SQL operator tim; bukan klaim implementasi selesai |

---

## 17. Glosarium

| Istilah | Arti |
| --- | --- |
| Santri | Peserta/penghuni pondok yang wajib absen dan lapor harian |
| Pengurus | Pengelola operasional pondok |
| Peninjau (reviewer) | Ustadz/pengurus yang ditugaskan meninjau laporan/koreksi |
| Check-in | Pencatatan kehadiran mandiri oleh pengguna |
| Toleransi | Rentang 08.01–08.15 WIB |
| Belum Check-in (unrecorded) | Tidak ada catatan check-in; **bukan** otomatis alpa |
| Hari operasional | Hari yang menimbulkan kewajiban absen/laporan (Senin–Sabtu, kecuali non-operasional) |
| RLS | Row Level Security, pembatas akses per baris di database |
| RBAC | Role-Based Access Control |
| OD | Open Decision (keputusan terbuka) |
| ADR | Architecture Decision Record |

---

## Lampiran A — Pembedaan Penting

1. Absensi ≠ laporan aktivitas.
2. Laporan terkirim ≠ laporan disetujui.
3. Laporan terlambat ≠ laporan ditolak.
4. Belum check-in ≠ alpa terverifikasi.
5. Peran pengguna ≠ tanggung jawab tim.
6. Dashboard = lapisan presentasi, bukan sumber kebenaran.
7. Resource Library = repositori pengetahuan terstruktur, bukan kumpulan tautan.
8. Akses internal ≠ tidak butuh keamanan dan privasi.

## Lampiran B — Pertanyaan yang Perlu Dijawab Pemilik Sebelum R1

1. Perkiraan jumlah pengguna per peran (OD-019)?
2. Apakah santri umumnya punya email aktif (OD-009)?
3. Siapa Product Owner dan siapa yang memegang akun infrastruktur (OD-020)?
4. Apakah ada santri di bawah 18 tahun (OD-018)?
5. Bagaimana posisi ustadz dalam struktur (OD-014)?
