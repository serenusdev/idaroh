# PERMISSIONS.md — Universal Authorization & Anti-Regression Contract (IDAROH / Pondok OS)

> **Status:** LOCKED — SINGLE SOURCE OF TRUTH (Finalized 2026-11-22)
> **Aturan Emas:** File ini adalah acuan otorisasi tunggal untuk seluruh sistem IDAROH (Frontend UI/Navigasi, Server Actions, API Routes, Helper SQL, RLS Policies, dan RPC `SECURITY DEFINER`). Jika kode lama atau dokumen PRD berbeda dengan file ini, **kode wajib diselaraskan ke file ini**.
> **Aturan Anti-Regresi:** Agen IDE dilarang mengubah izin atau memperluas/mempersempit akses suatu peran tanpa memperbarui seluruh 5 lapisan secara serentak (Navigasi UI ↔ Server Action Guard ↔ Helper SQL ↔ RLS Policy ↔ RPC + Unit/RLS Tests).

---

## 1. Peran Kanonik & Pemisahan Kategori (`role` vs `member_type`)

| Peran | Kunci Kanonik (`roles.key`) | Cakupan Default | Definisi & Batas Kewenangan |
|---|---|---|---|
| **Santri** | `santri` | `own` / `audiens` | Pengguna operasional dasar (presensi, laporan harian, tugas pribadi/ditugaskan, baca resource internal). |
| **Koordinator** | `koordinator` | **`team` (scoped)** | Pemimpin operasional pada **tim aktif yang dipimpinnya saja**. Tidak memiliki akses lintas tim maupun pengaturan global. |
| **Pengurus** | `pengurus` | `all` / `assigned` | Pelaksana operasional & monitoring harian pondok (review laporan/absensi ditugaskan, manajemen jadwal, tugas, anggota, resource). **Ustadz** adalah profil dengan `member_type = 'ustadz'` yang memegang peran `pengurus` (atau `koordinator` sesuai penugasan). |
| **Yayasan** | `yayasan` | `all` (Oversight) | Pengawas institusi, menyetujui perubahan kebijakan strategis, melihat analitik & audit log, serta mengelola struktur tim/koordinator/reviewer. Tidak mengeksekusi tugas teknis sistem. |
| **Super Admin** | `super_admin` | `all` (Technical Only) | **Kewenangan teknis & infrastruktur sistem, BUKAN kewenangan operasional/institusional.** Ditolak secara default dari data privat operasional (isi laporan harian, tugas harian, ekspor data operasional). |

### Definisi Nilai Scope
* `own`: Hanya baris data milik pengguna itu sendiri (`user_id = auth.uid()`).
* `assigned`: Hanya baris data yang ditugaskan secara eksplisit melalui tabel penugasan (`reviewer_assignments` atau `task_assignees`).
* `team`: Hanya baris data milik anggota/entitas pada tim aktif di mana pemanggil tercatat sebagai koordinator/anggota aktif (`team_members`).
* `audiens`: Hanya jika pengguna memenuhi kriteria audiens eksplisit (`all`, `role`, `team`, atau `user`).
* `all` (`✓`): Seluruh data aktif dalam lingkup institusi.
* `terbatas`: Akses sempit dengan syarat ketat (didefinisikan eksplisit pada §4).
* `—` (**DITOLAK**): **Tidak ada akses sama sekali.** Tidak boleh ada pengecualian implisit melalui hierarki peran.

---

## 2. Invarian Keamanan & Anti-Regresi (12 Aturan Mutlak)

1. **Sumber Peran Tunggal (`user_roles`)**: Peran aktif **hanya** dibaca dari tabel `user_roles` yang terhubung ke `roles.key`. Kolom `profiles.member_type` (`santri`, `ustadz`, `pengurus`, `yayasan`, `lainnya`) bersifat **deskriptif/kategorikal semata** dan dilarang keras digunakan untuk menentukan hak akses, filter audiens peran, atau penjagaan hierarki.
2. **Larangan Hierarki Linear (`roleRank`)**: Dilarang menggunakan perbandingan peringkat seperti `roleRank >= pengurus` atau `hasMinimumRole()`. `super_admin` tidak otomatis mewarisi izin `pengurus` atau `yayasan`. Setiap aksi wajib mengecek **pasangan `(permission, scope)`**.
3. **Isolasi Kewenangan Teknis Super Admin**: `super_admin` ditolak (`—`) pada seluruh aksi operasional harian: isi laporan harian, tugas & proyek, check-in/riwayat absensi operasional, serta ekspor data operasional.
4. **Kewajiban Operasional Berbasis Flag Eksplisit**: Kewajiban presensi harian dan laporan harian ditentukan oleh flag eksplisit (`attendance_required`, `report_required`) pada profil/penugasan pengguna, bukan ditebak dari `member_type = 'santri'`.
5. **Integritas Dihitung di Database**: Nilai kritis (`is_late`, tanggal efektif WIB `Asia/Jakarta`, status efektif koreksi, `auth.uid()` pemanggil) **wajib** dihitung dan divalidasi di dalam fungsi database/PostgreSQL. Parameter dari klien (`p_is_late`, `p_user_id`, `requesterRole`) tidak boleh dipercaya.
6. **Standar Wajib RPC `SECURITY DEFINER`**: Setiap fungsi `SECURITY DEFINER` wajib:
   * Mengunci `SET search_path = app, public, pg_temp;`
   * Memvalidasi `auth.uid() IS NOT NULL` dan menyamakannya dengan identitas pemanggil
   * Memeriksa `app.is_active_member(auth.uid())`
   * Memverifikasi `(permission, scope)` sesuai matriks §3
   * Mencatat jejak ke `audit_logs` dalam transaksi yang sama
