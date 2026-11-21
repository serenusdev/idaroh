# Operator Release Gates — Pondok OS

Panduan klik-per-klik untuk mengaktifkan seluruh gate rilis. Ditulis untuk operator/pemilik yang punya akses dashboard provider. **Semua langkah di sini butuh login akun provider dan secret asli — tidak bisa diotomatisasi dari repo.** Kode dan dokumen sudah disiapkan; bagian dashboard/secret adalah tanggung jawab operator.

Aturan tetap: jangan taruh secret di repo, log, screenshot, atau chat. `.env.example` hanya placeholder. Jangan longgarkan RLS/grant. Jangan apply migrasi/ubah provider tanpa otorisasi. Label menu provider bisa sedikit berbeda antar versi; ikuti nama fungsi, bukan hafalan letak.

## Urutan aman

> Rilis 2026-11-21 (cabang `fix/idaroh-auth-and-schema-reconciliation`): jalankan dulu
> `docs/runbook-2026-11-21-auth-schema-remediation.md` (preflight SQL + push 22 migrasi +
> verifikasi RPC) sebelum mengikuti langkah umum di bawah.

1. Backup dulu (B2 + GitHub Actions) — jaring pengaman sebelum ubah skema.
2. Apply migrasi.
3. Environment variables di Vercel + redeploy.
4. Cron eksternal (cron-job.org).
5. MFA super_admin (enroll TOTP + pahami break-glass §5b).
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

Lalu: push workflow ke repo → tab **Actions** → **IDAROH Weekly DB Backup** → **Run workflow** (pemicu manual) untuk bukti pertama. Setelah hijau, cek bucket B2: objek `backups/<tanggal>.sql.age` harus ada. Jadwal otomatis: Senin 00:00 WIB.

Bukti: screenshot run hijau + objek di B2 (tanpa secret). Catatan: dump = skema `public`; `auth.users` (akun) dan Storage (file) tidak ikut — lihat `docs/backup-restore.md`.

## 2. Apply migrasi (12 file pending)

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
11. `20261117000001_email_outbox_idempotency.sql`
12. `20261118000001_report_review_command_idempotency.sql`

**Prasyarat `000008`:** bersihkan email pending duplikat dulu, kalau tidak `CREATE UNIQUE INDEX` gagal. Cek:
```sql
SELECT lower(email), count(*) FROM public.account_requests
WHERE status = 'pending' GROUP BY lower(email) HAVING count(*) > 1;
```
Jika ada hasil, resolve manual (approve/reject salah satu) sebelum apply. File ini hanya menambah index, tidak menghapus baris.

**Prasyarat `20261117000001`:** periksa duplicate business reference pada `email_outbox` sebelum apply. Migration akan berhenti dan tidak membuat index bila pasangan `(reference_type, reference_id)` sudah duplicate; jangan menghapus atau memilih row secara otomatis.
```sql
SELECT reference_type, reference_id, count(*)
FROM public.email_outbox
WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL
GROUP BY reference_type, reference_id
HAVING count(*) > 1;
```

**Penilaian lock index `20261117000001`:** index unik dibuat dengan `CREATE UNIQUE INDEX` biasa (non-concurrent) di dalam transaksi. Index biasa mengambil lock `SHARE` yang memblokir *write* ke `email_outbox` selama build, bukan read. Bukti repo: tabel `email_outbox` baru dibuat migrasi `20261114000003` (beberapa hari sebelum migrasi 11) dan hanya diisi event keputusan review/persetujuan, sehingga volumenya kecil; build diperkirakan milidetik. Tidak ada bukti ukuran tabel produksi yang dapat diakses dari repo ini. **Rekomendasi: pertahankan index non-concurrent** — `CREATE INDEX CONCURRENTLY` tidak boleh berada di dalam blok `BEGIN/COMMIT` migrasi ini. Bila operator menemukan tabel sudah besar, bangun index yang kompatibel secara terpisah di luar transaksi sebelum apply:
```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_email_outbox_business_reference
  ON public.email_outbox(reference_type, reference_id);
```
Migrasi 11 menerima index yang sudah ada: preflight memverifikasi definisi dan `IF NOT EXISTS` melewati pembuatan ulang. Jangan mengubah file migrasi ke mode concurrent hanya sebagai pencegahan.

