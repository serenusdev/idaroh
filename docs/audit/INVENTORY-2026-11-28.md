# INVENTORY-2026-11-28 — IDAROH Audit Baseline

Dibuat: 2026-11-28  
Branch: `fix/comprehensive-audit-nis-etasrih-and-polish`  
Dibuat dari: `main` setelah merge PR #25 (`4120946`)

---

## A. Hash Berkas Untracked (harus tetap tak tersentuh)

```
46faa7776de5b2f60607b23bdb165ffe42b5d5989628aac2e4ac8042471a5b23  .github/workflows/backup.yml.bak
e0a2a6bdd8e8dd2c4655bd7e0ba0d9230384260a4829adb2e824f46e54cca903  docs/backup-restore.md.bak
8049e301cd19d50d56d370193d8b985117f16bc3a6a7b4875ff494538d5e1684  pondok-os-audit.zip
```

> Dibuat dengan `shasum -a 256 .github/workflows/backup.yml.bak docs/backup-restore.md.bak pondok-os-audit.zip`  
> Verifikasi akhir PR harus mengulang perintah ini dan memastikan hash identik.

---

## B. Hasil Baseline (terverifikasi — semua dijalankan di branch ini)

| Perintah | Status | Catatan |
|---|---|---|
| `npx tsc --noEmit` | **LULUS** (exit 0, tanpa output) | Tidak ada error TypeScript |
| `npm run lint` | **LULUS** (exit 0, hanya Warning) | 11 warning `no-unused-vars` di file tes; 1 warning `react-hooks/exhaustive-deps` di `kehadiran/page.tsx` — semua pre-existing |
| `npm test` | **LULUS** | 92 file tes, 1308 passed, 6 skipped (skipped = `dx01-live-parity.test.ts` tanpa `DX01_DB_URL`), 0 failed |
| `npm run build` | **GAGAL (pre-existing)** | `Error: Production environment variable NEXT_PUBLIC_TURNSTILE_SITE_KEY is missing or contains a placeholder` di `scripts/validate-production-env.mjs:37`. Gagal di tahap webpack sebelum compile — bukan regresi kode baru. |

### Detail Warning Lint (pre-existing, tidak memblokir)
- `email-outbox.test.ts`: `_url`, `_init` unused
- `query-error-drain.test.ts`: `_url`, `_init` unused (×2)
- `report-history.test.ts`: `_columns` unused
- `report-visibility-scope.test.ts`: `join` unused
- `role-sync-iam-matrix.test.ts`: `_args`, `settle` unused
- `sec02-func05-func06.test.ts`: `table`, `_args` unused (×2)
- `kehadiran/page.tsx`: `useMemo` exhaustive-deps

---

## C. Inventaris Rute

Sumber: `src/app/**/page.tsx` dan `src/app/**/route.ts`

### Rute Halaman (page.tsx)

