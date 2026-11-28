# PRD-04 — Daily Activity Reports (Laporan Aktivitas Harian)

**Versi:** 2.1 · **Keputusan audit:** 2026-11-13 (§16; NOW/v1.1 mengikat cakupan rilis, bukan klaim implementasi) · **Prefix:** REP · **Rilis:** R2 · **Dibaca bersama:** Master PRD v2.0, PRD-01, PRD-03, PRD-07 **Label:** \[TERKONFIRMASI\] · \[REKOMENDASI\] · \[TERBUKA\]

---

## 1. Tujuan dan Posisi Modul

Santri mendokumentasikan **apa yang mereka kerjakan** setiap hari. Laporan terpisah dari absensi (PRD-03): absensi menjawab "hadir atau tidak", laporan menjawab "mengerjakan apa".

**Tujuan**

1. Dokumentasi harian yang konsisten dan dapat ditelusuri.
2. Pemantauan kepatuhan (siapa belum melapor) tanpa menghukum otomatis.
3. Alur review oleh ustadz/pengurus yang ditugaskan, tanpa memaksa review di hari yang sama **\[TERKONFIRMASI\]**.
4. Riwayat laporan dan riwayat review yang utuh.

**Bukan tujuan:** penilaian kinerja otomatis/AI, pemberian skor/nilai (R2), pelaporan kelompok (laporan tetap individual).

---

## 2. Aturan Bisnis

### 2.1 Terkonfirmasi

| ID | Aturan |
| --- | --- |
| BR-REP-01 | Laporan bersifat individual |
| BR-REP-02 | Seluruh santri wajib melapor setiap hari operasional (Senin–Sabtu) |
| BR-REP-03 | Batas pengumpulan **21.00 WIB**; Minggu tanpa kewajiban |
| BR-REP-04 | Laporan terlambat tetap dapat dikirim, ditandai terlambat; timestamp pengiriman asli dipertahankan |
| BR-REP-05 | Status pengumpulan dan status review **dipisah** |
| BR-REP-06 | Review oleh ustadz/pengurus sesuai penugasan; waktunya mengikuti kebijakan pereview — sistem tidak boleh memaksakan tenggat review hari yang sama |
| BR-REP-07 | Laporan terlambat ≠ laporan ditolak; terkirim ≠ disetujui |

### 2.2 Rekomendasi (default sementara; lihat OD)

| ID | Aturan | OD |
| --- | --- | --- |
| BR-REP-08 | Satu laporan per pengguna per tanggal (`UNIQUE (user_id, report_date)`) berisi **1–N item aktivitas** | OD-017 |
| BR-REP-09 | Laporan boleh diedit selama belum berstatus `approved`; setiap pengiriman ulang menjadi revisi baru yang tersimpan | OD-003 |
| BR-REP-10 | **[v1.1 — kontrak asal; NOW backfill diblokir, §16]** Laporan untuk tanggal lampau dapat dikirim hingga 7 hari ke belakang (configurable); lebih dari itu perlu persetujuan pengurus | OD-016 |
| BR-REP-11 | Status `is_late` ditentukan **sekali** pada pengiriman pertama dan **tidak berubah** pada revisi berikutnya | — |
| BR-REP-12 | Hari dengan keterangan izin/sakit disetujui (PRD-03) tidak menimbulkan kewajiban laporan | OD-007 |
| BR-REP-13 | Kewajiban lapor ditentukan flag `report_required` pada profil (default santri); pengurus/yayasan default tidak wajib | OD-001 |
| BR-REP-14 | Pereview ditentukan oleh penugasan aktif saat **pengiriman pertama** dan disimpan sebagai snapshot di laporan | — |
| BR-REP-15 | Jika tidak ada pereview ditugaskan, laporan masuk antrean "Belum Ditugaskan" yang terlihat oleh pengurus berwenang | — |

---

## 3. Status dan State Machine

### 3.1 Dua Dimensi Status (wajib terpisah)

**Status pengumpulan (`submission_status`)**

