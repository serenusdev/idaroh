# PRD-02 — Resource Library

**Versi:** 2.1 · **Keputusan audit:** 2026-11-13 (§16; NOW/v1.1 mengikat cakupan rilis, bukan klaim implementasi) · **Prefix:** LIB · **Rilis:** R1 · **Dibaca bersama:** Master PRD v2.0, PRD-01 **Label:** \[TERKONFIRMASI\] · \[REKOMENDASI\] · \[TERBUKA\]

---

## 1. Tujuan dan Posisi Modul

Resource Library adalah **repositori pengetahuan institusi** (alat digital, referensi, dokumen, panduan) yang berkembang dari Google Sheets **Everything Library**. Ia bukan kumpulan tautan: setiap item membawa dokumentasi terstruktur agar orang lain dapat memakainya tanpa bertanya.

**Tujuan**

1. Memusatkan pengetahuan agar mudah ditemukan.
2. Mempertahankan dokumentasi per item (enam bidang dokumentasi) **\[TERKONFIRMASI\]**.
3. Memudahkan perawatan: siapa mengubah apa, kapan.
4. Mengurangi pencarian dan dokumentasi berulang.
5. Memigrasi data Everything Library secara bertahap dan tervalidasi **\[TERKONFIRMASI\]**.

**Bukan tujuan (R1):** crawling otomatis seluruh sumber, verifikasi otomatis URL, kontribusi publik, rekomendasi berbasis AI.

**Pengguna:** semua anggota aktif membaca (sesuai visibilitas); Pengurus/Yayasan/Super Admin mengelola; kontributor tertentu dapat diberi hak sunting.

---

## 2. Aturan Bisnis

| ID | Aturan | Label |
| --- | --- | --- |
| BR-LIB-01 | Enam bidang dokumentasi selalu melekat pada record resource: **Access / Setup, How to Use, Workflow / Examples, Limitations / Cautions, Official Sources, Documentation Status** | TERKONFIRMASI |
| BR-LIB-02 | Bidang kosong ditampilkan sebagai "Belum didokumentasikan" — **tidak boleh diisi data karangan** | TERKONFIRMASI (dari PRD v1.0) |
| BR-LIB-03 | Spreadsheet asli tetap menjadi referensi sampai migrasi terverifikasi | TERKONFIRMASI |
| BR-LIB-04 | Record ID dari spreadsheet dipertahankan bila valid | TERKONFIRMASI |
| BR-LIB-05 | Resource tidak dihapus permanen dari UI; diarsipkan (soft delete) | REKOMENDASI |
| BR-LIB-06 | Setiap perubahan konten tersimpan sebagai revisi | REKOMENDASI |
| BR-LIB-07 | Resource memiliki *visibilitas*: `internal` (semua anggota aktif) atau `restricted` (peran/tim tertentu) | REKOMENDASI |
| BR-LIB-08 | Satu resource berada pada **tepat satu kategori utama** dan boleh punya banyak tag | REKOMENDASI |

BR-LIB-07 menjawab kemungkinan ada resource yang tidak pantas dibaca semua santri (mis. kredensial/panduan internal); jika semua resource boleh dibaca semua anggota, cukup biarkan semuanya `internal`.

---

## 3. Model Data

| Tabel | Kolom kunci | Catatan |
| --- | --- | --- |
| `resources` | `id, legacy_record_id, name, slug, description, category_id, official_url, access_setup, how_to_use, workflow_examples, limitations_cautions, official_sources, documentation_status, visibility, status (draft/published/archived), created_by, updated_by, created_at, updated_at, archived_at, search_vector` | Enam bidang dokumentasi disimpan sebagai kolom teks Markdown |
| `resource_categories` | `id, name, slug, parent_id, sort_order` | Satu tingkat induk-anak cukup di R1 |
| `tags` | `id, name, slug` | Dikelola terpusat |
| `resource_tags` | `resource_id, tag_id` | Many-to-many |
| `resource_urls` | `id, resource_id, label, url, is_official, sort_order` | Untuk lebih dari satu tautan (S) |
| `resource_favorites` | `user_id, resource_id, created_at` | Pribadi |
| `resource_revisions` | `id, resource_id, revision_no, snapshot jsonb, changed_by, changed_at, change_note` | Dibuat oleh trigger |
| `resource_visibility_rules` | `resource_id, role_id / team_id` | Dipakai jika `visibility = restricted` |
| `resource_views` | `resource_id, user_id, viewed_at` | Untuk analitik, retensi singkat (S) |
| `import_batches` / `import_rows` | lihat §7 | Staging migrasi |

