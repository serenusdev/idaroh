# PRD-07 — People & Teams

**Versi:** 2.1 · **Keputusan audit:** 2026-11-13 (§15; NOW/v1.1 mengikat cakupan rilis, bukan klaim implementasi) · **Prefix:** PPL · **Rilis:** R1 (dasar) → R3 (penuh) · **Dibaca bersama:** Master PRD v2.0, PRD-01 **Label:** \[TERKONFIRMASI\] · \[REKOMENDASI\] · \[TERBUKA\]

---

## 1. Tujuan dan Posisi Modul

Mengelola **siapa** anggota organisasi, **tim** apa yang ada, dan **hubungan tanggung jawab** di antara mereka (keanggotaan, koordinator, pereview). Modul ini adalah sumber kebenaran untuk profil dan struktur; IAM mengelola akun dan peran, PPL mengelola identitas organisasi dan relasi.

**Perubahan penting terhadap roadmap v1.0:** PRD awal menaruh People & Teams di Phase 3, tetapi Attendance dan Activity Reports (R2) membutuhkan **penugasan pereview**, **flag kewajiban absen/lapor**, dan **keanggotaan tim**. Maka dibagi:

| Rilis | Cakupan PPL |
| --- | --- |
| **R1 (dasar)** | Profil pengguna, `member_type`, flag kewajiban, riwayat status |
| **R2 (pendukung operasi)** | Penugasan pereview (reviewer assignment) dan tim dasar |
| **R3 (penuh)** | Manajemen tim lengkap, struktur organisasi, riwayat keanggotaan, overview tim |

**Tujuan**

1. Satu profil per orang yang dipakai seluruh modul.
2. Keanggotaan tim yang menentukan cakupan data.
3. Penugasan pereview yang eksplisit dan berversi.
4. Riwayat keanggotaan dan penugasan yang utuh.

**Bukan tujuan:** SDM/payroll, penilaian kinerja, data akademik/nilai, data keluarga/wali yang tidak perlu (minimisasi), pohon organisasi kompleks multi-level.

---

## 2. Konsep Inti

| Konsep | Penjelasan |
| --- | --- |
| **Profil** | Data organisasi seseorang (`profiles`), terhubung 1:1 ke akun auth |
| **Tipe anggota** (`member_type`) | Jenis keanggotaan: `santri`, `ustadz`, `pengurus`, `yayasan`, `staf`, `lainnya` (OD-014). *Atribut deskriptif*, bukan hak akses |
| **Peran** | Hak akses (IAM) — tidak sama dengan tipe anggota |
| **Tim** | Kelompok kerja (mis. Media, Tahfidz, Digital) |
| **Peran tim** | Posisi dalam tim: `coordinator`, `member`, (organisasi-defined) |
| **Penugasan pereview** | Relasi "siapa meninjau siapa", berlaku periode tertentu |
| **Kewajiban** | Flag `attendance_required`, `report_required` dengan tanggal efektif |

**Pembedaan penting (Master Lampiran A.5):** peran pengguna ≠ tanggung jawab tim. Seorang santri (peran `santri`) yang menjadi koordinator tim Media memegang peran `koordinator` ber-scope tim Media; **keanggotaan tim** dan **peran bercakupan** harus selalu sinkron (lihat §4.3).

---

## 3. Aturan Bisnis

| ID | Aturan | Label |
| --- | --- | --- |
| BR-PPL-01 | Pengguna dapat tergabung di satu atau lebih tim | TERKONFIRMASI (PRD v1.0) |
| BR-PPL-02 | Keanggotaan tim menentukan visibilitas data operasional | TERKONFIRMASI |
| BR-PPL-03 | Penugasan pereview menentukan siapa dapat me-review laporan; laporan memakai snapshot pereview saat kirim | TERKONFIRMASI |
| BR-PPL-04 | Riwayat keanggotaan dan penugasan disimpan; tidak ditimpa | TERKONFIRMASI |
| BR-PPL-05 | Setiap tim memiliki 0–1 koordinator utama aktif (dapat dibuat konfigurasi co-koordinator) | REKOMENDASI |
| BR-PPL-06 | Setiap pengguna wajib-lapor harus memiliki tepat **satu** pereview utama aktif pada suatu waktu | REKOMENDASI |
| BR-PPL-07 | Pengguna tidak dapat menjadi pereview dirinya sendiri | REKOMENDASI |
| BR-PPL-08 | Tim tidak dihapus; diarsipkan (`archived_at`) jika tidak dipakai; keanggotaan historis tetap | REKOMENDASI |
| BR-PPL-09 | Perubahan data identitas inti (nama, tipe anggota, kewajiban) dibatasi pada yang berwenang, beraudit | REKOMENDASI |
| BR-PPL-10 | Pengguna dapat mengubah sendiri hanya data kontak/pribadi non-struktural (foto, nama panggilan, nomor HP, bio singkat) | REKOMENDASI |

