# PRD-08 — Analytics & Administration

**Versi:** 2.1 · **Keputusan audit:** 2026-11-13 (§17; NOW/v1.1 mengikat cakupan rilis, bukan klaim implementasi) · **Prefix:** ADM · **Rilis:** R4 (konfigurasi & audit dasar dari R1) · **Dibaca bersama:** Master PRD v2.0, seluruh PRD modul **Label:** \[TERKONFIRMASI\] · \[REKOMENDASI\] · \[TERBUKA\]

---

## 1. Tujuan dan Posisi Modul

Menyajikan **ringkasan operasional** dari modul lain dan menyediakan **alat administrasi** (konfigurasi kebijakan, audit, ekspor, backup). Modul ini *tidak menggantikan* data sumber: dashboard adalah lapisan presentasi, bukan sumber kebenaran (Master Lampiran A.6).

**Tujuan**

1. Visibilitas operasional bagi yang berwenang tanpa menyusun laporan manual.
2. Definisi metrik yang **tunggal dan konsisten** di seluruh platform.
3. Konfigurasi kebijakan yang berversi dan beraudit.
4. Audit log yang dapat dipercaya.
5. Ekspor terkendali dan pemulihan data yang terbukti.

**Bukan tujuan:** skor kinerja individu otomatis/AI, peringkat/leaderboard santri, BI umum (kueri bebas), integrasi data warehouse.

**Pembagian rilis:** audit log, pengaturan kebijakan, dan backup dasar harus ada **sejak R1/R2** karena modul lain bergantung padanya. Dasbor analitik dan ekspor lengkap masuk R4.

---

## 2. Prinsip dan Aturan Bisnis

| ID | Aturan | Label |
| --- | --- | --- |
| BR-ADM-01 | Seluruh angka analitik harus dapat ditelusuri ke record sumber (drill-down sampai daftar record, sesuai hak akses) | REKOMENDASI |
| BR-ADM-02 | Analitik menghormati hak akses: pengguna hanya melihat agregat atas data yang berhak ia lihat | TERKONFIRMASI (PRD v1.0 — "respects permissions") |
| BR-ADM-03 | Setiap metrik punya definisi tertulis (§4); tidak ada angka tanpa rumus | REKOMENDASI |
| BR-ADM-04 | Statistik tidak digunakan sebagai penilaian kinerja otomatis atau peringkat orang | TERKONFIRMASI (Out of scope PRD v1.0) |
| BR-ADM-05 | Kebijakan operasional (jam, hari, tenggat) berversi: perubahan berlaku ke depan (`effective_from`) dan tidak mengubah data historis | REKOMENDASI (Master §5.3) |
| BR-ADM-06 | Perubahan kebijakan yang telah terkonfirmasi memerlukan persetujuan pihak berwenang (usulan → persetujuan → aktif) | TERKONFIRMASI (Master §16) |
| BR-ADM-07 | Audit log append-only; tidak seorang pun (termasuk Super Admin) dapat mengubah atau menghapus entri lewat aplikasi | REKOMENDASI |
| BR-ADM-08 | Setiap ekspor data pribadi tercatat (siapa, apa, kapan, filter) | REKOMENDASI |

BR-ADM-04 penting: data absensi/laporan sensitif secara sosial bagi santri; menampilkan peringkat atau label "terburuk" menimbulkan risiko non-teknis. Dasbor fokus pada **pola dan kebutuhan tindak lanjut**, bukan penghakiman.

---

## 3. Arsitektur Data Analitik

| Lapisan | Pendekatan | Alasan |
| --- | --- | --- |
| Sumber | Tabel modul (`attendance_*`, `daily_reports`, `tasks`, dst.) | Satu sumber kebenaran |
| Agregasi | **View SQL** untuk metrik ringan; **materialized view / tabel snapshot** untuk metrik berat; di-refresh oleh job | Dasbor cepat tanpa membebani saat jam puncak |
| Otorisasi | View memakai `security_invoker` / fungsi agregasi ber-RLS; atau RPC yang memfilter cakupan pemanggil | Hindari kebocoran lewat agregat |
| Penyajian | Komponen grafik (mis. Recharts) membaca RPC/view; tidak ada perhitungan metrik di klien | Konsistensi angka |
| Ekspor | Route Handler server-side + antrean untuk data besar | Tidak membebani UI |

