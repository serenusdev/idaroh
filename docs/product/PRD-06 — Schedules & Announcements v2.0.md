# PRD-06 — Schedules & Announcements

**Versi:** 2.1 · **Keputusan audit:** 2026-11-13 (§13; NOW/v1.1 mengikat cakupan rilis, bukan klaim implementasi) · **Prefix:** SCH · **Rilis:** R3 · **Dibaca bersama:** Master PRD v2.0, PRD-01, PRD-07 **Label:** \[TERKONFIRMASI\] · \[REKOMENDASI\] · \[TERBUKA\]

---

## 1. Tujuan dan Posisi Modul

Menjadi **satu sumber** untuk jadwal kegiatan dan pengumuman internal, menggantikan pengumuman yang tercecer di grup WhatsApp. Pengguna hanya melihat informasi yang relevan baginya.

**Tujuan**

1. Satu kalender kegiatan pondok yang konsisten.
2. Pengumuman tertarget (semua, peran, tim, individu).
3. Perubahan jadwal sampai ke orang yang terdampak.
4. Riwayat pengumuman tetap dapat ditelusuri.

**Bukan tujuan (R3):** sinkronisasi dua arah dengan Google Calendar, RSVP kompleks/tiket, pemesanan ruangan, siaran massal ke nomor di luar sistem, balasan/obrolan (bukan aplikasi chat).

**Hubungan dengan modul lain:** hari non-operasional/pengecualian absensi (PRD-03) dapat bersumber dari kalender ini; kelak jadwal dapat memicu pengecualian. Di R3 keduanya **dihubungkan secara manual** (admin menandai) agar tidak menciptakan ketergantungan tersembunyi.

---

## 2. Aturan Bisnis

| ID | Aturan | Label |
| --- | --- | --- |
| BR-SCH-01 | Acara punya audiens target; pengguna di luar audiens tidak melihatnya | TERKONFIRMASI (PRD v1.0) |
| BR-SCH-02 | Pengumuman memiliki siklus: Draft → Published → Archived | TERKONFIRMASI |
| BR-SCH-03 | Pengumuman target dapat: semua pengguna, peran tertentu, tim tertentu, individu terpilih | TERKONFIRMASI |
| BR-SCH-04 | Perubahan jadwal memicu notifikasi ke audiens | TERKONFIRMASI |
| BR-SCH-05 | Audiens dihitung saat **tayang** (snapshot penerima) dan tidak otomatis berubah untuk notifikasi yang sudah terkirim; tampilan mengikuti keanggotaan terkini | REKOMENDASI |
| BR-SCH-06 | Pengumuman terbit tidak dihapus; hanya diarsipkan. Koreksi isi dicatat sebagai revisi dengan penanda "diperbarui" | REKOMENDASI |
| BR-SCH-07 | Pengumuman penting dapat ditandai `priority = important` dan *dipinned*, dengan tanggal kedaluwarsa | REKOMENDASI |
| BR-SCH-08 | Semua waktu ditampilkan WIB; acara menyimpan `starts_at/ends_at` bertipe `timestamptz` atau `all_day` bertipe `date` | REKOMENDASI |
| BR-SCH-09 | Pembuat tidak dapat menargetkan audiens di luar scope kewenangannya (koordinator hanya timnya) | REKOMENDASI |

---

## 3. Model Data

| Tabel | Kolom kunci | Catatan |
| --- | --- | --- |
| `events` | `id, title, description, starts_at, ends_at, all_day, location, organizer_id, team_id?, category, status (scheduled\|cancelled), recurrence_rule?, recurrence_until?, created_by, created_at, updated_at, deleted_at` | Satu baris untuk seri berulang |
| `event_exceptions` | `event_id, occurrence_date, action (cancelled\|modified), override_fields jsonb` | Pengecualian pada kemunculan seri |
| `event_audiences` | `event_id, audience_type (all\|role\|team\|user), target_id` | Banyak baris per acara |
| `event_attachments` | `event_id, file_id` | Storage privat |
| `event_reminders` | `event_id, offset_minutes, channel` | Mis. 60 menit sebelum |
| `announcements` | `id, title, body_markdown, priority, status (draft\|published\|archived), published_at, expires_at, pinned, author_id, team_id?, created_at, updated_at` | `body` disanitasi |
| `announcement_audiences` | `announcement_id, audience_type, target_id` | Sama seperti acara |
| `announcement_revisions` | `announcement_id, revision_no, snapshot, changed_by, changed_at` | Jejak perubahan |
| `announcement_reads` | `announcement_id, user_id, read_at` | Penanda baca (S) |
| `announcement_attachments` | `announcement_id, file_id` |  |
| `calendar_markers` | `date, type (non_operational\|special_activity), name, scope` | Disinkronkan manual dengan PRD-03 |

