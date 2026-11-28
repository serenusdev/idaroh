# Inventaris Baseline Audit IDAROH — 2026-11-28

## Ruang lingkup dan baseline

- `main` diverifikasi memuat merge PR #25: `4120946 Merge pull request #25 from serenusdev/fix/attendance-checkin-and-rbac-superadmin`.
- Branch kerja saat audit: `fix/comprehensive-audit-nis-etasrih-and-polish`.
- Worktree aktif sudah memiliki perubahan pengguna yang belum dibuat oleh tugas ini; perubahan tersebut dipertahankan.
- Berkas untracked terlarang dicatat di awal dengan SHA-256:
  - `.github/workflows/backup.yml.bak`: `46faa7776de5b2f60607b23bdb165ffe42b5d5989628aac2e4ac8042471a5b23`
  - `docs/backup-restore.md.bak`: `e0a2a6bdd8e8dd2c4655bd7e0ba0d9230384260a4829adb2e824f46e54cca903`
  - `pondok-os-audit.zip`: `8049e301cd19d50d56d370193d8b985117f16bc3a6a7b4875ff494538d5e1684`

### Hasil baseline `main` (terverifikasi)

| Pemeriksaan | Hasil | Bukti ringkas |
|---|---|---|
| `npx tsc --noEmit` | LULUS | exit 0, tanpa keluaran error |
| `npm run lint` | LULUS | exit 0; warning lint pre-existing |
| `npm test` | LULUS | 92 file, 1308 test passed, 6 skipped |
| `npm run build` | GAGAL PRE-EXISTING | berhenti di validasi env: `NEXT_PUBLIC_SUPABASE_URL` missing/placeholder |

Build tidak dapat diverifikasi sebagai hijau tanpa env produksi/disposable yang sesuai. Kegagalan ini dicatat sebagai baseline, bukan diperbaiki diam-diam di luar cakupan.

## Inventaris rute