---

## 4. Model Data

### 4.1 Tabel

| Tabel | Kolom kunci | Catatan |
| --- | --- | --- |
| `profiles` | `id (=auth.users.id), full_name, nickname, member_number?, member_type, status (dari IAM), phone, photo_file_id, bio?, joined_on, left_on?, attendance_required, attendance_required_from, report_required, report_required_from, created_at, updated_at` | Status akun dikelola IAM; data kewajiban dikelola PPL |
| `teams` | `id, name, slug, description, status (active\|archived), parent_team_id? (C), created_by, created_at, archived_at` | Satu tingkat induk bersifat opsional (Could) |
| `team_members` | `id, team_id, user_id, team_role (coordinator\|member\|other), title?, valid_from, valid_to, added_by, removed_by, note` | Riwayat: baris tidak dihapus; `valid_to` mengakhiri |
| `reviewer_assignments` | `id, reviewee_id, reviewer_id, kind (report\|attendance_correction\|task), valid_from, valid_to, assigned_by, reason` | Berversi; tidak tumpang tindih per `reviewee+kind` |
| `profile_change_log` | via audit umum | Perubahan sensitif |
| `member_types` (opsional) | lookup | Jika tipe ingin dikonfigurasi |

Konstrain penting: `EXCLUDE USING gist` (atau `unique partial index`) untuk mencegah dua penugasan pereview aktif tumpang tindih; `check (reviewer_id <> reviewee_id)`.

### 4.2 Data Pribadi (minimisasi)

| Data | Status | Catatan |
| --- | --- | --- |
| Nama lengkap, panggilan | Wajib / opsional |  |
| Nomor anggota (NIS/NIP internal) | Opsional | Jika pondok memakainya |
| Nomor HP | Wajib saat pengajuan (NOW 2026-11-13; asal Opsional) | Tetap privat, hanya untuk yang berwenang; tidak mengarang nilai data lama yang kosong |
| Foto | Opsional | Storage privat |
| Tanggal lahir | **Tidak dikumpulkan di R1** | Ditambah hanya jika ada kebutuhan operasional jelas (OD-018) |
| Data wali/keluarga, alamat, NIK | **Tidak dikumpulkan** | Di luar kebutuhan operasional awal |

Alasan: banyak santri kemungkinan di bawah umur; makin sedikit data pribadi, makin kecil risiko dan kewajiban kepatuhan (Master §12.2).

### 4.3 Sinkronisasi Peran Koordinator ↔ Keanggotaan Tim

Untuk mencegah "koordinator tanpa keanggotaan" atau sebaliknya:

- Menetapkan seseorang sebagai **koordinator tim X** dilakukan lewat **satu aksi** (RPC `team_set_coordinator`) yang secara atomik: memastikan ia anggota tim X, membuat `user_roles(koordinator, scope=team X)`, menutup koordinator sebelumnya, dan menulis audit.
- Mencabut keanggotaan aktif seorang koordinator otomatis mencabut peran `koordinator` bercakupan tim tersebut.
- Tidak ada jalur terpisah untuk mengubah keduanya secara manual yang dapat membuat keduanya tidak sinkron (invarian dijaga trigger).

---

