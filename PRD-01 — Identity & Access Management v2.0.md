# PRD-01 — Identity & Access Management (IAM)

**Versi:** 2.1 · **Keputusan audit:** 2026-11-13 (§16; NOW/v1.1 mengikat cakupan rilis, bukan klaim implementasi) · **Prefix:** IAM · **Rilis:** R1 · **Dibaca bersama:** Master PRD v2.0 **Label:** \[TERKONFIRMASI\] · \[REKOMENDASI\] · \[TERBUKA\] (lihat Master §0.2)

---

## 1. Tujuan dan Posisi Modul

IAM adalah **fondasi** seluruh platform: siapa pengguna, apakah akunnya sah, apa yang boleh ia lakukan. Semua modul lain bergantung pada model identitas dan permission di sini.

**Tujuan**

1. Pembuatan akun terkendali lewat pengajuan + persetujuan admin **\[TERKONFIRMASI\]**.
2. Setiap pengguna punya identitas tunggal dan terverifikasi.
3. Mendukung banyak peran dan peran bercakupan tim.
4. Mencegah eskalasi hak akses dan akses akun yang belum aktif.
5. Semua perubahan akses dapat diaudit.

**Bukan tujuan (R1):** registrasi publik bebas, social login, federasi identitas eksternal, SSO.

---

## 2. Model Peran dan Permission

### 2.1 Peran Dasar \[TERKONFIRMASI daftar, REKOMENDASI isi\]

| Peran | Kunci | Cakupan penugasan | Deskripsi |
| --- | --- | --- | --- |
| Super Admin | `super_admin` | Global | Administrasi platform: akun, peran, konfigurasi, audit |
| Yayasan | `yayasan` | Global | Pengawasan institusi, laporan ringkasan |
| Pengurus | `pengurus` | Global (dapat dibatasi unit) | Operasional harian, monitoring, review |
| Koordinator | `koordinator` | **Tim** (scoped) | Memimpin tim tertentu |
| Santri | `santri` | Global | Pengguna dasar |

**Prinsip:** *peran* menentukan kapabilitas; *keanggotaan tim* menentukan cakupan data. Seorang santri bisa sekaligus koordinator tim Media: ia memegang peran `santri` (global) dan `koordinator` (scope = tim Media).

### 2.2 Posisi Ustadz (OD-014)

Ustadz muncul sebagai pereview di dokumen awal tetapi bukan peran. **\[REKOMENDASI\]**: ustadz dimodelkan sebagai pengguna dengan `member_type = ustadz` (PRD-07) yang memegang peran `pengurus` sehingga dapat ditugaskan sebagai pereview. Alasan: tidak menambah peran baru, kewenangan review tetap berasal dari *penugasan* (reviewer assignment), bukan dari label. Jika pondok ingin peran terpisah, cukup menambah baris di `roles` — desain mendukung tanpa ubah skema.

### 2.3 Struktur Data Otorisasi

| Tabel | Kolom kunci | Catatan |
| --- | --- | --- |
| `roles` | `id, key, name, description, is_system` | Peran sistem tidak dapat dihapus |
| `permissions` | `id, key, description` | Mis. `attendance.record.read` |
| `role_permissions` | `role_id, permission_id, scope` | scope ∈ `own, assigned, team, all` |
| `user_roles` | `id, user_id, role_id, scope_type, scope_team_id, granted_by, granted_at, revoked_at, reason` | Tidak dihapus; dicabut dengan `revoked_at` agar riwayat utuh |
| `account_requests` | lihat §5 | Permohonan pembuatan akun |
| `profiles` | `id (=auth.users.id), status, ...` | Detail di PRD-07; `status` dikelola IAM |

### 2.4 Fungsi Helper Database (kontrak)

| Fungsi | Tujuan |
| --- | --- |
| `app.is_active_member()` | True jika `profiles.status = 'active'` untuk `auth.uid()` |
| `app.has_permission(perm text, target_user uuid default null, target_team uuid default null)` | True jika pengguna punya permission dengan scope yang mencakup target |
| `app.user_team_ids()` | Daftar tim aktif milik pengguna |
| `app.led_team_ids()` | Tim yang dipimpin (koordinator) |
| `app.is_reviewer_of(target_user uuid)` | True jika ada penugasan pereview aktif |

