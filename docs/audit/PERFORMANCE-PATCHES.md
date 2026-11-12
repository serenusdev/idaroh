# PERFORMANCE PATCHES — IDAROH

## Current baseline
Tidak ada HAR, trace, Lighthouse report, Supabase query plan, payload sample, atau device profile di ZIP. Maka byte savings dan milliseconds saved tidak diklaim.

| Area | Bukti source | Status | Patch konkret | Target / verifikasi |
|---|---|---|---|---|
| Identity query | `src/lib/auth/session.ts:59-64` `.select('*')` | HARDCODED query projection | Replace `*` with exact used profile columns: `id,email,full_name,status,team_name,member_type,avatar_url,phone_number,created_at,updated_at,session_revoked_at` | Compare response bytes + DB duration before/after; target payload reduction measured, not guessed |
| Middleware identity | `src/lib/supabase/middleware.ts:71-79` profile status lookup; layout resolves profile again | SETENGAH | Preserve active-account enforcement; instrument both queries and consolidate only if Next/Supabase cookie behavior remains correct | p50/p95 auth-ready; no bypass of RLS |
| Notification inbox | `notifikasi/page.tsx:15-19` one initial request | SETENGAH | Realtime insert + focus/reconnect refetch, no full route reload | new notification visible <3s; record measured latency |
| Long lists | several modules have data actions and limit handling; exact pagination varies | UNVERIFIED | Audit each action for explicit `.limit()` and cursor; add keyset pagination by `(created_at,id)` to high-volume lists | Load test 10k/50k records; no unbounded select |
| Dashboard aggregation | module actions and analytics RPC migrations exist | UNVERIFIED | Verify dashboard uses RPC aggregates, not client full-table fetch; use `EXPLAIN ANALYZE` on staging | p95 query budget after baseline |
| Bundle splitting | Next App Router route structure exists | UNVERIFIED | Inspect `next build` analyzer before dynamic imports; lazy-load PDF/export/modal only if bundle trace shows material size | compare route JS bytes |
| Images/assets | No runtime image trace | NOT EXECUTED | `next/image` dimensions, lazy load below fold, cache immutable hashed assets | LCP element and bytes measured |
| DB indexes | migrations include indexes, not full query plan | UNVERIFIED | For each slow query, capture `EXPLAIN (ANALYZE, BUFFERS)` before adding index; do not create speculative indexes | add only index justified by plan |
| Service worker | `public/sw.js:1-48` network-first navigation; static assets network-first/cache fallback | HIDUP | Keep private data uncached; verify update lifecycle and stale hashed assets on real device | update prompt and version parity |
| Compression | deployment config unavailable | UNVERIFIED | Confirm Brotli/gzip at hosting edge; compare `content-encoding` and transfer size | verify HTML/JS/CSS compressed |

## Route inventory for performance runs
`/`, `/kehadiran`, `/laporan`, `/tugas`, `/jadwal`, `/tim`, `/resources`, `/resources/{slug}`, `/notifikasi`, `/review`, `/settings/profile`, `/admin/analytics`, `/admin/audit`, `/admin/backup`, `/admin/jadwal`, `/admin/kehadiran`, `/admin/notifications`, `/admin/people`, `/admin/resources`, `/admin/users`, plus login/register/recovery routes.

## Measurement protocol
Cold/warm × desktop/mobile × fast/4G slow × 5 repetitions. Capture TTFB, FCP, LCP element, INP, CLS, TBT, request count, transfer bytes, waterfall, JS execution, hydration, Supabase duration. Use p50 and p75. Do not increase timeout, insert delay, or hide loading.

## Critical path diagram
flowchart TD
  A[Navigation request] --> B[Next middleware: auth.getUser]
  B --> C[Profile status lookup]
  C --> D[App layout: getCurrentUserProfile]
  D --> E[Profile + user_roles parallel queries]
  E --> F[AppShell render]
  F --> G[Client page data fetch]
  G --> H[First data visible]
  H --> I[Non-critical data / interaction]
  D -.->|profile fetch error currently maps to null| J[Redirect to login]
  style J fill:#fdd,stroke:#900
  H -.->|target| K[<1s warm / <2s cold 4G]
