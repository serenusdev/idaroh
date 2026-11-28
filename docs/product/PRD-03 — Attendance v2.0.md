# PRD-03 — Attendance (Absensi)

**Versi:** 2.1 · **Keputusan audit:** 2026-11-13 (§16; NOW/v1.1 mengikat cakupan rilis, bukan klaim implementasi) · **Prefix:** ATT · **Rilis:** R2 · **Dibaca bersama:** Master PRD v2.0, PRD-01, PRD-07 **Label:** \[TERKONFIRMASI\] · \[REKOMENDASI\] · \[TERBUKA\]

---

## 1. Tujuan dan Posisi Modul

Menggantikan absensi via WhatsApp dengan pencatatan **check-in mandiri** yang akurat, tidak dapat dimanipulasi klien, dan dapat diaudit. Absensi mencatat **apakah** seseorang hadir; **apa yang dikerjakan** dicatat di Activity Reports (PRD-04) — keduanya terpisah.

**Tujuan**

1. Catatan kehadiran konsisten dengan waktu server tepercaya.
2. Klasifikasi otomatis: tepat waktu / toleransi / terlambat.
3. Mendukung koreksi dan keterangan (izin, sakit) tanpa merusak catatan asli.
4. Ringkasan harian/mingguan/bulanan untuk yang berwenang.
5. Tidak menyimpulkan "alpa" secara otomatis.

**Bukan tujuan:** GPS wajib, pengenalan wajah, perangkat biometrik, QR wajib, terminal absensi.

---

## 2. Aturan Bisnis

### 2.1 Terkonfirmasi

| ID | Aturan |
| --- | --- |
| BR-ATT-01 | Check-in dilakukan sendiri oleh pengguna |
| BR-ATT-02 | Batas normal 08.00 WIB; toleransi sampai 08.15 WIB |
| BR-ATT-03 | s.d. 08.00 = tepat waktu; 08.01–08.15 = toleransi; setelah 08.15 = terlambat |
| BR-ATT-04 | Berlaku Senin–Sabtu; Minggu tanpa kewajiban |
| BR-ATT-05 | Timestamp memakai waktu server, bukan perangkat |
| BR-ATT-06 | Koreksi berdasarkan kondisi dan persetujuan pihak berwenang |
| BR-ATT-07 | Pembedaan tepat waktu vs toleransi harus dipertahankan di data dan laporan |
| BR-ATT-08 | Tidak check-in ≠ alpa terverifikasi tanpa peninjauan |

### 2.2 Interpretasi dan Rekomendasi

| ID | Aturan | Label |
| --- | --- | --- |
| BR-ATT-09 | Klasifikasi dihitung dari waktu server (WIB) **dipotong ke menit**: ≤ 08:00 → `on_time`; 08:01–08:15 → `grace`; ≥ 08:16 → `late` (OD-013) | REKOMENDASI |
| BR-ATT-10 | Check-in dibuka mulai 04.00 dan dapat dilakukan sampai 23.59 pada hari operasional; di luar jendela → ditolak (OD-015) | REKOMENDASI |
| BR-ATT-11 | Check-in di hari non-operasional (Minggu/libur) ditolak dengan pesan jelas, kecuali ada pengecualian aktif (kegiatan khusus, OD-012) | REKOMENDASI |
| BR-ATT-12 | Kewajiban absensi ditentukan oleh flag `attendance_required` pada profil/keanggotaan (default: santri) | REKOMENDASI |
| BR-ATT-13 | Klasifikasi disimpan **bersama versi kebijakan** (`policy_version_id`) saat check-in; perubahan kebijakan tidak mengubah data lama | REKOMENDASI |

### 2.3 Status Harian (Final per Orang per Tanggal)

| Status | Sumber | Catatan |
| --- | --- | --- |
| `on_time` | Check-in | Otomatis |
| `grace` | Check-in | Otomatis |
| `late` | Check-in | Otomatis |
| `excused` (Izin) | Keterangan disetujui | Bukan hasil check-in |
| `sick` (Sakit) | Keterangan disetujui | Bukan hasil check-in |
| `no_checkin` (Belum Check-in) | Dihitung sistem: wajib absen, hari operasional, tidak ada check-in & tidak ada keterangan | **Bukan** alpa (OD-002) |
| `non_operational` | Hari libur/Minggu | Tidak masuk statistik |