**[v1.1 — kontrak konsolidasi helper asal]** Semua policy RLS di seluruh modul memanggil `app.is_active_member()` lalu permission. Fungsi bertipe `SECURITY DEFINER` dengan `search_path` terkunci dan hanya membaca tabel otorisasi. **[NOW, 2026-11-13]** Otorisasi request di app-layer + guard tests; RLS tetap aktif sebagai defense-in-depth dan tidak boleh dilonggarkan (§16). Ini bukan klaim seluruh policy/action kini memakai helper tersebut.

### 2.5 Permission Katalog Dasar

| Kunci | Deskripsi | Santri | Koord. | Pengurus | Yayasan | S.Admin |
| --- | --- | --- | --- | --- | --- | --- |
| `iam.account.request.read` | Lihat permohonan akun | — | — | — | — | all |
| `iam.account.decide` | Setujui/tolak akun | — | — | — | — | all |
| `iam.account.suspend` | Suspend/nonaktifkan | — | — | — | — | all |
| `iam.role.assign` | Beri/cabut peran | — | — | — | — | all |
| `iam.user.read` | Lihat daftar pengguna | — | team | all (dasar) | all (dasar) | all |
| `iam.audit.read` | Baca audit akses | — | — | — | all | all |
| `iam.session.revoke` | Cabut sesi pengguna | — | — | — | — | all |

(Permission modul lain didefinisikan di PRD masing-masing dan didaftarkan lewat migrasi seed.)

**Aturan keras:**

- **BR-IAM-01** Pemohon tidak pernah bisa menetapkan peran sendiri; tidak ada policy tulis pengguna pada `user_roles`.
- **BR-IAM-02 [v1.1 — target atomik, kontrak asal]** Perubahan peran hanya lewat RPC `iam_assign_role` / `iam_revoke_role` yang memeriksa permission, mencatat audit, dan menolak jika menghapus **Super Admin terakhir**. **[NOW, 2026-11-13]** Server action + guard diterima sebagai jalur saat ini; audit tetap wajib, tetapi atomicity dan kelengkapan guard tidak dianggap sudah terpenuhi (§16).
- **BR-IAM-03** Peran **tidak disimpan** di `user_metadata`/klaim yang dapat diubah pengguna.
- **BR-IAM-04** Admin tidak dapat mengubah peran dirinya sendiri tanpa persetujuan Super Admin lain **\[REKOMENDASI\]** (prinsip empat mata; berlaku jika ≥ 2 Super Admin).
- **BR-IAM-05** Perubahan peran berlaku pada permintaan berikutnya tanpa login ulang (peran dibaca dari DB, bukan hanya JWT).

---

## 3. Siklus Hidup Akun

### 3.1 State Machine

```
(submit) → PENDING ──approve─→ ACTIVE ←─reactivate─ SUSPENDED
              │                  │  │ suspend ────→ ↑
              └─reject─→ REJECTED    │  └─deactivate─→ DEACTIVATED
                                   └─ deactivate ───→ DEACTIVATED
```

| Status | Arti | Bisa login? | Bisa akses data? |
| --- | --- | --- | --- |
| `pending` | Diajukan, belum disetujui | Tidak (halaman "menunggu persetujuan" saja) | Tidak |
| `active` | Disetujui | Ya | Sesuai peran |
| `rejected` | Ditolak (alasan dicatat) | Tidak | Tidak |
| `suspended` | Dibekukan sementara | Tidak (sesi dicabut) | Tidak |
| `deactivated` | Keluar/alumni; tidak aktif permanen | Tidak | Tidak (data historis tetap) |

Transisi tidak valid ditolak di DB (trigger/constraint). **Tidak ada penghapusan akun** dari UI; penghapusan data pribadi mengikuti kebijakan retensi (OD-006) dan dilakukan lewat prosedur admin terdokumentasi.

### 3.2 Identitas Login (OD-009)

| Opsi | Kelebihan | Kekurangan |
| --- | --- | --- |
| A. Email + password | Standar, pemulihan mudah | Tidak semua santri punya email |
| B. Username + email sintetis (akun dibuatkan admin) | Cocok santri tanpa email | Pemulihan password oleh admin |
| C. Nomor HP + OTP | Familiar | Biaya OTP, ketergantungan penyedia |

**\[REKOMENDASI\]** A sebagai jalur utama; B sebagai jalur cadangan (admin membuat akun atas nama santri, status langsung `active` dengan audit — tetap lewat admin sehingga konsisten dengan aturan persetujuan). C ditunda.

---

## 4. Alur Utama

### 4.1 Pengajuan Akun