## 5. Persyaratan Fungsional

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| PPL-001 | Profil pengguna: lihat/ubah data yang diizinkan; admin/pengurus mengelola data struktural (tipe anggota, kewajiban, tanggal bergabung/keluar) | M |
| PPL-002 | **[v1.1 — penundaan Must disetujui 2026-11-13]** Buat/ubah/arsipkan tim oleh yang berwenang melalui aplikasi; interim NOW lewat SQL operator beraudit (§15) | M |
| PPL-003 | Keanggotaan tim: tambah/keluarkan anggota; satu orang boleh di banyak tim | M |
| PPL-004 | Peran tim: koordinator, anggota, sebutan khusus; penetapan koordinator via aksi atomik (§4.3) | M |
| PPL-005 | Penugasan pereview (per pengguna atau massal per tim) dengan periode berlaku | M |
| PPL-006 | Riwayat keanggotaan dan penugasan tertelusur (timeline per pengguna & per tim) | S |
| PPL-007 | Ikhtisar tim: anggota, koordinator, ringkasan aktivitas (tautan ke ATT/REP/TSK sesuai hak akses) | S |
| PPL-008 | Direktori anggota: pencarian & filter (tipe, tim, status), tampilan terbatas sesuai hak (nomor HP disamarkan bagi yang tak berwenang) | M |
| PPL-009 | Flag kewajiban absen/lapor dengan tanggal efektif; perubahan tidak mengubah data historis | M |
| PPL-010 | **[v1.1 — disetujui 2026-11-13]** Pemindahan santri antar tim dengan satu aksi (keluar dari tim lama + masuk tim baru, tercatat) | S |
| PPL-011 | Penugasan ulang pereview massal saat pereview berhenti/pindah (pratinjau dampak) | S |
| PPL-012 | **[v1.1 — disetujui 2026-11-13]** Dashboard peringatan struktur: pengguna wajib-lapor tanpa pereview; tim tanpa koordinator; penugasan yang segera berakhir | S |
| PPL-013 | Impor awal anggota dari CSV (nama, tipe, tim, pereview) dengan pratinjau dan laporan kesalahan | S |
| PPL-014 | **[v1.1 — disetujui 2026-11-13]** Struktur organisasi (bagan sederhana: Yayasan → Pengurus → Tim) dalam tampilan baca-saja | C |
| PPL-015 | Foto profil dengan batas ukuran & pemangkasan otomatis | C |
| PPL-016 | **[v1.1 — disetujui 2026-11-13]** Penandaan status khusus anggota (mis. cuti panjang, alumni) yang memengaruhi kewajiban melalui flag, bukan logika tersembunyi | S |

---

## 6. Hak Akses dan Visibilitas

| Permission | Santri | Koord. | Pengurus | Yayasan | S.Admin |
| --- | --- | --- | --- | --- | --- |
| `people.profile.read` (dasar: nama, foto, tim) | all | tim yang dipimpin (NOW 2026-11-13; asal all) | all | all | all |
| `people.profile.read_contact` (HP) | own | tim | assigned/all | all | terbatas |
| `people.profile.update_self` | own (non-struktural) | own | own | own | own |
| `people.profile.update_structural` | — | — | ✓ | — | ✓ |
| `team.create/archive` | — | — | ✓ | ✓ | ✓ |
| `team.member.manage` | — | tim | ✓ | ✓ | ✓ |
| `team.coordinator.set` | — | — | ✓ | ✓ | ✓ |
| `reviewer.assign` | — | — | ✓ | ✓ | ✓ |
| `people.history.read` | own | tim | ✓ | ✓ | ✓ |

**[NOW, 2026-11-13]** Direktori koordinator hanya menampilkan anggota tim yang dipimpinnya. Asal: direktori nama, foto, tipe, dan tim ke seluruh anggota aktif; aturan asal tidak lagi berarti koordinator boleh melihat semua tim. Data kontak dan status akun tetap dibatasi bagi yang berwenang melalui proyeksi data server/view terbatas serta RLS, bukan hanya penyembunyian UI. Super Admin mengelola struktur tetapi tidak otomatis membaca kontak pribadi.

**RLS/Keamanan:** pengguna tidak dapat `UPDATE` kolom struktural di `profiles` (dilindungi trigger yang menolak perubahan kolom terlarang oleh non-berwenang); penugasan pereview dan keanggotaan hanya via RPC beraudit.

---

## 7. Alur Utama

### 7.1 Onboarding Anggota Baru

1. Akun disetujui (IAM-003) → profil dibuat dengan `member_type` dari pemohon (klaim) yang **diverifikasi** admin.
2. Admin mengisi: tipe anggota, tim, flag kewajiban (default: santri wajib), pereview.
3. Sistem memeriksa invarian BR-PPL-06: wajib-lapor tanpa pereview → peringatan di dashboard struktur (tidak memblokir persetujuan akun, tetapi muncul di antrean "perlu dilengkapi").

### 7.2 Perpindahan dan Keluar

- **Pindah tim:** aksi PPL-010; riwayat lama tetap, akses data tim lama berhenti sejak `valid_to`.
- **Keluar/alumni:** `left_on` diisi, status akun diubah via IAM (`deactivated`), kewajiban dihentikan sejak tanggal tersebut, penugasan pereview ditutup, tugas terbuka masuk antrean penugasan ulang (TSK).
- **Pereview berhenti:** PPL-011 menampilkan semua santri terdampak untuk dialihkan.