7. **Konsistensi Dua Lapis (Action + RLS)**: Guard di Server Action/API Route dan kebijakan RLS/RPC di database harus memberlakukan aturan yang identik. Dilarang melonggarkan RLS (`USING (true)`) demi membuat fitur frontend berjalan.
8. **Sinkronisasi Navigasi UI dengan Guard Server**: Menu dan tombol di UI (`DesktopSidebar`, `MobileNav`, `MoreSheet`, halaman admin) wajib mengevaluasi seluruh daftar `user.roles[]` menggunakan helper izin yang sama dengan Server Action, sehingga pengguna tidak pernah melihat menu yang berujung `"Unauthorized"`.
9. **Audit Log Append-Only**: Tabel `audit_logs` bersifat *append-only*. Tidak ada peran (termasuk `super_admin`) yang boleh mengubah atau menghapus catatan audit melalui aplikasi.
10. **Larangan Self-Review**: Tidak ada pengguna dari peran mana pun yang boleh menyetujui/menolak laporan harian, koreksi presensi, atau penyelesaian tugas miliknya sendiri.
11. **Perlindungan Super Admin Terakhir**: Sistem wajib menolak penghapusan atau penurunan peran `super_admin` aktif terakhir, serta melarang admin mengubah perannya sendiri tanpa persetujuan `super_admin` lain.
12. **Bucket Privat & Signed URL**: Lampiran tugas (`task-attachments`) dan dokumen sensitif wajib disimpan di bucket privat dengan kebijakan `storage.objects` berbasis kepemilikan/akses tugas, serta diakses hanya lewat *signed URL* berumur pendek setelah verifikasi akses.

---

## 3. Matriks Permission Kanonik per Modul

Legenda: **S** = `santri`, **K** = `koordinator`, **P** = `pengurus`, **Y** = `yayasan`, **SA** = `super_admin`.

### 3.1 Identity & Access Management (`PRD-01`)
| Permission | S | K | P | Y | SA | Aturan Scope & Validasi |
|---|---|---|---|---|---|---|
| `iam.account.request.read` | — | — | — | — | `all` | Hanya melihat daftar pengajuan akun baru. |
| `iam.account.decide` | — | — | — | — | `all` | Approve/reject akun baru + penetapan peran awal via RPC atomik. |
| `iam.account.suspend` | — | — | — | — | `all` | Aktivasi/suspensi akun & pencabutan sesi (`session_revoked_at`). |
| `iam.role.assign` | — | — | — | — | `all` | Wajib menjaga minimal 1 `super_admin` aktif; dilarang self-escalation. |
| `iam.user.read` | — | `team` | `all` | `all` | `all` | Profil dasar & daftar peran aktif. |
| `iam.audit.read` | — | — | — | `all` | `all` | `pengurus` ditolak membaca log audit IAM. |
| `iam.session.revoke` | — | — | — | — | `all` | Memaksa logout global pengguna tertentu. |

> **Catatan `ROLE-SYNC` (2026-11-25):** tanda `—` pada baris `iam.account.request.read`, `iam.account.decide`, `iam.account.suspend`, `iam.role.assign`, dan `iam.session.revoke` kini benar-benar ditegakkan pada lapisan Server Action: `getAccountRequestsAction`, `approveAccountApplicationAction`, `rejectAccountApplicationAction`, `createManualAccountAction`, `adminUpdateUserAction`, `resetUserSessionAction`, dan `revokeDeviceTokenAction` seluruhnya memanggil `requireRole(["super_admin"])`. Sebelumnya guard aksi meloloskan `pengurus` (decide/suspend/session) dan `yayasan` (request.read), dan seed `role_permissions` warisan `20261102000005` memberikan grant yang sama di database, sehingga matriks §3.1 bukan aturan yang efektif; seed dikoreksi oleh migrasi `20261122000010_role_sync_ustadz_and_matrix.sql`. `iam.user.read` tetap (`P`/`Y`/`SA`), dan hanya layar `/admin/users` sebagai pembaca.
>
> Tabel `account_requests` dibaca antrean hanya atas izin `iam.account.request.read`, sehingga policy RLS `20261101000003` tidak lagi mati. Tidak ada lagi perbandingan peringkat peran: `ROLE_PRIORITY`/`getHighestRole`/`hasMinimumRole` dihapus dari `src/lib/auth/guards.ts` dan satu-satunya urutan yang tersisa adalah penyajian `roles[]` di `src/lib/auth/session.ts`. "Target berada pada hierarki setara atau lebih tinggi" bukan lagi dasar penolakan di TypeScript — penolakan berasal dari pasangan `(permission, scope)` dan dari invarian `super_admin` aktif terakhir yang dimiliki RPC `app.admin_update_user()` (§2 aturan 11).
>
> Pemisahan `role` vs `member_type` (§2 aturan 1) berlaku pada seluruh jalur tulis: `app.approve_account_application()` menyimpan kategori dari klaim pendaftaran (`claimed_member_type`), bukan dari peran yang ditetapkan, dan `app.admin_update_user()` menerima `p_new_role_key` (hak akses, ditulis ke `user_roles`) terpisah dari `p_member_type` (kategori deskriptif, ditulis ke `profiles.member_type`) sehingga mengubah peran tidak lagi menimpa kategori dan sebaliknya. Layar `/admin/users` menampilkan keduanya berdampingan dan chip/filter **Ustadz** dihitung dari `member_type`, bukan dari `role`.

### 3.2 Resource Library (`PRD-02`)
| Permission | S | K | P | Y | SA | Aturan Scope & Validasi |
|---|---|---|---|---|---|---|
| `library.resource.read` | `internal` | `published` | `published+` | `published+` | `published+` | `restricted` wajib lolos aturan tabel `resource_visibility_rules` (role/team). |
| `library.resource.create` | — | `team/own` | `all` | `all` | `all` | Koordinator hanya dapat membuat draft/resource pada kategori timnya. |
| `library.resource.update` | — | `own` | `all` | `all` | `all` | Koordinator hanya dapat menyunting resource yang dibuatnya sendiri. |
| `library.resource.archive` | — | — | `all` | `all` | `all` | Pengarsipan & penghapusan lunak resource. |
| `library.taxonomy.manage` | — | — | `all` | `all` | `all` | Manajemen kategori & tag library. |
| `library.import.run` | — | — | — | — | `all` | **Eksklusif `super_admin`**; impor CSV atomik per baris dengan log batch. |
| `library.export` | — | — | `all` | `all` | — | Ekspor metadata library sesuai visibilitas pemanggil. |
| `library.revision.restore` | — | — | `all` | `all` | `all` | Pemulihan versi revisi dokumen sebelumnya. |

