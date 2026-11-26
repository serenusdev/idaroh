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
| FONT-02 — re-slice subset ikon | `public/fonts/material-symbols-outlined-subset.woff2`, `scripts/subset-material-icons.mjs` | File 122.864 B (−96,6% dari 3.585.732), 188 glyph, 151 nama (148 `src` + 3 seed); 4 sumbu + `liga` + `FILL 0..1` utuh; `fonts.test.ts` hijau penuh — gerbang ukuran ditetapkan < 140 KB atas keputusan operator; path & nama file tidak berubah sehingga `globals.css`, `layout.tsx`, `middleware.ts`, `public/sw.js` tidak disentuh; `Content-Length` produksi dicatat sebelum vs sesudah | Subset kehilangan ligature yang baru ditambahkan orang lain (dijaga skrip + tes); sumbu variabel hilang sehingga `FILL 1` mati (dijaga assertion `fonts.test.ts:203-210`) | Simpan woff2 lama sebagai artefak, revert asset saja (satu file, tanpa migrasi, tanpa perubahan kode); URL tidak berubah sehingga cukup re-deploy |

Syarat yang wajib dipertahankan slicing (sudah dipinned tes, jadi hasil re-slice terverifikasi otomatis):

1. `familyName` = `Material Symbols Outlined`; magic byte `wOF2`.
2. Sumbu `FILL` 0..1 **wajib utuh** — `FILL 1` dipakai pada 5 call site (`tugas/page.tsx:617`,
   `jadwal/page.tsx:298,391,555`, `laporan/page.tsx:332`).
3. Fitur `liga` tidak dibuang (CSS mengatur `font-feature-settings: "liga"`).
4. Ke-148 nama membentuk tepat 1 glyph non-missing; `font-variation-settings` default
   `"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24` tetap berlaku.
5. `public/fonts/Material-Symbols-Outlined-LICENSE.txt` (Apache) tetap disertakan.

Catatan pelaksanaan:

- Slicing tidak boleh jadi kerja sekali jalan: `scripts/subset-material-icons.mjs` di-commit dan
  berjalan murni di Node/wasm memakai dependency yang sudah ada di `package.json`
  (`harfbuzzjs` + `fontverter` + `@pdf-lib/fontkit` + `typescript`), tanpa `pyftsubset`/`fontTools`.
  `--names` mencetak daftar ikon yang akan retained, `--check` melaporkan drift terhadap file shipped.
- Sumber woff2 asli = rilis Material Symbols yang dipakai aplikasi, dinaikkan ke v387 karena
  master v2.978 tidak punya ligature `diversity_1`/`more_horiz`/`volunteer_activism`. Diunduh ke
  `.cache/` (gitignored) dan di-pin SHA-256 di dalam skrip, bukan dari `fonts.googleapis.com` —
  runtime aplikasi tetap nol request ke host itu.
- Peluang ukuran tambahan butuh keputusan pemilik desain, bukan asumsi agen: tidak ada utilitas bobot
  yang menempel pada span ikon, jadi `wght`/`GRAD`/`opsz` praktis hanya dipakai pada nilai default,
  tetapi `fonts.test.ts:203-210` menuntut keempat sumbu ada pada range penuh. **Diputuskan operator
  2026-11-26: pertahankan 4 sumbu (Opsi 1)** — kontrak sumbu tidak diubah, skrip tetap bebas
  `fontTools`, dan yang disesuaikan hanyalah ambang ukuran (lihat Status di bawah).
- Tidak perlu menaikkan `CACHE_NAME` service worker: `public/sw.js` tidak pernah memanggil
  `cache.put` untuk font/stylesheet, dan respons Vercel memakai `max-age=0, must-revalidate`.

### Status FONT-02 — terukur 2026-11-26 (`scripts/subset-material-icons.mjs`, branch `feat/wave4-1-icon-font-subsetting`)

Sudah berjalan: subset diregenerasi dari master upstream v387 (`Version 2.985`, 6.683 glyph) menjadi
**122.864 byte / 188 glyph** (−96,6% dari 3.585.732). 151 nama ikon retained = 148 dari `src` +
3 seed-only (`diversity_1`, `more_horiz`, `volunteer_activism`) yang **selama ini tampil sebagai teks
mentah di `/laporan`** karena master v2.978 tidak punya ligature-nya; upgrade master memperbaikinya.
Keempat sumbu, `liga`, dan `FILL 0..1` utuh — `fonts.test.ts` hijau kecuali gerbang ukuran.

Angka floor (151 ikon), diukur dua toolchain berbeda dan konsisten:

| Varian subset | woff2 | Ket. |
|---|---|---|
| 4 sumbu penuh (FILL, wght, GRAD, opsz) | **122.864 B** (harfbuzz) / 121.720–121.848 B (fontTools) | `gvar` = 218.127 dari 256.168 B TTF; `glyf` hanya 25.730 B |
| Buang `GRAD`+`opsz` (sisa FILL+wght) | 38.012 B | melanggar `fonts.test.ts:203-210` |
| Buang `wght`+`GRAD` (sisa FILL+opsz) | 37.896 B | melanggar `fonts.test.ts:203-210` |
| Buang `wght`+`GRAD`+`opsz` (sisa FILL) | 18.296 B | `FILL 1` tetap hidup; melanggar assertion sumbu |
| Static tanpa sumbu | 14.836 B | `FILL 1` mati → 5 call site rusak |

Kesimpulan: **< 100 KB tidak mungkin dicapai dengan 151 ikon × 4 sumbu penuh** — biaya ~810 B/ikon
hampir semuanya data delta varian, bukan outline (base letter 38 glyph hanya ±4 KB, glyph name `post`
±1 KB, dan kualitas brotli tidak menutupi 22 KB sisanya). Menambah/mengurangi jumlah ikon bukan jalan
keluar: tes lama menuntut setiap nama yang ada di `src` bentuk.

**Keputusan & keadaan akhir (2026-11-26).** Operator memilih Opsi 1: 4 sumbu dipertahankan, aset
shipped 122.864 B, dan gerbang ukuran `src/__tests__/fonts.test.ts:178-185` plus `SIZE_BUDGET` skrip
diseragamkan ke **< 140 KB** dengan komentar yang menyebut lantainya. Assertion sumbu, `liga`,
`familyName`, `wOF2`, preload `<head>`, dan 148+3 nama tidak diubah. Bukti: `npm test` 1111/1111 hijau,
`npx tsc --noEmit` exit 0, `node scripts/subset-material-icons.mjs --check` konsisten dengan file
shipped. Belum terverifikasi: `Content-Length` produksi (butuh deploy) dan rendering visual 151 ikon
di browser.

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