| Nilai | Arti |
| --- | --- |
| `draft` | Disimpan, belum dikirim |
| `submitted` | Terkirim (pengiriman pertama mencatat `first_submitted_at`) |

Berdampingan dengan `is_late` (boolean, hasil perbandingan `first_submitted_at` terhadap tenggat tanggal laporan). Tampilan: *Tepat Waktu* / *Terlambat* / *Draft*.

**Status review (`review_status`)**

| Nilai | Arti |
| --- | --- |
| `not_reviewed` | Belum ditinjau |
| `under_review` | Sedang ditinjau (opsional; pereview "mengambil" laporan) |
| `revision_required` | Perlu revisi |
| `approved` | Disetujui |

### 3.2 Transisi Review

```
not_reviewed ──claim──→ under_review ──approve──→ approved
      │                        │
      └─────approve────────────┘──request_revision──→ revision_required
                                                       │ (santri edit & kirim ulang)
                                                       ↓
                                                  not_reviewed (revisi baru)
```

- `approved` bersifat akhir; **[v1.1 — REP-019, kontrak asal]** dapat dibuka kembali oleh pereview dengan alasan (audit) **\[REKOMENDASI\]**.
- Kirim ulang setelah revisi tidak mengubah `is_late` dan `first_submitted_at`; mencatat `last_submitted_at` dan `revision_no`.

### 3.3 Status Kepatuhan (dihitung, bukan disimpan sebagai keputusan)

| Kondisi pada hari tertutup | Label kepatuhan |
| --- | --- |
| Terkirim ≤ 21.00 | Tepat waktu |
| Terkirim > 21.00 | Terlambat |
| Tidak ada laporan, wajib | **Belum Melapor** (bukan "menolak" atau "pelanggaran") |
| Izin/sakit disetujui | Dikecualikan |
| Hari non-operasional | Tidak berlaku |

---

## 4. Model Data

| Tabel | Kolom kunci | Catatan |
| --- | --- | --- |
| `daily_reports` | `id, user_id, report_date, submission_status, is_late, first_submitted_at, last_submitted_at, review_status, reviewer_id (snapshot), revision_no, policy_version_id, created_at, updated_at` | **UNIQUE (user\_id, report\_date)** |
| `report_items` | `id, report_id, category_id, title, description, result_progress, obstacles, sort_order, duration_minutes (opsional)` | 1–N per laporan |
| `report_revisions` | `id, report_id, revision_no, snapshot jsonb (items), submitted_at, submitted_by` | Dibuat saat setiap pengiriman |
| `report_reviews` | `id, report_id, revision_no, reviewer_id, decision (approved\|revision_required), notes, decided_at` | Riwayat tidak dihapus |
| `report_categories` | `id, name, sort_order, is_active` | Configurable (OD-011) |
| `report_attachments` | `id, report_id, item_id?, file_id` | File di Storage privat |
| `report_reminders_log` | `user_id, report_date, sent_at` | Mencegah pengingat ganda |
| `report_reviewer_queue` (view) | per pereview: laporan menunggu | Untuk antrean |

**Kategori awal (usulan, harus divalidasi):** Pendidikan/Pembelajaran, Kegiatan Keagamaan, Digital & Teknologi, Media & Kreatif, Operasional, Penggalangan Dana, Kegiatan Sosial, Lainnya.

**Batas ukuran (configurable):** judul 150 karakter; deskripsi 5.000; hasil/kendala 2.000; maks. 10 item/laporan; lampiran sesuai Master §10.2.

---

## 5. Logika Pengiriman (Kontrak Teknis)

Semua perhitungan waktu dan transisi status di database lewat RPC `report_submit(report_id)`.