> **Catatan `D6` (LIB-02):** baris `resource_visibility_rules(resource_id, role_key, team_id)` adalah satu-satunya jalur menuju resource `restricted`; tidak ada peran — termasuk `super_admin` — yang mendapat cabang blanket. Grant dibaca oleh policy `resources` melalui `app.can_view_resource()` (role aktif + keanggotaan tim aktif), dan ditulis hanya lewat `app.resource_rule_set()` pada tier `library.resource.update` (`P`/`Y`/`SA`) dengan baris `audit_logs` pada transaksi yang sama.
>
> **Catatan `LIB-03` / `LIB-08`:** satu kali simpan resource adalah satu transaksi di `app.resource_upsert(p_resource_id, p_row, p_tag_names, p_change_note)` pada tier `library.resource.create/update` (`P`/`Y`/`SA`): baris `resources`, buku tag (`tags` + `resource_tags`), appending `resource_revisions` (nomor dari `max(revision_no)+1` di bawah `FOR UPDATE` baris resource) dan baris `audit_logs` (`library.resource_saved`) — jalur simpan tidak lagi menulis `resources`/`tags`/`resource_revisions` dari aplikasi, sehingga `created_by`, `updated_by`, dan seluruh tanggal berasal dari sesi & jam database. Label `visibility`/`status` divalidasi terhadap enum katalog dan tabrakan `slug`/`legacy_record_id` ditolak dengan pesan, bukan nama constraint. Impor CSV (`library.import.run`, tetap eksklusif `super_admin`) memakai RPC yang sama per baris; hanya log batch `resource_import_batches` yang masih ditulis dengan klien service-role. **Selisih yang dilaporkan:** `setResourceArchiveAction` masih berupa `resources.update` tunggal tanpa revision dan tanpa audit — temuan terpisah, tidak diubah pada item ini.
>
> **Selisih `ROLE-SYNC` (2026-11-25), dilaporkan tidak diubah:** `importMembersCsvAction` (`src/modules/operations/actions.ts`) masih `requireRole(["super_admin", "pengurus"])` padahal baris `library.import.run` di atas eksklusif `super_admin`, dan kolom `member_type` pada CSV disalin ke `account_requests.role_requested` — kategori dipakai sebagai peran, lawan dari §2 aturan 1. Perbaikan ini berada di luar cakupan item `ROLE-SYNC` dan menunggu persetujuan cakupan pada Tahap A tersendiri.

### 3.3 Attendance (`PRD-03`)
| Permission | S | K | P | Y | SA | Aturan Scope & Validasi |
|---|---|---|---|---|---|---|
| `attendance.checkin` | `own` | `own` | `own` | `own` | — | Dihitung WIB (`Asia/Jakarta`) di DB; diblokir pada hari libur/Ahad sesuai kalender. |
| `attendance.record.read` | `own` | `team` | `all` | `all` | — | `pengurus` & `yayasan` juga dapat melihat riwayat presensi `own` miliknya sendiri. |
| `attendance.correction.request` | `own` | `own` | `own` | `own` | — | Pengajuan koreksi absensi pribadi. |
| `attendance.correction.review` | — | — | `assigned/all` | `all` | — | Wajib `pengurus` atau `yayasan`; dilarang self-review; `koordinator` ditolak. |
| `attendance.exception.manage` | — | — | `all` | — | — | Pencatatan izin/sakit/dispensasi resmi. |
| `attendance.manual_entry` | — | — | `all` | — | — | Input presensi manual beraudit. |
| `attendance.policy.manage` | — | — | — | `approve` | `propose/exec` | `super_admin` mengajukan/mengeksekusi konfigurasi; `yayasan` menyetujui. |
| `attendance.report.export` | — | — | `all` | `all` | — | `super_admin` ditolak ekspor data presensi. |

> **Catatan `ROLE-SYNC` (2026-11-25):** `attendance.record.read` sebelumnya belum pernah di-seed, sehingga clause RLS yang membacanya (`20261101000003`) mati dan policy peninggalan `20261102000005` menyerahkan seluruh baris kepada `super_admin`/`yayasan`/`pengurus` sementara `koordinator` — yang §3.3 beri `team` — tidak mendapat apa-apa selain barisnya sendiri. Migrasi `20261122000010_role_sync_ustadz_and_matrix.sql` menanam grant sesuai matriks (`santri`=`own`, `koordinator`=`team`, `pengurus`/`yayasan`=`global`, `super_admin` tanpa grant) dan memindahkan keputusan scope ke `app.permission_scope('attendance.record.read')` → `app.can_view_attendance_of(p_target)`. `getAttendanceHistoryAction` tidak lagi menilai siapa yang boleh dibaca: ia membaca lewat klien sesi (bukan service-role, yang mengabaikan RLS) sehingga policy yang menjawab, dan kolom `scope` akhirnya benar-benar menentukan sesuatu. Kewajiban presensi harian (`app.refresh_attendance_effective`) ikut dipindahkan dari `profiles.member_type` ke peran aktif di `user_roles`, sehingga santri berkategori `ustadz` tetap tercatat wajib presensi (§2 aturan 1 dan 4).
>
> **Terverifikasi di CI (run `45541771333`), dua cacat tipe yang ikut diperbaiki:** `app.admin_update_user()` tidak pernah bisa mengubah status akun — `profiles.status` bertipe `account_status_type` sedangkan parameternya `text`, sehingga `COALESCE(p_status, status)` gagal di-parse; suspend/reaktivasi dari `/admin/users` selalu gagal diam-diam. Dan `app.refresh_attendance_effective()` sudah rusak sejak `20261114000007`: lookup koreksinya `COALESCE(c.effective_classification /* text */, c.requested_classification /* enum */)`, dan karena fungsi ini dipanggil `trg_refresh_attendance_after_record`, **setiap `INSERT INTO attendance_records` error pada database yang dibangun dari rantai migrasi**. Keduanya sekarang di-cast eksplisit. Untuk produksi: `20261114000007` diterapkan manual, jadi definisi fungsi di sana belum tentu sama — periksa `SELECT prosrc FROM pg_proc ... proname = 'refresh_attendance_effective'` sebelum menyimpulkan presensi harian pernah rusak di produksi.
>
> **Selisih `ROLE-SYNC` (2026-11-25), ditutup oleh `TEMPORAL` di bawah:** `20261102000012` menambahkan aturan "Ahad selalu non-operasional" ke lapisan efektif (`EXTRACT(DOW FROM p_date) = 0 → 'non_operational'`), dan `20261114000007` menulis ulang fungsi itu tanpa klausa tersebut — jadi sejak saat itu Ahad tanpa baris eksplisit di `non_operational_dates` tercatat `no_checkin`/wajib, bukan non-operasional. Blokir check-in Ahad sendiri masih hidup (`20261102000003:153`, `20261102000013:45`).