1. Calon pengguna membuka halaman *Ajukan Akun* (publik, di belakang Turnstile + rate limit).
2. Mengisi data minimum (§5.1) dan menyetujui kebijakan privasi internal.
3. Sistem membuat `auth.users` (belum terkonfirmasi) + `account_requests` dengan status `pending` dan `profiles.status = 'pending'`.
4. Pengguna memverifikasi email lewat tautan.
5. Halaman konfirmasi menyatakan eksplisit: **"Pengajuan tidak otomatis mengaktifkan akun"** \[TERKONFIRMASI\].
6. Admin menerima notifikasi `account.request_received`.

### 4.2 Persetujuan oleh Admin

- Admin melihat antrean `pending` (hanya yang email-nya sudah terverifikasi, dengan filter untuk melihat semua).
- Detail pemohon ditampilkan; admin memilih **Setujui** (wajib menetapkan peran awal; opsional tim) atau **Tolak** (alasan wajib).
- Persetujuan = satu transaksi: ubah status, buat `user_roles`, buat `team_members` bila ada, tulis audit, buat notifikasi.
- Email hasil dikirim ke pemohon (`account.approved` / `account.rejected`). Penolakan tidak menampilkan detail internal berlebih.
- Pemohon yang ditolak dapat mengajukan ulang setelah jeda yang dapat dikonfigurasi (default 24 jam) **\[REKOMENDASI\]**.

### 4.3 Login dan Logout

- Login email+password; pesan gagal **seragam** ("Email atau password salah") untuk mencegah enumerasi.
- Setelah login, middleware memeriksa `profiles.status`. Selain `active`, pengguna diarahkan ke halaman status yang sesuai, bukan ke aplikasi.
- Logout mencabut sesi saat ini; "keluar dari semua perangkat" tersedia.

### 4.4 Pemulihan Password

- Reset via email tautan sekali pakai berumur pendek (default 60 menit).
- Jalur B (tanpa email): admin memicu reset dan menyerahkan kredensial sementara; wajib ganti saat login pertama.
- Reset password mencabut seluruh sesi lain.

### 4.5 Suspensi dan Penonaktifan

- Suspend/Deactivate wajib alasan, mencabut sesi aktif seketika (admin API: sign-out global + larangan login), dan tercatat di audit.
- Pengguna `suspended` tidak muncul di daftar penugasan baru, tetapi data historisnya tetap utuh dan terbaca oleh yang berwenang.

---

## 5. Data Akun

### 5.1 Data Pengajuan (minimisasi)

| Field | Wajib | Catatan |
| --- | --- | --- |
| Nama lengkap | Ya | Dipakai di seluruh sistem |
| Email | Ya\* | \*Jalur A |
| Password | Ya\* | Kebijakan: min. 10 karakter, cek kata sandi umum/bocor bila tersedia |
| Kategori keanggotaan | Ya (NOW, REG-01) | Lima klaim: Santri / Ustadz / Pengurus / Yayasan / Lainnya (OD-014); bukan role otorisasi |
| Nomor HP | Ya (NOW, 2026-11-13; asal Opsional) | Untuk kontak; dilindungi, tidak otomatis terlihat di direktori |
| Tim/unit yang dituju | Opsional | Saran saja; admin yang memutuskan |
| Catatan untuk admin | Opsional | Maks. 500 karakter |
| Persetujuan kebijakan privasi | Ya | Versi & waktu disimpan |

Kategori keanggotaan dari pemohon hanyalah **klaim**; peran sebenarnya ditetapkan admin.

### 5.2 Tabel `account_requests`

`id, user_id, full_name, email, claimed_member_type, phone, requested_team_note, note, privacy_consent_version, privacy_consent_at, status (pending|approved|rejected), decided_by, decided_at, decision_reason, created_at`

Konstrain: satu permohonan `pending` aktif per email; email dinormalisasi huruf kecil.

---

