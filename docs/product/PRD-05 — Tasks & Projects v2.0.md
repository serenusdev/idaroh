# PRD-05 — Tasks & Projects

**Versi:** 2.1 · **Keputusan audit:** 2026-11-13 (§14; NOW/v1.1 mengikat cakupan rilis, bukan klaim implementasi) · **Prefix:** TSK · **Rilis:** R3 · **Dibaca bersama:** Master PRD v2.0, PRD-01, PRD-07 **Label:** \[TERKONFIRMASI\] · \[REKOMENDASI\] · \[TERBUKA\]

---

## 1. Tujuan dan Posisi Modul

Memberi kepemilikan pekerjaan yang jelas: siapa mengerjakan apa, kapan, dan sudah sampai mana. Mendukung penugasan individu maupun kolaborasi tim, serta riwayat proyek yang tertelusur.

**Tujuan**

1. Memperjelas kepemilikan pekerjaan.
2. Membuat progres terlihat bagi yang berwenang.
3. Mendukung koordinasi tim dan proyek.
4. Menyimpan riwayat pekerjaan (siapa mengubah status, kapan).

**Bukan tujuan (R3):** alokasi sumber daya, Gantt kompleks, akuntansi proyek, penilaian kinerja otomatis, subtask bersarang tak terbatas, tugas berulang otomatis, integrasi kalender eksternal.

**Prinsip:** ringan seperti papan Kanban sederhana, bukan pengganti Jira. Jika fitur tidak dipakai di pilot, jangan dibangun.

---

## 2. Konsep dan Aturan Bisnis

| ID | Aturan | Label |
| --- | --- | --- |
| BR-TSK-01 | Tugas dapat berdiri sendiri atau menjadi bagian satu proyek | TERKONFIRMASI (PRD v1.0) |
| BR-TSK-02 | Tugas dapat ditugaskan ke satu atau lebih pengguna berwenang | TERKONFIRMASI |
| BR-TSK-03 | Status awal: To Do, In Progress, In Review, Done, Cancelled | TERKONFIRMASI |
| BR-TSK-04 | Perubahan status tercatat (siapa, kapan, dari-ke) | TERKONFIRMASI |
| BR-TSK-05 | Tugas yang menyangkut tim hanya dapat dilihat anggota tim/yang berwenang | REKOMENDASI |
| BR-TSK-06 | Tugas `Done` hanya dapat diselesaikan oleh assignee; jika `requires_review = true` maka harus melalui `In Review` lalu disetujui pereview | REKOMENDASI |
| BR-TSK-07 | Hanya pembuat tugas, pemilik proyek, koordinator tim, atau pengurus berwenang yang dapat mengubah assignee/due date/prioritas | REKOMENDASI |
| BR-TSK-08 | Proyek berstatus `completed` atau `archived` tidak dapat menerima tugas baru | REKOMENDASI |
| BR-TSK-09 | Pengguna dinonaktifkan: tugas terbuka miliknya ditandai "perlu ditugaskan ulang" dan muncul di antrean pemilik proyek | REKOMENDASI |
| BR-TSK-10 | Tugas tidak dihapus permanen oleh pengguna; `Cancelled` atau arsip (soft delete) | REKOMENDASI |

Tugas bukan pengganti laporan harian: menyelesaikan tugas tidak otomatis mengisi laporan, dan sebaliknya (R3). Pengaitan opsional (menautkan tugas pada item laporan) ditunda **\[Could\]**.

---

## 3. State Machine Tugas

```
To Do ──mulai──→ In Progress ──ajukan──→ In Review ──setujui──→ Done
  │ ↑                  │ ↑                      │
  │ └─────kembali─────┘ └─────tolak/revisi────┘
  └── (selesai langsung jika tanpa review) ──→ Done
  semua status aktif ──batalkan──→ Cancelled   (Done/Cancelled dapat dibuka kembali oleh berwenang)
```