**Penting:** status final `no_checkin` hanya *label tampilan hasil perhitungan*. Penetapan menjadi "alpa" atau status lain menunggu keputusan OD-002 dan **harus melalui peninjauan manusia**; **[v1.1 — ATT-011, 2026-11-13]** sistem menyediakan antrean peninjauan, bukan keputusan otomatis. Antrean ditunda, bukan dianggap sudah tersedia NOW.

---

## 3. Model Data

| Tabel | Kolom kunci | Catatan |
| --- | --- | --- |
| `attendance_records` | `id, user_id, attendance_date, checked_in_at (timestamptz, default now()), classification (on_time\|grace\|late), minutes_after_deadline, policy_version_id, client_meta jsonb, created_at` | **UNIQUE (user\_id, attendance\_date)**; tidak ada UPDATE/DELETE bagi pengguna |
| `attendance_exceptions` | `id, user_id, date_from, date_to, type (excused\|sick\|special_activity\|other), reason, evidence_file_id, status, decided_by, decided_at` | Keterangan izin/sakit atau pengecualian kegiatan |
| `attendance_corrections` | `id, user_id, attendance_date, requested_type, requested_classification, reason, evidence_file_id, status (pending\|approved\|rejected\|cancelled), reviewer_id, review_note, requested_at, decided_at, original_record_snapshot jsonb` | Catatan asli **tidak diubah**; hasil koreksi terlihat lewat lapisan efektif |
| `attendance_effective` (view) | per `user_id, date`: status efektif | Gabungan record + keterangan + koreksi disetujui |
| `non_operational_dates` | `date, name, scope (all\|team), reason, created_by` | Libur, kegiatan khusus |
| `policy_versions` | `id, effective_from, checkin_open_time, on_time_until, grace_until, checkin_close_time, operating_weekdays int[], timezone` | Berversi (Master §5.3) |
| `attendance_daily_snapshot` | `date, user_id, effective_status, computed_at` | Dihasilkan job penutupan hari (§7) |

**Catatan desain:** `attendance_records` bersifat *append-only*. Koreksi disetujui tidak menimpa; **tampilan/laporan memakai status efektif** (`attendance_effective`) dan menampilkan penanda "dikoreksi" beserta tautan ke alasan dan audit. Cara ini memenuhi syarat "catatan asli dan riwayat koreksi harus tertelusur".

---

## 4. Logika Check-in (Kontrak Teknis)

Semua perhitungan terjadi di **database** lewat satu RPC `attendance_check_in()`; klien tidak mengirim waktu.

```
attendance_check_in():
  1. Pastikan is_active_member() dan attendance_required
  2. now_wib   = now() AT TIME ZONE policy.timezone
  3. date      = now_wib::date
  4. Tolak bila date bukan hari operasional / ada non_operational_dates
     (kecuali pengecualian aktif)           -> ATT_NON_OPERATIONAL_DAY
  5. Tolak bila di luar jendela buka/tutup   -> ATT_OUTSIDE_WINDOW
  6. minute_t  = date_trunc('minute', now_wib)::time
  7. classification:
       minute_t <= on_time_until  -> on_time
       minute_t <= grace_until    -> grace
       else                       -> late
  8. INSERT ... ON CONFLICT (user_id, attendance_date) DO NOTHING
     jika konflik -> kembalikan record yang sudah ada (idempoten)
  9. Tulis audit ringan + kembalikan {classification, checked_in_at}
```

**Sifat penting**