| Rute | File | Jenis Guard | Peran/Izin Diizinkan | Sumber Data Utama |
|---|---|---|---|---|
| `/` (beranda) | `(app)/page.tsx` | `useIdentity` (klien) | Semua peran aktif | `getTodayAttendanceStatusAction`, `getEventsAction`, `getAnnouncementsAction`, `getAdminDashboardStatsAction` |
| `/jadwal` | `(app)/jadwal/page.tsx` | `useIdentity` (klien) | Semua peran aktif | `getEventsAction`, `getAnnouncementsAction`, `createEventAction`, `updateEventAction` |
| `/kehadiran` | `(app)/kehadiran/page.tsx` | `useIdentity` (klien) | Semua peran aktif | `checkInAttendanceAction`, `getTodayAttendanceStatusAction`, `getAttendanceHistoryAction` |
| `/laporan` | `(app)/laporan/page.tsx` | `useIdentity` (klien) | Semua peran aktif | `getTodayReportAction`, `getReportCategoriesAction`, `saveReportDraftAction`, `submitReportAction` |
| `/mutabaah` | `(app)/mutabaah/page.tsx` | `useIdentity` (klien) | `user.role === 'pengurus'\|'super_admin'` atau santri (F-18: periksa single-role check) | `saveMutabaahLogAction`, `saveHalaqahLogAction` — **BUG F-08: santri tidak bisa membaca baris `students` sendiri (RLS)** |
| `/notifikasi` | `(app)/notifikasi/page.tsx` | `useIdentity` (klien) | Semua peran aktif | `getAnnouncementsAction`, `markAnnouncementReadAction` |
| `/rapor` | `(app)/rapor/page.tsx` | `useIdentity` (klien) | `pengurus`, `super_admin` | `academic_terms` via Supabase klien sesi |
| `/rapor/[termId]` | `(app)/rapor/[termId]/page.tsx` | `useIdentity` (klien) | `pengurus`, `super_admin` | `report_cards`, `students`, `academic_terms` |
| `/resources` | `(app)/resources/page.tsx` | `requireAuthUser` | Semua peran aktif | `getResourcesAction`, `getResourceCategoriesAction` |
| `/resources/[slug]` | `(app)/resources/[slug]/page.tsx` | `requireAuthUser` | Semua peran aktif | `getResourceBySlugAction` |
| `/review` | `(app)/review/page.tsx` | `useIdentity` (klien) | `pengurus`, `yayasan`, `super_admin` (reviewer) | `getReviewQueueAction`, `reviewReportAction` |
| `/settings/profile` | `(app)/settings/profile/page.tsx` | `useIdentity` (klien) | Semua peran aktif | `getCurrentUserAction`, `updateProfileAction`, `changePasswordAction` |
| `/tasrih` | `(app)/tasrih/page.tsx` | `requireAuthUser` **saja** (F-13: tanpa `requireRole`) | Semua peran aktif (F-18, F-13) | `requestGatePassAction`, `approveGatePassAction`, `scanGatePassAction`, `getGatePassDashboardAction` |
| `/tim` | `(app)/tim/page.tsx` | `useIdentity` (klien) | Semua peran aktif | `getPeopleAction`, `getTeamsAction` |
| `/tugas` | `(app)/tugas/page.tsx` | `useIdentity` (klien) | Semua peran aktif | `getTasksAction`, `getProjectsAction`, `createTaskAction` |
| `/unauthorized` | `(app)/unauthorized/page.tsx` | — | — | Halaman statis |
| `/offline` | `offline/page.tsx` | — | — | Halaman statis (PWA offline) |
| `/verify/rapor/[hash]` | `verify/rapor/[hash]/page.tsx` | — (publik) | Semua, termasuk `anon` | `verify_report_card_public` (RPC GRANT anon) |
| `/admin/analytics` | `(app)/admin/analytics/page.tsx` | `useIdentity` (klien); cek `user.role` **saja** (F-17, F-18) | `super_admin`, `yayasan`, `pengurus`, `koordinator` | `getOperationalAnalyticsAction`, `getAnalyticsDrilldownAction` |
| `/admin/audit` | `(app)/admin/audit/page.tsx` | `useIdentity` (klien) | `super_admin`, `yayasan` (dugaan) | `queryAuditLogsAction`, `queryComplianceCenterAction` |
| `/admin/backup` | `(app)/admin/backup/page.tsx` | `useIdentity` (klien) | `super_admin` | `createBackupManifestAction`, `getBackupRunsAction` |
| `/admin/cron` | `(app)/admin/cron/page.tsx` | `useIdentity` (klien) | `super_admin` | Cron job status |
| `/admin/jadwal` | `(app)/admin/jadwal/page.tsx` | `useIdentity` (klien) | `super_admin`, `yayasan`, `pengurus`, `koordinator` | `getEventsAction`, `createEventAction`, `updateEventAction`, `deleteEventAction` |
| `/admin/kehadiran` | `(app)/admin/kehadiran/page.tsx` | `useIdentity` (klien) | `super_admin`, `yayasan`, `pengurus` | `getAttendanceReviewQueueAction`, `reviewAttendanceCorrectionAction` |
| `/admin/live-telemetry` | `(app)/admin/live-telemetry/page.tsx` | `useIdentity` (klien); `user.role` single-check (F-06, F-18) | `pengurus`, `super_admin` | `getLiveTelemetryAction` |
| `/admin/notifications` | `(app)/admin/notifications/page.tsx` | `useIdentity` (klien) | `super_admin`, `yayasan`, `pengurus` | `sendTestPushAction` |
| `/admin/people` | `(app)/admin/people/page.tsx` | `useIdentity` (klien) | `super_admin`, `yayasan`, `pengurus` | `getPeopleAction`, `getTeamsAction`, `addTeamMemberAction` |
| `/admin/resources` | `(app)/admin/resources/page.tsx` | `useIdentity` (klien) | `super_admin`, `yayasan`, `pengurus` | `getResourcesAction`, `importMembersCsvAction` |
| `/admin/users` | `(app)/admin/users/page.tsx` | `useIdentity` (klien) | `super_admin` | `getActiveUsersAction`, `getAccountRequestsAction`, `approveAccountApplicationAction` |

