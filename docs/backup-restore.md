# Backup Restore dan Rollback Pondok OS

Dokumen ini adalah prosedur operasional minimum untuk Supabase production. Backup dan restore harus dijalankan oleh operator yang memiliki akses infrastruktur dan dicatat pada change log.

Ada dua jalur: **plan paid (Pro+)** memakai PITR + backup harian terkelola; **Free plan** memakai backup logis mingguan ke Backblaze B2 via GitHub Actions (lihat seksi khusus di bawah). Keduanya memenuhi intent ADM-009 hanya bila drill restore benar-benar dijalankan dan dicatat.

## Backup (plan paid: PITR + harian)

Pada plan paid (Pro+), aktifkan Point in Time Recovery dan backup harian pada project Supabase production. Simpan salinan export terenkripsi di lokasi terpisah, dengan retensi yang mengikuti kebijakan privasi Pondok OS. Jangan memasukkan `SUPABASE_SERVICE_ROLE_KEY` atau `FIREBASE_SERVICE_ACCOUNT_KEY` ke dalam backup aplikasi, repository, atau log CI. Free plan tidak menyediakan PITR maupun backup harian — gunakan jalur B2 di bawah.

Sebelum migration production:

1. Catat commit aplikasi dan migration terakhir.
2. Ambil backup database terbaru dan verifikasi timestamp-nya.
3. Uji restore backup ke project staging.
4. Jalankan smoke test untuk login, presensi, laporan, task, dan calendar feed.

## Jalur Free plan: backup mingguan ke Backblaze B2

Free plan Supabase tidak menyediakan backup harian maupun PITR. Sebagai gantinya, backup logis mingguan dijalankan oleh GitHub Actions (`.github/workflows/backup.yml`) dan disimpan terenkripsi di Backblaze B2 (S3-compatible, 10 GB gratis, tanpa kartu kredit). Ini memenuhi intent ADM-009 (data dapat dipulihkan) selama drill restore di bawah benar-benar dijalankan dan dicatat; PITR tetap opsi upgrade berbayar.

Alur: `supabase db dump` dua tahap via session pooler — dump **skema** (`--schema public,app,audit`) lalu dump **data** (`--data-only --use-copy`) — digabung menjadi `backup.sql` → enkripsi `age` → upload ke B2. Jadwal: Senin 00:00 WIB (Minggu 17:00 UTC), plus pemicu manual `workflow_dispatch`. Cadence mingguan juga menjaga project Free tidak di-pause karena idle (±7 hari). `supabase db dump` menjalankan `pg_dump` **di dalam container CLI**; versi pg_dump mengikuti `[db] major_version` di `supabase/config.toml` (17), bukan binary host. Workflow tetap memasang `postgresql-client-17` di host (dari PGDG bila repo Ubuntu hanya punya versi lebih lama) untuk langkah preflight `psql`, mem-pin PATH ke versi itu, dan menolak jalan bila versi mayor server lebih baru dari client. Runner dipin ke `ubuntu-24.04` karena label `ubuntu-latest` dijadwalkan pindah ke 26.04 pada Nov 2026.

Secret GitHub Actions yang wajib diset (Settings → Secrets and variables → Actions):

| Secret | Isi |
| --- | --- |
| `SUPABASE_DB_URL` | Connection string **Session pooler** (tombol Connect → Session pooler). Bukan direct connection: runner GH IPv4, direct Supabase IPv6-only. |
| `AGE_RECIPIENT` | Public key age (`age1...`) untuk enkripsi. Private key disimpan operator offline, tidak di CI. |
| `B2_APPLICATION_KEY_ID` | Backblaze B2 application keyID (keyID). |
| `B2_APPLICATION_KEY` | Backblaze B2 applicationKey (secret, hanya tampil sekali). |
| `B2_BUCKET` | Nama bucket B2 tujuan. |
| `B2_REGION` | Region bucket B2 (mis. `us-west-004`); menentukan endpoint S3. |

Setup sekali:

1. Buat akun Backblaze B2 (tanpa kartu kredit) → buat bucket (mis. `idaroh-backups`). Catat **region** bucket (mis. `us-west-004`, terlihat di endpoint bucket). Atur lifecycle rule untuk kedaluwarsa objek prefix `backups/` setelah mis. 60 hari; retensi mengikuti kebijakan privasi Pondok OS.
2. Buat **Application Key** (B2 → Application Keys → Add a New Application Key) dengan akses read/write ke bucket `idaroh-backups` → dapat **keyID** + **applicationKey** (applicationKey hanya tampil sekali).
3. Generate keypair age: `age-keygen -o key.txt`. Public key (`age1...`) → secret `AGE_RECIPIENT`. **Simpan `key.txt` offline/terenkripsi** — ini satu-satunya cara mendekripsi backup. Jangan commit ke repo.
4. Ambil Session pooler URL dari Supabase → Connect, ganti `<password>` dengan password DB, simpan sebagai `SUPABASE_DB_URL`.
5. Set keenam secret, push workflow, lalu jalankan manual (Actions → IDAROH Weekly DB Backup → Run workflow) untuk bukti pertama.