- **Idempoten:** ketukan ganda/jaringan lambat tidak menghasilkan record ganda; respons sama dengan yang pertama (`already_checked_in = true`).
- **Atomik & ringan:** satu `INSERT`; target p95 ≤ 1 dtk, aman pada lonjakan 07.45–08.15.
- **Pesan yang jelas:** hasil menampilkan jam server yang tercatat dan klasifikasinya ("Tercatat 08:07 WIB — Masa toleransi").
- **Zona waktu:** perhitungan memakai zona waktu dari kebijakan (WIB), bukan zona server/klien.
- **Jam klien:** boleh disimpan di `client_meta` hanya sebagai informasi diagnostik (mis. selisih jam perangkat), **tidak** memengaruhi klasifikasi.

---

## 5. Persyaratan Fungsional

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| ATT-001 | Tombol check-in besar di dashboard (≤ 2 ketuk dari buka aplikasi), menampilkan status hari ini | M |
| ATT-002 | Waktu check-in dari server; pengguna tak dapat mengubah | M |
| ATT-003 | Klasifikasi otomatis `on_time/grace/late` sesuai §4 dan kebijakan berversi | M |
| ATT-004 | Pencegahan duplikasi (unik per pengguna per tanggal; idempoten) | M |
| ATT-005 | Riwayat absensi pribadi (kalender bulanan + daftar) dengan status efektif | M |
| ATT-006 | Monitoring oleh yang berwenang: daftar harian per scope (tim/semua), filter status, pencarian nama | M |
| ATT-007 | Pengajuan koreksi: tanggal, alasan, bukti opsional/wajib sesuai tipe, status pengajuan terlihat | M |
| ATT-008 | Review koreksi: setujui/tolak + catatan; catatan asli tetap utuh; semua tercatat audit | M |
| ATT-009 | Ringkasan harian/mingguan/bulanan: jumlah & persentase on\_time, grace, late, izin, sakit, belum check-in | M |
| ATT-010 | Konfigurasi kebijakan: hari operasional, jam batas, jendela check-in, kalender non-operasional — berversi dan beraudit | M |
| ATT-011 | **[v1.1 — penundaan Must disetujui pengguna 2026-11-13, §16]** Antrean peninjauan "Belum Check-in" untuk hari yang telah ditutup, agar penanggung jawab menetapkan penanganan (OD-002) | M |
| ATT-012 | Keterangan izin/sakit: diajukan pengguna (atau diinput pereview atas nama pengguna) + persetujuan | S |
| ATT-013 | **[NOW — OPS-12, 2026-11-13]** Pengingat check-in (in-app) sebelum 08.00 bagi yang belum check-in; dapat dinonaktifkan per pengguna melalui satu toggle | M (asal S; dinaikkan oleh keputusan pengguna) |
| ATT-014 | Ekspor rekap (CSV/Excel) oleh yang berwenang, beraudit | S |
| ATT-015 | **[v1.1 — disetujui 2026-11-13]** Tampilan "belum check-in" langsung (live) bagi pengurus pada rentang 08.00–09.00 | S |
| ATT-016 | Penandaan pengecualian kegiatan khusus pada tanggal tertentu (OD-012) | S |
| ATT-017 | **[v1.1 — disetujui 2026-11-13]** Input manual oleh pengurus untuk kasus teknis (sistem down) dengan alasan wajib & audit, ditandai `source = manual` | S |
| ATT-018 | **[v1.1 — disetujui 2026-11-13]** Penanda perangkat/jam aneh (selisih jam klien > ambang) untuk peninjauan, bukan penolakan | C |

---

## 6. Alur Koreksi dan Keterangan

### 6.1 State Machine Koreksi

`pending → approved | rejected | cancelled` (pembatalan oleh pemohon hanya saat `pending`). Transisi akhir tidak dapat diubah; kesalahan keputusan dikoreksi dengan pengajuan baru atau keputusan susulan beraudit oleh peran lebih tinggi **\[REKOMENDASI\]**.

### 6.2 Jenis Koreksi

| Jenis | Contoh | Hasil bila disetujui |
| --- | --- | --- |
| Lupa check-in padahal hadir | Check-in tidak tercatat | Status efektif `on_time/grace/late` sesuai keputusan pereview (bukan otomatis `on_time`) |
| Gangguan teknis | Aplikasi error | Sama; ditandai `technical` |
| Salah klasifikasi | Terlambat karena tugas pondok | Ubah menjadi `grace/on_time` dengan alasan |
| Izin/sakit | Surat/keterangan | Status efektif `excused/sick` |