### Rute API (route.ts)

| Rute | Method | Guard | Keterangan |
|---|---|---|---|
| `/api/auth/login` | POST | Rate limit + Turnstile (non-dev) | Login endpoint, mengembalikan cookie sesi |
| `/api/calendar/feed` | GET | Bearer token (`cal_*`) di URL | iCal feed; `X-WR-CALNAME: Agenda & Kajian Pondok OS` (branding lama — F-07) |
| `/api/cron/backups` | GET | `CRON_SECRET` Bearer | Backup artefak |
| `/api/cron/notifications` | GET | `CRON_SECRET` Bearer | Notifikasi + refresh presensi |
| `/api/exports/[exportId]` | GET | Sesi Supabase + `export_requests.created_by` | PDF/CSV; nama file `pondok-os-*.pdf` (branding lama) |
| `/api/files/[fileId]` | GET | Sesi Supabase + RLS storage | Download file tersimpan |
| `/api/inngest` | POST | Inngest HMAC signature | Background jobs |
| `/api/report-cards` | GET/POST | Sesi Supabase | Rapor digital; scope via RLS |
| `/api/report-cards/ingest` | POST | Service role / internal | Ingest rapor batch |
| `/api/version` | GET | — (publik) | Versi deploy |
| `/api/worker/jobs` | POST | Bearer token internal | Background worker |

---

## D. Inventaris Server Actions ("use server")

### `src/modules/attendance/actions.ts`
| Fungsi | Guard | Pola Error | RPC/Tabel |
|---|---|---|---|
| `checkInForEventAction` | `requireAuthUser()` | `throw` Error | `app.attendance_check_in` RPC |
| `checkInAttendanceAction` | `requireAuthUser()` | return object `{success, message}` | `app.attendance_check_in` RPC |
| `getTodayAttendanceStatusAction` | `requireAuthUser()` | return null | `attendance_records` |
| `getAttendanceHistoryAction` | `requireAuthUser()` | return `[]` | `attendance_records`, `attendance_exceptions` |
| `submitCorrectionAction` | `requireAuthUser()` | return object `{success, message}` | `attendance_exceptions` |
| `submitExceptionAction` | `requireAuthUser()` | return object `{success, message}` | `attendance_exceptions` |
| `getAttendanceReviewQueueAction` | `requireRoleForAttendanceReview()` → role tunggal `user.role` (F-18) | return `[]` | `attendance_records`, `attendance_exceptions` |
| `reviewAttendanceCorrectionAction` | `requireRoleForAttendanceReview()` | return `{success, message}` | `review_attendance_correction` RPC |
| `reviewAttendanceExceptionAction` | `requireRoleForAttendanceReview()` | return `{success, message}` | `review_attendance_exception` RPC |