```
report_submit(report_id):
  1. Pastikan pemilik laporan = auth.uid() dan akun aktif
  2. Pastikan >= 1 item valid (judul + deskripsi wajib)
  3. Pastikan review_status != approved (atau pengaturan edit diizinkan, BR-REP-09)
  4. Jika first_submitted_at kosong:
        first_submitted_at = now()
        deadline = (report_date + 21:00) AT TIME ZONE 'Asia/Jakarta'
        is_late  = (now() > deadline)
        reviewer_id = penugasan aktif | NULL
        NOW: tolak pengiriman pertama untuk tanggal lampau (backfill diblokir)
        v1.1 (kontrak asal): tolak bila report_date lebih tua dari batas mundur
                            (OD-016) -> REP_BACKFILL_LIMIT
  5. revision_no += 1; simpan snapshot ke report_revisions
  6. review_status = not_reviewed (jika sebelumnya revision_required)
  7. last_submitted_at = now(); submission_status = submitted
  8. Buat notifikasi report.submitted ke pereview (atau antrean umum)
  9. Audit
```

- Tenggat dihitung dari tanggal laporan, bukan tanggal kirim: laporan tanggal 3 yang dikirim tanggal 4 pukul 08.00 tetap `is_late = true`.
- Pengiriman ganda cepat (double-click) aman: pemeriksaan versi (`revision_no` yang diharapkan) mencegah revisi ganda.
- **[v1.1 — REP-015]** Draft otomatis tersimpan (autosave) agar laporan panjang tidak hilang di jaringan buruk.

---

## 6. Persyaratan Fungsional

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| REP-001 | Santri membuat laporan untuk tanggal operasional; form mobile-first dengan item dinamis | M |
| REP-002 | Sistem melacak kewajiban lapor tiap santri per hari operasional | M |
| REP-003 | Klasifikasi tepat waktu/terlambat berdasarkan tenggat 21.00 WIB tanggal laporan | M |
| REP-004 | Laporan terlambat tetap bisa dikirim; `first_submitted_at` asli tidak berubah | M |
| REP-005 | Kategori configurable oleh admin | S |
| REP-006 | **[v1.1 — disetujui 2026-11-13]** Lampiran pendukung (gambar/dokumen) dengan batas tipe & ukuran | S |
| REP-007 | Routing laporan ke pereview sesuai penugasan | M |
| REP-008 | Keputusan review: setujui / minta revisi + catatan (wajib saat minta revisi) | M |
| REP-009 | Santri menanggapi revisi dengan mengedit dan mengirim ulang; riwayat revisi & review tetap | M |
| REP-010 | Antrean pereview: menunggu, perlu revisi, dikirim ulang, disetujui; filter tanggal/santri/status | M |
| REP-011 | Monitoring kepatuhan harian: santri belum melapor setelah 21.00 | M |
| REP-012 | **[NOW — TRC-05, 2026-11-13]** Riwayat laporan pribadi berupa daftar sederhana per tanggal dengan dua status dan tautan detail; pereview melihat laporan dalam cakupannya | M |
| REP-013 | Snapshot penugasan pereview pada laporan; perubahan penugasan tidak mengubah laporan lama; admin dapat menugaskan ulang laporan menunggu | M |
| REP-014 | Pengingat in-app sebelum 21.00 (mis. 19.30, 20.30) bagi yang belum mengirim; dapat dikonfigurasi | S |
| REP-015 | **[v1.1 — disetujui 2026-11-13]** Autosave draft | S |
| REP-016 | **[v1.1 — disetujui 2026-11-13]** Salin dari laporan kemarin sebagai template (tanpa mengirim otomatis) | C |
| REP-017 | **[v1.1 — disetujui 2026-11-13]** Komentar berulang pereview ↔ santri pada satu laporan (thread ringkas) | C |
| REP-018 | **[v1.1 — disetujui 2026-11-13]** Pereview massal: setujui banyak laporan sekaligus (hanya yang dipilih eksplisit) | C |
| REP-019 | **[v1.1 — disetujui 2026-11-13]** Buka kembali laporan `approved` oleh pereview dengan alasan | S |
| REP-020 | **[v1.1 — disetujui 2026-11-13]** Rekap per santri: periode, jumlah lapor, terlambat, belum lapor, rata-rata waktu review | S |
| REP-021 | Ekspor rekap & isi laporan (CSV/PDF) oleh yang berwenang, beraudit | S |
| REP-022 | **[v1.1 — kontrak asal; NOW backfill diblokir, 2026-11-13]** Pembatasan lampau: pengiriman melewati batas mundur butuh persetujuan pengurus (REP\_BACKFILL\_LIMIT → permintaan izin) | C |