**Aturan beban:** kueri analitik berat **tidak boleh** berjalan pada jendela puncak 07.45–08.30 dan 20.30–21.15 WIB. Refresh materialized view dijadwalkan di luar jendela itu (mis. 00.30‐05.00). Tampilan "live" pada jam puncak hanya memakai query ringan terindeks (mis. daftar belum check-in).

**Cakupan data (scope) agregat:** ringkasan per tim hanya bagi koordinator timnya; ringkasan organisasi bagi Pengurus/Yayasan; **sel dengan jumlah sangat kecil** (< 3 orang) pada irisan sensitif diberi tanda atau digabung agar individu tidak dapat diidentifikasi secara tak sengaja **\[REKOMENDASI\]**.

---

## 4. Definisi Metrik (Sumber Tunggal)

Semua modul dan dasbor memakai definisi ini. Notasi: **Populasi wajib** = pengguna aktif dengan kewajiban pada tanggal tersebut (flag PPL), pada hari operasional, **dikurangi** yang berstatus izin/sakit disetujui.

### 4.1 Absensi

| Metrik | Rumus | Catatan |
| --- | --- | --- |
| Tingkat check-in | pengguna wajib yang punya check-in ÷ populasi wajib |  |
| Tingkat tepat waktu | `on_time` ÷ populasi wajib | Penyebut sama untuk semua rasio agar dapat dijumlahkan |
| Tingkat toleransi | `grace` ÷ populasi wajib | Dibedakan dari tepat waktu (BR-ATT-07) |
| Tingkat terlambat | `late` ÷ populasi wajib |  |
| Tingkat belum check-in | `no_checkin` ÷ populasi wajib | Bukan "alpa" (OD-002) |
| Izin / Sakit | jumlah status efektif `excused` / `sick` | Ditampilkan terpisah; tidak masuk penyebut di atas |
| Ketepatan periode | rata-rata harian atau total terbobot hari-orang untuk minggu/bulan | Gunakan **hari-orang** (person-days), bukan rata-rata dari persentase harian |

Semua memakai **status efektif** (setelah koreksi disetujui).

### 4.2 Laporan Aktivitas

| Metrik | Rumus | Catatan |
| --- | --- | --- |
| Tingkat pengumpulan | santri wajib dengan laporan `submitted` ÷ populasi wajib laporan |  |
| Tingkat tepat waktu lapor | `submitted & !is_late` ÷ populasi wajib laporan |  |
| Tingkat terlambat lapor | `submitted & is_late` ÷ populasi wajib laporan |  |
| Belum melapor | populasi wajib tanpa laporan terkirim | Bukan pelanggaran otomatis |
| Backlog review | laporan `submitted` dengan `review_status ∈ {not_reviewed, under_review}` | Ditampilkan dengan usia (hari sejak kirim); **tidak ada target SLA** (BR-REP-06) kecuali ditetapkan |
| Jumlah revisi | laporan `revision_required` + jumlah revisi per laporan |  |
| Persetujuan pertama | disetujui pada kiriman pertama ÷ total disetujui |  |
| Median waktu review | median(`decided_at − last_submitted_at`) | Informasi; bukan KPI pereview |

### 4.3 Tugas

| Metrik | Rumus |
| --- | --- |
| Tugas terbuka | status ∈ {To Do, In Progress, In Review} |
| Tugas selesai (periode) | `completed_at` dalam periode |
| Tugas terlambat | terbuka ∧ `due_date` < hari ini (WIB) |
| Progres proyek | Done ÷ (semua − Cancelled) |
| Median waktu penyelesaian | median(`completed_at − created_at`) |

### 4.4 Resource Library

| Metrik | Rumus |
| --- | --- |
| Pencarian per hari | jumlah kueri pencarian (tanpa menyimpan teks pribadi jika tidak perlu) |
| Pencarian tanpa hasil | kueri dengan 0 hasil ÷ total kueri |
| Kelengkapan dokumentasi | rata-rata (bidang terisi ÷ 6) |
| Resource usang | `updated_at` > ambang (default 180 hari) |

### 4.5 Adopsi dan Operasi Platform

| Metrik | Rumus |
| --- | --- |
| Pengguna aktif harian/mingguan | pengguna dengan sesi/aksi bermakna (check-in, kirim laporan, ubah tugas) |
| Waktu persetujuan akun | median(`decided_at − created_at`) |
| Ketersediaan sistem | waktu aktif ÷ total waktu (dari pemantau uptime) |
| Keberhasilan job | job sukses ÷ job terjadwal |