### `src/modules/gate-pass/actions.ts`
| Fungsi | Guard | Pola Error | RPC/Tabel |
|---|---|---|---|
| `requestGatePassAction` | `requireAuthUser()` **saja** (F-13) | `throw error.message` | `request_gate_pass` RPC |
| `approveGatePassAction` | `requireAuthUser()` **saja** (F-13) | `throw error.message` | `approve_gate_pass` RPC |
| `scanGatePassAction` | `requireAuthUser()` **saja** (F-13) | `throw error.message` | `scan_gate_pass` RPC |
| `getGatePassDashboardAction` | `requireAuthUser()` | return `{passes:[], students:[]}` | `gate_passes` + `students` + `refresh_gate_pass_overdue` RPC **(F-11d: UPDATE dalam action baca!)** |

### `src/modules/live-telemetry/actions.ts`
| Fungsi | Guard | Pola Error | RPC/Tabel |
|---|---|---|---|
| `getLiveTelemetryAction` | `requireRole(['pengurus','super_admin'])` | `throw` (tidak ter-catch) | `fetchLiveTelemetry` via `ReadonlyKysely` |

### `src/modules/mutabaah/actions.ts`
| Fungsi | Guard | Pola Error | RPC/Tabel |
|---|---|---|---|
| `saveMutabaahLogAction` | `requireAuthUser()` | `throw error.message` | `save_mutabaah_log` RPC |
| `saveHalaqahLogAction` | `requireAuthUser()` | `throw error.message` | `save_halaqah_log` RPC |
| `todayWibDate` | — | — | Hanya komputasi waktu |

### `src/modules/operations/actions.ts`
| Fungsi | Guard | Pola Error | RPC/Tabel |
|---|---|---|---|
| `getOperationalAnalyticsAction` | `requireRole([super_admin,yayasan,pengurus,koordinator])` | return object dengan `attendance/reports/tasks` | `fetchOperationalCounts` via ReadonlyKysely |
| `getAnalyticsDrilldownAction` | `requireRole([super_admin,yayasan,pengurus,koordinator])` | `throw membershipError`/`throw error` (F-16, F-19) | **`createAdminClient()`** (melanggar aturan ReadonlyKysely — F-16) |
| `importMembersCsvAction` | `requireRole([super_admin])` | return `{success, message}` | `admin_update_user` RPC |
| `getTaskDiscussionAction` | `requireAuthUser()` | `{comments:[],attachments:[]}` | `task_comments`, `task_attachments` |
| `addTaskCommentAction` | `requireAuthUser()` | `{success, message}` | `task_comments` |
| `uploadTaskAttachmentAction` | `requireAuthUser()` | `{success, message}` | storage + `task_attachments` |
| `deleteTaskAttachmentAction` | `requireAuthUser()` | `{success, message}` | `task_attachments` |
| `sendTestPushAction` | `requireRole([super_admin,yayasan,pengurus])` | `{success, message}` | FCM + `device_tokens` |
| `createBackupManifestAction` | `requireRole([super_admin])` | `{success, message}` | `backup_manifests` |
| `getBackupRunsAction` | — (tidak ada `requireAuthUser`) | return `[]` | `background_job_runs` |