---

## 8. Persyaratan Layar

| Layar | Isi |
| --- | --- |
| Profil Saya | Data diri, foto, tim, kontak, keamanan akun (tautan ke IAM) |
| Direktori | Pencarian & filter anggota |
| Detail Anggota | Profil, tim, pereview, riwayat, tautan ke data terkait sesuai hak |
| Daftar Tim | Kartu tim + anggota |
| Detail Tim | Anggota, koordinator, ringkasan, riwayat keanggotaan |
| Kelola Anggota Tim | Tambah/keluarkan, set koordinator |
| Penugasan Pereview | Tabel penugasan, pratinjau massal, peringatan celah |
| Dashboard Struktur | Peringatan: tanpa pereview, tim tanpa koordinator, dll. |
| Impor Anggota | CSV, pratinjau, laporan |

---

## 9. Notifikasi dan Audit

| Event | Penerima |
| --- | --- |
| `team.membership_changed` | Anggota terkait, koordinator |
| `reviewer.assigned` / `.changed` | Pereview dan santri terkait |
| `structure.gap_detected` (ringkasan harian) | Pengurus berwenang |

Audit: `people.profile.structural_updated`, `team.created/archived`, `team.member.added/removed`, `team.coordinator.set`, `reviewer.assigned/ended`, `people.requirement.changed`.

---

## 10. Edge Case

| Kasus | Perilaku |
| --- | --- |
| Santri tanpa pereview | Laporan masuk antrean "Belum Ditugaskan" (PRD-04); peringatan di dashboard struktur |
| Tim tanpa koordinator | Diizinkan; peringatan informasi |
| Dua koordinator sekaligus | Hanya jika konfigurasi co-koordinator diaktifkan; selain itu ditolak |
| Pengguna yang sama menjadi pereview dari banyak santri lalu dinonaktifkan | Peringatan dampak + alur penugasan ulang massal |
| Pereview dan reviewee bertukar peran | Diperbolehkan selama tidak saling meninjau pada periode yang sama (peringatan) |
| Penugasan pereview tumpang tindih | Ditolak oleh konstrain DB |
| Pengubahan flag kewajiban mundur ke tanggal lalu | Ditolak/dibatasi; hanya efektif ke depan, kecuali koreksi beraudit oleh Pengurus |
| Anggota tim diarsipkan | Keanggotaan historis tetap; tim tidak muncul di pemilih baru |
| `member_type` diubah (santri → ustadz) | Riwayat tipe tersimpan; kewajiban dihitung sesuai tanggal efektif |
| Nama pengguna berubah | Tampilan terbaru dipakai; riwayat audit menyimpan nama lama saat kejadian |
| Profil tanpa foto | Avatar inisial |

---

## 11. Kriteria Penerimaan

1. Admin dapat mengatur `member_type`, flag kewajiban, tim, dan pereview untuk setiap anggota; perubahan tercatat audit dan berlaku sejak tanggal efektif.
2. Seseorang dapat berada di beberapa tim; akses data tim mengikuti keanggotaan aktif (tes RLS: keluar tim → akses hilang).
3. Menetapkan koordinator selalu menghasilkan keanggotaan **dan** peran bercakupan yang sinkron; mencabut salah satunya tidak meninggalkan keadaan yatim.
4. Penugasan pereview aktif tidak dapat tumpang tindih dan tidak dapat menunjuk diri sendiri.
5. Santri tidak dapat mengubah kolom struktural profilnya (tes percobaan `UPDATE` gagal).
6. **[v1.1 — PPL-012]** Dashboard struktur menampilkan semua santri wajib-lapor tanpa pereview.
7. Direktori tidak membuka nomor HP kepada pengguna tanpa hak.
8. Riwayat keanggotaan & penugasan dapat ditampilkan per tanggal tertentu ("siapa pereview X pada tanggal ini").

---

## 12. Rencana Tes

| Jenis | Skenario |
| --- | --- |
| pgTAP | Konstrain tumpang tindih; trigger kolom terlarang; sinkronisasi koordinator; RLS direktori; kueri "pada tanggal" |
| Unit | Validasi CSV impor; logika dampak penugasan ulang massal |
| E2E | Onboarding anggota → pereview → laporan terkirim ke pereview yang benar; pindah tim; pereview berhenti |

