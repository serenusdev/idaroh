# Runbook Remediasi Auth & Rekonsiliasi Skema — 2026-11-21

Cabang: `fix/idaroh-auth-and-schema-reconciliation` (basis `4e66ce2` = produksi Vercel saat audit).
Status: **siap direview operator. Jangan merge/push ke `main` dan jangan `supabase db push` sebelum checklist §2–§3 selesai dan hasil §4 dicatat.**

Runbook ini melengkapi `docs/operator-release-gates.md` (gate umum) dan `docs/disposable-db-verification.md` (prosedur DB sekali-pakai).

## 0. Apa yang diperbaiki

| Lapisan | Masalah | Perbaikan |
| --- | --- | --- |
| CSP (`next.config.mjs`) | `script-src 'self'` memblokir `challenges.cloudflare.com` → `window.turnstile` tak pernah ada → login selalu gagal "Verifikasi keamanan wajib diselesaikan." | Origin Turnstile diizinkan di `script-src`, `frame-src`, `connect-src`; direktif ketat lainnya utuh. |
| Widget Turnstile | Gagal load / kedaluwarsa tidak terlihat pengguna. | `error-callback`, `expired-callback`, penanganan `onerror` script + UI "Muat ulang verifikasi", reset token via `resetNonce` setelah kegagalan server. |
| Honeypot registrasi | Autofill password manager bisa mengisi field `website` → pendaftaran asli ditolak. | Atribut anti-autofill (`new-password`, `data-lpignore`, `data-1p-ignore`, `data-form-type`, non-focusable, off-screen). Nama field dan cek server TETAP ada — kontrol bot tidak dilonggarkan. |
| Diagnostik | Kegagalan registrasi tidak bisa dibedakan dari log. | `console.warn` bertahap (`honeypot`/`turnstile`/`auth`/`database`), tanpa PII (email disanitasi). |
| Migrasi pending (33 applied / 21 pending) | Produksi memakai objek dari `20261105000002..20261114000008` via perubahan manual → replay mentah gagal (`CREATE TABLE`/`CREATE POLICY` duplikat). | Semua DDL di rentang pending diberi guard `IF [NOT] EXISTS` / `CREATE OR REPLACE` / `DROP ... IF EXISTS`. Replay di DB fresh (dari migrasi 001) tetap valid. |
| RPC | `public.review_attendance_correction` masih 3 argumen (aplikasi kirim 4); overload lama `approve_account_application(uuid,uuid,text,uuid)` dan `review_report(uuid,text,text)` menggantung. | `20261114000007` kini ikut meng-upgrade wrapper public ke 4 argumen; migrasi baru `20261121000001_reconcile_rpc_overloads.sql` menghapus semua overload usang lalu **gagal keras** jika签名 5/4/5-argumen yang diharapkan tidak ada. |

Kontrol keamanan yang TIDAK diubah: Turnstile tetap fail-closed di produksi (SEC-11), honeypot server-side tetap aktif, MFA/AAL2, RLS, dan grant service_role tidak disentuh.

## 1. Prasyarat

1. Backup produksi terakhir sukses (lihat `docs/operator-release-gates.md` §1; minimal satu manifest B2 sebelum hari ini) + pastikan PITR/backup provider aktif.
2. CI di cabang ini hijau (`vitest`, `tsc --noEmit`, `database-integration` bila runner tersedia).
3. `supabase` CLI sudah `link` ke project produksi (`supabase/.temp/project-ref`). Verifikasi ref cocok dengan Dashboard — JANGAN menjalankan perintah apa pun terhadap ref lain.
4. Akses SQL read-only ke produksi (Dashboard SQL editor atau `psql` via connection string pooled — jangan cetak connection string ke log/chat).

## 2. Preflight SQL produksi (read-only, wajib semua lolos sebelum push)

Jalankan satu per satu; simpan hasilnya sebagai bukti.

```sql
-- 2a. Titik berhenti migrasi tercatat (diharapkan s/d 20261105000001)
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;

-- 2b. Overload RPC yang akan direkonsiliasi (diharapkan: approve 4-arg DAN 5-arg;
--     review_attendance_correction 3-arg; review_report 3-arg)
SELECT n.nspname AS schema, p.proname,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('approve_account_application','review_attendance_correction','review_report')
ORDER BY 1,2,3;

-- 2c. OPS-02: duplicate pending account requests (harus 0 baris, kalau tidak bereskan dulu)
SELECT lower(email), count(*) FROM public.account_requests
WHERE status = 'pending' GROUP BY lower(email) HAVING count(*) > 1;

-- 2d. TRC-04: duplicate email_outbox business references (harus 0 baris)
SELECT reference_type, reference_id, count(*) FROM public.email_outbox
WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL
GROUP BY 1,2 HAVING count(*) > 1;

-- 2e. Objek yang belum ada dan akan dibuat (diharapkan FALSE keduanya)
SELECT to_regclass('public.report_review_idempotency') IS NOT NULL AS idempotency_table_exists,
       to_regclass('public.email_outbox') IS NOT NULL AS email_outbox_exists;
```

Jika 2b sudah menunjukkan hanya signature baru (mis. karena operator pernah apply manual), tidak apa-apa — seluruh pernyataan bersifat idempoten.

## 3. Replay di DB sekali-pakai (opsional tapi dianjurkan)