### `src/modules/analytics/actions.ts`
| Fungsi | Guard | Pola Error | RPC/Tabel |
|---|---|---|---|
| `exportAuditedDataAction` | `requireRole([...EXPORT_ROLES])` | `{success, message}` | `export_requests` |
| `queryAuditLogsAction` | `requireRole([super_admin,yayasan])` | return `[]` | `audit_logs` via ReadonlyKysely |
| `queryComplianceCenterAction` | `requireRole([super_admin,yayasan])` | return `{}` | ReadonlyKysely |
| `getAuditChainStatusAction` | `requireAuthUser()` | `{valid, checked, message}` | `audit_logs` via ReadonlyKysely |
| `getActivePolicyAction` | `requireAuthUser()` | return `null` | `policy_settings` |
| `updatePolicySettingsAction` | `requireRole([super_admin,yayasan,pengurus])` | `{success, message}` | `policy_settings` |
| `getPendingPolicySettingsAction` | `requireRole([super_admin,yayasan])` | return `[]` | `policy_settings` |
| `approvePolicySettingsAction` | `requireRole([yayasan])` | `{success, message}` | `policy_settings` |
| `activatePolicySettingsAction` | `requireRole([super_admin])` | `{success, message}` | `policy_settings` |
| `getAdminDashboardStatsAction` | `requireRole([super_admin,yayasan,pengurus])` | return `{}` | ReadonlyKysely |

### `src/modules/iam/actions.ts`
| Fungsi | Guard | Pola Error | RPC/Tabel |
|---|---|---|---|
| `submitAccountApplicationAction` | — (publik, rate-limited) | `{success, message}` | `account_requests` |
| `getAccountRequestsAction` | `requireRole([super_admin,yayasan,pengurus])` | return `[]` | `account_requests` |
| `getActiveUsersAction` | `requireRole([super_admin,yayasan,pengurus])` | return `[]` | `profiles`, `user_roles` |
| `approveAccountApplicationAction` | `requireRole([super_admin])` | `{success, message}` | `approve_account_request` RPC |
| `rejectAccountApplicationAction` | `requireRole([super_admin])` | `{success, message}` | `reject_account_request` RPC |
| `createManualAccountAction` | `requireRole([super_admin])` | `{success, message}` | `create_manual_account` RPC |
| `resetUserSessionAction` | `requireRole([super_admin])` | `{success, message}` | Supabase Admin API |
| `revokeDeviceTokenAction` | `requireAuthUser()` | `{success, message}` | `device_tokens` |
| `getCurrentUserAction` | `requireAuthUser({allowAal1:true})` | return `null` | `profiles`, `user_roles` |
| `listMfaFactorsAction` | `requireAuthUser()` | return `[]` | Supabase Auth API |
| `enrollMfaAction` | `requireAuthUser()` | `{success, ...}` | Supabase Auth API |
| `verifyMfaAction` | `requireAuthUser()` | `{success, message}` | Supabase Auth API |
| `unenrollMfaAction` | `requireAuthUser()` | `{success, message}` | Supabase Auth API |
| `updateProfileAction` | `requireAuthUser()` | `{success, message}` | `update_own_profile` RPC |
| `uploadAvatarAction` | `requireAuthUser()` | `{success, ...}` | storage + `profiles` |
| `deleteAvatarAction` | `requireAuthUser()` | `{success, message}` | storage |
| `changePasswordAction` | `requireAuthUser()` | `{success, message}` | Supabase Auth API |
| `adminUpdateUserAction` | `requireRole([super_admin])` | `{success, message}` | `admin_update_user` RPC |
| `adminSetUserRolesAction` | `requireRole([super_admin])` | `{success, message}` | `admin_set_user_roles` RPC |

### `src/modules/people/actions.ts`
| Fungsi | Guard | Pola Error | RPC/Tabel |
|---|---|---|---|
| `getPeopleAction` | `requireAuthUser()` | return `[]` | `profiles`, `user_roles`, `team_members` |
| `touchPresenceAction` | `requireAuthUser()` | return `false` | `presence_heartbeats` |
| `getTeamsAction` | `requireAuthUser()` | return `[]` | `teams`, `team_members` |
| `setTeamCoordinatorAction` | `requireRole([super_admin,yayasan,pengurus])` | `{success, message}` | `set_team_coordinator` RPC |
| `addTeamMemberAction` | `requireRole([super_admin,yayasan,pengurus])` | `{success, message}` | `add_team_member` RPC |
| `removeTeamMemberAction` | `requireRole([super_admin,yayasan,pengurus])` | `{success, message}` | `remove_team_member` RPC |
| `assignReviewerAction` | `requireRole([super_admin,yayasan,pengurus])` | `{success, message}` | `assign_reviewer` RPC |
| `revealContactNumberAction` | `requireAuthUser()` | `{success, ...}` | `profiles` |
| `updatePersonalBioAction` | `requireAuthUser()` | `{success, message}` | `profiles` |
| `getPersonalBioAction` | `requireAuthUser()` | `{success, bio}` | `profiles` |

