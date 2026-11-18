# Runbook Drill Restore Non-Produksi (ke Supabase Hosted Disposable)

Panduan operator untuk menguji apakah backup logis IDAROH **benar-benar dapat dipulihkan** ke project Supabase hosted dengan privilege database yang realistis, dan mengumpulkan bukti untuk keputusan owner **C-3** (konflik `session_replication_role`). Ditulis untuk operator/pemilik yang punya akses dashboard provider. **Eksekusi live = tanggung jawab operator.** Repo hanya menyiapkan script; tidak ada restore/backup yang dijalankan dari CI/build atau terhadap produksi.

Latar: `docs/backup-restore.md` (§Drill restore) dan `.github/workflows/backup.yml`. Backup mingguan = dump skema `public,app,audit` + data (`--use-copy`), dienkripsi `age`, disimpan di Backblaze B2. Dump **tidak** memuat `auth.users` maupun Storage.

Aturan tetap (selaras `docs/operator-release-gates.md` dan Master Prompt §1.3/§6):

- **Hanya project Supabase disposable NON-PRODUKSI.** Jangan pernah arahkan ke project production. Drill melakukan restore (perubahan data besar) — dilarang di produksi tanpa otorisasi.
- Jangan taruh secret (connection string/password DB, private key `age`, isi dump) di repo, log, screenshot, atau chat. Script memindahkan password ke `PGPASSWORD`, me-redact connection string dari semua output, dan tidak pernah mencetak isi dump.
- **Jangan melemahkan RLS/grant**, jangan menghapus user, jangan mengubah migration yang sudah diterapkan, jangan menyentuh `supabase/migrations/**` untuk "memaksa" restore berhasil.
- Dekripsi backup dilakukan **offline** oleh operator memakai private key `age` yang disimpan offline. Script menerima file `backup.sql` yang **sudah didekripsi**; ia tidak memegang private key.
- `key.txt` (private key age) adalah milik operator. **Jangan** commit, jangan buka isinya di chat/log, jangan simpan di CI.

## Status persiapan (jujur)

| Item | Status |
|---|---|
| Script drill + guard (`scripts/drill/restore-drill.mjs`) | **Implemented locally** |
| Validasi sintaks (`node --check`) | **Verified** lulus |
| Guard target non-prod + redaksi secret + quoting identifier + credential argv guard | **Verified** secara lokal; guard menolak sebelum kontak DB dan password tidak masuk argument `psql` |
| Guard integritas dump di `backup.yml` (marker `dump complete` + jumlah `COPY` == terminator `\.`) | **Verified** logika lewat fixture sintetis (lengkap/terpotong/tabel kosong); perilaku dump Supabase asli dikonfirmasi pada run workflow pertama operator |
| Perilaku restore live ke hosted (privilege `postgres`, `session_replication_role`, orphan, RLS/grants) | **Unknown** — hanya terbukti setelah operator menjalankan drill |
| Klaim di `backup-restore.md` L57/L60/L61 (default privileges, error hosted, rewrite skema) | **Pending re-verifikasi** oleh drill ini; koreksi doc ditunda sampai ada bukti RESULT |

## 0. Prasyarat

1. Buat **project Supabase baru yang disposable** (boleh Free plan) sebagai target drill. Usahakan versi PostgreSQL sama dengan produksi (17). Catat bila berbeda. **Jangan** pakai project produksi/staging yang berisi data nyata.
2. Ambil **connection string** project disposable (tombol **Connect**). Untuk drill, **Direct connection** lebih representatif untuk menguji privilege role `postgres` hosted; session pooler juga boleh. Ganti `<password>` dengan password DB project disposable. Masukkan lewat env saat run — jangan di chat/repo.
3. **Dekripsi backup offline** di mesin operator (private key tidak masuk script):
   ```bash
   aws s3 cp s3://<bucket>/backups/<file>.sql.age . --endpoint-url https://s3.<region>.backblazeb2.com
   age -d -i key.txt -o backup.sql <file>.sql.age
   ```
   Hasil: `backup.sql` (plaintext, sensitif — hapus setelah drill).
4. **Siapkan dump `auth.users` terpisah** (wajib untuk drill yang faithful). Dump aplikasi tidak memuatnya, sedangkan `profiles.id` ber-FK ke `auth.users`. Tanpa auth, restore tidak boleh dilanjutkan. Buat dump auth dari project **sumber** (produksi) secara read-only oleh operator, atau dari backup auth yang sudah ada:
   ```bash
   supabase db dump --db-url "<SUMBER_DB_URL>" --schema auth --file auth.sql
   ```
   `auth.sql` berisi hash password → perlakukan sebagai data sensitif, hapus setelah drill. Script menolak berjalan tanpa file ini.