### 6.3 Aturan

- Pemohon tidak boleh menyetujui koreksi miliknya sendiri.
- **[NOW, 2026-11-13]** Pereview koreksi wajib pengurus+ (pengurus/yayasan/super_admin) yang berwenang; koordinator saja tidak cukup. Asal: pereview ditentukan penugasan (PRD-07), fallback pengurus (OD-004); penugasan kini harus tunduk pada batas role ini.
- Jumlah level persetujuan **configurable** (default 1); tabel `approval_policies` menyimpan aturan sehingga OD-004 dapat diputuskan tanpa mengubah skema.
- Batas pengajuan: maksimal N hari setelah tanggal terkait (default 7, configurable).
- Bukti: file via Storage privat; wajib/tidaknya mengikuti jenis (configurable).

---

## 7. Penutupan Hari dan Job Terjadwal

| Job | Waktu (WIB) | Fungsi |
| --- | --- | --- |
| Pengingat check-in | mis. 07.30 | Notifikasi bagi wajib absen yang belum check-in |
| Penutupan hari | mis. 00.30 hari berikutnya | Hitung `attendance_daily_snapshot` untuk tanggal kemarin: status efektif, termasuk `no_checkin` |
| Hitung ulang setelah koreksi | Event-driven | Perbarui snapshot tanggal terkait |

Job bersifat **idempoten** (aman dijalankan ulang), mencatat hasil ke log job, dan memberi alarm jika gagal. Snapshot hanya akselerator laporan; sumber kebenaran tetap `attendance_records` + keterangan + koreksi.

---

## 8. Hak Akses

| Permission | Santri | Koord. | Pengurus | Yayasan | S.Admin |
| --- | --- | --- | --- | --- | --- |
| `attendance.checkin` | ✓ | ✓ | ✓ (bila wajib) | opsional | — |
| `attendance.record.read` | own | team | all/assigned | all | — |
| `attendance.correction.request` | own | own | own | own | — |
| `attendance.correction.review` (NOW 2026-11-13; asal koordinator opsional) | — | — | assigned/all | berwenang (pengurus+) | berwenang (pengurus+) |
| `attendance.exception.manage` | — | — | ✓ | — | — |
| `attendance.manual_entry` | — | — | ✓ | — | — |
| `attendance.policy.manage` | — | — | — | ✓ (persetujuan) | ✓ (eksekusi) |
| `attendance.report.export` | — | — | ✓ | ✓ | — |

**RLS:** pengguna biasa hanya `SELECT` baris miliknya dan **tidak** punya `INSERT/UPDATE/DELETE` langsung pada `attendance_records` — hanya lewat RPC `attendance_check_in()`. Perubahan kebijakan memerlukan dua langkah: usulan oleh admin, persetujuan pihak berwenang (Yayasan) sesuai Master §16.

---

## 9. Persyaratan Layar

| Layar | Isi |
| --- | --- |
| Dashboard Santri (widget) | Tombol Check-in, status hari ini, jam server, hitung mundur ke batas |
| Hasil Check-in | Waktu tercatat + klasifikasi + tombol "Lihat riwayat" |
| Riwayat Saya | Kalender berwarna (hijau/kuning/merah/abu) + daftar + tombol ajukan koreksi |
| Ajukan Koreksi/Keterangan | Form singkat + unggah bukti |
| Monitoring Harian | Tabel per scope, filter, status "belum check-in" |
| Antrean Review Koreksi | Daftar pending, detail, setujui/tolak |
| Antrean Peninjauan Belum Check-in [v1.1 — ATT-011] | Hari tertutup yang butuh keputusan; penundaan Must disetujui 2026-11-13 |
| Rekap | Mingguan/bulanan + ekspor |
| Pengaturan Kebijakan | Jam batas, hari operasional, libur, versi & riwayat |

Warna tidak boleh menjadi satu-satunya penanda (aksesibilitas): sertakan ikon/teks ("Tepat Waktu", "Toleransi", "Terlambat").

