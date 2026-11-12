# EXECUTION PLAN — IDAROH

## Gelombang 1 — Identity, sync, notification, backup
| Item | File | Selesai bila | Risiko | Rollback |
|---|---|---|---|---|
| Role missing state | `src/lib/auth/session.ts`, `src/app/(app)/layout.tsx`, new recovery route | Active profile tanpa role tidak memperoleh role default; tampil state recovery | Akun lama yang tidak punya role tidak bisa masuk dashboard | Rollback app change; jangan auto grant role tanpa admin |
| Identity typed errors | `src/lib/auth/session.ts`, `src/lib/supabase/middleware.ts` | DB outage dibedakan dari unauthenticated; retry dan trace ID | Middleware behavior berubah | Revert middleware; keep fail-closed for protected actions |
| Inbox realtime + deep link | `src/app/(app)/notifikasi/page.tsx`, `src/modules/notifications/actions.ts` | Insert muncul lintas device <3s; klik membuka route yang tepat; read state persist | Duplicate listeners, invalid URL | Feature flag realtime; fallback manual refresh; route allowlist |
| Durable notification delivery | `src/app/api/cron/notifications/route.ts`, `src/lib/fcm.ts`, new outbox migration/worker | Semua event yang diwajibkan PRD punya event key, retry, DLQ, receipt telemetry | Duplicate sends | Dual-write then rollback producer; retain outbox |
| Backup provider integration | `src/app/api/cron/backups/route.ts`, deployment config, `docs/backup-restore.md` | Provider backup ID verified; restore staging passed; RPO/RTO recorded | Cost/provider permissions | Keep previous provider backup; revert job but never delete artifacts |
| Role matrix + RLS | `supabase/tests/rls_matrix.sql`, `src/__tests__`, E2E | Every permission/scope pair tested and evidence archived | Policy lockout | Compensating migration; keep break-glass super admin process |

## Gelombang 2 — Load performance and fonts
| Item | File | Selesai bila | Risiko | Rollback |
|---|---|---|---|---|
| Font final | `src/app/layout.tsx`, `src/app/globals.css`, `public/fonts/*`, `package.json` | 0 external font request or documented preconnect; text visible immediately; CLS <0.1 | Brand font mismatch/license | Revert font assets + CSS; preserve fallback |
| Identity payload trim | `src/lib/auth/session.ts` | `.select('*')` replaced with used projection; payload bytes and query duration compared | Missing field breaks shell | Restore old projection until corrected |
| Per-route profiling | `src/app/**`, module data/actions | Lighthouse/HAR baseline attached for top routes | Optimization without evidence | Revert only implicated change |
| Pagination/index | relevant `src/modules/*/data.ts`, Supabase migration | 10k/50k test passes; query plan uses justified index | Index write overhead | `DROP INDEX CONCURRENTLY` compensation |
| JS bundle | route components, PDF/export modules | build analyzer confirms route chunk reduction | Dynamic import UX | revert dynamic import |

## Gelombang 3 — PRD conformance & hardening
| Item | File | Selesai bila | Risiko | Rollback |
|---|---|---|---|---|
| Requirement acceptance 149 rows | `PRD-TRACEABILITY.md`, E2E, pgTAP | each row TERPENUHI or dated remediation | Scope expansion | Product owner re-prioritizes with decision log |
| Temporal edge cases | attendance/report/schedule tests + migrations if needed | boundaries 07:59/08:00/08:15/21:00, Sunday, backfill tested | Historical data drift | migration backup + compensating migration |
| Accessibility | `src/app/layout.tsx`, UI components | zoom 200%, keyboard, screen reader, contrast pass | Layout overflow | CSS-level rollback; do not disable zoom |
| Scale/network | data modules, tests | 10k/50k and offline/reconnect behavior documented | Load on production | staging only; rollback config |
| Release compatibility | `public/sw.js`, `capacitor.config.ts`, release pipeline | old/new clients coexist; update prompt works | stale app version | restore previous cache version and deployment |
| Backup drill | operator docs + provider console | successful staging restore and signed runbook | data loss | do not run destructive restore on production |

## Release gates
- Gate 1: no CRITICAL security/backup/identity defect without mitigation.
- Gate 2: unit + pgTAP + browser E2E green on same commit.
- Gate 3: real device FCM, role matrix, restore drill, performance budget.
- Gate 4: PRD owner signs all open decisions (ODs) and acceptance matrix.

## Prioritas dampak × effort (quadrantChart)
quadrantChart
  title IDAROH remediation priority
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Strategic projects
  quadrant-2 Do first
  quadrant-3 Opportunistic
  quadrant-4 Defer
  "Role missing state": [0.35, 0.92]
  "Backup provider + restore": [0.78, 0.98]
  "Inbox realtime/deep link": [0.32, 0.82]
  "Viewport zoom fix": [0.12, 0.72]
  "Font self-host": [0.35, 0.55]
  "Load test + query tuning": [0.72, 0.75]
  "Offline write queue": [0.86, 0.28]