> **Catatan `TEMPORAL` (2026-11-25, Gelombang 3 item 1):** aturan "hari libur/Ahad sesuai kalender" pada baris `attendance.checkin` di atas kini benar-benar satu sumber dan berlaku di kedua lapisan. Migrasi `20261122000011_attendance_temporal_rules.sql`:
>
> 1. `app.is_operational_day(p_date)` — non-operasional bila tanggalnya Ahad **atau** terdaftar di `non_operational_dates`. `app.refresh_attendance_effective()` dan `app.attendance_check_in()` sama-sama bertanya ke fungsi ini, sehingga penutup kalender kini ikut memblokir check-in (sebelumnya hanya Ahad yang memblokir) dan Ahad kembali menjadi `non_operational`/`calendar` di lapisan efektif. Klausa ROLE-SYNC (kewajiban dari `user_roles`, bukan `member_type`) dipertahankan.
> 2. Aritmetika batas jam dipindah ke fungsi murni agar bisa diletakkan di atas garis: `app.classify_checkin_time(p_time, p_cutoff, p_grace)` = `on_time` sampai menit cut-off inklusif (`<= cutoff + 59 detik`, warisan `20261102000013:49`), `grace` sampai menit toleransi inklusif, `late` sesudahnya; `minutes_after_deadline` dihitung dari cut-off dan tidak pernah negatif. pgTAP mengikat 07:59/08:00/08:00:59 → `on_time`, 08:01/08:15/08:15:59 → `grace`, 08:16 → `late` (16 menit), 09:30 → 90 menit, 07:00 → 0 menit.
> 3. Pemicu `trg_refresh_attendance_after_calendar` pada `non_operational_dates` menyegarkan tanggal yang ditutup **dan** tanggal yang dibuka kembali; tanpa ini cron hanya menyegarkan hari ini sehingga baris salah permanen.
> 4. `app.backfill_non_operational_effective(p_from, p_to)` memperbaiki baris lama yang ditulis cacat ini (Ahad/tanggal tertutup menjadi `non_operational`/`calendar`), dipanggil sekali saat migrasi atas rentang tabel, idempoten dan terbatas rentang; pembungkus `public.` hanya untuk `service_role`. Tidak ada pelonggaran grant: `authenticated` tetap tidak dapat menulis kalender penutupan (pgTAP mengikat `42501`).
> 5. Lapisan tampilan: `EFFECTIVE_STATUS_LABELS` kini wajib menutup seluruh status `CHECK` lapisan efektif, sehingga `non_operational` ("Hari Non-Operasional") dan `not_required` ("Tidak Wajib Presensi") muncul di riwayat pribadi alih-alih hilang dari daftar, dan keduanya tidak menawarkan form koreksi.
>
> **Dugaan yang belum terverifikasi:** baris `attendance_effective` produksi untuk Ahad-ahad sejak 2026-11-14 jumlahnya belum dihitung dari sisi ini (akses produksi hanya SELECT-terbatas pada item sebelumnya); `RAISE NOTICE` saat migrasi melaporkan angka perbaikannya. Cron pengingat (`cron_job_schedules.attendance_reminder`) secara default berhari `{1,2,3,4,5,6}` sehingga spam "ayo presensi" pada Ahad hanya terjadi bila operator menambahkan hari 0. **Catatan `CRON-DAY` di bawah menunjukkan angka 0 itu memang dapat dipilih admin**, jadi dugaan di atas bukan kasus mustahil.

> **Catatan `CRON-DAY` (2026-11-25, menindaklanjuti catatan §7 `TEMPORAL` yang disetujui operator):** aturan hari kini ditanyakan ke database, bukan disimpulkan dari ada/tidaknya baris snapshot. Migrasi `20261122000012_attendance_reminder_day_guard.sql` menanam pembungkus `public.is_operational_day(p_date)` — `SECURITY DEFINER`, `search_path` terkunci ke `public, app, pg_temp`, `STABLE`, **hanya** `service_role` (tidak ada grant untuk `authenticated`/`anon`, sehingga kalender pondok tidak menjadi daftar yang bisa dijajak akun masuk) — yang hanya meneruskan `app.is_operational_day()` warisan `20261122000011`; file migrasinya sengaja tidak memuat aritmetika tanggal kedua. Di `src/app/api/cron/notifications/route.ts`, `attendance_reminder` dinyatakan due hanya bila `operationalToday === true` — bukan `!== false` — sehingga jawaban `NULL` ikut menahan pengiriman, dan kegagalan baca **melempar** (cron menandai `cron_job_runs` gagal) alih-alih menebak. Tanpa penjaga ini dua jalur masih mengirim "Batas waktu presensi pagi hampir ditutup" pada hari non-operasional: fallback ketika `refresh_attendance_effective` gagal (audiens diambil dari `attendance_records`, bukan `status = 'no_checkin'`) dan pilihan **"Min"** pada papan hari `src/app/(app)/admin/cron/page.tsx:12`.
>
> **Yang sengaja tidak dijaga:** `report_reminder` tidak membaca aturan hari. §3.4 menetapkan tenggat laporan harian pukul 21.00 tanpa pengecualian kalender, jadi hari penutupan tetap menagih laporan; mengubahnya butuh baris matriks tersendiri, bukan inisiatif item ini.
>
> **Selisih `CRON-DAY` yang dilaporkan, tidak diubah:** daftar penerima pengingat masih diturunkan dari `profiles.member_type = 'santri'` (`src/app/api/cron/notifications/route.ts:110`). §2 aturan 1 melarang kewajiban/hak diturunkan dari `member_type`, dan ROLE-SYNC + TEMPORAL sudah memindahkan aturan kewajiban presensi ke `user_roles` di lapisan efektif — sehingga santri berkategori `ustadz` yang perannya `santri` tercatat wajib presensi namun tidak pernah menerima pengingat, sementara pengguna berkategori `santri` tanpa peran aktif tetap masuk daftar (dan daftar yang sama juga dipakai penagih laporan harian). Perbaikannya menyentuh dua penagih sekaligus dan butuh keputusan "siapa wajib melapor harian" → dibawa ke branch People/Import, tidak diloloskan diam-diam di sini.

