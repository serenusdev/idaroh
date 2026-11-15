# Operator Release Gates — Pondok OS

Panduan klik-per-klik untuk mengaktifkan seluruh gate rilis. Ditulis untuk operator/pemilik yang punya akses dashboard provider. **Semua langkah di sini butuh login akun provider dan secret asli — tidak bisa diotomatisasi dari repo.** Kode dan dokumen sudah disiapkan; bagian dashboard/secret adalah tanggung jawab operator.

Aturan tetap: jangan taruh secret di repo, log, screenshot, atau chat. `.env.example` hanya placeholder. Jangan longgarkan RLS/grant. Jangan apply migrasi/ubah provider tanpa otorisasi. Label menu provider bisa sedikit berbeda antar versi; ikuti nama fungsi, bukan hafalan letak.

## Urutan aman

1. Backup dulu (B2 + GitHub Actions) — jaring pengaman sebelum ubah skema.
2. Apply migrasi.
3. Environment variables di Vercel + redeploy.
4. Cron eksternal (cron-job.org).
5. TOTP manual semua super_admin.
6. Drill restore (uji backup benar-benar bisa dipulihkan).
7. Uji PDF runtime produksi.

Selesaikan berurutan; tiap gate ada bukti yang harus dicatat. Checklist akhir di §8.

## 0. Prasyarat akses & alat

Akun yang dibutuhkan: Supabase (project production), Vercel (project terhubung repo), Cloudflare (Turnstile), Backblaze B2 (backup, tanpa kartu kredit), Resend, cron-job.org, GitHub (repo `serenusdev/idaroh`).

Alat di mesin operator: `supabase` CLI, `age` (`age-keygen`), `aws` CLI (atau `rclone`), `openssl`, `psql` (untuk drill restore). Di macOS: `brew install supabase/tap/supabase age awscli libpq openssl`.

## 1. Backup mingguan ke Backblaze B2 (Free plan)

Workflow sudah ada di `.github/workflows/backup.yml`; prosedur lengkap + batasan di `docs/backup-restore.md`. Ringkasan setup:

### 1a. Bucket + application key B2
1. Daftar Backblaze B2 (tanpa kartu kredit) → **Buckets** → **Create a Bucket** → nama mis. `idaroh-backups` (Files in Bucket: **Private**) → Create.
2. Catat **region** bucket (mis. `us-west-004`) — terlihat di **Endpoint** bucket; ini jadi secret `B2_REGION`.
3. Buka bucket → **Lifecycle Settings** → atur objek prefix `backups/` kedaluwarsa setelah mis. **60 hari** (retensi ikuti kebijakan privasi).
4. **Application Keys** → **Add a New Application Key** → nama mis. `idaroh-backup` → allow access to bucket `idaroh-backups` → type of access **Read and Write** → Create. Catat **keyID** + **applicationKey** (applicationKey hanya tampil sekali).

### 1b. Kunci enkripsi age
1. Jalankan `age-keygen -o key.txt`. Public key (`age1...`) dicetak ke layar.
2. Public key → akan jadi secret `AGE_RECIPIENT`.
3. **Simpan `key.txt` offline/terenkripsi** (mis. password manager + salinan terenkripsi). Ini satu-satunya cara mendekripsi backup. Jangan commit, jangan simpan di CI.