**[v1.1 — konsolidasi model, UX-23; 2026-11-13] Kontrak asal:** audiens efektif dihitung di database oleh fungsi `app.user_in_audience(user_id, audience_type, target_id)` yang dipakai RLS dan job notifikasi, agar satu definisi dipakai di semua tempat. Ini target konsolidasi, bukan klaim seluruh UI/jalur sudah konsisten; pembatasan audiens server dan RLS tetap NOW (§13).

**Perulangan:** gunakan aturan sederhana (harian/mingguan/bulanan) berbasis format RRULE iCalendar; kemunculan diekspansi **saat kueri** untuk rentang tanggal tertentu, bukan disimpan satu per satu. Pengecualian per kemunculan lewat `event_exceptions`.

---

## 4. Persyaratan Fungsional

### 4.1 Jadwal

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| SCH-001 | Buat acara: judul, deskripsi, tanggal, jam mulai/selesai (atau seharian), lokasi, penyelenggara, audiens, tim terkait, lampiran | M |
| SCH-002 | Tampilan kalender (bulan/minggu/agenda) dan daftar; hanya acara relevan bagi pengguna; ponsel default ke tampilan agenda | M |
| SCH-003 | Ubah/batalkan acara oleh yang berwenang; pembatalan menampilkan status "Dibatalkan", bukan menghilang | M |
| SCH-004 | Notifikasi perubahan (waktu/lokasi/batal) ke audiens, memuat apa yang berubah | M |
| SCH-005 | Pengingat acara terkonfigurasi (mis. 1 hari dan 1 jam sebelum) | S |
| SCH-006 | Acara berulang sederhana + pengecualian kemunculan | S |
| SCH-007 | **[NOW — keputusan B, 2026-11-13]** Deteksi bentrok jadwal bagi pembuat untuk penyelenggara/lokasi yang sama: **tolak simpan/ubah** bila bentrok. Asal: peringatan saja, tidak menolak; diganti keputusan ini | C |
| SCH-008 | Penanda hari non-operasional/kegiatan khusus (tautan manual ke ATT) | S |
| SCH-009 | Ekspor/berlangganan kalender iCal pribadi (tautan token berumur panjang, dapat dicabut) | C |
| SCH-010 | Pencarian acara dan filter (tim, kategori, rentang tanggal) | S |

### 4.2 Pengumuman

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| SCH-011 | Buat pengumuman: judul, isi (Markdown ringan), prioritas, audiens, lampiran, kedaluwarsa | M |
| SCH-012 | Penargetan audiens: semua / peran / tim / individu (kombinasi diperbolehkan). **[v1.1 — UX-23]** Konsolidasi model dan UI lengkap; batas scope/kewenangan tetap NOW (§13) | M |
| SCH-013 | Siklus Draft → Published → Archived; jadwal tayang (*scheduled publish*) opsional | M |
| SCH-014 | Feed pengumuman di dashboard; pinned dan penting di atas | M |
| SCH-015 | Penanda sudah dibaca & jumlah pembaca bagi penulis (tanpa mempermalukan; hanya agregat + daftar belum baca bagi yang berwenang) | S |
| SCH-016 | Revisi pengumuman: perbarui isi memberi penanda "diperbarui" dan opsi kirim ulang notifikasi | S |
| SCH-017 | Arsip otomatis setelah kedaluwarsa; pencarian arsip | S |
| SCH-018 | **[v1.1 — disetujui 2026-11-13]** Pratinjau audiens sebelum terbit: jumlah & daftar penerima | S |
| SCH-019 | Pengumuman darurat (`important`): notifikasi lebih menonjol, wajib konfirmasi baca (opsional) | C |
| SCH-020 | **[v1.1 — disetujui 2026-11-13]** Tautan terbagi (deep link) ke satu pengumuman/acara; membuka hanya bila berhak | S |

---

## 5. Hak Akses dan Penargetan

| Permission | Santri | Koord. | Pengurus | Yayasan | S.Admin |
| --- | --- | --- | --- | --- | --- |
| `schedule.event.read` | audiens | audiens | audiens/all | all | — |
| `schedule.event.create/update` | — | team | all | all | — |
| `announcement.read` | audiens | audiens | audiens/all | all | — |
| `announcement.create/publish` | — | team | all | all | — |
| `announcement.archive` | — | milik tim | all | all | — |
| `announcement.read_stats` | — | milik sendiri | all | all | — |
| `schedule.marker.manage` | — | — | ✓ | ✓ | ✓ |