| Dari → Ke | Siapa | Syarat |
| --- | --- | --- |
| To Do → In Progress | Assignee | — |
| In Progress → In Review | Assignee | Hanya jika `requires_review` |
| In Progress → Done | Assignee | Hanya jika tanpa review |
| In Review → Done | Pereview | Catatan opsional |
| In Review → In Progress | Pereview | Catatan wajib |
| Any → Cancelled | Pembuat/pemilik proyek/koordinator | Alasan wajib |
| Done/Cancelled → To Do/In Progress | Pembuat/pemilik proyek/berwenang | Alasan wajib (audit) |

Transisi dijaga di database (trigger/RPC `task_transition`), bukan hanya UI. Setiap transisi menulis `task_status_history`.

---

## 4. Model Data

| Tabel | Kolom kunci | Catatan |
| --- | --- | --- |
| `projects` | `id, name, description, owner_id, team_id, start_date, target_date, status (planned\|active\|on_hold\|completed\|archived), created_by, created_at, updated_at, archived_at` | Status proyek ≠ progres tugas |
| `tasks` | `id, project_id?, team_id?, title, description, priority (low\|normal\|high\|urgent), status, requires_review, reviewer_id?, start_date?, due_date?, completed_at?, created_by, created_at, updated_at, deleted_at, position (urutan di papan)` | `due_date` bertipe `date` (WIB) |
| `task_assignees` | `task_id, user_id, assigned_by, assigned_at, unassigned_at` | Banyak assignee; riwayat dipertahankan |
| `task_status_history` | `id, task_id, from_status, to_status, changed_by, changed_at, note` | Append-only |
| `task_comments` | `id, task_id, author_id, body, created_at, edited_at, deleted_at` | Soft delete; riwayat edit dasar |
| `task_attachments` | `id, task_id, file_id, uploaded_by` | Storage privat |
| `task_labels` / `task_label_map` | `id, name, color` | Label ringan (S) |
| `task_watchers` | `task_id, user_id` | Pengikut notifikasi (C) |
| `task_checklist_items` | `id, task_id, text, done` | Daftar centang sederhana sebagai pengganti subtask (S) |

**Keputusan desain:** gunakan *checklist* di dalam tugas alih-alih subtask bersarang untuk mencegah kompleksitas hierarki; evaluasi ulang setelah pilot.

**Progres proyek** dihitung (bukan diinput): `tugas Done / (semua tugas − Cancelled)`, ditampilkan sebagai persentase dan hitungan.

---

## 5. Persyaratan Fungsional

| ID | Persyaratan | Prioritas |
| --- | --- | --- |
| TSK-001 | Buat tugas: judul, deskripsi, prioritas, assignee(s), tim, proyek, tanggal mulai, tenggat, lampiran, `requires_review` | M |
| TSK-002 | Penugasan ke satu/lebih pengguna **dalam cakupan** pembuat (tim/organisasi sesuai permission) | M |
| TSK-003 | Status dan transisi sesuai §3; riwayat perubahan terlihat | M |
| TSK-004 | Assignee memperbarui status, menambah komentar & lampiran sesuai permission | M |
| TSK-005 | Review tugas oleh pereview ditentukan (pembuat/koordinator/pengurus) untuk tugas ber-`requires_review` | S |
| TSK-006 | Kelola proyek: nama, deskripsi, pemilik, tim, tanggal, status, tugas terkait | M |
| TSK-007 | Ringkasan proyek: persentase progres, hitungan per status, kontributor, tugas terlambat | M |
| TSK-008 | Notifikasi: ditugaskan, status berubah, review diminta, mendekati tenggat, terlambat | S |
| TSK-009 | Tampilan **Tugas Saya** (default dashboard santri): kelompok Terlambat / Hari ini / Minggu ini / Nanti | M |
| TSK-010 | Tampilan papan Kanban (seret-lepas) + tampilan daftar; keduanya dapat difilter | S |
| TSK-011 | Filter & pencarian: status, prioritas, assignee, tim, proyek, tenggat, label | M |
| TSK-012 | Komentar pada tugas dengan penyebutan (@nama) memicu notifikasi | S |
| TSK-013 | **[v1.1 — disetujui 2026-11-13]** Pengingat tenggat otomatis (H-1 dan hari-H) via job | S |
| TSK-014 | Checklist dalam tugas | S |
| TSK-015 | **[v1.1 — disetujui 2026-11-13]** Label tugas | C |
| TSK-016 | **[v1.1 — disetujui 2026-11-13]** Duplikasi tugas/proyek sebagai template (tanpa assignee/tanggal) | C |
| TSK-017 | Penugasan ulang massal saat pengguna dinonaktifkan/ganti tim | S |
| TSK-018 | Ekspor daftar tugas/proyek (CSV) oleh berwenang, beraudit | C |
| TSK-019 | Tugas lintas tim: satu tugas dapat melibatkan assignee dari tim berbeda bila pembuat berwenang atas keduanya | C |
| TSK-020 | **[v1.1 — disetujui 2026-11-13]** Pengarsipan tugas selesai otomatis setelah N hari dari tampilan papan (tetap dapat dicari) | C |