### 1c. Connection string Supabase
1. Supabase dashboard → project → tombol **Connect** → pilih **Session pooler** (bukan Direct connection).
2. Salin URL, ganti `<password>` dengan password DB project. Format: `postgresql://postgres.<project_ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
3. **Wajib session pooler:** runner GitHub Actions IPv4, direct connection Supabase IPv6-only → direct tidak akan jalan di CI.

### 1d. Secret GitHub + aktivasi
GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**, set enam:

| Secret | Nilai |
| --- | --- |
| `SUPABASE_DB_URL` | Session pooler URL (1c) |
| `AGE_RECIPIENT` | Public key age (1b) |
| `B2_APPLICATION_KEY_ID` | keyID application key B2 (1a) |
| `B2_APPLICATION_KEY` | applicationKey B2 (1a) |
| `B2_BUCKET` | `idaroh-backups` |
| `B2_REGION` | Region bucket B2, mis. `us-west-004` (1a) |

Lalu: push workflow ke repo → tab **Actions** → **Pondok OS Weekly DB Backup** → **Run workflow** (pemicu manual) untuk bukti pertama. Setelah hijau, cek bucket B2: objek `backups/<tanggal>.sql.age` harus ada. Jadwal otomatis: Senin 00:00 WIB.

Bukti: screenshot run hijau + objek di B2 (tanpa secret). Catatan: dump = skema `public`; `auth.users` (akun) dan Storage (file) tidak ikut — lihat `docs/backup-restore.md`.

## 2. Apply migrasi (10 file pending)

Migrasi sebelum `20261113` sudah diterapkan. Yang pending, terapkan **berurutan sesuai nama file**:

1. `20261113000001_registration_consent.sql`
2. `20261113000002_attendance_reminder_preference.sql`
3. `20261114000001_fix_duration_regex.sql`
4. `20261114000002_fix_report_reminder_default.sql` (pengingat laporan 21:00 → 19:30)
5. `20261114000003_email_outbox.sql`
6. `20261114000004_admin_update_user_rpc.sql`
7. `20261114000005_task_reviewer_mention_username.sql`
8. `20261114000006_profile_bio.sql`
9. `20261114000007_correction_effective_layer.sql`
10. `20261114000008_account_requests_pending_unique.sql`

**Prasyarat `000008`:** bersihkan email pending duplikat dulu, kalau tidak `CREATE UNIQUE INDEX` gagal. Cek:
```sql
SELECT lower(email), count(*) FROM public.account_requests
WHERE status = 'pending' GROUP BY lower(email) HAVING count(*) > 1;
```
Jika ada hasil, resolve manual (approve/reject salah satu) sebelum apply. File ini hanya menambah index, tidak menghapus baris.

**Cara apply (pilih satu):**
- **SQL Editor (disarankan untuk produksi):** Supabase dashboard → **SQL Editor** → New query → paste isi file ke-1 → **Run**. Ulangi berurutan sampai file ke-10. Pastikan tiap statement sukses sebelum lanjut.
- **Supabase CLI:** `supabase link --project-ref <ref>` lalu `supabase db push`. *Caveat:* `db push` bergantung tabel history `supabase_migrations`; bila migrasi lama diterapkan via SQL Editor (tak tercatat di history), ia bisa coba re-apply semua. Untuk produksi berjalan, SQL Editor per-file lebih terkendali.

Semua migrasi ini tidak melonggarkan RLS/grant. Sesudah: smoke test login, presensi, laporan, task, calendar feed. Bukti: daftar file applied + hasil smoke test.

## 3. Environment variables di Vercel

Validator `scripts/validate-production-env.mjs` berjalan saat build produksi dan **fail-closed** (build gagal bila ada yang kurang). Variabel wajib:

| Variabel | Sumber |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL (HTTPS) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key (rahasia, server-only) |
| `NEXT_PUBLIC_APP_URL` | Origin HTTPS produksi (mis. `https://app.domainmu`) |
| `CRON_SECRET` | Generate: `openssl rand -hex 32` (≥32 char) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare → Turnstile → site key (publik) |
| `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → secret key |
| `RESEND_API_KEY` | Resend → API Keys |
| `EMAIL_FROM` | Alamat pengirim terverifikasi, mis. `Pondok OS <no-reply@domainmu>` |

Opsional: `FIREBASE_SERVICE_ACCOUNT_KEY` (bila kosong, push disabled + warning), `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL`/`NEXT_PUBLIC_ADMIN_WHATSAPP`, `OPS_ERROR_WEBHOOK_URL`. `VITEST` tidak boleh ada di produksi.

### 3a. Turnstile (Cloudflare)
1. Cloudflare dashboard → **Turnstile** → **Add site**.
2. Isi nama site + domain produksi (mis. `app.domainmu`) → widget mode **Managed** → Create.
3. Catat **Site Key** (publik → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) dan **Secret Key** (→ `TURNSTILE_SECRET_KEY`).
4. Widget sudah rilis di kode, jadi kedua kunci ini wajib sekarang.

### 3b. Resend (email transaksional)
1. resend.com → **Domains** → **Add Domain** → masukkan domain pengirim → tambahkan record DNS (SPF/DKIM) yang diminta di DNS provider (Cloudflare) → tunggu **Verified**.
2. **API Keys** → **Create API Key** → permission sending → catat key (→ `RESEND_API_KEY`).
3. `EMAIL_FROM` harus pakai domain yang sudah verified, mis. `Pondok OS <no-reply@domainmu>`.

### 3c. Set di Vercel + redeploy
1. Vercel → project → **Settings → Environment Variables**.
2. Tambah tiap variabel di atas, environment **Production** (dan Preview bila perlu). Untuk secret, pilih tipe encrypted; jangan paste ke log.
3. **Deployments** → deployment terakhir → **⋯ → Redeploy** (atau push commit baru). Build akan gagal bila ada variabel wajib kurang — itu validator bekerja, bukan bug.

Bukti: build produksi hijau + variabel terpasang (nama saja, bukan nilai).

## 4. Cron eksternal (cron-job.org)

Detail desain: `docs/ADR-2026-11-13-cron-job-org.md`. Dua job **GET tiap 15 menit** ke origin HTTPS produksi:
- `https://<origin>/api/cron/notifications`
- `https://<origin>/api/cron/backups`

