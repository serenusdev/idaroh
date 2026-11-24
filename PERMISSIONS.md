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
| `schedule.event.read` | `audiens` | `audiens` | `all` | `all` | — | Event berstatus `cancelled`/`deleted` disembunyikan dari daftar aktif. |
| `schedule.event.create/update/delete` | — | `team` | `all` | `all` | — | **DB Constraint:** audiens dinilai ulang oleh `app.can_write_event_audience()` dan dipaksa oleh pemicu `trg_events_audience_scope`; koordinator hanya boleh beralamat ke tim yang ia koordinatori. |
| `announcement.read` | `audiens` | `audiens` | `all` | `all` | — | Difilter berdasarkan target audiens aktif (`user_roles`, `team_members`, `user_id`). |
| `announcement.create/publish` | — | `team` | `all` | `all` | — | Koordinator hanya dapat mempublikasikan pengumuman untuk timnya sendiri. |
| `announcement.archive` | — | `team` | `all` | `all` | — | Koordinator hanya untuk pengumuman timnya. |
| `announcement.read_stats` | — | `own` | `all` | `all` | — | Statistik keterbacaan pengumuman. |
| `schedule.marker.manage` | — | — | `all` | `all` | `all` | Penanda hari libur/efektif kalender pondok. |

> **Catatan `SCH-01`:** pembatalan **satu hari** dari agenda berulang memakai tier `schedule.event.update` (`P`/`Y`/`SA`) dan tersimpan sebagai baris `event_occurrence_exceptions(event_id, occurrence_date)` — `occurrence_date` adalah tanggal kalender WIB `Asia/Jakarta`, bukan id agenda baru. Seluruh operasi lain (`update`/`delete`/`cancel`) tetap beralamat ke baris `events` milik seri, sehingga kunci tampilan `<uuid>:<tanggal>` wajib diurai sebelum menyentuh Postgres. Tanggal yang bukan hasil pengulangan (mis. hari Selasa untuk aturan `weekly`), berada di luar `recurrence_until`/horizon 180 hari, atau milik seri yang sudah `cancelled`/dihapus **ditolak**. Tulis hanya lewat `app.event_occurrence_set()` dengan baris `audit_logs` (`event.occurrence_cancelled` / `event.occurrence_restored`) pada transaksi yang sama. **Selisih yang dilaporkan:** baris `schedule.event.read` di atas menyatakan agenda `cancelled` disembunyikan dari daftar aktif, namun daftar saat ini menampilkan occurrence yang dibatalkan dengan badge `Dibatalkan` agar pengurus masih bisa memulihkannya; keputusan penyembunyian penuh ditunda ke `SCH-02`.