**Aturan umum:** tanggal memakai WIB; periode "minggu" dimulai Senin; hari non-operasional dikeluarkan dari penyebut; perubahan definisi metrik adalah perubahan dokumen berversi.

---

## 5. Persyaratan Fungsional

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| ADM-001 | **[NOW: dua view, Master §0.4]** Santri/pribadi dan admin gabungan. **[v1.1 — kontrak asal per peran]** Dasbor Pengurus, Yayasan, Koordinator (tim), Super Admin (teknis); rujukan asal Master §8.3 tidak tersedia, lihat §17 | M |
| ADM-002 | Analitik absensi: ringkasan harian, tingkat tepat waktu/toleransi/terlambat/belum check-in, tren mingguan & bulanan, drill-down ke daftar | M |
| ADM-003 | Analitik laporan: tingkat pengumpulan, terlambat, belum melapor, backlog review (dengan usia), revisi | M |
| ADM-004 | Analitik tugas: terbuka, selesai, terlambat, progres proyek | S |
| ADM-005 | **[v1.1 — disetujui 2026-11-13]** Analitik Resource Library: penggunaan, kategori populer, pencarian tanpa hasil, status dokumentasi | C |
| ADM-006 | Ekspor CSV/XLSX/PDF untuk rekap yang diizinkan; ekspor beraudit, berbatas baris, dapat berjalan asinkron | M |
| ADM-007 | Pengaturan sistem berversi: hari operasional, jam absensi, jendela check-in, tenggat laporan, zona waktu, kalender non-operasional, ambang pengingat, kategori laporan, batas file | M |
| ADM-008 | Audit log: penelusuran dengan filter (aktor, aksi, entitas, tanggal), tampilan sebelum/sesudah ter-redaksi | M |
| ADM-009 | Backup & pemulihan terdokumentasi dan teruji (§8) | M |
| ADM-010 | Alur usulan→persetujuan perubahan kebijakan (dua langkah) dengan pratinjau dampak | S |
| ADM-011 | Pemantauan kesehatan sistem: status job terjadwal, antrean notifikasi, kegagalan terbaru (tanpa membuka data pribadi) | S |
| ADM-012 | Manajemen kategori/tag/daftar referensi (kategori laporan, kategori acara) dari satu pusat | S |
| ADM-013 | **[v1.1 — disetujui 2026-11-13]** Rekap periodik otomatis (mingguan ke Pengurus; bulanan ke Yayasan) sebagai notifikasi/PDF | C |
| ADM-014 | Pembekuan periode (period lock): bulan yang sudah direkap resmi tidak dapat dikoreksi tanpa otorisasi khusus beraudit | C |
| ADM-015 | Konfigurasi retensi data dan antrean pemusnahan terjadwal (diaktifkan hanya setelah OD-006 diputuskan) | W (ditunda) |
| ADM-016 | Kontrol akses ekspor: izin ekspor per jenis data, batas frekuensi | S |
| ADM-017 | **[v1.1 — disetujui 2026-11-13]** Halaman "Tentang Data": definisi metrik (§4) dapat dibaca pengguna berwenang di dalam aplikasi | S |

---

## 6. Pengaturan dan Kebijakan Berversi

### 6.1 Struktur

| Tabel | Kolom kunci | Catatan |
| --- | --- | --- |
| `policy_versions` | `id, effective_from, status (draft\|pending_approval\|active\|superseded), proposed_by, approved_by, approved_at, payload jsonb, change_reason` | Satu versi aktif per tanggal; riwayat tidak dihapus |
| `system_settings` | `key, value jsonb, updated_by, updated_at` | Setelan non-kebijakan (batas file, ambang) |
| `non_operational_dates` | (lihat PRD-03) | Terkelola dari sini juga |
| `reference_lists` | `list_key, item_key, label, sort_order, is_active` | Kategori configurable |

### 6.2 Alur Perubahan Kebijakan

```
Draft (admin)  →  Usul (pending_approval)  →  Disetujui pihak berwenang  →  Aktif pada effective_from
                          ↓ ditolak/dibatalkan                                   ↓
                       Draft                                          versi lama = superseded
```

- `effective_from` hanya boleh **hari ini atau masa depan**; tidak ada perubahan mundur yang menulis ulang klasifikasi lama.
- Pratinjau dampak: menampilkan perkiraan akibat (mis. "memajukan batas absensi ke 07.45 akan mengubah klasifikasi X pengguna jika berlaku pada data 30 hari terakhir").
- Siapa "pihak berwenang" penyetuju adalah keputusan OD-020/OD-037 (default: Yayasan menyetujui, Super Admin mengeksekusi).
- Perubahan kebijakan yang telah terkonfirmasi (Master §5.1) menampilkan peringatan khusus dan butuh alasan tertulis.