## 6. Persyaratan Fungsional

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| IAM-001 | Form pengajuan akun dengan Turnstile, rate limit (mis. 5/jam/IP & per email), validasi server-side (manual diterima, Zod opsional; asal Zod wajib, keputusan 2026-11-13), pesan bahwa akun belum aktif | M |
| IAM-002 | Antrean permohonan untuk admin: filter status, pencarian, detail pemohon | M |
| IAM-003 | Setujui (peran awal + tim opsional) dan tolak (alasan wajib) dalam satu transaksi beraudit | M |
| IAM-004 | Login/logout aman; gerbang status akun di middleware **dan** di RLS | M |
| IAM-005 | Manajemen peran: beri/cabut peran, termasuk peran bercakupan tim; riwayat peran | M |
| IAM-006 | Dukungan banyak peran per pengguna | M |
| IAM-007 | State machine akun: pending/active/rejected/suspended/deactivated + validasi transisi di DB | M |
| IAM-008 | Reset password via email; ganti password; kebijakan password | M |
| IAM-009 | Manajemen sesi: daftar sesi aktif, logout semua perangkat, pencabutan admin saat suspend | S |
| IAM-010 | Audit untuk persetujuan, penolakan, perubahan peran, tim, suspend, nonaktif, reset paksa | M |
| IAM-011 | Verifikasi email pemohon sebelum masuk antrean prioritas | M |
| IAM-012 | MFA TOTP untuk Super Admin, Yayasan, Pengurus (wajib untuk Super Admin): **[v1.1] enforcement login**; **[NOW] semua Super Admin existing wajib mengaktifkan dan memverifikasi TOTP manual sebagai release gate**, bukan klaim enforcement tersedia (§16) | S |
| IAM-013 | Pembuatan akun oleh admin atas nama pengguna (jalur B), status langsung aktif, beraudit | S |
| IAM-014 | Perubahan peran massal / impor pengguna CSV dengan pratinjau & laporan kesalahan | C |
| IAM-015 | Guard "Super Admin terakhir" dan prinsip empat mata untuk perubahan peran admin | M |
| IAM-016 | Halaman status akun (pending/rejected/suspended) dengan pesan jelas dan kontak admin | M |
| IAM-017 | **[NOW — REG-03, disetujui 2026-11-13]** Pencatatan persetujuan kebijakan privasi (versi, waktu) dan persetujuan ulang saat versi berubah | S (NOW; bukan v1.1) |
| IAM-018 | **[v1.1 — disetujui 2026-11-13]** Peringatan keamanan ke pengguna (email) saat password diganti atau login perangkat baru | C |
| IAM-019 | Konfigurasi masa berlaku sesi dan batas percobaan login | S |

---

## 7. Aturan Keamanan Rinci

| Area | Ketentuan |
| --- | --- |
| Kredensial | Hash oleh Supabase Auth; tidak ada penyimpanan password di tabel aplikasi |
| Sesi | Cookie httpOnly, secure, SameSite=Lax; access token pendek; refresh token dirotasi |
| Rate limit | Login, pengajuan, reset password, permintaan ekspor |
| Anti-enumerasi | Pesan seragam pada login/reset/pengajuan ("Jika email terdaftar, kami kirim tautan") |
| Service role | Hanya di server (Route Handler/Edge Function) untuk tugas admin; tidak pernah ke klien |
| RPC admin | `SECURITY DEFINER`, cek `has_permission('iam.account.decide')`, tulis audit dalam transaksi sama |
| Idempotensi | Persetujuan ganda pada permohonan sama → operasi kedua ditolak dengan kode `IAM_ALREADY_DECIDED` |
| Header | CSP, HSTS, X-Frame-Options/`frame-ancestors`, Referrer-Policy |
| Redirect | Allow-list tujuan redirect setelah login (hindari open redirect) |
| Logging | Tidak mencatat password/token; event login gagal dicatat tanpa detail kredensial |

---

## 8. Persyaratan Layar

| Layar | Pengguna | Isi utama |
| --- | --- | --- |
| Ajukan Akun | Publik | Form, Turnstile, persetujuan privasi, pesan "belum aktif" |
| Verifikasi Email / Status | Pemohon | Status pending/ditolak, kontak admin |
| Login | Semua | Email, password, lupa password |
| Antrean Permohonan | Admin | Tabel + filter + aksi cepat |
| Detail Permohonan | Admin | Data pemohon, pilih peran/tim, setujui/tolak |
| Manajemen Pengguna | Admin | Daftar, status, peran, aksi suspend/aktifkan |
| Detail Pengguna & Peran | Admin | Riwayat peran, tim, sesi, audit |
| Keamanan Akun | Semua | Ganti password, sesi aktif, MFA |

UX: form pengajuan satu kolom, mobile-first; status akun harus selalu jelas; aksi destruktif (suspend, cabut peran) meminta konfirmasi dan alasan.

---

## 9. Notifikasi dan Email