---

## 10. Notifikasi

| Event | Penerima | Kanal |
| --- | --- | --- |
| `attendance.checkin_reminder` | Belum check-in | In-app (+ push saat PWA) |
| `attendance.correction_requested` | Pereview | In-app |
| `attendance.correction_decided` | Pemohon | In-app |
| `attendance.review_needed` | Penanggung jawab | In-app (ringkasan harian) |

---

## 11. Edge Case

| Kasus | Perilaku |
| --- | --- |
| Tap ganda / koneksi lambat | Idempoten; satu record |
| Tepat 08:00:xx / 08:15:xx / 08:16:00 | Sesuai BR-ATT-09; tercakup tes batas |
| Jam perangkat salah | Tidak berpengaruh; selisih disimpan diagnostik |
| Check-in pukul 23:59:59 lalu 00:00:01 | Tanggal ditentukan jam WIB server saat insert; dua tanggal berbeda = dua record sah |
| Pengguna berperan ganda (santri+koordinator) | Satu kewajiban absensi, satu record per tanggal |
| Hari libur mendadak diumumkan setelah check-in | Record tetap; tanggal ditandai non-operasional; statistik mengecualikan sesuai kebijakan |
| Perubahan kebijakan di tengah bulan | Record lama tetap memakai versi lama; rekap menampilkan versi yang berlaku per tanggal |
| Pengguna disuspend/dinonaktifkan | Dikeluarkan dari kewajiban mulai tanggal efektif; riwayat tetap |
| Santri baru bergabung di tengah bulan | Dihitung mulai `attendance_required_from` |
| Pereview dan pemohon orang yang sama | Ditolak; diarahkan ke pereview lain |
| Job penutupan gagal | Alarm; dapat dijalankan ulang untuk tanggal tertentu |
| Zona waktu cabang di luar WIB (masa depan) | Timezone disimpan per kebijakan; belum didukung per pengguna di R2 |

---

## 12. Kriteria Penerimaan

1. Pengguna dapat check-in sendiri; waktu tercatat adalah waktu server; klien tidak dapat memengaruhi klasifikasi (tes manipulasi payload/jam).
2. Hasil uji batas: 08:00:00 & 08:00:59 → `on_time`; 08:01:00 & 08:15:59 → `grace`; 08:16:00 → `late` (sesuai OD-013 setelah dikonfirmasi).
3. Hari Minggu/non-operasional tidak menimbulkan kewajiban dan check-in ditolak dengan pesan jelas.
4. Check-in berulang pada tanggal yang sama tidak membuat record baru (tes konkurensi: 20 permintaan paralel → 1 record).
5. Koreksi melalui pengajuan→review; catatan asli tetap utuh; status efektif & audit terlihat.
6. Pengguna tidak dapat menulis langsung ke `attendance_records` (tes RLS).
7. Rekap harian/mingguan/bulanan konsisten dengan data sumber (rekonsiliasi sampel).
8. Hari ditutup menghasilkan status `no_checkin` tanpa menandainya alpa; **[v1.1 — ATT-011, penundaan M disetujui 2026-11-13]** muncul di antrean peninjauan.
9. Mengubah kebijakan tidak mengubah klasifikasi data historis.
10. Uji beban: 100% pengguna check-in dalam 5 menit tanpa error pada ukuran pengguna yang diasumsikan (OD-019).

---

## 13. Rencana Tes

| Jenis | Skenario |
| --- | --- |
| pgTAP | Klasifikasi semua batas; `ON CONFLICT`; larangan tulis langsung; view efektif; kebijakan berversi |
| Unit | Util format waktu, pemetaan status ke label |
| Konkurensi | 20–100 check-in paralel pengguna sama & berbeda |
| E2E | Check-in → riwayat; koreksi disetujui/ditolak; hari Minggu |
| Beban | Simulasi lonjakan 07.55–08.15 |
| Zona waktu | Peralihan tanggal 23:59→00:00 WIB, server di UTC |

---

## 14. Dependensi dan Keputusan Terbuka