Header tiap job: `Authorization: Bearer <CRON_SECRET yang sama dengan env Vercel>`.

Langkah:
1. cron-job.org → daftar/login → **Create cronjob**.
2. Title mis. `idaroh-notifications`; URL `https://<origin>/api/cron/notifications`.
3. Schedule: **Every 15 minutes** (custom: `*/15 * * * *`).
4. Request method: **GET**. Di bagian advanced/headers tambah header `Authorization` = `Bearer <CRON_SECRET>`.
5. Save. Ulangi untuk job kedua (`/api/cron/backups`, title `idaroh-backups`).
6. Catat **ID kedua job, origin, pemilik, jadwal**.

Jadwal bisnis **WIB** diatur in-app di **`/admin/cron`** (`cron_job_schedules`): `attendance_reminder` 07:30 Sen–Sab, `report_reminder` **19:30** Sen–Sab (setelah migrasi `000002`), `backup_manifest` 00:30 harian. Heartbeat 15 menit ≠ jadwal pengingat; jendela due [jadwal, +20 menit).

Verifikasi: **HTTP 200 bisa berarti `skipped/not_scheduled/already_processed`** — periksa claim `cron_job_runs`, outbox, dan hasil pekerjaan, bukan HTTP saja. Hindari scheduler ganda (Vercel Cron/pg_cron) untuk pekerjaan sama.

Rotasi `CRON_SECRET`: ubah serentak env Vercel + header kedua job; kode menerima satu secret (tanpa overlap) → pantau kemungkinan 401 saat pergantian. Bukti: heartbeat terakhir kedua job + respons/body + hasil claim.

## 5. TOTP manual semua super_admin (syarat rilis)

TRC-10: pemaksaan MFA di login ditunda v1.1, tapi **setiap super_admin existing wajib aktifkan TOTP sekarang**.

Tiap super_admin:
1. Login → buka **`/settings/profile`** (mobile: sheet **Lainnya** → **Pengaturan Profil**).
2. Bagian **"Verifikasi Dua Langkah (MFA)"** → **Aktifkan MFA**.
3. Scan QR di aplikasi authenticator (Google Authenticator/Authy/1Password), atau masukkan **secret manual**.
4. Ketik kode 6 digit → **Verifikasi MFA**. Faktor terverifikasi tampil dengan tombol **Cabut**.

Catat bukti (siapa, kapan, status verified) **tanpa** secret/QR/kode. Enrollment via Supabase Auth factors.