| Event | Kanal | Isi |
| --- | --- | --- |
| `account.request_received` | In-app (admin) | Pemohon baru menunggu |
| `account.approved` | Email | Akun aktif + tautan login |
| `account.rejected` | Email | Alasan ringkas yang aman |
| `account.suspended` | Email | Pemberitahuan + kontak |
| Reset password | Email | Tautan sekali pakai |

Domain pengirim email wajib terverifikasi (SPF/DKIM/DMARC) agar tidak masuk spam.

---

## 10. Audit

Aksi: `iam.account.requested`, `.approved`, `.rejected`, `.suspended`, `.reactivated`, `.deactivated`, `iam.role.assigned`, `.revoked`, `iam.session.revoked`, `iam.password.admin_reset`, `iam.mfa.enabled`. Setiap entri memuat aktor, target, sebelum/sesudah, alasan, `request_id`.

---

## 11. Edge Case

| Kasus | Perilaku |
| --- | --- |
| Dua admin menyetujui bersamaan | Satu berhasil, satu menerima `IAM_ALREADY_DECIDED` |
| Email sudah terdaftar | Pesan netral; tidak membuat duplikat; pemilik email menerima pemberitahuan |
| Pemohon tidak verifikasi email | Tetap `pending` di antrean "belum terverifikasi"; kedaluwarsa & dibersihkan setelah N hari (default 14) |
| Pengguna disuspend saat sedang login | Sesi dicabut; request berikutnya ditolak oleh RLS meski token belum kedaluwarsa |
| Super Admin tunggal dinonaktifkan | Ditolak oleh guard |
| Santri naik menjadi pengurus | Tambah peran baru, tidak membuat akun baru; peran lama dicabut bila perlu; riwayat tetap |
| Koordinator dicabut dari tim | Aksesnya ke data tim berhenti segera; riwayat tugas tetap |
| Perubahan email pengguna | Wajib verifikasi email baru; audit |
| Token JWT lama setelah cabut peran | Aman karena otorisasi dibaca dari DB setiap request |

---

## 12. Kriteria Penerimaan

1. Pengguna `pending`/`rejected`/`suspended`/`deactivated` tidak dapat membaca atau menulis data modul mana pun (dibuktikan tes pgTAP per tabel).
2. Admin dapat menyetujui/menolak; hasil tercatat di audit dengan aktor dan alasan.
3. Pemohon tidak dapat memberi dirinya peran apa pun (tes percobaan `INSERT` ke `user_roles` oleh pengguna biasa gagal).
4. Satu pengguna dapat memegang `santri` + `koordinator(tim X)`; akses data tim X terbuka hanya untuk tim X.
5. Perubahan/pencabutan peran berlaku tanpa login ulang.
6. Super Admin terakhir tidak bisa dihapus/diturunkan.
7. Pesan login/reset/pengajuan tidak membocorkan keberadaan akun.
8. Form pengajuan menolak bot tanpa token Turnstile valid dan menolak permintaan melebihi rate limit.
9. Suspend mencabut sesi aktif dalam ≤ 1 menit.
10. Seluruh aksi pada §10 tercatat audit.

---

## 13. Rencana Tes

| Jenis | Skenario kunci |
| --- | --- |
| pgTAP | Matriks peran × tabel × operasi; fungsi `has_permission` untuk semua scope; transisi status ilegal ditolak; guard Super Admin terakhir |
| Unit | Validasi server pengajuan (manual atau Zod; asal skema Zod); normalisasi email; kebijakan password; guard app-layer |
| E2E | Pengajuan → verifikasi email → persetujuan → login pertama; penolakan; suspend saat sesi aktif; reset password |
| Keamanan | Percobaan eskalasi peran lewat klien Supabase langsung; IDOR pada detail pengguna; rate limit; enumerasi akun |

---

## 14. Dependensi dan Keputusan Terbuka

**Bergantung pada:** PRD-07 (profil, tim), Master §9 (model otorisasi). **Dipakai oleh:** semua modul.

| ID | Keputusan | Default sementara |
| --- | --- | --- |
| OD-008 | Hierarki peran & matriks final | Matriks default §2.5 + Master §9.2 |
| OD-009 | Metode verifikasi/identitas login | Email + jalur admin-created |
| OD-014 | Posisi ustadz | `member_type` + peran pengurus |
| OD-018 | Pengguna di bawah 18 tahun | Minimisasi; konsultasi hukum |
| OD-020 | Pemilik produk & admin teknis | Wajib sebelum R1 |

