# SYNC MATRIX — IDAROH

## Arsitektur yang terlihat di source
- Server of record yang direncanakan: Supabase Postgres; auth: Supabase Auth.
- Server Actions mengakses Supabase; sejumlah jalur privileged menggunakan `createAdminClient()` service role.
- Browser shell PWA hanya cache `/offline` dan brand assets (`public/sw.js:1-19`); navigations network-first dan tidak menyimpan halaman privat (`:22-48`).
- Push listener diinisialisasi pada `AppShell` (`src/components/layout/app-shell.tsx:14-18`) dan listener native didaftarkan pada `src/lib/notifications.ts:21-94`.
- In-app inbox memuat sekali saat mount (`src/app/(app)/notifikasi/page.tsx:15-19`); belum terlihat subscription realtime/polling pada halaman inbox.

## Entity map (berdasarkan migrations + module folders)
| Entitas | Source of truth | Modul / bukti |
|---|---|---|
| profiles, roles, permissions, user_roles, account_requests | Supabase Postgres + Auth | `supabase/migrations/20261101000001_iam_schema.sql`; `src/modules/iam` |
| resources, tags, favorites, revisions/import batches | Supabase Postgres + Storage | migration `20261101000002_resource_library_schema.sql`, `20261103000001_resource_import_batches.sql` |
| attendance_records, attendance_exceptions, attendance_effective, policy versions | Supabase Postgres/RPC | migrations `20261101000003...`, `20261102000011...` |
| daily_reports, report revisions/reviews/attachments | Supabase Postgres + Storage | migration `20261101000004_activity_reports_schema.sql` |
| tasks, projects, assignees, checklist, comments, attachments | Supabase Postgres + Storage | migration `20261101000005_tasks_projects_schema.sql` |
| events, announcements, calendar subscriptions/revisions | Supabase Postgres | migration `20261101000006_schedules_announcements_schema.sql` |
| teams, memberships, reviewer assignments, presence | Supabase Postgres | migration `20261101000007_people_teams_schema.sql` |
| audit_logs, policy settings, backup_runs, exports/analytics | Supabase Postgres | migration `20261101000008_analytics_audit_schema.sql` |
| notifications, device_tokens, cron_job_runs | Supabase Postgres + FCM | migrations `20261102000001_device_tokens.sql`, `20261102000008_cron_idempotency.sql`, `20261102000015_notifications_audit_integrity.sql` |

## Matriks silang — semua sel NOT EXECUTED
| Mutasi | Admin desktop → user mobile | User mobile → admin desktop | Dua akun berbeda | Dua tab akun sama | Konflik dua penulis |
|---|---|---|---|---|---|
| Create record | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Update record | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Delete/archive | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Change status | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Upload attachment | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Change role/status akun | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Change preferences/settings | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Notification read state | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |

## Temuan statis
| ID | Status | Severity | Bukti | Dampak | Patch konkret |
|---|---|---|---|---|---|
| SYNC-01 | SETENGAH | HIGH | Inbox fetch satu kali `notifikasi/page.tsx:15-19`; no subscription visible in file | Perangkat/tab lain tidak terbukti menerima notifikasi baru tanpa reload | Add Supabase Realtime subscription scoped `user_id`; cleanup on unmount; refetch on focus/reconnect; test duplicate subscription |
| SYNC-02 | SETENGAH | MEDIUM | Mark-read updates local state regardless of action result `notifikasi/page.tsx:21-30` | UI dapat menampilkan read walau server gagal | Periksa `{success}`; optimistic update hanya dengan rollback; atau update local setelah server success |
| SYNC-03 | UNVERIFIED (runtime) | HIGH | `getCurrentUserProfile` uses server cache React `cache()` `session.ts:44`; role and profile resolved via two parallel admin queries `:59-64` | Perubahan role pada sesi yang sudah render belum dibuktikan terpropagasi | Force route refresh after admin role mutation; use server request-scoped cache only; acceptance on two sessions |
| SYNC-04 | HIDUP (shell only) | INFO | `public/sw.js:1-19,22-48`; docs/pwa.md | Private responses not intentionally cached; offline is shell-only | Preserve policy; test stale asset + update behavior on real device |
| SYNC-05 | UNVERIFIED | HIGH | Supabase realtime/RLS integration cannot be proven from static ZIP | Perubahan lintas akun mungkin tidak masuk karena publication/RLS scope | Run pgTAP and authenticated realtime tests for each role/table |
| SYNC-06 | UNVERIFIED | HIGH | Conflict strategy not documented in source inspected | Concurrent edits may overwrite without conflict signal | Add `version` integer and conditional update only if PRD/OD approval; migration expand/backfill/dual-read/rollback |
| SYNC-07 | UNVERIFIED | MEDIUM | No offline mutation queue evidenced; `docs/pwa.md` states online-first shell-only | Offline write may fail and user must retry manually | Keep online-first unless product owner approves queue; surface explicit offline/failed state, do not imply saved |
| SYNC-08 | UNVERIFIED | HIGH | Logout/account-switch multi-device acceptance absent | Previous session/cache could persist until token/profile check | Add account-switch test and clear query/local caches keyed by user; revoke session according to IAM policy |

## Data flow (Mermaid)
flowchart LR
  A[Client A: Admin Desktop] -->|Server Action + session| B[Next.js Server]
  C[Client B: Mobile Web/PWA] -->|Server Action + session| B
  D[Client C: Android Capacitor] -->|Remote HTTPS app| B
  B -->|Auth + privileged query| E[Supabase Auth/Postgres]
  E -->|Realtime status: NOT VERIFIED| B
  E -->|notifications rows| F[In-app Inbox]
  B -->|FCM send| G[Firebase Cloud Messaging]
  G -->|push| D
  F -.->|no inbox live subscription evidenced| C