5. Di mesin operator: Node.js (repo v24) + `psql` (libpq/postgresql-client). macOS: `brew install libpq` lalu pastikan `psql` di PATH. Script menolak jalan bila `psql` tidak ada.

## 1. Environment variable (nama saja, tanpa nilai)

Script memakai namespace **`DRILL_*` terpisah** dari env aplikasi, supaya `.env`/secret produksi yang ter-load tidak bisa tak-sengaja terpakai.

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DRILL_CONFIRM` | ya | Set `yes` sebagai pengakuan target adalah project disposable non-prod. |
| `DRILL_DB_URL` | ya | Connection string `postgres://`/`postgresql://` ke project disposable. |
| `DRILL_BACKUP_SQL` | ya | Path ke `backup.sql` yang sudah didekripsi offline (langkah 0.3). |
| `DRILL_AUTH_SQL` | ya | Path ke dump `auth.sql` (langkah 0.4), dipulihkan **sebelum** data aplikasi. |
| `SUPABASE_DB_URL` | tidak | Bila ter-set, guard menolak jika `DRILL_DB_URL` sama dengannya (anti-tertarget produksi). |
| `NEXT_PUBLIC_SUPABASE_URL` | tidak | Bila ter-set, guard menolak jika `DRILL_DB_URL` memuat project ref aplikasi (anti-tertarget produksi). |
| `NODE_ENV` | tidak | Bila `production`, script menolak jalan. |

Guard menolak (sebelum kontak DB apa pun): tanpa `DRILL_CONFIRM=yes`; `NODE_ENV=production`; tanpa `DRILL_DB_URL`; URL bukan `postgres://`; URL sama dengan `SUPABASE_DB_URL`; URL memuat ref project aplikasi; tanpa/`DRILL_BACKUP_SQL` tidak ada; `DRILL_AUTH_SQL` tidak ada; `psql` tidak terpasang.

## 2. Jalankan drill

Dari root repo. Ganti `...` dengan nilai asli di terminal operator (jangan di chat):

```bash
DRILL_CONFIRM=yes DRILL_DB_URL=... DRILL_BACKUP_SQL=./backup.sql DRILL_AUTH_SQL=./auth.sql npm run drill:restore
```

Script mencetak blok `RESULT: <decision>` berisi bukti (role, privilege, versi server, supautils, hasil probe replica, error persis, orphan, jumlah policy RLS, row count per tabel, grant anon/authenticated). **Salin blok itu** ke change log / `docs/audit/`. Password + connection string tidak pernah dicetak.

Kode exit: `0` = RESTORE_OK; `1` = guard/setup gagal; `2` = ORPHANS_FOUND; `3` = RESTORE_BLOCKED_REPLICA_ROLE; `4` = RESTORE_ERROR; `5` = RESTORE_BLOCKED_PRIVILEGE_PREP; `6` = RESTORE_INCOMPLETE_VALIDATION.

| RESULT | Arti | Tindakan |
|---|---|---|
| `RESTORE_OK` | Restore sukses + orphan profiles = 0 | Backup terbukti dapat dipulihkan ke hosted disposable. Lanjut validasi manual §4, catat bukti, cleanup. |
| `ORPHANS_FOUND` | Restore sukses tapi ada `profiles` tanpa `auth.users` | Auth tidak dipulihkan lebih dulu / nilai FK mismatch. Sediakan `DRILL_AUTH_SQL`, ulangi. Jangan percaya backup sampai orphan = 0. |
| `RESTORE_BLOCKED_REPLICA_ROLE` | Restore ditolak di `SET session_replication_role = replica` (permission denied) | Inilah konflik C-3. Catat error persis + privilege role; lihat §3 untuk adjudikasi. |
| `RESTORE_BLOCKED_PRIVILEGE_PREP` | Revoke default privileges gagal pada satu atau lebih schema | Restore auth/app tidak dilanjutkan. Perbaiki target privilege dan ulangi; jangan menerima hasil sebagai valid. |
| `RESTORE_INCOMPLETE_VALIDATION` | Restore berjalan tetapi satu atau lebih gate validation gagal | `RESTORE_OK` dilarang. Periksa policy, grant, object, row count, dan error gate yang tercetak; ulangi setelah diperbaiki. |
| `RESTORE_ERROR` | Restore gagal karena sebab lain | Catat error persis; diagnosa (skema/order/FK). Jangan melemahkan RLS/grant untuk memaksa lolos. |
| `DRILL ABORTED` | Guard/setup gagal | Perbaiki prasyarat/env, ulangi. Tidak ada DB yang disentuh. |

## 3. Adjudikasi konflik `session_replication_role` (keputusan owner C-3)