---

## 7. Audit Log

| Atribut | Ketentuan |
| --- | --- |
| Penyimpanan | `audit.audit_logs`, append-only (REVOKE UPDATE/DELETE; hanya fungsi pencatat) |
| Partisi | Per bulan (partisi deklaratif) agar kueri dan arsip efisien |
| Isi | `occurred_at, actor_id, actor_role_snapshot, action, entity_type, entity_id, before, after, reason, request_id, source (ui\|job\|import\|admin_tool)` |
| Redaksi | Kolom sensitif (kontak, isi laporan) disamarkan di `before/after`; hanya jenis perubahan dan ID dicatat |
| Integritas | **\[REKOMENDASI\]** rantai hash sederhana (hash entri sebelumnya) untuk mendeteksi penyuntingan tersembunyi; ekspor berkala ke penyimpanan terpisah |
| Akses | Super Admin & Yayasan baca; hanya baca; akses ke log itu sendiri dicatat |
| Retensi | Tidak dihapus sampai OD-006 diputuskan; partisi lama dapat diarsipkan (bukan dihapus) |
| Kinerja | Indeks `(entity_type, entity_id)`, `(actor_id, occurred_at)`, `(occurred_at)` |

**Katalog aksi** didaftarkan terpusat (setiap PRD modul menyebut aksi auditnya). Aksi tanpa pendaftaran ditolak di fungsi pencatat agar katalog konsisten.

---

## 8. Backup, Pemulihan, dan Kontinuitas

### 8.1 Target \[REKOMENDASI\]

| Parameter | Target | Cara |
| --- | --- | --- |
| RPO | ≤ 24 jam (dasar); ≤ 15 menit jika PITR aktif | Backup harian Supabase + (disarankan) PITR untuk data absensi/laporan |
| RTO | ≤ 4 jam | Runbook pemulihan teruji |
| Salinan eksternal | Mingguan, terenkripsi, di penyimpanan berbeda (mis. object storage terpisah) | `pg_dump` terjadwal + salinan file Storage |
| Uji pemulihan | **Kuartalan** ke proyek staging; hasil dicatat | Backup tanpa uji dianggap tidak ada |

### 8.2 Cakupan

Database (skema + data + fungsi/policy), file Storage, konfigurasi lingkungan (secret disimpan di pengelola rahasia, bukan di repo), dan migrasi (di Git). Kode di GitHub org milik yayasan.

### 8.3 Runbook yang Wajib Ada

1. Pemulihan database penuh.
2. Pemulihan satu tabel/rentang waktu (PITR).
3. Rotasi secret & kunci (jika ada kebocoran).
4. Pencabutan akses massal (akun terkompromi).
5. Penanganan insiden kebocoran data (siapa yang diberi tahu, langkah, dokumentasi).
6. Pemulihan setelah migrasi gagal (rollback).

---

## 9. Ekspor Data

| Aspek | Ketentuan |
| --- | --- |
| Format | CSV (UTF-8 BOM untuk Excel), XLSX, PDF untuk rekap berformat |
| Cakupan | Hanya data dalam hak akses pemanggil; filter dicatat |
| Ukuran | Batas baris sinkron (mis. 5 ribu); di atasnya asinkron: dibuat di server, disimpan di Storage privat, tautan unduhan berumur pendek, notifikasi saat siap |
| Keamanan | Izin khusus per jenis data (`*.export`), batas frekuensi, audit; file ekspor dihapus otomatis setelah N hari (default 7) |
| Proteksi CSV injection | Sel diawali `=`, `+`, `-`, `@` di-escape agar tidak menjadi formula |
| Konsistensi | Kolom dan rumus ekspor sama dengan definisi §4 |
| Nama file | `pondokos-<jenis>-<periode>-<timestamp>.<ext>` |

---

## 10. Hak Akses

