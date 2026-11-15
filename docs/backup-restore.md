# Backup Restore dan Rollback Pondok OS

Dokumen ini adalah prosedur operasional minimum untuk Supabase production. Backup dan restore harus dijalankan oleh operator yang memiliki akses infrastruktur dan dicatat pada change log.

Ada dua jalur: **plan paid (Pro+)** memakai PITR + backup harian terkelola; **Free plan** memakai backup logis mingguan ke Cloudflare R2 via GitHub Actions (lihat seksi khusus di bawah). Keduanya memenuhi intent ADM-009 hanya bila drill restore benar-benar dijalankan dan dicatat.

## Backup (plan paid: PITR + harian)

Pada plan paid (Pro+), aktifkan Point in Time Recovery dan backup harian pada project Supabase production. Simpan salinan export terenkripsi di lokasi terpisah, dengan retensi yang mengikuti kebijakan privasi Pondok OS. Jangan memasukkan `SUPABASE_SERVICE_ROLE_KEY` atau `FIREBASE_SERVICE_ACCOUNT_KEY` ke dalam backup aplikasi, repository, atau log CI. Free plan tidak menyediakan PITR maupun backup harian — gunakan jalur R2 di bawah.

Sebelum migration production:

1. Catat commit aplikasi dan migration terakhir.
2. Ambil backup database terbaru dan verifikasi timestamp-nya.
3. Uji restore backup ke project staging.
4. Jalankan smoke test untuk login, presensi, laporan, task, dan calendar feed.

## Jalur Free plan: backup mingguan ke Cloudflare R2

Free plan Supabase tidak menyediakan backup harian maupun PITR. Sebagai gantinya, backup logis mingguan dijalankan oleh GitHub Actions (`.github/workflows/backup.yml`) dan disimpan terenkripsi di Cloudflare R2. Ini memenuhi intent ADM-009 (data dapat dipulihkan) selama drill restore di bawah benar-benar dijalankan dan dicatat; PITR tetap opsi upgrade berbayar.

Alur: `supabase db dump` (session pooler) → enkripsi `age` → upload ke R2. Jadwal: Senin 00:00 WIB (Minggu 17:00 UTC), plus pemicu manual `workflow_dispatch`. Cadence mingguan juga menjaga project Free tidak di-pause karena idle (±7 hari).

Secret GitHub Actions yang wajib diset (Settings → Secrets and variables → Actions):

| Secret | Isi |
| --- | --- |
| `SUPABASE_DB_URL` | Connection string **Session pooler** (tombol Connect → Session pooler). Bukan direct connection: runner GH IPv4, direct Supabase IPv6-only. |
| `AGE_RECIPIENT` | Public key age (`age1...`) untuk enkripsi. Private key disimpan operator offline, tidak di CI. |
| `R2_ACCOUNT_ID` | Account ID Cloudflare. |
| `R2_ACCESS_KEY_ID` | R2 API token Access Key ID (izin Object Read & Write). |
| `R2_SECRET_ACCESS_KEY` | R2 API token Secret Access Key. |
| `R2_BUCKET` | Nama bucket R2 tujuan. |

Setup sekali:

1. Buat bucket R2 (mis. `idaroh-backups`). Aktifkan lifecycle rule untuk kedaluwarsa objek prefix `backups/` setelah mis. 60 hari; retensi mengikuti kebijakan privasi Pondok OS.
2. Buat R2 API token (Object Read & Write) → dapat Access Key ID + Secret Access Key.
3. Generate keypair age: `age-keygen -o key.txt`. Public key (`age1...`) → secret `AGE_RECIPIENT`. **Simpan `key.txt` offline/terenkripsi** — ini satu-satunya cara mendekripsi backup. Jangan commit ke repo.
4. Ambil Session pooler URL dari Supabase → Connect, ganti `<password>` dengan password DB, simpan sebagai `SUPABASE_DB_URL`.
5. Set keenam secret, push workflow, lalu jalankan manual (Actions → Pondok OS Weekly DB Backup → Run workflow) untuk bukti pertama.

Cakupan dan batasan (jujur):

- Dump mencakup skema `public` (tabel aplikasi + policy RLS). Roles Supabase (`anon`/`authenticated`/`service_role`) sudah ada di project tujuan, jadi restore antar-project Supabase tidak memerlukan dump roles.
- **Akun Supabase Auth (`auth.users`) TIDAK ikut** secara default. Untuk recover akun, dump terpisah skema `auth` (`supabase db dump -s auth ...`) dan tangani restore-nya hati-hati (GoTrue mengelola skema ini), atau terima konsekuensi re-invite user. Dump auth berisi hash password → perlakukan sebagai data sensitif.
- **Storage (file lampiran) TIDAK ikut** dalam dump DB. Export objek Storage terpisah bila ada file nyata.
- File backup terenkripsi (age). Tanpa private key, backup tidak bisa dibaca — termasuk oleh CI. Plaintext dihapus (`shred`) setelah enkripsi.

### Drill restore (wajib, berkala mis. bulanan)

Backup tanpa uji restore tidak memenuhi ADM-009. Prosedur:

1. Ambil objek terbaru dari R2: `aws s3 cp s3://<bucket>/backups/<file>.sql.age . --endpoint-url https://<account>.r2.cloudflarestorage.com`.
2. Dekripsi dengan private key offline: `age -d -i key.txt -o backup.sql <file>.sql.age`.
3. Restore ke **Supabase lokal** (`supabase start`, lalu `psql "$LOCAL_DB_URL" -f backup.sql`) atau project staging Free ke-2. Jangan langsung produksi.
4. Validasi row count tabel inti, constraint, dan policy RLS; uji akses lintas dua akun uji.
5. Smoke test login, presensi, laporan, task, dan calendar feed.
6. Catat tanggal, operator, file backup, hasil validasi, dan keputusan di change log.

Job `database-integration` pada `.github/workflows/ci.yml` sudah membuktikan migrasi apply dari nol + uji RLS (`supabase db reset --local` + `supabase test db`); itu basis yang baik untuk drill, tetapi restore dari dump tetap harus diuji terpisah.

## Restore

Hentikan deployment yang sedang berjalan, pilih titik pemulihan yang disetujui, dan restore ke staging terlebih dahulu. Validasi row count, constraint, RLS, dan akses lintas dua akun uji. Setelah hasil disetujui, lakukan restore production pada maintenance window, rotasi secret yang terdampak, dan jalankan smoke test yang sama.

## Rollback aplikasi

Gunakan deployment sebelumnya yang diketahui sehat dan jangan menghapus migration yang sudah diterapkan. Untuk perubahan skema, buat migration kompensasi yang dapat dijalankan ulang. Catat waktu, operator, commit, migration, hasil smoke test, dan keputusan membuka kembali layanan.

Prosedur ini mendokumentasikan kontrol yang diperlukan; status backup production dan drill restore tetap harus diverifikasi di akun Supabase yang sebenarnya.
