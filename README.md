# Pondok OS (IDAROH)

Sistem operasi internal pondok pesantren: presensi, laporan harian, tugas & proyek,
jadwal & pengumuman, resource library, direktori tim, serta administrasi & audit trail.
Dibangun sebagai aplikasi web mobile-first dengan wrapper Android opsional.

## Stack

- **Next.js 15 (App Router)** + **React 19** + **TypeScript**
- **Supabase** — Postgres, Auth, Row-Level Security, Storage
- **Tailwind CSS** (token kustom) + Material Symbols
- **Vercel** (hosting + serverless) — cron via route handler ber-`CRON_SECRET`
- **Capacitor** (wrapper Android, opsional; di luar gate rilis awal)

Otorisasi memakai pola *app-layer guard + RLS defense-in-depth*: server action
memeriksa peran via `requireRole`/`requireAuthUser`, dan RLS tetap menjadi lapisan
kedua. Service-role key hanya dipakai di server, tidak pernah di klien.

## Prasyarat

- Node.js 24+, npm
- Proyek Supabase (URL, anon key, service-role key)

## Setup lokal

```bash
npm ci
cp .env.example .env.local   # lalu isi nilai nyata
npm run dev                  # default http://localhost:3000
```

Jika port 3000 dipakai proyek lain, jalankan di 3001: `npm run dev -- -p 3001`.
Jangan pernah menjalankan `next build` dan `next dev` bersamaan (berbagi `.next`).

Migrasi database diterapkan oleh **operator** (Supabase CLI / dashboard), bukan
otomatis saat dev. Lihat `supabase/migrations/`. Beberapa migrasi punya prasyarat
data (mis. index unik OPS-02) — baca komentar di tiap file sebelum apply.

## Skrip

| Skrip | Fungsi |
| --- | --- |
| `npm run dev` | Server pengembangan |
| `npm run build` / `start` | Build produksi / jalankan hasil build |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Unit test (Vitest) |
| `npm run test:e2e` | E2E Playwright (fixture komponen, bukan DB produksi) |
| `npm run e2e:seed` | Seed user E2E ke proyek **non-produksi** |
| `npm run build:android` | Siapkan wrapper Capacitor Android |

### Seed E2E (OPS-07)

`scripts/seed-e2e-user.mjs` menulis data uji memakai service-role key. Script
menolak `NODE_ENV=production` dan butuh konfirmasi eksplisit:

```bash
E2E_SEED_CONFIRM=yes npm run e2e:seed   # atau `npm run e2e:seed`
```

### E2E

Fixture Playwright mem-bundle halaman asli + `IdentityProvider` dengan action
di-mock (esbuild), lalu mounts di browser. Butuh dev server hidup:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 npm run test:e2e -- --workers=1
```

## Environment

Wajib di produksi (divalidasi `scripts/validate-production-env.mjs`, fail-closed):

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET` (≥32 karakter),
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`,
`EMAIL_FROM`.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` adalah pasangan
wajib di production: site key merender widget dan secret key memverifikasi token.
GitHub Actions dapat menjalankan context compile-only eksplisit tanpa credential
deployment; build tersebut bukan bukti environment deployment sudah lengkap.

Opsional:

- `FIREBASE_SERVICE_ACCOUNT_KEY` — push FCM. Bila kosong, push **disabled** dan
  guard mencetak warning eksplisit saat build produksi (OPS-13).
- `OPS_ERROR_WEBHOOK_URL` — drain alerting error produksi (OPS-04).
- `CAPACITOR_SERVER_URL` — URL server untuk wrapper Android.

Jangan set `VITEST` di produksi; guard menolaknya.

## Monitoring (OPS-04)

`throwQueryError` mencatat `console.error` ber-`correlationId` (masuk Vercel logs)
dan, bila `OPS_ERROR_WEBHOOK_URL` diisi, meneruskan error secara *best-effort* ke
endpoint alerting (Slack webhook / Sentry store / log drain). Tanpa URL, hook no-op.
Setup Sentry free tier atau Vercel log drain + alert adalah tugas operator.

## Deploy (Vercel)

1. Set seluruh env wajib di atas (placeholder ditolak guard).
2. Terapkan migrasi terbaru ke proyek Supabase produksi.
3. `next build` — font PDF (`@fontsource/noto-sans` WOFF2) sudah di-include via
   `outputFileTracingIncludes` agar ekspor PDF jalan di serverless (FUNC-03).
4. Aktifkan cron eksternal pemanggil `/api/cron/*` dengan header `CRON_SECRET`.
5. Super admin wajib mengaktifkan TOTP/MFA manual sebelum rilis (gate TRC-10).

## Dokumentasi

- `PRD-01 … PRD-08` + Master PRD — spesifikasi produk per modul.
- `docs/audit/AUDIT-FINDINGS-2026-11-12.md` — register temuan audit (149 requirement).
- `docs/audit/REVIEW-INDEPENDEN-2026-11-14.md` — review independen + verifikasi.
- `docs/HANDOVER-2026-11-13.md` — status pekerjaan & gate operator.