| Area | Rute terdeteksi | Guard/sumber data utama |
|---|---|---|
| Aplikasi | `/`, `/jadwal`, `/kehadiran`, `/laporan`, `/mutabaah`, `/notifikasi`, `/rapor`, `/rapor/[termId]`, `/resources`, `/resources/[slug]`, `/review`, `/settings/profile`, `/tasrih`, `/tim`, `/tugas` | layout aplikasi + session/role guard; Server Actions modul terkait; RLS/RPC Supabase |
| Admin | `/admin/analytics`, `/admin/audit`, `/admin/backup`, `/admin/cron`, `/admin/jadwal`, `/admin/kehadiran`, `/admin/live-telemetry`, `/admin/notifications`, `/admin/people`, `/admin/resources`, `/admin/users` | role/permission guard di page/action; audit/analytics memakai jalur baca tertype bila tersedia |
| Auth & fallback | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/mfa`, `/unauthorized`, `/offline` | auth actions, middleware, dan state session |
| API | `/api/auth/login`, `/api/calendar/feed`, `/api/cron/backups`, `/api/cron/notifications`, `/api/exports/[exportId]`, `/api/files/[fileId]`, `/api/inngest`, `/api/report-cards`, `/api/report-cards/ingest`, `/api/version`, `/api/worker/jobs` | route-level auth/cron secret, action/RPC, ReadonlyKysely untuk query analitik/audit/ekspor sesuai modul |
| Verifikasi publik | `/verify/rapor/[hash]` | RPC/verifikasi hash laporan |

Inventaris berasal dari `src/app/**/page.tsx` dan `src/app/**/route.ts`. Detail izin per rute harus tetap diturunkan dari `PERMISSIONS.md`; `PERMISSIONS.md` tidak diubah.

## Inventaris Server Action

| Modul | File | Pola guard | Jalur data/efek |
|---|---|---|---|
| Identity & MFA | `src/modules/iam/actions.ts` | `requireAuthUser`, `requireRole`, guard MFA | Supabase session/admin client, RPC IAM, profiles/user_roles, audit/outbox |
| Attendance | `src/modules/attendance/actions.ts` | auth + role/assignment/scope | session client, attendance RPC/tabel, klasifikasi tersimpan |
| Reports | `src/modules/reports/actions.ts` | auth + reviewer/assignment | jalur lama yang dilindungi; **berkas terlarang, tidak diubah** |
| Tasks & operations | `src/modules/tasks/actions.ts`, `src/modules/operations/actions.ts` | auth + role/scope/team | task/report/analytics query, RPC dan audit |
| Schedules | `src/modules/schedules/actions.ts` | auth + audience/role | agenda/announcement RPC/tabel |
| People | `src/modules/people/actions.ts` | auth + own/team/global | profiles, team_members, reviewer assignments, audit |
| Library | `src/modules/library/actions.ts` | auth + resource permission | resources/tags/revisions, storage metadata, RPC |
| Gate pass | `src/modules/gate-pass/actions.ts` | auth; perlu audit guard operator dan hasil terstruktur | gate_passes RPC/tabel, QR/token, rate limit |
| Mutaba'ah | `src/modules/mutabaah/actions.ts` | auth + student/operator scope | students, mutabaah_logs, halaqah_logs, RPC |
| Telemetry | `src/modules/live-telemetry/actions.ts` | auth + admin role | `getReadOnlyDb()`/live telemetry queries, structured result |
| Notifications/cron | `src/modules/notifications/actions.ts`, `src/modules/cron/actions.ts` | auth/cron secret | notification tables, outbox, cron runs |

Semua action yang mengembalikan error perlu diverifikasi agar tidak melempar objek PostgREST mentah atau menghasilkan `[object Object]`. `reports/actions.ts` dikecualikan dari perubahan dan hanya dilaporkan bila temuan menyentuhnya.

## Inventaris RPC dan RLS yang relevan

| Entitas | Skema/tabel dan objek saat ini | Risiko audit awal |
|---|---|---|
| `students` | RLS `students_admin_select`, `students_admin_write` di `202611280001_wave5_1_students_and_report_cards.sql`; `profile_id`, `nis`, `gender` | Santri self-select belum tampak pada baseline; NIS masih ditulis/diisi di jalur lama; `gender` wajib pada schema awal |
| `academic_terms` | RLS admin select/write; report-card migration | Kondisi kosong belum memiliki alur UI pembuatan term |
| `report_cards` | RLS admin all + student published select; `upsert_wave5_report_card`, `sync_term_activity_to_report_cards`, public verify RPC | Roster dual-track/non-gawai dan idempotensi perlu diverifikasi |
| `mutabaah_logs` | RLS `mutabaah_read_scope`/`mutabaah_write_scope`; `save_mutabaah_log` | RPC hanya memakai hari ini pada baseline; pemilih tanggal perlu RPC baru |
| `halaqah_logs` | RLS `halaqah_read_scope`/`halaqah_write_scope`; `save_halaqah_log` | Validasi tanggal dan roster operator perlu diverifikasi |
| `gate_passes` | RLS read scoped + `gate_passes_request_scoped` INSERT; `request_gate_pass`, `approve_gate_pass`, `scan_gate_pass`, `refresh_gate_pass_overdue` | Jalur INSERT langsung tampak terlalu longgar; lifecycle overdue/returned dan self-review perlu tes runtime |
| `attendance_records` | Attendance RLS/policies dan effective-attendance RPC/trigger | Klasifikasi/WIB dan scope multi-role perlu dipastikan pada drill-down |
| `daily_reports` | Reports RLS/review RPC dan assignment scope | D1: visibilitas isi laporan yayasan tidak boleh melebar |
| `tasks` | RLS task visibility, transition RPC, task scope migrations | Super admin/koordinator scope dan self-review perlu tes matriks |

Migrasi relevan terakhir sebelum remediasi baru mencakup `202612030001_attendance_checkin_and_multi_role.sql`. Migrasi baru harus mulai `202612040001_...sql`, idempoten, memiliki rollback, dan diakhiri `NOTIFY pgrst, 'reload schema';`.

## Status temuan awal (hasil pembacaan)

F-01 sampai F-21 pada `PROMPT.md` adalah **DUGAAN** sampai tes/simulasi membuktikannya. Prioritas verifikasi mengikuti urutan prompt: telemetry, students/NIS, gate-pass, multi-role/header, mutaba'ah/rapor, analytics, serialisasi/WIB, branding dan dead link. F-21 secara eksplisit dilaporkan sebagai selisih sesuai keputusan K6 dan tidak diubah tanpa keputusan baru.

## Batasan dan keputusan yang dipakai

Keputusan terbuka K1–K8 memakai default prompt dan akan dicatat lagi pada laporan akhir. Tidak ada migrasi diterapkan ke produksi, tidak ada `supabase db push --remote`, dan tidak ada push ke `origin/main` pada fase ini.