| Permission | Santri | Koord. | Pengurus | Yayasan | S.Admin |
| --- | --- | --- | --- | --- | --- |
| `analytics.team.read` | — | tim | ✓ | ✓ | — |
| `analytics.org.read` | — | — | ✓ | ✓ | terbatas (teknis) |
| `analytics.drilldown` | — | tim | sesuai scope | sesuai scope | — |
| `analytics.export` | — | — | ✓ | ✓ | — |
| `admin.policy.propose` | — | — | — | — | ✓ |
| `admin.policy.approve` | — | — | — | ✓ | — |
| `admin.settings.manage` | — | — | — | — | ✓ |
| `admin.audit.read` | — | — | — | ✓ | ✓ |
| `admin.health.read` | — | — | — | — | ✓ |

**Catatan:** santri tidak mendapat dasbor organisasi; mereka melihat ringkasan **pribadi** pada dashboard masing-masing (bagian dari modul asal, bukan dari ADM).

---

## 11. Persyaratan Layar

| Layar | Pengguna | Isi |
| --- | --- | --- |
| Dasbor Pengurus (NOW: admin gabungan, §17) | Pengurus; Yayasan/Super Admin sesuai scope | Absensi hari ini, laporan belum masuk, backlog review, tugas terlambat; view tidak memperluas izin |
| Dasbor Yayasan [v1.1 — view terpisah] | Yayasan | Tren mingguan/bulanan, kepatuhan, ringkasan antrean |
| Dasbor Tim [v1.1 — view khusus] | Koordinator | Ringkasan tim: absensi, laporan, tugas |
| Analitik Absensi / Laporan / Tugas | Berwenang | Grafik + filter periode/tim + drill-down |
| Ekspor | Berwenang | Pilih jenis, periode, format; riwayat ekspor |
| Pengaturan Kebijakan | Admin / Yayasan | Versi aktif, draft, usulan, riwayat, pratinjau dampak |
| Audit Log | Admin / Yayasan | Pencarian + filter + detail |
| Kesehatan Sistem | Super Admin | Status job, antrean, error ringkas |
| Tentang Data | Berwenang | Definisi metrik |

UX: setiap grafik punya tabel alternatif dan label teks (aksesibilitas); tooltip menyebut jumlah mentah dan penyebut; periode default = minggu berjalan; kosong/tidak ada data diberi pesan jelas, bukan angka 0 menyesatkan.

---

## 12. Edge Case

| Kasus | Perilaku |
| --- | --- |
| Perubahan kebijakan di tengah periode rekap | Rekap memakai versi yang berlaku per tanggal; laporan menampilkan penanda perubahan |
| Pengguna masuk/keluar di tengah periode | Penyebut menyesuaikan `required_from`/`left_on` |
| Koreksi absensi disetujui setelah rekap bulanan dibuat | Rekap diperbarui, atau ditandai "direvisi" bila period lock aktif |
| Materialized view belum refresh | Dasbor menampilkan "Data per \<waktu>" |
| Ekspor besar gagal di tengah | Status gagal, tanpa file parsial, dapat diulang |
| Pengguna berwenang tim membuka drill-down di luar timnya | Ditolak oleh RLS; tidak ada kebocoran lewat agregat |
| Kelompok < 3 orang | Diberi tanda/digabung (§3) |
| Audit partisi bulan baru | Dibuat otomatis oleh job; alarm jika gagal |
| Perubahan definisi metrik | Versi dokumen naik; dasbor tidak mengubah data historis kecuali dihitung ulang dengan pemberitahuan |
| Dua orang menyetujui kebijakan bersamaan | Satu berhasil; lainnya menerima konflik |

---

## 13. Kriteria Penerimaan

1. Setiap angka dasbor dapat di-drill-down ke daftar record yang menghasilkannya, dan jumlahnya sama (rekonsiliasi sampel lulus).
2. Metrik absensi/laporan sesuai §4 untuk skenario uji (dataset sintetis dengan hasil yang diketahui).
3. Pengguna hanya melihat agregat dalam scope-nya (tes RLS: koordinator tim A tidak melihat tim B).
4. Ekspor dibatasi hak akses, tercatat audit, dan melindungi dari CSV injection.
5. Perubahan kebijakan memerlukan usulan dan persetujuan; versi lama tetap berlaku untuk data historis.
6. Audit log tidak dapat diubah/dihapus lewat aplikasi (tes percobaan `UPDATE/DELETE` gagal).
7. Backup harian berjalan; **uji pemulihan** ke staging berhasil dan terdokumentasi sebelum R4 dinyatakan selesai.
8. Dasbor memuat ≤ 3 dtk untuk data satu bulan pada ukuran pengguna yang diasumsikan; refresh berat tidak berjalan pada jam puncak.

---

## 14. Rencana Tes