### 3.4 Activity Reports (`PRD-04`)
| Permission | S | K | P | Y | SA | Aturan Scope & Validasi |
|---|---|---|---|---|---|---|
| `report.create/update/submit` | `own` | `own` | `own` | `own` | — | Batas waktu & status `is_late` (> 21.00 WIB) dihitung otomatis di DB. |
| `report.read` (isi laporan) | `own` | `assigned` | `assigned` | `terbatas` | — | **Privasi ketat:** `pengurus` & `koordinator` hanya membaca isi laporan yang ditugaskan (`reviewer_assignments`); `yayasan` melihat ringkasan kepatuhan atau isi jika diberi izin eksplisit; `super_admin` ditolak (`—`). |
| `report.review` | — | `assigned` | `assigned` | — | — | Wajib terdaftar di `reviewer_assignments` aktif; dilarang self-review. |
| `report.reopen` | — | — | `assigned` | — | — | Membuka kembali laporan yang sudah direview untuk revisi. |
| `report.reviewer.reassign` | — | — | `all` | — | `terbatas` | Pengalihan reviewer harian secara atomik & beraudit. |
| `report.compliance.read` | — | `team` | `all` | `all` | — | Hanya metadata status pengumpulan/kepatuhan (tanpa isi teks laporan). |
| `report.export` | — | — | `all` | `all` | — | Wajib menerapkan `filter_criteria` & scope pemanggil. |

> **Catatan `TEMPORAL` (2026-11-25):** "> 21.00 WIB" kini punya satu rumah yang bisa diuji: `app.report_time_is_late(p_now, p_deadline)` = `p_now > p_deadline`, dipakai `app.save_report()` (salinan verbatim `20261122000002:450-615` dengan satu baris ini yang berubah). Garis yang diikat pgTAP: 20:59:59 dan 21:00:00 **tidak** terlambat, 21:00:01 terlambat — berbeda dari presensi yang memberi toleransi 59 detik di dalam menit batas. **Selisih yang dilaporkan, tidak diubah:** `app.report_submit(uuid, uuid)` warisan `20261101000004:124-130` masih menghitung `is_late` terhadap `' 21:00:00'` hasil concatenation tanggal laporan, bukan `policy_settings.report_deadline_time`, sehingga jika suatu kebijakan menggeser deadline kedua fungsi itu tidak sependapat. Fungsi tersebut sudah di-`REVOKE` dari `authenticated` (`20261102000003:265-266`), tidak punya pembungkus `public.`, dan tidak dipanggil kode mana pun — jadi jalur live aman; ia kandidat penghapusan, bukan perbaikan.
>
> **Catatan `DEAD-RPC` (2026-11-25, kandidat di atas ditutup sesuai persetujuan operator):** `app.report_submit(uuid, uuid)` dihapus oleh `20261122000013_drop_dead_report_submit.sql` bersama pembungkus `public.` yang memang tidak pernah ada (`DROP ... IF EXISTS` keduanya). Alasannya bukan hanya dead code: selain deadline `' 21:00:00'` yang tetap, fungsi itu `SET search_path = public, app` **tanpa `pg_temp`** (pra-hardening) dan menerima `p_user_id` dari pemanggil alih-alih `auth.uid()` — dua hal yang melanggar §2 dan akan diwarisi siapa pun yang "menghidupkan kembali" fungsi itu. Rollback `supabase/rollback/20261122000013_drop_dead_report_submit_down.sql` menanam pre-image verbatim `20261101000004:91-158` beserta kedua `REVOKE` `20261102000003:265-266`, sehingga hasil rollback sama tidak tercapainya seperti semula. Migrasinya gagal tertutup bila salah satu dari `app.save_report`/`public.save_report` (uuid, date, text, boolean, jsonb) atau `app.review_report`/`public.review_report` (uuid, integer, text, text, text) tidak ada, jadi file ini tidak dapat dipakai untuk merobohkan layar setor/laporan. pgTAP `supabase/tests/attendance_reminder_day_guard.sql` mengikat nama `report_submit` hilang di semua schema dan jalur hidup tetap ada.

### 3.5 Tasks & Projects (`PRD-05`)
| Permission | S | K | P | Y | SA | Aturan Scope & Validasi |
|---|---|---|---|---|---|---|
| `task.read` | `assigned/own` | `team` | `all` | `all` | — | `organization` task dapat dibaca seluruh anggota aktif non-SA. |
| `task.create` | `own` | `team` | `all` | `all` | — | Santri hanya tugas pribadi; Koordinator hanya pada timnya. |
| `task.assign` | — | `team` | `all` | `all` | — | Koordinator wajib diverifikasi sebagai anggota/koordinator aktif `team_id` target. |
| `task.update_status` | `assignee` | `team` | `all` | — | — | Koordinator berhak mengubah status tugas dalam timnya via `app.task_transition`. |
| `task.review` | — | `team` | `all` | — | — | Dilarang self-review oleh assignee tugas. |
| `task.cancel/reopen` | — | `team` | `all` | `all` | — | Wajib mengikuti matriks transisi status yang sah. |
| `project.create/update` | — | `team` | `all` | `all` | — | Koordinator terbatas pada proyek milik timnya. |
| `project.read` | `anggota` | `team` | `all` | `all` | — | Sesuai visibilitas proyek & keanggotaan tim. |
| `task.export` | — | — | `all` | `all` | — | `super_admin` ditolak ekspor data tugas. |