**Migration review decision berikutnya:** `20261118000001_report_review_command_idempotency.sql` menambahkan idempotensi command dan membuat review, perubahan status, idempotency result, recipient snapshot, email outbox event, **event push durable (`notifications` + enqueue trigger `notification_push_outbox`), dan record audit wajib** berada dalam satu transaksi database. Audit memakai `auth.uid()` server-side (`actor_id` terisi) dan hanya dibuat pada jalur create — retry idempotent tidak menduplikasi audit, email, maupun push. Kegagalan insert audit membatalkan seluruh command. Setiap keputusan yang tersimpan tetap merupakan event independen, termasuk beberapa keputusan pada `report_id` dan `revision_no` yang sama. Identitas email review adalah `report_review_email + report_reviews.id`; identitas push adalah `notification_type + reference_id(review_id)`; jangan menggantinya dengan `report_id`.

Retry dengan actor dan `idempotency_key` yang sama mengembalikan `review_id` asli. Key yang sama dengan payload berbeda harus ditolak. Migration ini belum menjadi bukti bahwa email terkirim exactly once: outbox dan Resend tetap memakai retry dengan provider idempotency key yang sama, tanpa klaim exactly-once delivery.

Jika recipient tidak dapat diselesaikan atau insert outbox gagal, transaksi review dibatalkan dan RPC mengembalikan kegagalan. Email tetap dikirim asynchronous oleh drain worker. Atomic database commit bukan jaminan exactly-once delivery: provider/network ambiguity tetap dapat menyebabkan retry, tetapi retry menggunakan provider idempotency key yang sama.

#### Pemulihan retry pada browser

Halaman review menyimpan hanya `idempotency_key` dan fingerprint non-sensitif di `sessionStorage` dengan scope **actor**/report/revisi/keputusan (`src/modules/reports/review-command-storage.ts`). Isi catatan review tidak disimpan di browser storage (hanya digest). Key dipakai kembali setelah refresh atau network timeout selama fingerprint command sama, lalu dihapus setelah RPC mengembalikan sukses. Browser storage yang diblokir memakai fallback memory-only; pada kondisi tersebut retry setelah refresh **tidak** memakai key lama (command baru diterbitkan) dan harus diperlakukan sebagai kondisi yang belum terverifikasi oleh operator. Jangan menghapus storage pending secara manual sebelum hasil command ambigu diselesaikan, karena hal itu dapat mengubah retry menjadi command baru.

**Cara apply (pilih satu):**
- **SQL Editor (hanya setelah gate environment disetujui):** Supabase dashboard → **SQL Editor** → New query → paste isi file ke-1 → **Run**. Ulangi berurutan sampai file ke-12. Pastikan tiap statement sukses sebelum lanjut; berhenti jika salah satu preflight gagal.
- **Supabase CLI:** `supabase link --project-ref <ref>` lalu `supabase db push`. *Caveat:* `db push` bergantung tabel history `supabase_migrations`; bila migrasi lama diterapkan via SQL Editor (tak tercatat di history), ia bisa coba re-apply semua. Untuk produksi berjalan, SQL Editor per-file lebih terkendali.

**Preflight function dan index:** sebelum migration 12, pastikan migration 11 sudah berhasil dan index memiliki definisi yang tepat:
```sql
SELECT to_regprocedure('public.review_report(uuid,integer,text,text,text)') AS review_rpc;
SELECT indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND indexname = 'uq_email_outbox_business_reference';
```
Hasil yang diharapkan untuk `review_rpc` adalah function 5-parameter; `indexdef` harus memuat `(reference_type, reference_id)`. Jika duplicate non-NULL business reference ditemukan, hentikan proses dan jangan menghapus atau memilih row secara otomatis.

**Post-migration verification:** verifikasi function signature, execute grant untuk `authenticated`, RLS pada `report_review_idempotency`, serta bahwa `report_reviews` tidak memiliki uniqueness pada `(report_id, revision_no)`. Jalankan fixture pgTAP hanya pada disposable database; prosedur lengkap ada di [`docs/disposable-db-verification.md`](disposable-db-verification.md). Catat migration ledger dan hasil verifikasi tanpa mencatat secret atau data pengguna.

