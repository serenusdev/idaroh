# Universal Authorization, Integrity & Anti-Regression Standard

> **Tujuan:** Standar baku lintas proyek untuk memastikan sistem otorisasi, integritas data, dan perubahan kode berjalan konsisten di seluruh lapisan aplikasi (UI, API/Server, Database RLS, & RPC) tanpa menimbulkan regresi saat perbaikan dilakukan.
> **Prinsip Utama:** Dokumen izin spesifik proyek (mis. `PERMISSIONS.md` / PRD) adalah satu-satunya sumber kebenaran (*Single Source of Truth*). Jika kode dan spesifikasi berbeda, kode wajib diselaraskan ke spesifikasi—bukan sebaliknya.

---

## 1. Hukum Dasar Otorisasi & Identitas

1. **Pemisahan Identitas, Peran, dan Kategori Deskriptif**
   * **Peran (*Roles*)** hanya boleh dibaca dari tabel/relasi otorisasi kanonik yang terverifikasi di sisi server.
   * **Atribut deskriptif/kategori profil** (seperti jabatan, divisi, tipe anggota, atau metadata pengguna) **dilarang keras** dijadikan dasar keputusan hak akses, filter keamanan, atau eskalasi wewenang.
   * **Klaim klien tidak pernah dipercaya:** Parameter dari request klien (`role`, `userId`, `isLate`, `status`, `price`, `timestamp`) tidak boleh dianggap sebagai bukti otorisasi atau integritas. Selalu turunkan identitas pemanggil dari sesi server yang terverifikasi.

2. **Larangan Eskalasi Hierarki Implisit (*No Blind Rank Inheritance*)**
   * Dilarang memeriksa izin menggunakan perbandingan peringkat linear (seperti `roleLevel >= admin` atau `isHigherRole`) pada modul yang memiliki pemisahan tugas (*Separation of Duties*).
   * Peran teknis tertinggi (*Super Admin / System Owner*) tidak otomatis mewarisi akses operasional atau akses data privat pengguna kecuali diizinkan secara eksplisit dalam matriks izin proyek.
   * Setiap pengecekan akses wajib mengevaluasi pasangan eksplisit: **`(Permission / Capability, Data Scope)`**.

3. **Evaluasi Multi-Peran (*Multi-Role Union*)**
   * Jika pengguna memiliki lebih dari satu peran aktif, pengecekan izin wajib mengevaluasi **seluruh daftar peran aktifnya** (`roles[]`), bukan hanya satu peran utama/tertinggi yang mungkin justru dibatasi pada modul tertentu.

4. **Larangan *Self-Approval* & Perlindungan Akses Kritis**
   * Pengguna dari peran apa pun dilarang menyetujui, memverifikasi, atau menilai pengajuan/transaksi miliknya sendiri (*no self-review*).
   * Sistem wajib menolak penghapusan atau penurunan hak administrator aktif terakhir, serta mencegah perubahan hak akses diri sendiri tanpa otorisasi administrator lain.

---

## 2. Pertahanan Berlapis (*Defense-in-Depth*)

1. **Keselarasan 4 Lapisan Wajib**
   Setiap aturan izin dan cakupan data (*scope*) wajib ditegakkan secara identik pada empat lapisan:
   * **Lapisan 1 — UI & Navigasi:** Menyembunyikan menu/aksi yang tidak diizinkan agar pengguna tidak menemui jalan buntu (*dead-end `Unauthorized`*).
   * **Lapisan 2 — API / Server Action Guard:** Memvalidasi sesi, status aktif akun, `(permission, scope)`, dan skema input sebelum menjalankan logika bisnis.
   * **Lapisan 3 — Database Row-Level Security (RLS):** Menjadi benteng terakhir di tingkat baris database. **Dilarang keras melonggarkan RLS** (mis. `USING (true)` pada data sensitif) demi membuat fitur UI berjalan.
   * **Lapisan 4 — Privileged Functions / RPC (`SECURITY DEFINER`):** Wajib mengunci `search_path`, memvalidasi identitas pemanggil (`auth.uid()`), memeriksa status aktif akun, memverifikasi `(permission, scope)`, serta mencatat log audit dalam satu transaksi yang sama.

2. **Integritas Waktu & Kalkulasi di Sisi Database**
   * Seluruh kalkulasi yang menentukan status kepatuhan, tenggat waktu (*deadline*), tanggal efektif, atau keterlambatan wajib dihitung menggunakan zona waktu resmi sistem langsung di database/server—bukan dari jam atau parameter yang dikirim browser klien.

3. **Keamanan Penyimpanan Berkas (*Private Storage*)**
   * Berkas sensitif wajib berada di *bucket* privat dengan kebijakan akses berbasis kepemilikan/relasi data, dan hanya diakses melalui *signed URL* berumur pendek setelah pemeriksaan izin berhasil.

4. **Jejak Audit *Append-Only***
   * Catatan audit (*audit logs*) untuk mutasi sensitif, penolakan akses, dan perubahan hak akses bersifat *append-only* (tidak dapat diubah atau dihapus oleh peran mana pun melalui aplikasi) dan wajib ditulis secara atomik bersama transaksi utamanya.

---

## 3. Aturan Evolusi Skema & Anti-Regresi Kode

1. **Migrasi Database *Forward-Only* & Idempoten**
   * File migrasi yang sudah diterapkan ke lingkungan produksi/bersama **harus diperlakukan sebagai *immutable*** (tidak boleh diedit ulang).
   * Setiap perubahan skema, fungsi, atau RLS wajib dibuat dalam file migrasi baru berurutan waktu dengan sintaks idempoten (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`) serta disertai skrip pemulihan (*rollback*).

2. **Kejelasan Siklus Hidup Data & Cache**
   * Membedakan secara tegas antara status aktif, dibatalkan (*cancelled*), diarsipkan (*archived*), dan dihapus (*soft-deleted*) baik pada query database maupun filter tampilan UI.
   * Setiap mutasi data wajib menginvalidasi cache server maupun cache sisi klien secara konsisten agar tampilan UI tidak menampilkan data usang (*stale state*).

3. **Protokol Wajib Sebelum Menutup Perbaikan (*Anti-Regression Gate*)**
   Sebuah perbaikan atau fitur baru belum dianggap selesai sebelum seluruh poin berikut terverifikasi:
   * [ ] **Tidak ada keputusan yang ditebak:** Jika spesifikasi proyek memiliki bagian yang ambigu/kosong, agen wajib berhenti dan meminta konfirmasi pemilik produk terlebih dahulu.
   * [ ] **Test-Driven Verification:** Terdapat pengujian otomatis yang gagal sebelum perbaikan dan lulus setelah perbaikan.
   * [ ] **Matriks Uji Peran & Lintas Cakupan (*Cross-Scope*):** Menguji seluruh peran yang ada, kombinasi multi-peran, pemanggilan API/RPC secara langsung (di luar UI), serta percobaan akses lintas tim/organisasi (mis. Koordinator Tim A mencoba mengakses ID milik Tim B).
   * [ ] **Zero Regression:** Seluruh rangkaian tes lama dan pemeriksaan tipe (*typecheck*) lulus tanpa ada tes lama yang dihapus atau dimanipulasi.