**Documentation Status:** nilai **harus diturunkan dari data nyata** spreadsheet (profil nilai distinct), bukan dikarang. **\[REKOMENDASI\]** simpan sebagai tabel lookup `documentation_statuses` agar admin bisa menambah nilai, dengan satu nilai khusus sistem `unknown` untuk baris tanpa status.

**Konten Markdown:** keenam bidang menyimpan Markdown (daftar, tautan, blok kode). Render disanitasi (tanpa HTML mentah/skrip), tautan eksternal dibuka dengan `rel="noopener noreferrer"`.

---

## 4. Persyaratan Fungsional

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| LIB-001 | Jelajah per kategori (navigasi pohon sederhana) dengan jumlah item | M |
| LIB-002 | Pencarian: nama, deskripsi, kategori, tag, dan isi enam bidang dokumentasi; hasil terurut relevansi | M |
| LIB-003 | Halaman detail resource: header (nama, kategori, tag, status dokumentasi, tautan resmi) + enam bidang dalam bagian terlipat/tab | M |
| LIB-004 | Bidang kosong tampil "Belum didokumentasikan" + indikator kelengkapan dokumentasi (mis. 4/6 bidang terisi) | M |
| LIB-005 | Buat/ubah/arsipkan resource oleh pengguna berwenang; form dengan pratinjau Markdown | M |
| LIB-006 | Favorit pribadi + daftar "Favorit saya" | S |
| LIB-007 | Kelola kategori dan tag terpusat; gabung (merge) tag duplikat; ganti nama tanpa memutus relasi | M |
| LIB-008 | Impor awal dari Everything Library (§7) dengan pratinjau, validasi, laporan kesalahan | M |
| LIB-009 | **[v1.1 — disetujui 2026-11-13]** Ekspor resource (CSV/JSON) oleh pengguna berwenang, beraudit | S |
| LIB-010 | Riwayat perubahan per resource: daftar revisi, perbandingan (diff) sederhana, pemulihan revisi lama | S |
| LIB-011 | Filter: kategori, tag, status dokumentasi, visibilitas (admin), terakhir diperbarui | M |
| LIB-012 | Visibilitas `restricted` per peran/tim | S |
| LIB-013 | **[v1.1 — disetujui 2026-11-13]** Penanda "perlu ditinjau ulang" jika `updated_at` melewati ambang (default 180 hari) | C |
| LIB-014 | **[v1.1 — disetujui 2026-11-13]** Lampiran file pada resource (PDF/gambar) via Storage terproteksi | C |
| LIB-015 | Salin tautan resmi / bagikan tautan internal (butuh login) | S |
| LIB-016 | **[v1.1 — disetujui 2026-11-13]** Pelaporan masalah pada resource ("tautan rusak / info usang") ke pengelola | C |
| LIB-017 | **[v1.1 — disetujui 2026-11-13; asal W untuk rilis awal]** Pemeriksaan URL manual (tombol "cek tautan" oleh admin) | W (NOW) |

Catatan LIB-017: verifikasi URL otomatis berada di luar scope R1 (Master/PRD awal). Jika nanti dibutuhkan, rancang sebagai job terjadwal terpisah.

---

## 5. Pencarian

