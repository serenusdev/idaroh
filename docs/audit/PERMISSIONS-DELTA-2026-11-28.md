# Delta Izin Audit Remediasi 2026-11-28

Dokumen ini merangkum perubahan otorisasi pada branch remediation. `PERMISSIONS.md` tidak diubah dan tetap menjadi sumber kebenaran.

| Area | Navigasi UI | Guard/action | SQL helper/RPC | RLS/policy | Tes |
|---|---|---|---|---|---|
| Students self-read | `/mutabaah`, `/tasrih`, `/rapor` memakai roster sesuai identitas | santri dibatasi ke student miliknya; operator memakai `hasAnyRole` | `ensure_student_for_profile` dan sinkronisasi role/profile | `students_self_select` | `students-auto-nis`, mutabaah date-scope, gate-pass hardening |
| E-Tasrih | tombol hanya menampilkan aksi sesuai status | request/approve/scan/resolve/cancel memakai guard eksplisit; self-review ditolak | `request_gate_pass`, `approve_gate_pass_v2`, scan/refresh/resolve/cancel | direct INSERT authenticated dicabut | `gate-pass-hardening`, `wave5-4` terkait |
| Mutabaah | roster operator dan tanggal WIB | operator `pengurus`/`super_admin`; santri hanya hari ini | `save_mutabaah_log_for_date` | existing RLS dipertahankan, runtime belum terhubung | `mutabaah-date-scope` |
| Analytics named drilldown | semua segmen kartu menjadi button | yayasan/pengurus atau koordinator scope tim; super_admin-only ditolak | ReadonlyKysely via `getReadOnlyDb()` | reader/RLS existing | `analytics-drilldown-readonly`, `operations` |

Perubahan migrasi belum diterapkan ke produksi. Verifikasi RLS dan RPC langsung masih memerlukan database lokal/CI/staging dengan akun uji terisolasi.