---

## 15. Metrik Modul

Waktu rata-rata persetujuan akun; jumlah permohonan pending > 48 jam; persentase pengguna aktif ber-MFA (peran tinggi); jumlah percobaan login gagal/hari; jumlah perubahan peran/bulan.

---

## 16. Keputusan Audit — 2026-11-13 [TERKONFIRMASI]

Change log 2.1: keputusan pengguna berikut mengikat cakupan NOW/v1.1 (Master §0.4); tidak menyatakan perbaikan sudah diimplementasi atau diuji.

- **REG-01 + REG-03 / IAM-017 — NOW:** form menawarkan tepat lima **klaim kategori keanggotaan**: Santri, Ustadz, Pengurus, Yayasan, Lainnya. Bukan pilihan `roles`/`user_roles`, tidak memberi hak akses, tidak otomatis mengaktifkan akun; admin tetap memverifikasi dan menetapkan role secara terpisah. `staf` pada model profil PRD-07 bukan opsi keenam pada form klaim ini. Checkbox persetujuan privasi wajib; versi kebijakan dan waktu persetujuan dari server disimpan terkait pemohon, dapat ditelusuri setelah approval. IAM-017 termasuk persetujuan ulang saat versi berubah tetap NOW, bukan bagian deferral C.
- **REG-05 — NOW:** HP wajib di pengajuan (mengganti baseline opsional), tetap data kontak privat; kewajiban mengisi bukan izin mempublikasikan kontak.
- **REG-07 / IAM-001 — NOW:** validasi manual di server diterima; Zod boleh dipakai tetapi bukan syarat rilis. Semua batas input, normalisasi, anti-bot, rate limit, dan validasi kategori/consent tetap wajib; validasi klien saja tidak cukup.
- **TRC-10 / IAM-012 — v1.1:** enforcement MFA pada login/session untuk Super Admin ditunda eksplisit. **Release gate NOW: semua Super Admin yang SUDAH ADA harus mengaktifkan TOTP secara manual dan menyelesaikan verifikasi faktor.** Operator mencatat identitas akun, waktu, pemeriksa, dan hasil verifikasi tanpa secret/QR/recovery code. Belum boleh menyatakan gate terpenuhi sebelum bukti tersebut ada. Pendaftaran faktor tidak membuktikan setiap login meminta TOTP atau akses AAL1 ditolak; residual risk login tanpa challenge diterima sementara sampai v1.1.
- **TRC-28 — NOW:** app-layer adalah gerbang otorisasi request pengguna: identitas berasal dari sesi server, akun aktif, role terbaru, serta scope `own/assigned/team/all` diperiksa sebelum query/mutasi, terutama jalur service-role. Wajib bukti **guard tests** (anonim, nonaktif, role salah, IDOR/lintas tim, self-escalation) dan tes RLS secara terpisah. RLS tetap aktif, default-deny, defense-in-depth; **jangan menambah policy permisif, menonaktifkan RLS, atau menganggap service-role dilindungi RLS**. Kontrak helper database §2.4 tetap target konsolidasi **v1.1**, bukan deskripsi semua action saat ini.
- **FUNC-16 / BR-IAM-02 — NOW:** server action + guard diterima sebagai mekanisme penugasan/pencabutan role. Identitas aktor tidak boleh dari payload, cek kewenangan dan target tetap wajib, audit tetap diwajibkan. **Target v1.1:** `iam_assign_role` / `iam_revoke_role` menyatukan mutasi dan audit secara atomik. Requirement guard Super Admin terakhir (termasuk race) dan prinsip empat mata IAM-015 tetap dipertahankan; penundaan mekanisme RPC bukan penghapusan kewajiban guard. Mekanisme server action saat ini **tidak dinyatakan setara transaksi RPC atau sudah memenuhi seluruh guard tersebut**; bukti guard/audit harus dilaporkan, bukan diasumsikan dari nama action.
- **IAM-018 — v1.1:** email peringatan keamanan ditunda; tidak mengubah kebutuhan email keputusan pengajuan atau reset password yang terpisah.

Acceptance NOW tambahan: lima klaim tidak dapat mengeskalasi role; pengajuan tanpa HP/consent ditolak di server; versi/waktu consent tersimpan; bukti aktivasi manual TOTP semua Super Admin existing tersedia; guard dan RLS diuji sebagai lapisan berbeda. Ini rencana penerimaan, bukan hasil tes pembaruan dokumentasi.