---

## 6. Hak Akses

| Permission | Santri | Koord. | Pengurus | Yayasan | S.Admin |
| --- | --- | --- | --- | --- | --- |
| `task.read` | assigned/own | team | all | all | — |
| `task.create` | — (opsional: tugas pribadi) | team | all | all | — |
| `task.assign` | — | team | all | all | — |
| `task.update_status` | assignee | team | all | — | — |
| `task.review` | — | team | all | — | — |
| `task.cancel/reopen` | — | team | all | all | — |
| `project.create/update` | — | team | all | all | — |
| `project.read` | anggota | team | all | all | — |
| `task.export` | — | — | ✓ | ✓ | — |

**\[REKOMENDASI\]** Santri dapat membuat **tugas pribadi** (hanya ia lihat) untuk memantau pekerjaannya sendiri — opsional dan dapat dimatikan; tidak dihitung dalam analitik organisasi.

**RLS:** baca = assignee, atau berada dalam tim tugas/proyek, atau memiliki scope lebih luas; tulis dan transisi via RPC yang memeriksa peran dan relasi (assignee/koordinator tim). Lampiran mengikuti akses tugas.

---

## 7. Notifikasi

| Event | Penerima | Aturan |
| --- | --- | --- |
| `task.assigned` | Assignee baru | Segera |
| `task.status_changed` | Pembuat/pemilik proyek | Dikelompokkan jika banyak perubahan |
| `task.review_requested` | Pereview | Segera |
| `task.due_soon` | Assignee | H-1 pukul 16.00 WIB (configurable) |
| `task.overdue` | Assignee, pembuat | Ringkasan harian 07.00 |
| `task.comment_mention` | Disebut | Segera |
| `task.reassignment_needed` | Pemilik proyek | Saat assignee dinonaktifkan |

Pencegah kebisingan: notifikasi ke diri sendiri tidak dikirim; perubahan beruntun dalam 5 menit digabung.

---

## 8. Persyaratan Layar

| Layar | Isi |
| --- | --- |
| Tugas Saya | Kelompok waktu, aksi cepat ubah status |
| Daftar/Papan Tugas | Kanban + daftar, filter |
| Detail Tugas | Info, assignee, status, checklist, komentar, lampiran, riwayat |
| Form Tugas | Field minimum: judul + assignee + tenggat (lainnya opsional) |
| Daftar Proyek | Kartu proyek + progres |
| Detail Proyek | Ringkasan, tugas, kontributor, tenggat |
| Antrean Review Tugas | Tugas `In Review` untuk pereview |

UX: membuat tugas dari ponsel harus selesai dalam satu layar; seret-lepas Kanban wajib punya alternatif tombol "Pindahkan ke..." untuk layar sentuh dan aksesibilitas.

---

## 9. Edge Case