---

## 13. Dependensi dan Keputusan Terbuka

**Bergantung pada:** IAM (akun, peran). **Dipakai oleh:** ATT, REP, TSK, SCH, ADM.

| ID | Keputusan | Default sementara |
| --- | --- | --- |
| OD-008 | Struktur organisasi & hierarki peran final | Tim datar + koordinator |
| OD-014 | Posisi ustadz | `member_type = ustadz` + peran pengurus |
| OD-018 | Data pribadi & anak | Minimisasi (§4.2) |
| OD-034 | Daftar tim awal & koordinatornya | Diisi pemilik sebelum R1 |
| OD-035 | Siapa pereview default tiap santri (per angkatan/kelompok/tim) | Ditentukan admin; impor CSV pada onboarding |
| OD-036 | Apakah co-koordinator diperbolehkan | Tidak (default 1 koordinator) |

---

## 14. Metrik Modul

Jumlah anggota aktif per tipe; jumlah tim aktif; persentase santri wajib-lapor yang memiliki pereview (target 100%); rata-rata santri per pereview (indikator beban); jumlah perubahan struktur per bulan.

---

## 15. Keputusan Audit — 2026-11-13 [TERKONFIRMASI]

Change log 2.1; cakupan NOW/v1.1 mengikuti Master §0.4, bukan klaim seluruh model target sudah menjadi skema aktual.

- **TRC-25 / PPL-002 — v1.1:** pengguna menyetujui penundaan **Must** buat/ubah/arsip tim melalui aplikasi. Interim NOW adalah operasi operator melalui [dokumentasi SQL tim](docs/operator-team-sql.md), transaksi aman dan beraudit, default **ROLLBACK**, tanpa penghapusan. PPL-003/004 tidak otomatis ditunda oleh penundaan CRUD tim. Jangan menganggap runbook sebagai bukti operasi sudah dijalankan atau sinkronisasi koordinator sudah benar.
- **Model §4.1 adalah target, bukan skema SQL yang boleh diasumsikan.** Skema migrasi saat ditinjau: `teams` tidak memiliki `created_by/parent_team_id/updated_at`; `team_members` memakai `created_at` tanpa `added_by/removed_by/note`, role `coordinator/member/assistant`, dan periode bertipe `date`. Detail constraint dan audit aktual ada di runbook. Sinkronisasi `team_members` ↔ `user_roles` tetap harus diverifikasi; operasi biasa tidak boleh memberi role koordinator secara manual atau menganggap RPC saat ini sudah memenuhi seluruh kontrak §4.3.
- **B / PPL-008 — NOW:** koordinator melihat direktori hanya untuk anggota tim yang dipimpinnya, termasuk pencarian, filter, hitungan, dan detail; bukan seluruh organisasi. Pemeriksaan server dan RLS defense-in-depth wajib, bukan filter UI saja. Kebijakan kontak tetap terpisah: HP wajib dikumpulkan saat pengajuan tidak berarti boleh dibaca semua orang.
- **REG-01/03 — NOW:** klaim registrasi tepat lima kategori (Santri/Ustadz/Pengurus/Yayasan/Lainnya), bukan role IAM. `staf` pada kosakata profil internal tidak menambah opsi registrasi. Admin memverifikasi kategori dan menetapkan role terpisah; versi/waktu persetujuan privasi ditangani IAM-017 NOW. Nomor HP wajib di pengajuan; data lama yang kosong bukan alasan mengarang nomor atau membuka data kontak.
- **C — v1.1:** PPL-010, PPL-012, PPL-014, PPL-016. Perpindahan satu aksi, dashboard peringatan struktur, bagan organisasi, dan status khusus beserta layar/acceptance turunannya ditunda dengan requirement asal tetap utuh. Antrean laporan belum ditugaskan tidak ikut dihapus oleh penundaan dashboard struktur.
- Presence/heartbeat diakui untuk informasi keterkinian aktivitas, **bukan** bukti absensi, kewajiban, atau hak akses. Otorisasi tetap app-layer + guard tests dengan RLS yang tidak boleh dilonggarkan.

Acceptance NOW tambahan: koordinator tim A tidak dapat mencari/membuka anggota tim B tanpa scope sah, dan akses hilang ketika scope berakhir. Acceptance §11.6 dashboard struktur berlaku **v1.1**. Bukti penerimaan dan operasi SQL tidak diklaim telah dilakukan.