**Batas penargetan (BR-SCH-09):**

- Santri: tidak membuat pengumuman/jadwal.
- Koordinator: audiens terbatas pada tim yang dipimpinnya.
- Pengurus/Yayasan: audiens bebas (semua/peran/tim/individu).
- Pengumuman yang menargetkan `all` oleh koordinator ditolak di database (bukan hanya UI).

**RLS:** baca = anggota aktif **dan** `app.user_in_audience(...)` benar, atau penulis/pengelola; draft hanya terlihat penulis dan pengelola. Penerima individu tidak membocorkan daftar penerima lain kepada sesama penerima.

---

## 6. Notifikasi

| Event | Penerima | Aturan |
| --- | --- | --- |
| `announcement.published` | Audiens | Satu kali saat tayang; `important` bertanda khusus |
| `announcement.updated` | Audiens | Hanya bila penulis memilih "kirim ulang" |
| `event.created` | Audiens | Dapat dinonaktifkan untuk acara rutin berulang |
| `event.changed` | Audiens | Wajib untuk perubahan waktu/lokasi/pembatalan; isi memuat "sebelum → sesudah" |
| `event.reminder` | Audiens | Sesuai konfigurasi |
| `event.cancelled` | Audiens | Segera |

**Aturan anti-banjir:** perubahan beruntun pada acara yang sama dalam 10 menit digabung menjadi satu notifikasi; acara rutin berulang tidak mengirim notifikasi `created` per kemunculan. Pengguna dapat mematikan kategori notifikasi **non-kritis** (pengingat, acara baru) tetapi tidak dapat mematikan pengumuman `important` dan perubahan waktu acara.

**Kanal:** in-app (R3), Web Push saat PWA aktif; WhatsApp ditunda (OD-010). **[2026-11-13]** FCM diakui sebagai penyedia push yang disetujui (§13); provider baru lainnya tetap memerlukan keputusan biaya dan persetujuan.

---

## 7. Persyaratan Layar

| Layar | Isi |
| --- | --- |
| Beranda/Dashboard (feed) | Pengumuman penting & terbaru; acara hari ini/besok |
| Kalender | Bulan / Minggu / Agenda; filter tim & kategori |
| Detail Acara | Waktu (WIB), lokasi, penyelenggara, audiens ringkas, lampiran, status, riwayat perubahan |
| Form Acara | Pemilih audiens, perulangan, pengingat, pratinjau penerima |
| Daftar Pengumuman | Tab: Terbit / Arsip (/ Draft untuk penulis); pencarian |
| Detail Pengumuman | Isi, lampiran, penanda diperbarui, statistik baca (berwenang) |
| Editor Pengumuman | Markdown ringan + pratinjau + audiens + jadwal tayang |

UX: **[v1.1 — SCH-018/UX-23]** pemilih audiens menampilkan **jumlah penerima** secara langsung agar penulis sadar dampaknya; tampilan agenda adalah default di ponsel; label "Dibatalkan"/"Diperbarui" harus mencolok dan tidak hanya mengandalkan warna.

---

## 8. Edge Case

| Kasus | Perilaku |
| --- | --- |
| Pengguna bergabung ke tim setelah pengumuman terbit | Dapat melihat di feed bila pengumuman masih berlaku & audiens mencakup tim; tidak menerima notifikasi retroaktif |
| Pengguna keluar dari tim | Kehilangan akses ke acara/pengumuman tim sejak efektif; riwayat pribadinya (mis. status baca) tetap |
| Acara berulang diubah "hanya kemunculan ini" vs "seluruh seri" | Pengguna memilih eksplisit; perubahan "sejak kemunculan ini" membagi seri |
| Acara melewati tengah malam | Disimpan `timestamptz`; ditampilkan pada kedua tanggal di kalender |
| Acara seharian | Memakai `date`; tidak terpengaruh zona waktu |
| Draft pengumuman dengan audiens kosong | Tidak dapat diterbitkan |
| Audiens > N penerima (mis. semua) | Notifikasi dikirim bertahap (batch) untuk menghindari lonjakan |
| Pembatalan acara yang sudah lewat | Ditolak (arsip saja) |
| Lampiran dihapus dari acara | Soft delete; tautan lama tidak lagi valid |
| Penulis dinonaktifkan | Pengumuman tetap; kepemilikan dapat dipindah oleh pengurus |
| Konten Markdown berbahaya | Disanitasi; tidak ada HTML mentah/skrip |
| Jadwal bertabrakan dengan hari non-operasional | Peringatan informasi saja |

---

## 9. Kriteria Penerimaan