Dump data dari Supabase CLI diawali `SET session_replication_role = replica;` (mematikan trigger FK agar urutan baris tidak masalah). Statement itu **hanya boleh dijalankan superuser**. Di project Supabase hosted, role `postgres` umumnya **bukan** superuser. Script mengumpulkan bukti nyata:

- `current_user`, `priv` (`super`/`bypass`/`restricted` dari `pg_roles.rolsuper`/`rolbypassrls`), `server_version`, keberadaan ekstensi `supautils`.
- Probe langsung `SET session_replication_role = replica;` → `allowed` atau `denied` + error persis.
- Error persis dari percobaan restore `backup.sql` sesungguhnya.

**Arah keputusan (bukan solusi terverifikasi — pilih berdasarkan bukti RESULT, minta keputusan owner):**

1. **Restore ke Supabase LOKAL** (`supabase start`, role `postgres` = superuser) — jalur yang sudah diketahui jalan untuk memvalidasi data. Ini membuktikan backup dapat dipulihkan, tapi bukan restore ke hosted.
2. **Bila probe `allowed` di hosted** (mis. supautils/plan mengizinkan) → restore hosted langsung mungkin jalan; validasi orphan/RLS/grants tetap wajib.
3. **Bila probe `denied` di hosted** → restore langsung memakai dump apa adanya ditolak. Kandidat yang perlu diuji/disetujui owner (jangan diasumsikan berhasil):
   - Restore data dalam **urutan dependensi FK** dengan trigger aktif (auth.users dulu, lalu tabel dependent), tanpa `session_replication_role`. Perlu verifikasi urutan COPY dump memenuhi FK.
   - Jalur restore terkelola Supabase (PITR/backup berbayar) untuk pemulihan **produksi** sebenarnya; dump logis tetap untuk verifikasi recoverability + arsip.
   - Menyesuaikan cara dump (mis. opsi yang tidak menyisipkan `SET session_replication_role`) — **hanya** bila terbukti tidak mengurangi kelengkapan data dan disetujui owner.

**Larangan keras:** jangan mengubah migration yang sudah diterapkan, jangan melemahkan RLS/grant, jangan menghapus user/data produksi, jangan mengarang endpoint/role superuser untuk memaksa restore. Bila hosted restore tidak feasible dengan privilege realistis, **laporkan apa adanya** dan minta keputusan owner — jangan menyamakan "restore lokal sukses" dengan "restore hosted produksi sukses".

## 4. Validasi manual di luar script (wajib untuk ADM-009)

Script memvalidasi orphan/RLS/grants/row count secara SQL. Berikut tetap manual oleh operator:

1. **Uji akses lintas dua akun uji** di project disposable: buat/restore dua akun dengan role berbeda, pastikan RLS membatasi akses sesuai policy (bukan sekadar policy ada). Jangan pakai akun produksi.
2. **Smoke test aplikasi** terhadap project disposable (arahkan env aplikasi non-prod ke disposable): login, presensi, laporan, task, calendar feed.
3. **Bandingkan row count** tabel inti dengan sumber/manifest untuk memastikan tidak ada data hilang sebagian.
4. **Verifikasi grant** anon/authenticated atas tabel hasil restore minimal (bukan hak penuh) — bukti langkah revoke default privileges bekerja. Script mencetak grant ini; tinjau.

## 5. Setelah drill

1. Catat tanggal, operator, file backup, semua blok RESULT, versi server disposable, dan keputusan C-3 ke change log / `docs/audit/`.
2. **Koreksi doc tertunda sampai bukti ini ada:** bila RESULT mengonfirmasi/membantah klaim `docs/backup-restore.md` L57/L60/L61 atau header `backup.yml` L16–20, perbarui doc agar cocok dengan bukti nyata (jangan biarkan klaim lama yang belum terverifikasi).
3. **Cleanup:** hapus `backup.sql`/`auth.sql` plaintext (`shred -u` atau `rm -f`), lalu **hapus project disposable**. Jangan sentuh data/user/faktor produksi.
4. Lakukan berkala (mis. bulanan) dan setiap sebelum migrasi besar.

## 6. Yang TIDAK dilakukan runbook ini

- Tidak mengubah konfigurasi/produksi, tidak apply migrasi, tidak restore produksi, tidak mengirim email/notifikasi nyata, tidak mengubah cron, tidak merotasi credential, tidak deploy produksi (§1.3).
- Tidak melemahkan RLS/grant; tidak menyentuh `supabase/migrations/**`; tidak menghapus user.
- Tidak memegang private key `age`/`key.txt`; dekripsi tetap offline oleh operator.
- Tidak mengimplementasikan recovery codes MFA (itu WS3, digates spike T0.1 — lihat `docs/mfa-spike-runbook.md`).
- Tidak mengklaim restore hosted produksi berhasil berdasarkan restore lokal/disposable. Status produksi tetap harus diverifikasi terpisah.