### 3.6 Schedules & Announcements (`PRD-06`)
| Permission | S | K | P | Y | SA | Aturan Scope & Validasi |
|---|---|---|---|---|---|---|
| `schedule.event.read` | `audiens` | `audiens` | `all` | `all` | — | Event berstatus `cancelled`/`deleted` disembunyikan dari daftar aktif. Hari occurrence yang dibatalkan disembunyikan dari daftar pengguna dan tetap tampil di panel admin dengan lencana `Dibatalkan` — lihat catatan `SCH-08`. |
| `schedule.event.create/update/delete` | — | `team` | `all` | `all` | — | **DB Constraint:** audiens dinilai ulang oleh `app.can_write_event_audience()` dan dipaksa oleh pemicu `trg_events_audience_scope`; koordinator hanya boleh beralamat ke tim yang ia koordinatori. |
| `announcement.read` | `audiens` | `audiens` | `all` | `all` | — | Difilter berdasarkan target audiens aktif (`user_roles`, `team_members`, `user_id`). |
| `announcement.create/publish` | — | `team` | `all` | `all` | — | Koordinator hanya dapat mempublikasikan pengumuman untuk timnya sendiri. |
| `announcement.archive` | — | `team` | `all` | `all` | — | Koordinator hanya untuk pengumuman timnya. |
| `announcement.read_stats` | — | `own` | `all` | `all` | — | Statistik keterbacaan pengumuman. |
| `schedule.marker.manage` | — | — | `all` | `all` | `all` | Penanda hari libur/efektif kalender pondok. |

> **Catatan `SCH-01`:** pembatalan **satu hari** dari agenda berulang memakai tier `schedule.event.update` (`P`/`Y`/`SA`) dan tersimpan sebagai baris `event_occurrence_exceptions(event_id, occurrence_date)` — `occurrence_date` adalah tanggal kalender WIB `Asia/Jakarta`, bukan id agenda baru. Seluruh operasi lain (`update`/`delete`/`cancel`) tetap beralamat ke baris `events` milik seri, sehingga kunci tampilan `<uuid>:<tanggal>` wajib diurai sebelum menyentuh Postgres. Tanggal yang bukan hasil pengulangan (mis. hari Selasa untuk aturan `weekly`), berada di luar `recurrence_until`/horizon 180 hari, atau milik seri yang sudah `cancelled`/dihapus **ditolak**. Tulis hanya lewat `app.event_occurrence_set()` dengan baris `audit_logs` (`event.occurrence_cancelled` / `event.occurrence_restored`) pada transaksi yang sama. **Selisih yang dilaporkan:** baris `schedule.event.read` di atas menyatakan agenda `cancelled` disembunyikan dari daftar aktif, namun daftar saat ini menampilkan occurrence yang dibatalkan dengan badge `Dibatalkan` agar pengurus masih bisa memulihkannya; keputusan penyembunyian penuh ditunda ke `SCH-02`. **Selisih ini ditutup oleh catatan `SCH-08` (keputusan operator 2026-11-24).**