Mesin kerja saat ini BLOCKED (RAM 8 GB; lihat `docs/disposable-db-verification.md`). Jalankan di mesin dengan Docker + ≥6 GB:

```bash
# dari checkout cabang ini
supabase start          # stack lokal sekali-pakai
supabase db reset       # replay SEMUA 55 migrasi dari nol — harus sukses
supabase test db        # pgTAP: supabase/tests/*.sql — harus sukses

# simulasi replay di atas skema produksi yang sudah drift:
# 1) buat DB sekali-pakai lain, restore backup produksi terbaru (lihat docs/backup-restore.md)
# 2) hapus baris 20261105000002.. dari supabase_migrations.schema_migrations DB restore itu bila perlu,
#    lalu jalankan:
supabase db push --local   # terhadap DB restore/staging, BUKAN --linked
```

Tanpa replay ini, verifikasi yang tersedia adalah guard statis di `src/__tests__/migration-replay-safety.test.ts` (sudah hijau) — catat keputusan tersebut di bukti release.

## 4. Eksekusi (urutan wajib)

1. **Merge + deploy kode dulu sebelum push migrasi?** Tidak. Urutan aman: **migrasi → kode**, karena kode baru memanggil RPC 4/5-argumen yang baru dijamin ada setelah `20261121000001`; migrasi sendiri kompatibel-mundur (wrapper lama tidak dipakai aplikasi lama setelah deploy, dan `review_report` 3-argumen sudah dihapus oleh `20261118000001` di produksi). Aplikasi lama yang masih mengirim `review_report` 3-argumen hanya ada bila produksi > `4e66ce2` — produksi saat ini = `4e66ce2` yang sudah memakai 5-argumen.
2. Push migrasi (menambah `20261121000001` = 22 file):
   ```bash
   supabase db push        # terhadap project ref yang di-link;Review daftar "Applying migration" dulu
   ```
   Semua file mencatat versi ke `schema_migrations`; tidak ada CREATE mentah yang bisa gagal karena drift.
3. **Verifikasi pasca-migrasi** (ulangi query §2b + assert):
   ```sql
   SELECT
     to_regprocedure('public.approve_account_application(uuid, uuid, text, uuid, uuid)') IS NOT NULL AS approve5,
     to_regprocedure('public.approve_account_application(uuid, uuid, text, uuid)')      IS NULL     AS approve4_gone,
     to_regprocedure('public.review_attendance_correction(uuid, text, text, text)')     IS NOT NULL AS correction4,
     to_regprocedure('public.review_attendance_correction(uuid, text, text)')           IS NULL     AS correction3_gone,
     to_regprocedure('public.review_report(uuid, integer, text, text, text)')           IS NOT NULL AS review5,
     to_regprocedure('public.review_report(uuid, text, text)')                          IS NULL     AS review3_gone,
     (SELECT count(*) FROM supabase_migrations.schema_migrations) AS applied_count;
   ```
   Semua boolean harus `true`. `NOTIFY pgrst` sudah disertakan di migrasi; bila PostgREST belum segar, reload API dari Dashboard.
4. Merge cabang ke `main` → Vercel deploy otomatis. Pastikan commit deploy = merge commit cabang ini.
5. **Smoke test produksi** (pakai akun super_admin ber-MFA; jangan buat akun test permanen):
   - `/login`: widget Turnstile muncul (tidak ada error CSP di console browser), login sukses → MFA challenge jalan.
   - Matikan/ blokir `challenges.cloudflare.com` di devtools → muncul pesan "Verifikasi keamanan gagal dimuat…" + tombol muat ulang.
   - `/register`: isi form dengan password manager aktif (autofill penuh) → submit menghasilkan permohonan masuk antrean IAM (bukan "Permohonan tidak dapat diproses.").
   - Admin: setujui satu permohonan tertunda dengan pilihan tim → RPC 5-argumen sukses, tim terisi.
   - Admin: review satu koreksi presensi dengan klasifikasi efektif → sukses (wrapper public 4-argumen).
   - Review satu laporan → `report_review_idempotency` bertambah 1 baris `completed`; kirim ulang kunci sama → respons `idempotent:true`.
   - Cek log server (Vercel): tidak ada baris `[iam-registration] stage=...` yang berisi alamat email.

## 5. Rollback

- **Aplikasi**: redeploy commit produksi sebelumnya (`4e66ce2`) dari Vercel.
- **Database**: migrasi bersifat forward-fix; jangan menurunkan skema secara otomatis. Rollback manual hanya untuk `20261118000001` via `supabase/rollback/20261118000001_report_review_command_idempotency_down.sql` — hanya jika aplikasi juga diturunkan ke versi pra-idempotensi (urutan manual ada di header file itu). `20261121000001` tidak perlu di-rollback (hanya DROP + assert; menjalankan ulang kode lama di atas skema baru tidak dijamin — kembali ke §5 aplikasi).
- Jika push migrasi gagal di tengah: tiap file bertransaksi sendiri (`BEGIN/COMMIT`); catat file yang gagal, perbaiki penyebab (biasanya §2c/§2d belum dibereskan), lalu `supabase db push` lagi — file yang sudah sukses tidak diulang.

## 6. Bukti yang dicatat

Isi dan simpan bersama release notes: hasil §2 (6 query), keluaran `supabase db push` (nama file yang diterapkan), assert §4.3 semua `true`, checklist smoke §4.5, dan (bila dijalankan) keluaran `supabase db reset` + `supabase test db` dari §3.