**Data historis (orphan review):** keputusan review sebelum migrasi 12 mungkin tidak punya event email outbox. Inventory read-only dan backfill dry-run-by-default tersedia di `supabase/operator/report_review_email_inventory.sql` dan `supabase/operator/report_review_email_backfill.sql`; desain dan prosedur persetujuan operator ada di [`docs/report-review-email-backfill.md`](report-review-email-backfill.md). Jangan eksekusi backfill tanpa persetujuan eksplisit; baris yang di-insert akan dikirim oleh cron worker.

**Rollback artifact:** gunakan [`supabase/rollback/20261118000001_report_review_command_idempotency_down.sql`](../supabase/rollback/20261118000001_report_review_command_idempotency_down.sql) secara manual dan berurutan. Artifact menghapus public/app RPC 5-parameter, mengembalikan definisi historis 3-parameter, memulihkan grants, lalu menghapus tabel idempotency. Rollback ini menghapus command idempotency **termasuk persistensi audit dan push di dalam transaksi** (versi aplikasi historis mencatatnya app-side setelah RPC) dan tidak boleh dijalankan otomatis oleh aplikasi.

Local static validation, disposable database verification, staging verification, dan production release gate adalah tahap berbeda. Tidak ada tahap yang boleh dianggap PASS hanya karena source code atau migration file tersedia.

#### Verifikasi CI (`database-integration`)

Job `database-integration` di `.github/workflows/ci.yml` menjalankan verifikasi database runtime pada Supabase disposable di runner GitHub (bukan mesin operator, bukan hosted project):

1. `supabase start` + `supabase db reset --local --yes` — seluruh 54 migrasi diterapkan dari nol, termasuk migrasi 11 (`20261117000001`) dan 12 (`20261118000001`) berurutan; preflight duplicate-reference dan definisi index diuji terhadap DB bersih.
2. `supabase test db --local` — seluruh fixture pgTAP (`rls_matrix.sql`, `account_approval.sql`, `report_review_idempotency.sql` dengan 28 assertion): atomicity keputusan+audit+email+push+idempotency, rollback penuh saat audit gagal, retry same-key tanpa duplikat, same-key payload berbeda → `IDEMPOTENCY_CONFLICT`, key berbeda → keputusan independen, grants/RLS menolak akses tidak sah.
3. `scripts/drill/review-concurrency.sh` (timeout 5 menit) — dua sesi psql paralel terhadap DB disposable yang sama: same actor/key paralel menghasilkan tepat 1 review + 1 audit + 1 email outbox + 1 push event dengan `review_id` identical di kedua caller; distinct-key menghasilkan keputusan independen dengan event masing-masing. Assertion membaca count aktual di database, bukan exit code proses. Cleanup drill tidak menghapus audit (append-only/hash-chain); penghancuran total via `supabase stop --no-backup` (`if: always()`, tetap berjalan saat job gagal).
4. E2E browser terhadap aplikasi + DB disposable lokal.

Job ini tidak memakai secret repository apa pun; kredensial berasal dari stack lokal runner. Email/FCM tidak terkirim nyata: tanpa `RESEND_API_KEY`/kredensial FCM, drain mengembalikan `skipped`, dan email auth lokal ditangkap mailpit.

**Semantik status:**
- **PASS** — tahap benar-benar dieksekusi dan hasil aktualnya memenuhi invariant (bukti: log run CI/output fixture/drill).
- **FAIL** — tahap dieksekusi dan invariant tidak terpenuhi; job gagal.
- **BLOCKED** — tahap tidak dapat dieksekusi karena prasyarat eksternal (mis. Docker/RAM tidak cukup di mesin operator, atau izin push belum diberikan).
- **NOT VERIFIED** — belum ada eksekusi sama sekali; konfigurasi atau file yang tersedia bukan bukti eksekusi.

Perubahan integrasi drill disiapkan lokal per 2026-11-18 dan **belum di-commit/push/dijalankan**; sampai run CI pertama selesai setelah push, seluruh verifikasi database runtime berstatus NOT VERIFIED. **CI hijau tidak otomatis berarti production siap deploy**: gate operator (§1 backup, §2 apply migrasi hosted, §3 env Vercel, §4 cron, §5 MFA, §6 drill restore, §7 PDF) tetap wajib dan terpisah.

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
| `EMAIL_FROM` | Alamat pengirim terverifikasi di Resend. Target IDAROH: `IDAROH <noreply@mail.pondokabdurrahmanbinauf.web.id>` |