> **Catatan `SCH-02`:** matriks ini lama mengklaim "DB Constraint" untuk audiens agenda, padahal seluruh tulis `events` dijalankan dengan *service role* (`auth.uid()` = `NULL`), satu-satunya policy pada `events` adalah `FOR SELECT`, dan `createEventAction`/`updateEventAction` tidak memanggil `requireRole()` sama sekali. Sekarang:
>
> - **Satu path tulis.** `app.event_upsert(p_event_id, p_payload, p_note)` dan `app.event_cancel(p_event_id, p_status, p_reason)` menjadi satu-satunya jalan create/update/cancel/delete; keduanya berjalan pada **sesi pemanggil** (`createClient()`), memvalidasi `auth.uid()` + `app.is_active_member()` + tier peran sesuai baris matriks, mengunci baris dengan `FOR UPDATE`, menulis `audit_logs` pada transaksi yang sama, dan menyimpan baris lama ke `event_revisions` (`revision_no` dihitung dalam statement yang sama sehingga tidak lagi bisa bertabrakan).
> - **Satu helper audiens.** `app.can_write_event_audience(p_audience, p_team_id, p_event_id)` menjawab "audiens mana yang boleh ditulis sesi ini": pengurus/yayasan/super_admin boleh `all`/`team`/`users`/`custom`; koordinator hanya `team` yang seluruhnya ia koordinatori (`team_members.team_role = 'coordinator'`, `valid_to IS NULL`, tim `active`; `team_id` lama dapat terisi id, slug, atau nama sehingga ketiga bentuk diterima).
> - **Aturan di tabel, bukan hanya di RPC.** `trg_events_audience_scope` (`BEFORE INSERT OR UPDATE OF audience_config`) menolak sesi yang tidak aktif dan audiens di luar tier dengan `SQLSTATE 42501`, sehingga tulis dari jalan lain pun tetap tertahan.
> - **`member_type` ditutup untuk tulis.** Aturan §2 nomor 1 melarang menurunkan hak akses dari `profiles.member_type`; helper mengembalikan `false` untuk semua tier dan formulir agenda tidak lagi menawarkan pilihan itu. Jalur **baca** (`app.can_view_audience`, `filterByAudience`, suapan ICS, outbox notifikasi) sengaja belum diubah agar audiens `member_type` yang sudah tersimpan tetap tampil sampai ada keputusan backfill data.
> - **Sunting tidak melebarkan audiens (`SCH-07`).** Ketika audiens tersimpan tidak dapat dinyatakan picker — `member_type`, `users`, atau `team_id` lama yang tidak resolve — formulir mengirim **tanpa** kunci `audience` (bukan `null`) disertai opsi "Audiens tersimpan (tidak diubah)"; `app.event_upsert()` hanya memakai nilai baru bila kuncinya ada, sehingga sunting judul/waktu tidak mengubah siapa yang boleh melihat agenda.
> - **Waktu dihitung di database.** Teks naive `YYYY-MM-DDTHH:mm` dari `<input type="datetime-local">` diselesaikan dengan `AT TIME ZONE 'Asia/Jakarta'` oleh RPC, bukan `new Date(...)` di proses server yang zona waktunya bisa berbeda (§2 nomor 5).
>
> **Selisih yang dilaporkan:** (1) kolom `SA` pada baris `schedule.event.*` bertanda `—`, namun `super_admin` tetap ada dalam tier di kode karena alur operator; pilih — cabut `super_admin` dari RPC, atau isi kolom `SA` menjadi `all`. (2) Tulis dengan *service role* (mis. *backfill* internal) tetap menembus pemicu karena tidak membawa sesi. (3) Penafsiran WIB mengubah *instant* absolut agenda baru/hasil sunting; sebelum perbaikan, sunthing dapat menggeser waktu agenda **+7 jam**. (4) Penyembunyian occurrence `cancelled` (janji `SCH-01` di atas) masih tertunda → **ditutup oleh catatan `SCH-08`**.
>
> **Catatan `SCH-08`:** keputusan operator 2026-11-24 untuk occurrence yang dibatalkan (`SCH-01`): **halaman pengguna (`/jadwal`, beranda) menyembunyikan hari yang dibatalkan** — bagi santri/coordinator hari itu tidak ada; **panel admin (`/admin/jadwal`) tetap menampilkannya** dengan lencana `Dibatalkan` agar dapat dipulihkan. Karena keduanya memakai `getEventsAction`, panel admin memanggil `getEventsAction({ includeCancelledOccurrences: true })` dan diberi kunci cache sendiri (`admin:events:<uid>`) supaya dua set baris berbeda tidak saling menimpa pada kunci `events:<uid>`. Suapan ICS (`/api/calendar/feed`) ikut semantics yang sama: agenda berulang diterbitkan sebagai **satu** `VEVENT` dengan `RRULE` (`FREQ=WEEKLY;BYDAY=…` / `FREQ=DAILY`) `UNTIL` pada *instant* occurrence terakhir dalam horizon 180 hari yang sama dipakai permukaan jadwal, plus `EXDATE` per hari yang dibatalkan; pembacaan `events`/`event_occurrence_exceptions` yang gagal menjadi **500**, bukan kalender kosong yang kemudian di-cache klien. Penyaring audiens suapan tidak berubah (masih memakai interpretasi lama, termasuk `member_type` historis).
>
> **Catatan `SCH-09`:** validasi bentrok lokasi/waktu tidak lagi membandingkan dua interval tersimpan. `app.event_upsert()` bertanya ke `app.event_slot_taken()`, yang menghitung hari dengan `app.event_occurrence_spans()` (satu-satunya tempat aritmetika tanggal seri berada di SQL: tanggal dasar WIB, langkah hari penuh — harian 1, mingguan 7, dipotong `recurrence_until` row itu sendiri). Agenda masuk dikembangkan sepanjang *footprint*-nya sendiri (`recurrence_until`, jika kosong horizon 180 hari yang dapat dirender klien); kandidat lain di lokasi yang sama dikembangkan pada hari-hari agenda masuk, sehingga seri lama yang baru bertabrakan 30 minggu kemudian tetap tertahan sebelum ditulis. **Batas yang sengaja dipertahankan:** seri tanpa akhir divalidasi hanya untuk 180 hari, hari yang dibatalkan `app.event_occurrence_set()` tetap memesan slotnya (RPC yang sama dapat memulihkan hari itu dan akan menciptakan *double booking*), dan agenda yang intervalnya melewati tengah malam dibandingkan sebagai hari dasarnya saja.

### 3.7 People & Teams (`PRD-07`)
| Permission | S | K | P | Y | SA | Aturan Scope & Validasi |
|---|---|---|---|---|---|---|
| `people.profile.read` (dasar) | `all` | `team` | `all` | `all` | `all` | Nama, foto, peran, kategori (`member_type`), dan tim aktif. |
| `people.profile.read_contact` (WA/HP) | `own` | `team` | `all` | `all` | `terbatas` | Role pemanggil **wajib** dibaca dari sesi server (`resolveIdentity`), dilarang dari parameter klien; SA hanya untuk dukungan teknis dan wajib tercatat di `audit_logs`. |
| `people.profile.update_self` | `own` | `own` | `own` | `own` | `own` | Bio, foto profil, preferensi pengingat. |
| `people.profile.update_structural` | — | — | `all` | — | `all` | Perubahan `member_type`, flag kewajiban absen/laporan, dan penempatan struktural. |
| `team.create/archive` | — | — | `all` | `all` | `all` | Yayasan termasuk dalam daftar peran yang berwenang. |
| `team.member.manage` | — | `team` | `all` | `all` | `all` | Koordinator hanya mengelola anggota tim yang dipimpinnya. |
| `team.coordinator.set` | — | — | `all` | `all` | `all` | Penetapan koordinator tim. |
| `reviewer.assign` | — | — | `all` | `all` | `all` | Penugasan reviewer laporan/absensi. |
| `people.history.read` | `own` | `team` | `all` | `all` | `all` | Riwayat keanggotaan & perubahan struktural. |

> **Catatan `PPL-01`:** tiga baris di atas (`team.member.manage`, `team.coordinator.set`, `reviewer.assign`) berlaku untuk `P`/`Y`/`SA`, dan sejak migrasi `20261122000007` server action, halaman `/admin/people`, serta RPC-nya sependapat: `app.team_set_coordinator`, `app.team_member_set`, `app.team_member_end`, dan `app.assign_reviewer` semuanya meminta `has_any_role('super_admin', 'yayasan', 'pengurus')` setelah `app.is_active_member()` — tanpa rank. Penulisan keanggotaan tidak lagi lewat klien service-role: `valid_from`/`valid_to` adalah tanggal kalender WIB `Asia/Jakarta` yang dihitung database, keanggotaan lama ditutup (baris riwayat tidak dihapus), kursi koordinator tetap satu lewat `idx_one_active_coordinator_per_team`, dan setiap perubahan menulis `audit_logs` (`people.team_coordinator_set` / `people.team_member_added` / `people.team_member_removed` / `people.reviewer_assigned`) pada transaksi yang sama. `app.team_member_set` menolak `coordinator` agar hanya `team_set_coordinator` yang memiliki kursi tersebut. **Selisih yang dilaporkan:** daftar anggota di `getPeopleAction` memfilter `valid_to` dengan tanggal UTC klien — temuan PPL-03 dan tidak diubah pada item ini. (`updatePersonalBioAction` sudah tertutup pada `ROLE-SYNC` 2026-11-25: tanpa `hasMinimumRole`, ia menolak `caller.id !== userId` sesuai baris `people.profile.update_self` di atas, sehingga `pengurus` tidak lagi dapat menulis bio anggota lain.)