### `src/modules/schedules/actions.ts` (ringkasan)
Semua fungsi mutasi memakai `requireRole([super_admin,yayasan,pengurus])` atau `requireRole([...,koordinator])`. Fungsi baca memakai `requireAuthUser()`.

### `src/modules/tasks/actions.ts` (ringkasan)
Semua fungsi memakai `requireAuthUser()`. Pemeriksaan peran tambahan lewat RPC di DB.

### `src/modules/library/actions.ts` (ringkasan)
Baca = `requireAuthUser()`. Tulis/admin = `requireRole([...RESOURCE_ADMIN_ROLES])`. Import = `requireRole([...LIBRARY_IMPORT_ROLES])`.

### `src/modules/reports/actions.ts` (TERLARANG DIUBAH — dicatat saja)
Ekspor: `getReportCategoriesAction`, `getTodayReportAction`, `getMyReportHistoryAction`, `getReviewQueueAction`, `saveReportDraftAction`, `submitReportAction`, `reviewReportAction`. Pola error: mix `throw` dan return object. Catatan: baris 214 memakai `toISOString().slice(0,10)` — pre-existing, berkas terlarang, dilaporkan saja.

---

## E. Inventaris RPC & RLS per Tabel Terkait

### `students`

**Skema (dugaan — belum dijalankan di DB):**
- `id uuid PK`, `nis text UNIQUE NOT NULL`, `full_name text NOT NULL`, `gender text CHECK IN ('L','P') NOT NULL` **(F-09)**, `profile_id uuid UNIQUE FK → profiles(id)`, `guardian_profile_id uuid FK`, `is_active bool`, `dorm_room text`, `halaqah_group text`, `created_at`, `updated_at`

**RLS (berdasarkan migrasi `202611280001`):**
- `students_admin_select`: SELECT untuk `app.is_active_member() AND app.has_any_role('pengurus','super_admin')`
- `students_admin_write`: ALL untuk `pengurus`/`super_admin`
- **MISSING (F-08):** tidak ada policy untuk santri membaca baris miliknya sendiri (`profile_id = auth.uid()`)

**RPC yang menyentuh `students`:**
- `request_gate_pass(p_student_id, reason, destination, due_back_at)` — INSERT ke `gate_passes`, JOIN students
- `upsert_wave5_report_card` — JOIN students
- `sync_term_activity_to_report_cards` — JOIN students (hanya `profile_id IS NOT NULL`)
- `save_mutabaah_log`, `save_halaqah_log` — tidak langsung, via FK dari logs
- `app.ensure_student_for_profile` — **belum ada** (dibutuhkan Task 6)

### `academic_terms`

**Skema:** `id uuid PK`, `code text UNIQUE NOT NULL`, `name text NOT NULL`, `start_date date NOT NULL`, `end_date date NOT NULL`, `is_locked bool DEFAULT false`

**RLS:**
- `academic_terms_admin_select`: SELECT → `pengurus`/`super_admin`
- `academic_terms_admin_write`: ALL → `pengurus`/`super_admin`

**RPC:** `create_academic_term` — **belum ada** (dibutuhkan Task 10)

### `report_cards`