---

## 7. Hak Akses dan Privasi

| Permission | Santri | Koord. | Pengurus | Yayasan | S.Admin |
| --- | --- | --- | --- | --- | --- |
| `report.create/update/submit` | own | own | own (bila wajib) | own (bila wajib) | — |
| `report.read` | own | assigned/team | assigned / all | ringkasan, isi bila diberi hak | — (default) |
| `report.review` | — | assigned | assigned | — | — |
| `report.reopen` | — | — | assigned | — | — |
| `report.reviewer.reassign` | — | — | ✓ | — | ✓ (teknis) |
| `report.compliance.read` | — | team | all | all | — |
| `report.export` | — | — | ✓ | ✓ | — |

**Prinsip privasi:** laporan memuat catatan pribadi santri. Isi laporan hanya terbaca pemilik dan pereview/yang berwenang; **dashboard dan statistik hanya menampilkan agregat atau status** kecuali yang berwenang membuka detail. Super Admin tidak otomatis membaca isi (Master §9.2). Bukti lampiran memakai signed URL berumur pendek.

**RLS:** pemilik `SELECT/INSERT/UPDATE` laporannya selama status mengizinkan (UPDATE terbatas; transisi status hanya via RPC); pereview `SELECT` jika `reviewer_id = auth.uid()` atau penugasan aktif mencakup pemilik; keputusan review hanya via RPC `report_review()`.

---

## 8. Job Terjadwal

| Job | Waktu (WIB) | Fungsi |
| --- | --- | --- |
| Pengingat 1 | 19.30 | Notifikasi bagi wajib lapor yang belum kirim |
| Pengingat 2 | 20.30 | Idem |
| Penutupan hari | 00.30 | Hitung kepatuhan tanggal kemarin ke snapshot |
| Ringkasan antrean pereview | 07.00 | Notifikasi jumlah laporan menunggu (tanpa memaksa tenggat review) |

Job idempoten; pengingat ganda dicegah `report_reminders_log`. Pengingat bersifat bisa dimatikan per pengguna.

---

## 9. Persyaratan Layar

| Layar | Isi |
| --- | --- |
| Dashboard Santri (widget) | Status laporan hari ini, hitung mundur ke 21.00, tombol "Tulis Laporan" |
| Editor Laporan | Tanggal, item (kategori, judul, deskripsi, hasil, kendala), lampiran, autosave, "Kirim" |
| Konfirmasi Kirim | Ringkasan + penanda Tepat Waktu/Terlambat sebelum dikirim |
| Riwayat Laporan Saya | Daftar per tanggal dengan dua penanda status terpisah |
| Detail Laporan | Isi, riwayat revisi, riwayat review, catatan pereview |
| Antrean Review | Tab: Menunggu / Perlu Revisi / Dikirim Ulang / Disetujui / Belum Ditugaskan |
| Layar Review | Isi laporan, aksi Setujui / Minta Revisi (catatan), navigasi ke laporan berikutnya |
| Monitoring Kepatuhan | Daftar belum melapor per hari + filter tim |
| Rekap | Per santri / per tim / per periode |

UX: indikator status ditulis dengan teks + ikon; santri selalu melihat apakah laporannya *terkirim* dan *sudah ditinjau* sebagai dua hal berbeda; formulir panjang dibuat bertahap per item agar nyaman di ponsel.

---

## 10. Notifikasi

| Event | Penerima | Kanal |
| --- | --- | --- |
| `report.deadline_reminder` | Santri belum kirim | In-app (+ push saat PWA) |
| `report.submitted` | Pereview | In-app |
| `report.revision_requested` | Santri | In-app |
| `report.approved` | Santri | In-app |
| `report.queue_digest` | Pereview | In-app (ringkasan harian) |