> **Catatan `SCH-02`:** matriks ini lama mengklaim "DB Constraint" untuk audiens agenda, padahal seluruh tulis `events` dijalankan dengan *service role* (`auth.uid()` = `NULL`), satu-satunya policy pada `events` adalah `FOR SELECT`, dan `createEventAction`/`updateEventAction` tidak memanggil `requireRole()` sama sekali. Sekarang:
>
> - **Satu path tulis.** `app.event_upsert(p_event_id, p_payload, p_note)` dan `app.event_cancel(p_event_id, p_status, p_reason)` menjadi satu-satunya jalan create/update/cancel/delete; keduanya berjalan pada **sesi pemanggil** (`createClient()`), memvalidasi `auth.uid()` + `app.is_active_member()` + tier peran sesuai baris matriks, mengunci baris dengan `FOR UPDATE`, menulis `audit_logs` pada transaksi yang sama, dan menyimpan baris lama ke `event_revisions` (`revision_no` dihitung dalam statement yang sama sehingga tidak lagi bisa bertabrakan).
> - **Satu helper audiens.** `app.can_write_event_audience(p_audience, p_team_id, p_event_id)` menjawab "audiens mana yang boleh ditulis sesi ini": pengurus/yayasan/super_admin boleh `all`/`team`/`users`/`custom`; koordinator hanya `team` yang seluruhnya ia koordinatori (`team_members.team_role = 'coordinator'`, `valid_to IS NULL`, tim `active`; `team_id` lama dapat terisi id, slug, atau nama sehingga ketiga bentuk diterima).
> - **Aturan di tabel, bukan hanya di RPC.** `trg_events_audience_scope` (`BEFORE INSERT OR UPDATE OF audience_config`) menolak sesi yang tidak aktif dan audiens di luar tier dengan `SQLSTATE 42501`, sehingga tulis dari jalan lain pun tetap tertahan.
> - **`member_type` ditutup untuk tulis.** Aturan §2 nomor 1 melarang menurunkan hak akses dari `profiles.member_type`; helper mengembalikan `false` untuk semua tier dan formulir agenda tidak lagi menawarkan pilihan itu. Jalur **baca** (`app.can_view_audience`, `filterByAudience`, suapan ICS, outbox notifikasi) sengaja belum diubah agar audiens `member_type` yang sudah tersimpan tetap tampil sampai ada keputusan backfill data.
> - **Sunting tidak melebarkan audiens (`SCH-07`).** Ketika audiens tersimpan tidak dapat dinyatakan picker — `member_type`, `users`, atau `team_id` lama yang tidak resolve — formulir mengirim **tanpa** kunci `audience` (bukan `null`) disertai opsi "Audiens tersimpan (tidak diubah)"; `app.event_upsert()` hanya memakai nilai baru bila kuncinya ada, sehingga sunting judul/waktu tidak mengubah siapa yang boleh melihat agenda.
> - **Waktu dihitung di database.** Teks naive `YYYY-MM-DDTHH:mm` dari `<input type="datetime-local">` diselesaikan dengan `AT TIME ZONE 'Asia/Jakarta'` oleh RPC, bukan `new Date(...)` di proses server yang zona waktunya bisa berbeda (§2 nomor 5).
>
> **Selisih yang dilaporkan:** (1) kolom `SA` pada baris `schedule.event.*` bertanda `—`, namun `super_admin` tetap ada dalam tier di kode karena alur operator; pilih — cabut `super_admin` dari RPC, atau isi kolom `SA` menjadi `all`. (2) Tulis dengan *service role* (mis. *backfill* internal) tetap menembus pemicu karena tidak membawa sesi. (3) Penafsiran WIB mengubah *instant* absolut agenda baru/hasil sunting; sebelum perbaikan, sunthing dapat menggeser waktu agenda **+7 jam**. (4) Penyembunyian occurrence `cancelled` (janji `SCH-01` di atas) masih tertunda.

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

> **Catatan `PPL-01`:** tiga baris di atas (`team.member.manage`, `team.coordinator.set`, `reviewer.assign`) berlaku untuk `P`/`Y`/`SA`, dan sejak migrasi `20261122000007` server action, halaman `/admin/people`, serta RPC-nya sependapat: `app.team_set_coordinator`, `app.team_member_set`, `app.team_member_end`, dan `app.assign_reviewer` semuanya meminta `has_any_role('super_admin', 'yayasan', 'pengurus')` setelah `app.is_active_member()` — tanpa rank. Penulisan keanggotaan tidak lagi lewat klien service-role: `valid_from`/`valid_to` adalah tanggal kalender WIB `Asia/Jakarta` yang dihitung database, keanggotaan lama ditutup (baris riwayat tidak dihapus), kursi koordinator tetap satu lewat `idx_one_active_coordinator_per_team`, dan setiap perubahan menulis `audit_logs` (`people.team_coordinator_set` / `people.team_member_added` / `people.team_member_removed` / `people.reviewer_assigned`) pada transaksi yang sama. `app.team_member_set` menolak `coordinator` agar hanya `team_set_coordinator` yang memiliki kursi tersebut. **Selisih yang dilaporkan:** `updatePersonalBioAction` masih menyetornya dengan `hasMinimumRole(caller, "pengurus")` (bukan pasangan permission/scope) dan daftar anggota di `getPeopleAction` memfilter `valid_to` dengan tanggal UTC klien — keduanya temuan PPL-02/PPL-03 dan tidak diubah pada item ini.

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