**Bergantung pada:** IAM (status aktif), PPL (kewajiban absen, pereview), Master (kebijakan berversi, audit, notifikasi).

| ID | Keputusan | Default sementara |
| --- | --- | --- |
| OD-002 | Status final tanpa check-in | `no_checkin` + antrean peninjauan |
| OD-004 | Wewenang persetujuan koreksi | **NOW 2026-11-13: pengurus+ berwenang, bukan koordinator saja**; asal pereview ditugaskan, 1 level configurable |
| OD-007 | Izin/cuti & kewajiban | Keterangan disetujui menghapus kewajiban hari itu |
| OD-012 | Pengecualian kegiatan khusus | Kalender non-operasional/pengecualian |
| OD-013 | Batas detik | Dipotong ke menit |
| OD-015 | Jendela buka/tutup check-in | 04.00–23.59 |
| OD-024 | Apakah pengurus/yayasan wajib absen | Tidak, kecuali flag diaktifkan |
| OD-025 | Batas hari pengajuan koreksi | 7 hari |

---

## 15. Metrik Modul

Tingkat kehadiran harian; persentase on\_time / grace / late (didefinisikan di PRD-08 §4); jumlah `no_checkin` per hari; waktu rata-rata review koreksi; jumlah koreksi per bulan; persentase check-in yang berhasil pada percobaan pertama.

---

## 16. Keputusan Audit — 2026-11-13 [TERKONFIRMASI]

Change log 2.1; berlaku sesuai Master §0.4, bukan klaim implementasi selesai.

- **ATT-011: prioritas asal M (baris 126). Pengguna secara eksplisit menyetujui penundaan Must ini ke v1.1**, sehingga antrean peninjauan hari tertutup bukan release gate NOW. Deskripsi, prioritas, layar §9, dan acceptance §12.8 bagian antrean tetap disimpan sebagai v1.1. `no_checkin` tetap status informatif, bukan alpa/keputusan hukuman otomatis; jangan menganggap snapshot sebagai antrean yang sudah tersedia.
- **ATT-015: prioritas asal S (baris 130), v1.1.** Layar live 08.00–09.00 ditunda, tidak disamakan dengan presence/heartbeat. **ATT-017 (S) dan ATT-018 (C) juga v1.1**, dengan alasan/audit serta aturan diagnostik asal dipertahankan.
- **OPS-12 / ATT-013 — M NOW:** naik dari prioritas asal S. Sediakan **satu toggle** pengingat absensi pada preferensi pengguna, tersimpan di server dan hanya dapat diubah pemiliknya. Saat opt-out aktif, jangan mengirim pengingat absensi kepada pengguna itu, baik in-app maupun FCM/push; opt-in memulihkan pengingat berikutnya tanpa mengirim ulang kejadian lama. Tidak perlu pusat preferensi banyak kategori untuk memenuhi keputusan ini; notifikasi keputusan koreksi bukan pengingat absensi dan tidak ikut dibungkam.
- **B / TRC-12 — NOW:** reviewer koreksi = **pengurus+** (pengurus/yayasan/super_admin yang berwenang); koordinator tanpa peran tersebut tidak boleh review. Mengganti baseline koordinator opsional pada §8; penugasan tidak boleh mengangkat kewenangan koordinator. Larangan self-review, catatan asli tak berubah, status efektif, alasan, dan audit tetap wajib.
- **Scheduler:** cron-job.org memicu route terproteksi, sedangkan waktu bisnis memakai WIB; lihat [ADR](docs/ADR-2026-11-13-cron-job-org.md). Keberadaan endpoint tidak membuktikan provider aktif, pengiriman berhasil, atau job penutupan hari lengkap.

Acceptance NOW tambahan: toggle bertahan setelah login ulang; opt-out dihormati setiap jalur pengingat; akun lain tidak dapat mengubahnya; koordinator saja dan pemohon sendiri ditolak saat review. Guard app-layer dan RLS diuji terpisah tanpa melonggarkan policy. Bukti penerimaan masih harus dikumpulkan; tidak ada tes yang dijalankan dalam perubahan dokumentasi ini.