---

## 11. Edge Case

| Kasus | Perilaku |
| --- | --- |
| Dikirim tepat 21:00:00 | Tepat waktu; `> 21:00:00` terlambat (tes batas: 20:59:59, 21:00:00, 21:00:01) |
| Draft dibuat pukul 20.50, dikirim 21.10 | Terlambat (berdasarkan waktu pengiriman, bukan pembuatan) |
| Santri mengirim untuk hari Minggu | Ditolak (tidak ada kewajiban) kecuali pengecualian aktif atau izin pengurus |
| Pereview dinonaktifkan saat laporan menunggu | Laporan masuk antrean "Belum Ditugaskan"; notifikasi ke pengurus |
| Penugasan pereview berubah setelah kirim | Laporan lama tetap ke pereview snapshot; admin dapat menugaskan ulang yang masih menunggu |
| Santri edit saat laporan sedang `under_review` | Diizinkan; status kembali `not_reviewed`, pereview diberi tahu |
| Dua perangkat mengedit bersamaan | Optimistic locking (`updated_at`); konflik diberi peringatan |
| Lampiran gagal diunggah | Laporan tetap tersimpan sebagai draft; lampiran dapat diulang |
| Santri izin sakit tapi tetap melapor | Diperbolehkan; kewajiban hanya dihapus, bukan larangan |
| Hari non-operasional diumumkan terlambat | Kewajiban dibatalkan untuk tanggal tersebut; laporan yang sudah masuk tetap tersimpan |
| Pereview = pemilik laporan | Dicegah; dialihkan |
| Akun santri dinonaktifkan | Laporan historis tetap; kewajiban berhenti |

---

## 12. Kriteria Penerimaan

1. Setiap santri wajib tercakup monitoring kepatuhan harian; yang belum kirim muncul setelah 21.00 sebagai "Belum Melapor".
2. Santri dapat membuat, menyimpan draft, dan mengirim laporan; `first_submitted_at` berasal dari server.
3. Laporan yang dikirim setelah 21.00 pada tanggal laporan ditandai terlambat dan tetap dapat dikirim; flag tidak berubah pada revisi.
4. Hari Minggu tidak menimbulkan kewajiban.
5. Laporan diarahkan ke pereview aktif; tanpa penugasan masuk antrean "Belum Ditugaskan".
6. Pereview dapat menyetujui/meminta revisi dengan catatan; santri dapat merevisi dan mengirim ulang; seluruh riwayat revisi & review dapat dilihat.
7. Tidak ada mekanisme/tenggat yang memaksa review di hari yang sama.
8. Santri lain/pereview non-penugasan **tidak dapat** membaca isi laporan (tes RLS).
9. Status pengumpulan dan review tampil terpisah di semua layar dan ekspor.
10. Statistik dashboard tidak membuka isi laporan kepada yang tidak berwenang.

---

## 13. Rencana Tes

| Jenis | Skenario |
| --- | --- |
| pgTAP | Batas 21.00; `is_late` tidak berubah pada revisi; snapshot pereview; larangan baca silang; transisi review ilegal |
| Unit | Validasi server item (manual atau Zod; asal Zod); batas karakter; util status; guard kepemilikan/scope |
| E2E | Tulis → kirim tepat waktu; kirim terlambat; minta revisi → kirim ulang → setujui; antrean belum ditugaskan |
| Konkurensi | Dua pengiriman bersamaan; edit saat review |
| Zona waktu | Server UTC vs WIB di sekitar 21.00 dan pergantian hari |

---

## 14. Dependensi dan Keputusan Terbuka

**Bergantung pada:** IAM, PPL (penugasan pereview, flag wajib lapor), ATT (keterangan izin/sakit), Master (kebijakan berversi, notifikasi, file).