**Skema:** `id uuid PK`, `student_id uuid FK → students`, `term_id uuid FK → academic_terms`, `tahfidz_data jsonb`, `diniyah_scores jsonb`, `adab_scores jsonb`, `attendance_summary jsonb`, `status text CHECK IN (draft,published)`, `updated_by uuid`, `published_at timestamptz`

**RLS:**
- `report_cards_admin_all`: ALL → `pengurus`/`super_admin`
- `report_cards_student_published`: SELECT → santri (`students.profile_id = auth.uid()` + `status='published'`)

**RPC:** `upsert_wave5_report_card`, `sync_term_activity_to_report_cards`, `verify_report_card_public`

### `mutabaah_logs`

**Skema:** `id uuid PK`, `student_id uuid FK → students ON DELETE CASCADE`, `log_date date NOT NULL`, `checklist jsonb`, `recorded_by uuid FK → profiles`, UNIQUE `(student_id, log_date)`

**RLS (migrasi `202611300003`):**
- `mutabaah_read_scope`: SELECT → `pengurus`/`super_admin` **ATAU** santri (`students.profile_id = auth.uid()`) — **tetapi bergantung pada `students_self_select` yang belum ada (F-08)**
- `mutabaah_write_scope`: ALL → sama

**RPC:** `save_mutabaah_log(p_student_id, p_checklist)` — menggunakan `(now() AT TIME ZONE 'Asia/Jakarta')::date` sebagai tanggal — tidak menerima parameter tanggal (dibutuhkan RPC baru `save_mutabaah_log_for_date`)

### `halaqah_logs`

**Skema:** `id uuid PK`, `student_id uuid FK → students ON DELETE CASCADE`, `session_date date`, `entry_type text`, `surah_name text`, `ayah_from int`, `ayah_to int`, `quality_grade text`, `tajwid_errors text[]`, `notes text`, `ustadz_id uuid`

**RLS:** `halaqah_read_scope`, `halaqah_write_scope` — sama dengan mutabaah_logs

**RPC:** `save_halaqah_log(p_student_id, p_session_date, p_entry_type, ...)`

### `gate_passes`

**Skema (migrasi `202612010001`):** `id uuid PK`, `student_id uuid FK → students ON DELETE RESTRICT`, `reason text NOT NULL`, `destination text NOT NULL`, `status text CHECK IN (pending,approved,rejected,out,overdue,returned,cancelled) DEFAULT 'pending'`, `created_by uuid FK → profiles`, `approved_by uuid FK → profiles`, `due_back_at timestamptz NOT NULL`, `out_at timestamptz`, `actual_back_at timestamptz`, `qr_token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text`

**RLS:**
- `gate_passes_read_scoped`: SELECT → `pengurus`/`super_admin` **ATAU** santri pemilik
- `gate_passes_request_scoped`: INSERT TO authenticated → hanya memastikan `created_by = auth.uid()` + kepemilikan santri — **tidak membatasi field `status`, `out_at`, dll. (KRITIS F-10)**
- **GRANT INSERT ON gate_passes TO authenticated** — diizinkan langsung!

**RPC:**
- `request_gate_pass(p_student_id, reason, destination, due_back_at)`
- `approve_gate_pass(p_gate_pass_id, p_approved)` — tidak ada cek self-review (F-12)
- `scan_gate_pass(p_qr_token, p_direction)` — tidak ada cek terlambat saat `back` (F-11a)
- `refresh_gate_pass_overdue()` — mengubah `approved` juga ke `overdue` (F-11b)

### `attendance_records`

**Skema:** `id uuid PK`, `user_id uuid FK → profiles`, `attendance_date date`, `check_in_time timestamptz`, `classification text CHECK IN (on_time,grace,late,excused,sick,absent)`, `method text`, `event_id uuid`

**RLS:** `Users can view own attendance records`, `Users can insert own exceptions`, `Users can view own exceptions`

**RPC:** `app.attendance_check_in`, `refresh_attendance_snapshot`, `review_attendance_correction`, `review_attendance_exception`