Opsional: `FIREBASE_SERVICE_ACCOUNT_KEY` (bila kosong, push disabled + warning), `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL`/`NEXT_PUBLIC_ADMIN_WHATSAPP`, `OPS_ERROR_WEBHOOK_URL`. `VITEST` tidak boleh ada di produksi.

### 3a. Turnstile (Cloudflare)
1. Cloudflare dashboard → **Turnstile** → **Add site**.
2. Isi nama site + domain produksi (mis. `app.domainmu`) → widget mode **Managed** → Create.
3. Catat **Site Key** (publik → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) dan **Secret Key** (→ `TURNSTILE_SECRET_KEY`).
4. Widget sudah ada di kode (register & login) dan **hanya muncul bila `NEXT_PUBLIC_TURNSTILE_SITE_KEY` diisi**. Server menolak login/registrasi tanpa token Turnstile di produksi (fail-closed). Karena itu **kedua kunci wajib dipasang bersama**: secret tanpa site key = widget tidak render = token kosong = **semua login/registrasi terkunci**. Validator build produksi menegakkan keduanya (9 wajib, §3) — build gagal bila salah satu kurang/placeholder.
5. **Uji di browser produksi** (langkah operator, bukan klaim otomatis dari kode): buka `/register` dan `/login`, pastikan widget Turnstile benar-benar muncul, selesaikan challenge, dan submit berhasil. Catat bukti di §8. Jangan menganggap Turnstile "aktif" hanya karena secret terpasang — widget harus terlihat dan token terverifikasi server.

### 3b. Resend (email transaksional)
1. resend.com → **Domains** → **Add Domain** → masukkan domain pengirim IDAROH `mail.pondokabdurrahmanbinauf.web.id` → tambahkan record DNS (SPF/DKIM) yang diminta di DNS provider (Cloudflare) → tunggu **Verified**.
2. **API Keys** → **Create API Key** → permission sending → catat key (→ `RESEND_API_KEY`).
3. `EMAIL_FROM` harus pakai domain yang sudah verified di Resend. Target IDAROH: `IDAROH <noreply@mail.pondokabdurrahmanbinauf.web.id>` — verifikasi domain `mail.pondokabdurrahmanbinauf.web.id` dulu (langkah 1), jangan pakai alamat lain yang belum verified.

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

## 5. MFA super_admin (syarat rilis) + break-glass

**Keputusan owner C-1 = B (enforcement L1/L2/L3 SEKARANG)** menggantikan penundaan TRC-10 di PRD v1.1. Kode enforcement sudah diimplementasikan & teruji lokal (WS1–WS2); **aktif di produksi setelah deploy** (push saja tidak mengaktifkan — lihat catatan akhir). Sejak enforcement aktif:

- **super_admin wajib** punya faktor TOTP terverifikasi **dan** sesi aal2. Tanpa faktor → dipaksa enroll di `/mfa`; punya faktor tapi sesi aal1 → dipaksa challenge. Ini guard **server-side**, bukan sekadar redirect UI.
- **Non-super_admin yang sudah punya faktor terverifikasi** juga di-challenge saat login (keputusan Plan Q3). Non-super_admin tanpa faktor tidak dipaksa (MFA opsional).
- **Tidak ada flag bypass produksi** (Plan Q4). Rollback = redeploy commit lama, bukan mematikan guard lewat env.

### 5a. Enrollment TOTP tiap super_admin

Tiap super_admin (sebelum atau sesudah deploy enforcement):
1. Login → buka **`/settings/profile`** (mobile: sheet **Lainnya** → **Pengaturan Profil**). Bila enforcement sudah aktif dan akun belum ber-faktor, login otomatis mengarahkan ke **`/mfa`** untuk enroll.
2. Bagian **"Verifikasi Dua Langkah (MFA)"** → **Aktifkan MFA**.
3. Scan QR di aplikasi authenticator (Google Authenticator/Authy/1Password), atau masukkan **secret manual**.
4. Ketik kode 6 digit → **Verifikasi MFA**. Faktor terverifikasi tampil dengan tombol **Cabut**; sesi naik ke aal2.