| Kasus | Perilaku |
| --- | --- |
| Assignee dinonaktifkan | Penugasan ditandai tidak aktif; tugas masuk antrean penugasan ulang (BR-TSK-09) |
| Tenggat sebelum tanggal mulai | Validasi menolak |
| Pindah tugas ke proyek lain | Diizinkan bagi berwenang atas kedua proyek; tercatat riwayat |
| Proyek diarsipkan dengan tugas terbuka | Ditolak kecuali semua tugas ditutup/dibatalkan, atau konfirmasi membatalkan massal |
| Dua orang mengubah status bersamaan | Optimistic locking; penulis kedua diberi peringatan |
| Assignee keluar dari tim | Tetap dapat melihat tugas yang ditugaskan padanya; pembuat diberi tahu |
| Tugas tanpa assignee | Diizinkan (backlog); tampil di "Belum ditugaskan" bagi koordinator |
| Tenggat jatuh hari Minggu | Diizinkan (tugas tidak terkait kewajiban harian) |
| Komentar berisi mention ke pengguna di luar akses tugas | Mention ditolak/diabaikan agar tidak membocorkan tugas |
| Banyak assignee, satu menyelesaikan | `Done` mewakili tugas keseluruhan; hanya pembuat/pemilik/koordinator atau salah satu assignee sesuai pengaturan `completion_mode` (default: salah satu assignee cukup) |

---

## 10. Kriteria Penerimaan

1. Pengguna berwenang membuat tugas dengan field TSK-001 dan menugaskan ke pengguna dalam cakupannya.
2. Assignee melihat tugasnya di "Tugas Saya" dan hanya tugas yang boleh dilihatnya.
3. Setiap perubahan status tercatat dengan pelaku dan waktu; transisi ilegal ditolak di DB.
4. Satu proyek berisi banyak tugas; progres dihitung akurat dan sesuai status.
5. Pengguna di luar tim/penugasan tidak dapat membaca tugas tim (tes RLS).
6. Tugas ber-`requires_review` tidak bisa `Done` tanpa persetujuan pereview.
7. Notifikasi penugasan, review, dan tenggat terkirim sekali per kejadian.
8. Penonaktifan assignee memunculkan antrean penugasan ulang.

---

## 11. Rencana Tes

| Jenis | Skenario |
| --- | --- |
| pgTAP | Matriks transisi × peran; RLS tugas/proyek/komentar/lampiran; perhitungan progres |
| Unit | Validasi tanggal; pengelompokan Tugas Saya; util urutan Kanban |
| E2E | Buat→tugaskan→kerjakan→review→selesai; proyek dengan banyak tugas; penugasan ulang |
| Konkurensi | Ubah status bersamaan; reorder Kanban bersamaan |

---

## 12. Dependensi dan Keputusan Terbuka

**Bergantung pada:** IAM, PPL (tim, koordinator), Master (notifikasi, file, audit).

| ID | Keputusan | Default sementara |
| --- | --- | --- |
| OD-027 | Apakah santri boleh membuat tugas pribadi | Ya, privat, dapat dimatikan |
| OD-028 | Siapa saja pereview tugas | Pembuat tugas/koordinator tim; configurable per tugas |
| OD-029 | Mode penyelesaian tugas dengan banyak assignee | Salah satu cukup (configurable) |
| OD-030 | Perlu tugas berulang atau tidak | Tidak untuk R3 |

---

## 13. Metrik Modul

Tugas terbuka/selesai per periode; persentase tugas terlambat; waktu median dari To Do ke Done; jumlah tugas tanpa assignee; progres proyek aktif; beban tugas terbuka per pengguna (untuk pemerataan, **bukan** penilaian kinerja).

---

## 14. Keputusan Audit — 2026-11-13 [TERKONFIRMASI]

Change log 2.1: pengguna menyetujui deferral **v1.1** untuk **TSK-013, TSK-015, TSK-016, TSK-020**. Prioritas dan teks asal tetap ada di §5. Pengingat otomatis H-1/hari-H, label, template, dan arsip otomatis beserta model/layar/acceptance turunannya bukan release gate NOW. Bagian tenggat otomatis pada §7 dan §10.7 mengikuti TSK-013 v1.1; notifikasi penugasan/review tidak ikut ditunda.

Scheduler cron-job.org dan FCM diakui di Master §0.4, tetapi keberadaan scheduler tidak berarti job tugas TSK-013 telah diimplementasi. Guard app-layer + tes scope serta RLS defense-in-depth tetap diperlukan; RLS tidak boleh dilonggarkan. Ini keputusan dokumentasi, bukan hasil pengujian.
