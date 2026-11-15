# ADR — Scheduler eksternal cron-job.org

**Tanggal:** 2026-11-13 · **Status:** disetujui pengguna (keputusan desain, bukan bukti provider aktif)

## Konteks dan keputusan

Master PRD §0.4 mengakui cron-job.org sebagai scheduler eksternal, menggantikan asumsi baseline bahwa pg_cron adalah pemicu aktif. Gunakan dua heartbeat **GET setiap 15 menit** ke origin HTTPS deployment yang disetujui:

| Endpoint | Fungsi |
| --- | --- |
| `/api/cron/notifications` | Publikasi/arsip pengumuman, drain notification outbox, refresh attendance effective hari ini, dan pengingat yang jatuh tempo |
| `/api/cron/backups` | Membuat manifest jumlah baris; **bukan backup database/Storage atau restore** |

Header: `Authorization: Bearer <CRON_SECRET dari secret manager>`. Placeholder ini bukan kredensial. Jangan memasukkan secret ke URL, repo, screenshot, atau log. Endpoint memeriksa secret di server; tidak menggunakan cookie sesi pengguna. Jangan memperluas akses RLS untuk scheduler. Service-role hanya di server dan melewati RLS, sehingga endpoint authentication dan pembatasan pekerjaan tetap wajib.

Tidak menambah/mengubah provider dalam pekerjaan dokumentasi ini. Operator harus mencatat origin, ID kedua job provider, pemilik, jadwal, dan bukti heartbeat pada catatan operasi terbatas; nilainya tidak dikarang di ADR. Hindari scheduler kedua yang memicu pekerjaan sama (termasuk Vercel Cron/pg_cron).

## Waktu bisnis dan bukti source

Heartbeat bukan jadwal pengingat. `cron_job_schedules` memilih jadwal WIB; `isCronJobDue` memakai jendela **[waktu jadwal, +20 menit)**. Hari: 0=Minggu, 1–6=Senin–Sabtu.

| `job_key` konfigurasi | Seed migrasi yang ditinjau | Claim harian `cron_job_runs.job_key` |
| --- | --- | --- |
| `attendance_reminder` | 07:30 WIB, Senin–Sabtu | `attendance-reminder:YYYY-MM-DD` |
| `report_reminder` | **21:00 WIB**, Senin–Sabtu | `report-reminder:YYYY-MM-DD` |
| `backup_manifest` | 00:30 WIB, setiap hari | `backup-manifest:YYYY-MM-DD` |

Seed bukan bukti konfigurasi produksi. PRD-04 tetap meminta pengingat **sebelum 21.00** (misalnya 19.30); seed 21.00 adalah selisih yang harus ditangani/dibuktikan oleh pekerjaan implementasi/operasi terpisah, bukan dianggap sudah berubah. OPS-12 tetap **M NOW**: satu toggle opt-out absensi wajib dihormati in-app dan FCM; ADR tidak menyatakan fitur itu sudah ada.

Referensi repository: `src/app/api/cron/notifications/route.ts`, `src/app/api/cron/backups/route.ts`, `src/lib/cron-schedule.ts`, `supabase/migrations/20261112000004_cron_job_schedules.sql`. FCM adalah kanal pengiriman; presence/heartbeat pengguna bukan heartbeat scheduler dan bukan absensi. Android wrapper diakui tetapi bukan release gate.

## Konsekuensi dan prosedur operator

- Pemicu sederhana, tetapi bergantung pada provider eksternal, secret yang sama, dan ketersediaan endpoint. Catat heartbeat terakhir kedua job, respons HTTP/body, kegagalan, dan pemilik tindak lanjut; jangan menganggap endpoint ada berarti job provider aktif.
- HTTP 200 dapat berarti `skipped/not_scheduled/already_processed`; periksa claim/outbox dan hasil pekerjaan, bukan HTTP saja. Kesalahan refresh attendance dapat hanya tercatat di log; respons sukses tidak membuktikan seluruh langkah sukses.
- Claim harian mengurangi duplikasi, **bukan jaminan exactly-once**. Claim gagal masih dapat membuat percobaan berikutnya `already_processed`; heartbeat di luar jendela 20 menit tidak otomatis mengejar pengingat yang terlewat. Selidiki log/claim/outbox sebelum retry; jangan menghapus claim atau mengulang pengiriman secara buta. Pemulihan perlu prosedur dan persetujuan operasi tersendiri.
- Rotasi `CRON_SECRET`: jadwalkan perubahan terkoordinasi antara environment server dan header **kedua** job, simpan hanya di secret manager, verifikasi heartbeat setelahnya, lalu hentikan penggunaan nilai lama. Kode menerima satu secret, bukan masa overlap dua key; kemungkinan 401 saat pergantian harus dipantau. Rotasi/rollback provider tidak dilakukan oleh ADR ini.
- Rilis tetap memerlukan bukti backup nyata dan restore sesuai [runbook backup](backup-restore.md); status `manifest_only` tidak memenuhi ADM-009.

Tidak ada request endpoint, perubahan provider, eksekusi SQL, atau tes yang dilakukan untuk menyusun ADR ini.