Catat bukti (siapa, kapan, status verified) **tanpa** secret/QR/kode. Enrollment via Supabase Auth factors. Admin dapat melihat bukti enrollment semua user di **`/admin/users`** (badge `MFA: verified` / `belum diverifikasi` / `belum enroll` / `tidak diketahui`). Badge ini bukti **enrollment**, **bukan** bukti sesi user lain sedang aal2 — assurance level user lain tidak bisa diamati admin, jadi jangan menafsirkan badge sebagai "aal2 aktif".

### 5b. Break-glass: owner/super_admin terkunci (P0)

Skenario: super_admin kehilangan perangkat TOTP / tidak bisa menyelesaikan challenge, sehingga enforcement memblokir akses aplikasi. **Akses dashboard Supabase terpisah dari login aplikasi** — enforcement aplikasi tidak mengunci dashboard provider. Prosedur darurat (operator berwenang, **bukan** otomatisasi repo):

1. Pastikan ini benar-benar darurat dan operator punya otorisasi pemilik. **Jangan** jadikan ini jalur bypass rutin.
2. Supabase dashboard → project produksi → **Authentication → Users** → cari & pilih user yang terkunci.
3. Buka detail faktor MFA user (label mis. "Multi-Factor Authentication"/"Factors"; bisa berbeda antar versi) → **unenroll/hapus faktor TOTP** yang hilang. **Hanya hapus faktor — JANGAN hapus user, JANGAN ubah RLS/grant/role.**
   - Alternatif presisi bila operator memakai skrip berwenang (bukan repo otomatis): admin API `supabase.auth.admin.mfa.deleteFactor({ id: <factorId>, userId: <userId> })`. **Menghapus faktor verified akan logout user dari semua sesi aktif** — itu diharapkan; user login ulang lalu enroll baru.
4. Owner login ulang ke aplikasi. Tanpa faktor terverifikasi, super_admin diarahkan ke **`/mfa`** untuk **enroll TOTP baru** (perangkat baru) → verifikasi → sesi aal2.
5. Catat di change log/audit: siapa, kapan, alasan, faktor mana di-unenroll, dan bahwa enroll ulang sudah selesai. **Tanpa** secret/QR/kode.

Batasan & fallback (jujur, jangan mengarang):
- **Recovery codes belum diimplementasikan** (§4.3 master prompt; gate spike T0.1 — lihat `docs/mfa-spike-runbook.md`). Bila T0.1 membuktikan server mendukung, recovery codes bisa jadi jalur self-service; sampai terverifikasi, break-glass dashboard di atas adalah alternatif aman yang tersedia sekarang.
- **Aksi "Reset MFA oleh admin" dari dalam aplikasi belum ada** (ditunda P1, gated T0.1, butuh authz + audit + persetujuan owner karena menyangkut penghapusan faktor user lain). Jangan mengarang endpoint/aksi ini.
- Prosedur ini **tidak** melemahkan RLS, **tidak** menghapus audit trail, **tidak** memakai flag bypass. Penghapusan faktor MFA user hanya boleh dilakukan operator berwenang dalam break-glass (§1.3), **bukan** bagian pengujian.

### 5c. Environment & flag MFA (T4.3)

- **Enforcement MFA tidak butuh env var baru.** Ia memakai faktor Supabase Auth + klaim `aal` JWT yang sudah ada; tidak ada secret/flag baru untuk dipasang di Vercel. Daftar env wajib produksi tetap di §3, tidak berubah karena MFA.
- **Tidak ada flag bypass produksi.** `allowAal1` hanyalah pengecualian server-side terbatas untuk tiga aksi diri-sendiri (`listMfaFactorsAction`, `enrollMfaAction`, `verifyMfaAction`) agar user bisa enroll/verify saat masih aal1; ia **tidak** melewati `requireRole`, dan `unenrollMfaAction` tetap fully gated (aal2). Lihat §4.4 master prompt.
- **`MFA_RECOVERY_CODES` (experimental) BELUM dipakai** — gated pada hasil spike T0.1. Jangan menambah/mengaktifkan flag ini sebelum dukungan server terverifikasi (§4.3).

## 6. Drill restore (wajib; ADM-009)