**\[REKOMENDASI\]** Gunakan Postgres: kolom `search_vector` (`tsvector`) yang dipelihara trigger, **bobot** A=nama, B=tag & kategori, C=deskripsi, D=enam bidang dokumentasi; ditambah `pg_trgm` untuk toleransi salah ketik dan pencarian awalan pada nama.

| Keputusan | Pilihan |
| --- | --- |
| Konfigurasi bahasa | Konten campuran Indonesia-Inggris → mulai dengan konfigurasi `simple` + trigram; evaluasi konfigurasi `indonesian` bila tersedia dan terbukti lebih baik pada data nyata |
| Mesin eksternal (Algolia/Typesense/Meilisearch) | **Tidak perlu** di R1; ribuan record masih ringan untuk Postgres. Evaluasi ulang jika > \~50 ribu item atau kualitas relevansi tidak cukup |
| Pagination | Keyset; 20 hasil per halaman |
| Sorotan hasil | `ts_headline` untuk cuplikan (S) |

Kualitas pencarian diuji dengan **daftar 20–30 kueri nyata** dari pengguna pondok dan hasil yang diharapkan (golden set) sebelum rilis.

---

## 6. Hak Akses

| Permission | Santri | Koord. | Pengurus | Yayasan | S.Admin |
| --- | --- | --- | --- | --- | --- |
| `library.resource.read` | ✓ (internal) | ✓ | ✓ | ✓ | ✓ |
| `library.resource.create` | — | opsional | ✓ | ✓ | ✓ |
| `library.resource.update` | — | milik sendiri | ✓ | ✓ | ✓ |
| `library.resource.archive` | — | — | ✓ | ✓ | ✓ |
| `library.taxonomy.manage` | — | — | ✓ | ✓ | ✓ |
| `library.import.run` | — | — | — | — | ✓ |
| `library.export` | — | — | ✓ | ✓ | ✓ |
| `library.revision.restore` | — | — | ✓ | ✓ | ✓ |

**RLS:** baca = anggota aktif **dan** (`visibility='internal'` atau cocok aturan visibilitas); resource `draft`/`archived` hanya terlihat oleh pengelola. Tulis dibatasi permission di atas; `created_by/updated_by` diisi trigger dari `auth.uid()`, bukan dari klien.

---

## 7. Migrasi Everything Library

### 7.1 Prinsip

1. **Tidak ada kehilangan diam-diam**: setiap baris sumber berakhir sebagai *diimpor*, *diimpor dengan peringatan*, atau *ditolak dengan alasan* — dan terhitung (jumlah sumber = jumlah hasil).
2. Sumber tidak diubah. Spreadsheet tetap baca-saja sebagai referensi.
3. Impor dapat diulang (**idempoten**) berdasarkan `legacy_record_id`.

### 7.2 Tahapan

| Tahap | Aktivitas | Keluaran |
| --- | --- | --- |
| 0. Profiling | Ekspor sheet → CSV; hitung baris, kolom, nilai distinct (kategori, tag, status), ID kosong/duplikat, URL tak valid, sel sangat panjang | Laporan profil data |
| 1. Pemetaan | Petakan kolom sheet → kolom `resources`; putuskan normalisasi kategori/tag; tetapkan nilai Documentation Status | Dokumen pemetaan yang disetujui |
| 2. Staging | Muat ke `import_rows` mentah (JSON) beserta nomor baris sumber | Data mentah tersimpan |
| 3. Validasi | Aturan: Record ID unik & valid; nama wajib; URL valid (format); kategori dikenal; panjang bidang; duplikasi (ID sama / nama+URL sama) | `import_rows.status` + pesan kesalahan |
| 4. Pratinjau | Admin melihat jumlah: akan dibuat / diperbarui / ditolak / duplikat | Persetujuan admin |
| 5. Eksekusi | Transaksi per batch; tulis `resources`, `tags`, relasi; simpan `legacy_record_id` | Data produksi |
| 6. Rekonsiliasi | Bandingkan jumlah baris, checksum kolom kunci, sampel acak 5–10% dicek manual | Laporan rekonsiliasi |
| 7. Dual-run | Spreadsheet & platform berjalan paralel; perubahan di sheet dicatat | Periode stabil |
| 8. Penutupan | Sheet dijadikan arsip baca-saja setelah persetujuan tertulis | Keputusan migrasi selesai |