### 3.8 Analytics & Administration (`PRD-08`)
| Permission | S | K | P | Y | SA | Aturan Scope & Validasi |
|---|---|---|---|---|---|---|
| `analytics.team.read` | — | `team` | `all` | `all` | — | Koordinator hanya dapat melihat analitik timnya sendiri. |
| `analytics.org.read` | — | — | `all` | `all` | `terbatas` | SA hanya melihat metrik teknis/kesehatan sistem tanpa data privat santri. |
| `analytics.drilldown` | — | `team` | `all` | `all` | — | Mengikuti batas visibilitas modul asal (laporan/absensi/tugas). |
| `analytics.export` | — | — | `all` | `all` | — | **Ditolak untuk `super_admin`**; wajib memvalidasi `export_type` & `filter_criteria`. |
| `admin.policy.propose` | — | — | — | — | `all` | Tanggal efektif menggunakan WIB (`Asia/Jakarta`). |
| `admin.policy.approve` | — | — | — | `all` | — | Persetujuan kebijakan oleh Yayasan. |
| `admin.settings.manage` | — | — | — | — | `all` | Pengaturan cron, integrasi, dan konfigurasi sistem. |
| `admin.audit.read` | — | — | — | `all` | `all` | **Ditolak untuk `pengurus`** (baik di Server Action maupun RLS `audit_logs`). |
| `admin.health.read` | — | — | — | — | `all` | Status kesehatan sistem, outbox, dan manifest backup. |

---

## 4. Keputusan Kebijakan yang Dikunci (`D1–D7` — Final)

Seluruh keputusan berikut telah ditetapkan untuk mencegah ambiguitas selama implementasi:

| # | Keputusan | Ketetapan Final | Dampak Teknis |
|---|---|---|---|
| **D1** | Akses `yayasan` terhadap isi laporan harian | **Opsi (b) — Ringkasan default; isi hanya jika diberi hak eksplisit** | RLS `daily_reports` membatasi `yayasan` hanya pada metadata kepatuhan kecuali ada grant/penugasan baca eksplisit. |
| **D2** | Makna `terbatas` pada `people.profile.read_contact` untuk `super_admin` | **Opsi (b) — Hanya saat dukungan teknis & wajib tercatat di `audit_logs`** | `revealContactNumberAction` mengizinkan `super_admin` hanya jika audit log berhasil ditulis secara atomik. |
| **D3** | Makna `terbatas` pada `analytics.org.read` untuk `super_admin` | **Opsi (a) — Hanya metrik kesehatan sistem & agregat teknis tanpa PII** | `getAdminDashboardStatsAction` memisahkan metrik kesehatan sistem (SA) dari metrik operasional santri (Pengurus/Yayasan). |
| **D4** | Apakah `yayasan` boleh mengubah status tugas (`task.update_status`)? | **Ditolak (`—`) sesuai PRD-05** | `yayasan` dapat membatalkan/membuka ulang (`task.cancel/reopen`) dalam kapasitas pengawasan, namun tidak mengeksekusi transisi kerja harian. |
| **D5** | Kebijakan MFA Login `super_admin` | **Pertahankan enforcement runtime AAL2 yang sudah aktif saat ini** | Penegakan TOTP AAL2 saat login tetap aktif di produksi; dokumentasikan ketetapan ini di `PRD-08` & `operator-release-gates.md`. |
| **D6** | Model visibilitas `restricted` pada Resource Library | **Role-based + Team-based melalui tabel `resource_visibility_rules`** | Buat tabel & RLS `resource_visibility_rules(resource_id, role_key, team_id)` sehingga resource `restricted` tidak terbuka menyeluruh. |
| **D7** | Apakah `koordinator` boleh membuat resource (`library.resource.create`)? | **Diizinkan terbatas pada tim/kategori miliknya (`team/own`)** | Koordinator dapat membuat & menyunting resource miliknya sendiri, namun pengarsipan & manajemen taksonomi tetap eksklusif `pengurus+`. |

---

## 5. Checklist Verifikasi Anti-Regresi (Wajib untuk Setiap Perbaikan)

Sebelum satu pun PR/branch dinyatakan selesai, agen IDE wajib membuktikan seluruh butir berikut:

- [ ] **Guard TypeScript**: Menggunakan helper `(permission, scope)` di `src/lib/auth/guards.ts`, tidak menggunakan `hasMinimumRole()` untuk modul dengan pengecualian peran.
- [ ] **Navigasi UI**: Item menu pada `DesktopSidebar`, `MobileNav`, dan `MoreSheet` hanya muncul jika `user.roles[]` memenuhi izin halaman tujuan.
- [ ] **Kebijakan RLS**: Tabel terkait memiliki kebijakan RLS yang selaras dengan §3 (tanpa `USING (true)` pada data sensitif).
- [ ] **RPC `SECURITY DEFINER`**: Memvalidasi `auth.uid()`, `is_active_member()`, `(permission, scope)`, dan mencatat audit log.
- [ ] **Tes Matriks 5 Peran + Multi-Role**: Unit & integration test menguji `santri`, `koordinator`, `pengurus`, `yayasan`, `super_admin`, serta kombinasi multi-peran (mis. `santri` + `koordinator`).
- [ ] **Tes Lintas Tim & Panggilan RPC Langsung**: Menguji bahwa `koordinator` Tim A ditolak saat mengakses/mengubah ID milik Tim B, baik melalui Server Action maupun panggilan PostgREST RPC langsung.
- [ ] **Migrasi Forward-Only + Rollback**: Perubahan skema dituangkan dalam file migrasi baru (`supabase/migrations/20261122...sql`) beserta skrip pemulihannya di `supabase/rollback/`.