Backup tanpa uji restore tidak memenuhi ADM-009. Prosedur lengkap di `docs/backup-restore.md` (§Drill restore). Untuk drill ke **Supabase hosted disposable** yang mengumpulkan bukti nyata (privilege role `postgres`, probe `session_replication_role`, orphan, RLS/grants) guna mengadjudikasi konflik C-3, pakai script + runbook khusus: `docs/restore-drill-runbook.md` (`npm run drill:restore`, operator-run, non-prod). Ringkas prosedur manual (restore lokal):
1. Ambil objek terbaru dari B2 (`aws s3 cp s3://idaroh-backups/backups/<file>.sql.age . --endpoint-url https://s3.<region>.backblazeb2.com`).
2. Dekripsi offline: `age -d -i key.txt -o backup.sql <file>.sql.age`.
3. Siapkan target lalu restore. **Wajib sebelum restore:** `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;` (kalau tidak, tabel hasil restore berisiko mewarisi hak berlebihan ke anon/authenticated) dan pulihkan `auth.users` dari dump terpisah (kalau tidak, data aplikasi berisiko yatim). Restore ke **Supabase lokal**: `supabase start` → `psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f backup.sql`. Jangan langsung produksi. Dump data CLI dapat diawali `SET session_replication_role = replica;` yang **hanya boleh dijalankan superuser**. Kemampuan role hosted dan hasil probe parameter tersebut **NOT VERIFIED** sampai disposable restore drill dijalankan; jangan menganggap restore hosted atau production berhasil tanpa bukti.
4. Validasi row count tabel inti, constraint, policy RLS, nilai sequence, dan **jumlah baris yatim = 0** (`profiles` LEFT JOIN `auth.users`); uji akses lintas dua akun uji.
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
- [ ] 12 migrasi applied berurutan; duplikat pending `000008` dan duplicate email business reference sudah ditangani; smoke test lulus.
- [ ] CI `database-integration` hijau pada run nyata setelah push (migrasi 11→12 dari nol + 28 assertion pgTAP + concurrency drill + E2E); log run disimpan sebagai bukti. CI hijau ≠ siap deploy; gate operator di bawah tetap wajib.
- [ ] Env Vercel lengkap (9 wajib) + build produksi hijau + redeploy.
- [ ] Turnstile site+secret terpasang; widget muncul di register/login.
- [ ] Resend domain verified; email keputusan/undangan benar-benar terkirim.
- [ ] cron-job.org: dua job GET 15 menit aktif; heartbeat + claim/outbox terverifikasi (bukan cuma HTTP 200).
- [ ] `/admin/cron`: report_reminder 19:30 WIB; jadwal lain sesuai.
- [ ] Semua super_admin: TOTP verified (bukti tanpa secret).
- [ ] Break-glass MFA (§5b) dipahami operator: akses dashboard Supabase terpisah dari login app; unenroll darurat + enroll ulang, tanpa hapus user/ubah RLS.
- [ ] Drill restore: berhasil ke staging/lokal + validasi + smoke test + catatan.
- [ ] PDF runtime produksi: terbuka normal.
- [ ] `CRON_SECRET` ≥32 char, sama di env + kedua job; rotasi terkoordinasi bila diubah.

## Catatan: real vs placeholder (klarifikasi)

- **Kode fitur = real, teruji** (528 unit test hijau pada verifikasi terakhir; e2e non-prod dan build produksi diverifikasi pada gate terpisah, bukan diklaim otomatis di sini). Bukan dummy.
- **`.env.example` = placeholder by design.** Secret asli tidak boleh masuk repo; mengisinya adalah aksi dashboard (§3), bukan perubahan kode.
- **Fixture e2e mem-mock provider** = harness test yang sah, bukan aplikasi produksi. Produksi memakai Supabase/FCM/Resend asli setelah env diisi.
- **`/admin/backup` = manifest jumlah baris, BUKAN backup.** Backup nyata sekarang via workflow B2 (§1). Status `manifest_only` tidak memenuhi ADM-009.
- **"Lokal" (uncommitted)** menjadi aktif hanya setelah commit + push + deploy + langkah dashboard di atas. Push saja tidak membuat "aktif" bila secret/migrasi/provider belum dikonfigurasi operator.