| Jenis | Skenario |
| --- | --- |
| pgTAP | Rumus metrik dengan dataset sintetis; RLS agregat; append-only audit; versi kebijakan aktif per tanggal |
| Unit | Konversi hari-orang; escape CSV; pembulatan persentase |
| E2E | Ubah kebijakan (usul→setuju→aktif); ekspor asinkron; filter audit |
| Operasional | Latihan pemulihan di staging; simulasi job gagal & alarm |
| Beban | Dasbor pada jam non-puncak dan puncak dengan data 12 bulan |

---

## 15. Dependensi dan Keputusan Terbuka

**Bergantung pada:** semua modul (sumber data), IAM (hak akses), Master (audit, kebijakan berversi, NFR).

| ID | Keputusan | Default sementara |
| --- | --- | --- |
| OD-006 | Retensi data | Tidak ada penghapusan otomatis; ADM-015 ditunda |
| OD-037 | Siapa pihak berwenang penyetuju perubahan kebijakan | Yayasan menyetujui; Super Admin mengeksekusi |
| OD-038 | Target SLA review laporan (jika ada) | Tidak ada; hanya metrik usia backlog |
| OD-039 | Ambang kerahasiaan agregat (kelompok kecil) | < 3 orang |
| OD-040 | Frekuensi & penerima rekap otomatis | Mingguan Pengurus, bulanan Yayasan |
| OD-041 | Apakah PITR diaktifkan (biaya) | Disarankan untuk produksi |

---

## 16. Metrik Modul

Keberhasilan job terjadwal; waktu muat dasbor p75; jumlah ekspor per bulan dan ukuran; kegagalan pemulihan pada uji kuartalan (target 0); jumlah perubahan kebijakan per kuartal; jumlah entri audit tanpa pelaku (target 0 selain job sistem).

---

## 17. Keputusan Audit — 2026-11-13 [TERKONFIRMASI]

Change log 2.1; keputusan pengguna berikut mengikuti Master §0.4, tanpa klaim implementasi/operasi terverifikasi.

- **TRC-30 / ADM-001 — NOW:** cukup **dua view awal**, yaitu santri/pribadi (termasuk koordinator pada beranda awal) dan admin gabungan (pengurus/yayasan/super_admin). Pemilihan view tidak memberi tambahan izin: agregat, detail, dan aksi tetap mengikuti role/scope, termasuk pembatasan teknis Super Admin. **v1.1:** dashboard khusus koordinator per tim, ringkasan strategis Yayasan, dan dashboard teknis Super Admin terpisah. Kontrak asal per peran dan layar §11 dipertahankan sebagai v1.1; rujukan lama "Master §8.3" tidak ada, acuan keputusan yang benar Master §0.4.
- **C — v1.1:** ADM-005 (analitik Library), ADM-013 (rekap otomatis periodik), ADM-017 (halaman Tentang Data). Rumus metrik tetap terdokumentasi di §4 walau halaman dalam aplikasi ditunda. ADM-015 tetap W sesuai keputusan retensi semula; tidak diaktifkan lewat revisi ini.
- **Operasi NOW:** FCM, presence/heartbeat, dan cron-job.org diakui; Android wrapper ada tetapi di luar release gate. Ikuti [ADR scheduler](docs/ADR-2026-11-13-cron-job-org.md). `/api/cron/backups` menghasilkan **manifest metadata, bukan backup database/Storage atau bukti restore**; ADM-009 tetap membutuhkan bukti backup nyata dan pemulihan terpisah.
- **Kontrol NOW:** guard app-layer + guard tests untuk akses agregat/ekspor, RLS defense-in-depth tidak boleh dilonggarkan. Semua Super Admin existing wajib mengaktifkan dan memverifikasi TOTP secara manual sebagai release gate; enforcement MFA login tetap **v1.1**. Aktivasi faktor bukan bukti enforcement.
- **Interim tim:** PPL-002 v1.1; SQL operator menggunakan [runbook tim](docs/operator-team-sql.md). Audit operasi privileged wajib menyimpan aktor manusia, alasan, referensi perubahan, sebelum/sesudah yang aman; jangan menganggap bypass RLS oleh service-role sebagai kontrol akses atau audit otomatis.

Acceptance NOW: dua view tidak membocorkan data lintas scope; release gate TOTP manual memiliki bukti; heartbeat/job dan backup dibuktikan terpisah. Dokumen ini bukan hasil tes, operasi provider, atau eksekusi SQL.