## 6. Drill restore (wajib; ADM-009)

Backup tanpa uji restore tidak memenuhi ADM-009. Prosedur lengkap di `docs/backup-restore.md` (§Drill restore). Ringkas:
1. Ambil objek terbaru dari B2 (`aws s3 cp s3://idaroh-backups/backups/<file>.sql.age . --endpoint-url https://s3.<region>.backblazeb2.com`).
2. Dekripsi offline: `age -d -i key.txt -o backup.sql <file>.sql.age`.
3. Restore ke **Supabase lokal** (`supabase start` → `psql "$LOCAL_DB_URL" -f backup.sql`) atau project staging Free ke-2. Jangan langsung produksi.
4. Validasi row count tabel inti, constraint, policy RLS; uji akses lintas dua akun uji.
5. Smoke test login, presensi, laporan, task, calendar feed.
6. Catat tanggal, operator, file backup, hasil, keputusan di change log.

Lakukan berkala (mis. bulanan) dan setiap sebelum migrasi besar.

## 7. Uji PDF runtime produksi (FUNC-03)

`src/lib/pdf.ts` meng-embed font dari `node_modules/@fontsource/noto-sans/...woff2` saat runtime. Risiko: font tidak ter-trace ke bundle serverless Vercel → PDF gagal/kosong.

1. Di **produksi**, login sebagai super_admin/yayasan/pengurus.
2. Halaman analitik/admin → **ekspor PDF** (kategori mis. presensi/laporan).
3. Unduh file `.pdf` yang dihasilkan → buka: pastikan teks tampil benar (font Latin-ext ter-embed, bukan kotak/kosong). Uji juga CSV.
4. Bila gagal → itu perbaikan kode (tracing font di `next.config`), laporkan ke tim dev; di luar gate operator.

Bukti: file PDF hasil ekspor produksi yang terbuka normal.

## 8. Checklist rilis akhir

Centang hanya bila ada bukti:

- [ ] Backup B2: workflow hijau + objek `.sql.age` ada di bucket; `key.txt` tersimpan offline.
- [ ] 10 migrasi applied berurutan; duplikat pending `000008` sudah bersih; smoke test lulus.
- [ ] Env Vercel lengkap (9 wajib) + build produksi hijau + redeploy.
- [ ] Turnstile site+secret terpasang; widget muncul di register/login.
- [ ] Resend domain verified; email keputusan/undangan benar-benar terkirim.
- [ ] cron-job.org: dua job GET 15 menit aktif; heartbeat + claim/outbox terverifikasi (bukan cuma HTTP 200).
- [ ] `/admin/cron`: report_reminder 19:30 WIB; jadwal lain sesuai.
- [ ] Semua super_admin: TOTP verified (bukti tanpa secret).
- [ ] Drill restore: berhasil ke staging/lokal + validasi + smoke test + catatan.
- [ ] PDF runtime produksi: terbuka normal.
- [ ] `CRON_SECRET` ≥32 char, sama di env + kedua job; rotasi terkoordinasi bila diubah.

## Catatan: real vs placeholder (klarifikasi)

- **Kode fitur = real, teruji** (431 unit test, 95 e2e hijau, build produksi hijau). Bukan dummy.
- **`.env.example` = placeholder by design.** Secret asli tidak boleh masuk repo; mengisinya adalah aksi dashboard (§3), bukan perubahan kode.
- **Fixture e2e mem-mock provider** = harness test yang sah, bukan aplikasi produksi. Produksi memakai Supabase/FCM/Resend asli setelah env diisi.
- **`/admin/backup` = manifest jumlah baris, BUKAN backup.** Backup nyata sekarang via workflow B2 (§1). Status `manifest_only` tidak memenuhi ADM-009.
- **"Lokal" (uncommitted)** menjadi aktif hanya setelah commit + push + deploy + langkah dashboard di atas. Push saja tidak membuat "aktif" bila secret/migrasi/provider belum dikonfigurasi operator.