### 7.3 Aturan Penanganan Data

| Kasus | Perlakuan |
| --- | --- |
| Record ID kosong/duplikat | Ditandai; ID baru dibuat **dengan** menyimpan ID lama di `legacy_record_id` bila ada; dilaporkan |
| Kategori tidak dikenal | Masuk kategori "Belum Dikategorikan" + peringatan; tidak membuang baris |
| Tag bervariasi ejaan | Normalisasi huruf kecil/trim; usulan penggabungan ditinjau admin, bukan otomatis |
| URL tidak valid | Baris tetap diimpor; `official_url` dikosongkan; nilai asli disimpan di catatan impor |
| Teks melebihi batas | Ditolak atau dipotong **hanya** dengan persetujuan; default: ditolak dan dilaporkan |
| Sel berisi HTML/skrip | Disanitasi; nilai asli tersimpan di staging |
| Dokumentasi kosong | Tetap kosong (BR-LIB-02) |

### 7.4 Laporan Kesalahan Impor

Berisi: nomor baris sumber, Record ID, kolom bermasalah, jenis masalah, tindakan (ditolak/diperingatkan), saran perbaikan. Dapat diunduh CSV agar pemilik data memperbaikinya di sumber dan impor diulang.

---

## 8. Persyaratan Layar

| Layar | Isi |
| --- | --- |
| Beranda Library | Pencarian besar, kategori, "Baru diperbarui", "Favorit saya" |
| Hasil Pencarian | Daftar + filter; cuplikan; urutan relevansi |
| Detail Resource | Header, tautan resmi, enam bagian dokumentasi, meta (pembuat/pemutakhir, terakhir diubah), tombol favorit |
| Editor Resource | Form bertahap/bagian, pratinjau Markdown, simpan draft/terbitkan |
| Riwayat Revisi | Daftar revisi + diff |
| Kelola Taksonomi | Kategori & tag |
| Impor | Unggah CSV, pemetaan, pratinjau, laporan |

UX: pencarian harus dapat dicapai dari setiap halaman; layar detail nyaman dibaca di ponsel (bagian terlipat); tautan resmi tampil menonjol.

---

## 9. Persyaratan Non-Fungsional Modul

| Aspek | Target |
| --- | --- |
| Pencarian | p95 ≤ 500 ms untuk hingga 10 ribu record |
| Detail resource | LCP ≤ 2,5 dtk |
| Impor | 5 ribu baris ≤ 5 menit tanpa timeout (batch) |
| Keamanan | Konten Markdown disanitasi; CSP; tidak ada `dangerouslySetInnerHTML` tanpa sanitasi |
| Audit | Perubahan resource, taksonomi, impor, ekspor tercatat |

---

## 10. Notifikasi dan Audit

Notifikasi opsional (C): pengelola diberi tahu saat ada laporan masalah (LIB-016). Audit: `library.resource.created/updated/archived/restored`, `library.import.executed`, `library.export`, `library.taxonomy.changed`.

---

## 11. Edge Case

| Kasus | Perilaku |
| --- | --- |
| Dua pengurus menyunting bersamaan | Optimistic locking via `updated_at`/`revision_no`; pengguna kedua diberi peringatan konflik dan opsi gabung manual |
| Resource diarsipkan yang masih difavoritkan | Hilang dari pencarian; favorit tetap tersimpan dan ditandai "diarsipkan" |
| Kategori dihapus | Tidak bisa dihapus bila masih berisi resource; harus dipindah |
| Tag digabung | Seluruh relasi dipindah; tag lama disimpan sebagai alias agar pencarian lama tetap menemukan |
| Markdown sangat panjang | Batas ukuran per bidang (default 50 ribu karakter) dengan pesan jelas |
| Slug bentrok | Sufiks otomatis |
| Pengguna kehilangan akses setelah resource jadi `restricted` | Tautan lama menampilkan halaman "tidak tersedia" tanpa membocorkan judulnya |