### `daily_reports`

**Skema:** `id uuid PK`, `user_id uuid FK → profiles`, `report_date date`, `submission_status text CHECK IN (draft,submitted)`, `review_status text CHECK IN (pending,approved,rejected)`, `reviewer_id uuid`, `reviewed_at timestamptz`, UNIQUE `(user_id, report_date)`

**RLS:** `Users can manage own daily reports`, `Reviewers can view assigned or unassigned reports`

**RPC:** `review_report` (via SECURITY DEFINER)

### `tasks`

**Skema:** `id uuid PK`, `project_id uuid FK → projects`, `title text NOT NULL`, `description text`, `status text`, `due_date timestamptz`, `created_by uuid FK → profiles`, `completed_at timestamptz`, `deleted_at timestamptz`

**RLS:** `Tasks are viewable by authenticated users`, `Task assignees can update assigned tasks`

**RPC:** `app.task_transition`, `create_task`, `update_task`, `delete_task`, `assign_reviewer_to_task`, `submit_task_review`

---

## F. Migrasi Terbaru

Migrasi terakhir yang diterapkan: `202612030001_attendance_checkin_and_multi_role.sql`

Migrasi baru harus bernomor mulai `202612040001_...sql`.

---

## G. Temuan Pra-existing untuk PR

Temuan dari pembacaan kode (belum diverifikasi runtime — berlabel **dugaan**):

| ID | Sev | Status | Lokasi |
|---|---|---|---|
| F-01 | Tinggi | Dugaan | `live-telemetry-queries.ts`: `Date` sebagai kunci Map |
| F-02 | Tinggi | Dugaan | `live-telemetry/actions.ts`: jalur VITEST bypass |
| F-03 | Sedang | Dugaan | `admin/live-telemetry/page.tsx`: "Hari server: memuat…" permanen |
| F-04 | Sedang | Dugaan | 13 query serentak vs pool max:3 |
| F-05 | Sedang | Dugaan | env `SUPABASE_DB_URL`/SSL — tidak dapat diverifikasi lokal |
| F-06 | Tinggi | Dugaan | `desktop-header.tsx`: hardcode fallback "Santri" |
| F-07 | Sedang | Dugaan | `getPageTitle()`: `/mutabaah`,`/tasrih`,`/rapor`,`/admin/live-telemetry` → "Pondok OS" |
| F-08 | Tinggi | Dugaan | RLS `students` tidak ada policy santri self-select |
| F-09 | Tinggi | Dugaan | `students.gender NOT NULL` memblokir backfill |
| F-10 | **Kritis** | Dugaan | `gate_passes` GRANT INSERT + policy tidak membatasi field sensitif |
| F-11 | Tinggi | Dugaan | `scan_gate_pass`/`refresh_gate_pass_overdue` — 4 masalah logika |
| F-12 | Sedang | Dugaan | `approve_gate_pass` tanpa cek self-review |
| F-13 | Tinggi | Dugaan | `/tasrih`: halaman, actions tanpa `requireRole` |
| F-14 | Sedang | Dugaan | `/mutabaah`: hanya `students[0]` untuk pengurus |
| F-15 | Sedang | Dugaan | `/rapor`: jalan buntu bila `academic_terms` kosong |
| F-16 | Sedang | Dugaan | `getAnalyticsDrilldownAction`: `createAdminClient()` bukan ReadonlyKysely |
| F-17 | Sedang | Dugaan | `admin/analytics/page.tsx`: guard `user.role` saja |
| F-18 | Sedang | Dugaan | 45 baris single-role check di 17 file |
| F-19 | Rendah | Dugaan | `[object Object]` pada error |
| F-20 | Rendah | Dugaan | ~27 baris locale/date tanpa WIB |
| F-21 | Rendah | Dilaporkan | Populasi telemetry dari `member_type` (tidak diubah per K6) |