1. Pengguna hanya melihat acara dan pengumuman yang audiensnya mencakup dirinya (tes RLS per jenis audiens: all/role/team/user).
2. Pengguna berwenang dapat membuat, mengubah, membatalkan acara; perubahan memicu notifikasi dengan rincian perubahan.
3. Pengumuman mendukung Draft/Published/Archived; arsip tetap dapat dicari oleh yang berhak.
4. Koordinator tidak dapat menargetkan audiens di luar timnya (tes DB).
5. Kalender menampilkan acara berulang dengan benar, termasuk pengecualian satu kemunculan.
6. Pratinjau audiens menampilkan jumlah penerima yang sama dengan yang dikirimi notifikasi.
7. Notifikasi untuk perubahan beruntun digabung sesuai aturan anti-banjir.
8. Konten Markdown yang memuat skrip tidak dieksekusi.

---

## 10. Rencana Tes

| Jenis | Skenario |
| --- | --- |
| pgTAP | `user_in_audience` untuk semua tipe; RLS draft/terbit; batas penargetan koordinator |
| Unit | Ekspansi RRULE & pengecualian; penggabungan notifikasi; sanitasi Markdown |
| E2E | Buat acara → audiens menerima → ubah jam → notifikasi perubahan; terbit pengumuman terjadwal |
| Zona waktu | Acara lintas tengah malam; seharian; server UTC |
| Beban | Pengumuman ke seluruh pengguna (batch notifikasi) |

---

## 11. Dependensi dan Keputusan Terbuka

**Bergantung pada:** IAM, PPL (tim, peran), Master (notifikasi, file), PRD-03 (penanda non-operasional).

| ID | Keputusan | Default sementara |
| --- | --- | --- |
| OD-010 | Kanal notifikasi | In-app + Web Push; WhatsApp ditunda |
| OD-031 | Apakah jadwal pondok rutin (kajian, halaqah, piket) perlu dimodelkan sebagai acara berulang atau modul terpisah | Acara berulang |
| OD-032 | Apakah perlu konfirmasi baca wajib untuk pengumuman penting | Opsional per pengumuman |
| OD-033 | Siapa yang menandai hari non-operasional | Pengurus (persetujuan Yayasan untuk libur panjang) |

---

## 12. Metrik Modul

Persentase pengumuman terbaca dalam 24 jam; jumlah acara per periode; persentase acara yang berubah setelah terbit (indikator perencanaan); jumlah pengumuman `important`; rasio notifikasi dibuka (bila Web Push aktif).

---

## 13. Keputusan Audit — 2026-11-13 [TERKONFIRMASI]

Change log 2.1; berlaku bersama Master §0.4 dan meng-override baseline hanya pada item berikut.

- **B / SCH-007 — NOW:** konflik jadwal yang terdeteksi ditolak saat simpan/ubah, bukan peringatan yang dapat diteruskan. Baseline "peringatan saja, tidak menolak" disimpan sebagai asal keputusan, bukan perilaku aktif. Peringatan kalender non-operasional (§8) adalah hal berbeda, tidak otomatis menjadi bentrok.
- **UX-23 / SCH-012 — v1.1:** konsolidasi model audiens pengumuman dijadwalkan v1.1. Kontrak tunggal `all/role/team/user`, fungsi audiens bersama, dan UI penargetan lengkap tetap target v1.1. Interim mengakui perbedaan model pada jalur jadwal pengguna dan admin, **bukan menyatakan sudah sinkron**. `member_type` adalah kategori keanggotaan, bukan role otorisasi; jangan memetakan klaim kategori menjadi hak akses. Pembatasan audiens di server, larangan koordinator menargetkan di luar tim, dan RLS tetap berlaku NOW; jangan melonggarkan policy untuk mengakomodasi UI.
- **C — SCH-018 dan SCH-020: v1.1.** Pratinjau jumlah/daftar penerima serta deep link lengkap berikut bagian layar/UX/acceptance terkait ditunda; requirement dan prioritas asal tetap tersimpan.
- **Integrasi diakui:** FCM/push serta cron-job.org untuk pemicu endpoint notifikasi/publikasi terjadwal; [ADR](docs/ADR-2026-11-13-cron-job-org.md). Presence bukan penanda baca, kehadiran, atau izin audiens. Android wrapper bukan release gate.

Acceptance NOW: bentrok ditolak server; tidak ada akses/pengiriman ke audiens di luar kewenangan; guard tests dan RLS diuji terpisah. Acceptance §9.6 pratinjau audiens berlaku **v1.1**. Pernyataan ini tidak membuktikan provider maupun implementasi telah diuji.