---

## 12. Kriteria Penerimaan

1. Pengguna berwenang dapat menjelajah dan mencari resource sesuai LIB-001/002; golden set kueri memberi hasil yang diharapkan pada peringkat teratas (disepakati sebelum rilis).
2. Halaman detail menampilkan keenam bidang dokumentasi; bidang kosong tampil "Belum didokumentasikan" dan tidak ada data karangan.
3. Tautan resmi dapat dibuka.
4. Seluruh perubahan resource tercatat sebagai revisi dengan pelaku dan waktu.
5. Impor: jumlah baris sumber = diimpor + diperingatkan + ditolak; laporan kesalahan dihasilkan; **tidak ada baris hilang tanpa catatan**; Record ID valid dipertahankan.
6. Menjalankan ulang impor yang sama tidak membuat duplikat.
7. Resource `restricted` tidak terbaca pengguna di luar aturan visibilitas (tes pgTAP).
8. Markdown berisi skrip tidak dieksekusi saat dirender.

---

## 13. Rencana Tes

| Jenis | Skenario |
| --- | --- |
| pgTAP | RLS visibilitas; trigger revisi; trigger `search_vector`; unik slug & legacy\_record\_id |
| Unit | Parser/validator impor; normalisasi tag; sanitasi Markdown |
| E2E | Cari → buka detail; buat/ubah resource; arsip; impor CSV contoh dengan kasus rusak |
| Data | Rekonsiliasi hasil impor terhadap sumber (jumlah & checksum) |
| Relevansi | Golden set kueri |

---

## 14. Dependensi dan Keputusan Terbuka

**Bergantung pada:** IAM (peran), PPL (profil pemilik konten), Storage (lampiran).

| ID | Keputusan | Default sementara |
| --- | --- | --- |
| OD-021 | Struktur kolom sebenarnya Everything Library dan nilai Documentation Status | Ditentukan dari profiling (Tahap 0) |
| OD-022 | Apakah ada resource yang tidak boleh dibaca semua anggota | Semua `internal` sampai ada kebutuhan |
| OD-023 | Siapa kontributor/pengelola konten | Pengurus + Super Admin |
| OD-006 | Retensi revisi lama | Simpan semua sampai diputuskan |

---

## 15. Metrik Modul

Pencarian per hari; persentase pencarian tanpa hasil (indikator celah konten); kelengkapan dokumentasi rata-rata (bidang terisi/6); jumlah resource dengan status dokumentasi belum lengkap; resource tidak diperbarui > 180 hari; jumlah favorit per pengguna.

---

## 16. Keputusan Audit — 2026-11-13 [TERKONFIRMASI]

Change log 2.1: pengguna menyetujui deferral **v1.1** untuk **LIB-009, LIB-013, LIB-014, LIB-016, LIB-017**. Requirement dan prioritas asal tetap tersimpan pada §4; LIB-017 tetap W untuk NOW, dengan pemeriksaan manual menjadi target v1.1. Verifikasi URL otomatis tidak menjadi scope baru. Model, notifikasi, dan acceptance terkait item tersebut berlaku pada v1.1; penundaan bukan klaim fitur sudah tersedia.

Requirement lain tidak otomatis ditunda. Sesuai Master §0.4, otorisasi request dilakukan di app-layer dengan guard tests, RLS tetap defense-in-depth dan tidak boleh dilonggarkan; validasi server manual diterima tanpa mewajibkan Zod. Tidak ada tes atau perubahan kode dalam revisi dokumentasi ini.