| ID | Keputusan | Default sementara |
| --- | --- | --- |
| OD-001 | Pengurus/yayasan wajib lapor | Tidak (flag per profil) |
| OD-003 | Edit setelah kirim sebelum review | Boleh sampai `approved` |
| OD-005 | Delegasi review | Tidak; penugasan ulang oleh admin |
| OD-007 | Pengecualian saat izin | Hari izin/sakit disetujui dikecualikan |
| OD-011 | Kategori tetap/configurable | Configurable |
| OD-016 | Batas mundur | **NOW (2026-11-13): backfill diblokir. v1.1 (asal): 7 hari**, izin pengurus di luar batas |
| OD-017 | Satu laporan banyak item | Ya, 1–10 item |
| OD-026 | Apakah hari tanpa kegiatan khusus tetap wajib entri rutin | Ya, wajib minimal 1 item (bisa "Kegiatan rutin") |

---

## 15. Metrik Modul

Tingkat kepatuhan lapor harian; tingkat laporan terlambat; jumlah backlog review (dan usia terlama); waktu median dari kirim sampai review; jumlah revisi per laporan; persentase laporan disetujui pada kiriman pertama. Definisi rumus di PRD-08 §4.

---

## 16. Keputusan Audit — 2026-11-13 [TERKONFIRMASI]

Change log 2.1; keputusan berikut mengikat NOW/v1.1 sesuai Master §0.4, bukan laporan bahwa fitur telah selesai.

- **TRC-05 / REP-012 — M NOW:** riwayat laporan pribadi harus tersedia sebagai **daftar sederhana** berurut tanggal (terbaru dahulu), menampilkan tanggal, status pengumpulan dan review secara terpisah, serta akses detail laporan milik sendiri. Mencakup laporan lama, bukan hanya hari ini; sediakan pagination bila perlu dan keadaan kosong/gagal yang jelas. Rekap analitik REP-020 tidak diperlukan untuk daftar ini. Pereview tetap hanya melihat laporan dalam scope-nya; server tidak menerima `user_id` klien sebagai bukti kepemilikan.
- **B / TRC-09 / OD-016 — NOW:** backfill diblokir: pengguna tidak dapat membuat atau melakukan pengiriman pertama laporan untuk tanggal lampau; tidak ada jalur izin pengurus untuk membuka backfill pada rilis awal. Pengiriman setelah 21.00 pada tanggal yang sama tetap diterima sebagai terlambat (REP-004). Revisi laporan yang sudah terkirim tetap mengikuti REP-009 dan mempertahankan `first_submitted_at`/`is_late`. Baseline BR-REP-10 dan REP-022 (7 hari + izin pengurus) dipertahankan sebagai **v1.1**, bukan dihapus atau dianggap aktif sekarang.
- **Deferral C — v1.1:** REP-006 (lampiran), REP-015 (autosave), REP-016 (salin kemarin), REP-017 (thread), REP-018 (review massal), REP-019 (reopen approved), REP-020 (rekap per santri). Deskripsi, prioritas asal, layar, model data, dan acceptance turunannya tetap merupakan kontrak v1.1. Editor NOW tidak boleh menjanjikan autosave/lampiran yang belum tersedia; menyimpan draft biasa tidak sama dengan autosave.
- **Lintas modul:** validasi server manual diterima tanpa kewajiban Zod; guard app-layer + RLS defense-in-depth tetap wajib. Scheduler eksternal cron-job.org dan FCM diakui; lihat [ADR](docs/ADR-2026-11-13-cron-job-org.md). Pengingat laporan tetap mengikuti requirement sebelum 21.00; seed 21.00 yang tercatat di ADR adalah selisih konfigurasi, bukan perubahan tenggat atau klaim sudah diperbaiki.

Acceptance NOW tambahan: pemilik dapat membuka laporan lama dari daftar, dua status tidak tercampur, akun lain tidak dapat membaca detail di luar scope, dan pengiriman awal tanggal lampau ditolak server. Ini kriteria untuk verifikasi berikutnya, bukan hasil tes.