Cakupan dan batasan (jujur):

- Dump mencakup skema `public` (tabel aplikasi + policy RLS + grants), `app` (helper/RPC), dan `audit`. Roles Supabase (`anon`/`authenticated`/`service_role`) sudah ada di project tujuan, jadi restore antar-project Supabase tidak memerlukan dump roles.
- **Akun Supabase Auth (`auth.users`) TIDAK ikut** secara default, padahal `profiles.id` dan banyak kolom lain ber-FK ke sana. Untuk recover akun, dump terpisah skema `auth` (`supabase db dump -s auth ...`) dan pulihkan **sebelum** data aplikasi; tanpa itu restore menyisakan profil yatim (lihat drill langkah 3). Tangani restore auth hati-hati (GoTrue mengelola skema ini), atau terima konsekuensi re-invite user. Dump auth berisi hash password → perlakukan sebagai data sensitif.
- **Storage (file lampiran) TIDAK ikut** dalam dump DB. Export objek Storage terpisah bila ada file nyata.
- File backup terenkripsi (age). Tanpa private key, backup tidak bisa dibaca — termasuk oleh CI. Plaintext dihapus (`shred`) setelah enkripsi.

### Drill restore (wajib, berkala mis. bulanan)

Backup tanpa uji restore tidak memenuhi ADM-009. Untuk drill ke Supabase **hosted disposable** dengan script pengumpul bukti (privilege role `postgres`, probe `session_replication_role`, orphan, RLS/grants, row count) guna mengadjudikasi konflik C-3, lihat `docs/restore-drill-runbook.md` (`npm run drill:restore`, operator-run, non-prod). Prosedur manual di bawah tetap berlaku (terutama restore ke Supabase lokal yang role-nya superuser):

1. Ambil objek terbaru dari B2: `aws s3 cp s3://<bucket>/backups/<file>.sql.age . --endpoint-url https://s3.<region>.backblazeb2.com`.
2. Dekripsi dengan private key offline: `age -d -i key.txt -o backup.sql <file>.sql.age`.
3. **Siapkan target sebelum restore** (dua langkah ini wajib, terbukti lewat drill lokal):
   - Cabut default privileges agar tabel hasil restore tidak mewarisi hak penuh: `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;`. Tanpa ini, target berisiko memberikan privilege berlebihan kepada `anon`/`authenticated` dan melemahkan RLS/grants; hasil aktual wajib dicatat dari drill.
   - Pulihkan **`auth.users` lebih dulu** (dump terpisah skema `auth`). Dump aplikasi tidak memuatnya, sedangkan `profiles.id` dan banyak kolom lain ber-FK ke `auth.users`. Tanpa baris auth, mode restore tertentu dapat melewati FK dan meninggalkan **profil yatim**; drill harus membuktikan hasil aktual sebelum backup dianggap recoverable.
4. Restore ke **Supabase lokal** (`supabase start`, lalu `psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f backup.sql`). Jangan langsung produksi.
   - Dump data dari CLI dapat diawali `SET session_replication_role = replica;` (mematikan trigger FK agar urutan baris tidak masalah). Statement itu **hanya boleh dijalankan superuser**. Kemampuan role hosted dan hasil probe `session_replication_role` tetap **NOT VERIFIED** sampai disposable restore drill dijalankan; jangan menganggap restore hosted maupun restore production berhasil tanpa bukti.
   - Skema dari CLI sudah ditulis ulang menjadi `CREATE SCHEMA/TABLE IF NOT EXISTS` dan `CREATE OR REPLACE FUNCTION/VIEW`, jadi tidak bentrok dengan objek yang sudah ada di target.
5. Validasi: row count tabel inti, constraint, policy RLS (`pg_policies`), nilai sequence (`setval` ikut ter-dump), **jumlah baris yatim = 0** (`profiles` LEFT JOIN `auth.users`), dan uji akses lintas dua akun uji.
6. Smoke test login, presensi, laporan, task, dan calendar feed.
7. Catat tanggal, operator, file backup, hasil validasi, dan keputusan di change log.

Job `database-integration` pada `.github/workflows/ci.yml` sudah membuktikan migrasi apply dari nol + uji RLS (`supabase db reset --local` + `supabase test db`); itu basis yang baik untuk drill, tetapi restore dari dump tetap harus diuji terpisah.

## Restore

Hentikan deployment yang sedang berjalan, pilih titik pemulihan yang disetujui, dan restore ke staging terlebih dahulu. Validasi row count, constraint, RLS, dan akses lintas dua akun uji. Setelah hasil disetujui, lakukan restore production pada maintenance window, rotasi secret yang terdampak, dan jalankan smoke test yang sama.

## Rollback aplikasi

Gunakan deployment sebelumnya yang diketahui sehat dan jangan menghapus migration yang sudah diterapkan. Untuk perubahan skema, buat migration kompensasi yang dapat dijalankan ulang. Catat waktu, operator, commit, migration, hasil smoke test, dan keputusan membuka kembali layanan.

Prosedur ini mendokumentasikan kontrol yang diperlukan; status backup production dan drill restore tetap harus diverifikasi di akun Supabase yang sebenarnya.
