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

## Gelombang 4 — Payload ikon (susulan FONT-01)

FONT-01 sudah tertutup: 0 request font eksternal, `@font-face` lokal, preload dipindah ke `<head>`.
Yang tersisa adalah ukuran asetnya. Baseline terukur 2026-11-25 pada `main`:

- `public/fonts/material-symbols-outlined-subset.woff2` = **3.585.732 byte**, **5.869 glyph** (fontkit).
  Nama filanya "subset" tetapi isinya font variable utuh dari Google — inilah penyebab jeda ikon
  tampil sebagai teks ligature mentah (FOUT) meski file sudah disajikan self-host.
- Sumber aplikasi hanya memakai **148 nama ikon** berbeda (diukur dengan collector yang sama dengan
  `src/__tests__/fonts.test.ts`), dipakai pada 372 `<span class="material-symbols-outlined">`.

| Item | File | Selesai bila | Risiko | Rollback |
|---|---|---|---|---|
| FONT-02 — re-slice subset ikon | `public/fonts/material-symbols-outlined-subset.woff2`, script baru `scripts/build-icon-subset.*` | File < 60 KB; hanya 148 nama + `.notdef`; `fonts.test.ts` tetap hijau penuh tanpa mengubah assertion mana pun; path & nama file tidak berubah sehingga `globals.css`, `layout.tsx`, `middleware.ts` tidak perlu disentuh; `Content-Length` produksi dicatat sebelum vs sesudah | Subset kehilangan ligature yang baru ditambahkan orang lain; sumbu variabel hilang sehingga `FILL 1` mati; `liga` GSUB terbuang saat slicing | Simpan woff2 lama sebagai artefak, revert asset saja (satu file, tanpa migrasi, tanpa perubahan kode); URL tidak berubah sehingga cukup re-deploy |

Syarat yang wajib dipertahankan slicing (sudah dipinned tes, jadi hasil re-slice terverifikasi otomatis):

1. `familyName` = `Material Symbols Outlined`; magic byte `wOF2`.
2. Sumbu `FILL` 0..1 **wajib utuh** — `FILL 1` dipakai pada 5 call site (`tugas/page.tsx:617`,
   `jadwal/page.tsx:298,391,555`, `laporan/page.tsx:332`).
3. Fitur `liga` tidak dibuang (CSS mengatur `font-feature-settings: "liga"`).
4. Ke-148 nama membentuk tepat 1 glyph non-missing; `font-variation-settings` default
   `"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24` tetap berlaku.
5. `public/fonts/Material-Symbols-Outlined-LICENSE.txt` (Apache) tetap disertakan.

Catatan pelaksanaan:

- Tooling belum ada di mesin kerja: `pyftsubset` tidak ditemukan dan `fontTools` tidak terinstal.
  Pasang `fonttools[brotli]` (atau paket npm `subset-font`) dan **commit skrip slicingnya** supaya
  hasil bisa diulang saat jumlah ikon bertambah; slicing manual sekali jalan akan basi.
- Sumber woff2 asli diambil dari rilis Material Symbols yang sudah dipakai (versinya dicatat di
  skrip), bukan dari URL `fonts.googleapis.com` — aplikasi tidak boleh menambah kembali host itu.
- Peluang ukuran tambahan yang **butuh keputusan pemilik desain**, bukan asumsi agen: tidak ada
  utilitas bobot (`font-bold` dan sejenisnya) yang menempel pada span ikon, jadi `wght`/`GRAD`/`opsz`
  praktis hanya dipakai pada nilai default. Menyatukannya jadi satu instance akan memperkecil file,
  tetapi melanggar `fonts.test.ts:180-185` yang menuntut keempat sumbu ada — assertion itu harus
  diubah secara sadar dan terpisah, bukan ikut "dilonggarkan" agar build lolos.
- Tidak perlu menaikkan `CACHE_NAME` service worker: `public/sw.js` tidak pernah memanggil
  `cache.put` untuk font/stylesheet, dan respons Vercel memakai `max-age=0, must-revalidate`.

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
  "Icon subset re-slice": [0.28, 0.70]
  "Load test + query tuning": [0.72, 0.75]
  "Offline write queue": [0.86, 0.28]
