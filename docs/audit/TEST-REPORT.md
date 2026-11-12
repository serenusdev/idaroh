# TEST REPORT — IDAROH

## Eksekusi audit ini
<badge>NOT EXECUTED</badge> Tidak ada test runtime yang dijalankan dari ZIP.

Alasan:
- `node_modules/` tidak tersedia dalam snapshot kerja.
- Tidak ada Supabase local runtime/container, project ref, access token, service-role secret, Firebase service account, deployed URL, atau Android device yang tersedia.
- Tidak menjalankan `npm ci` karena memerlukan registry/network dan bukan bagian dari bukti repository.
- Tidak ada production/staging data atau credentials diarsipkan (ini benar dari sisi keamanan).

## Test harness yang tersedia di repository
- Unit tests: `src/__tests__/*.test.ts` (13 file terdaftar di handoff 3 Nov; repository berisi test IAM, auth-session, attendance, analytics, library, middleware, operations, PDF, people, reports, schedules, tasks, tokens, utils).
- Browser E2E: `e2e/auth.spec.ts`; Playwright config.
- Database RLS tests: `supabase/tests/rls_matrix.sql`.
- CI: `.github/workflows/ci.yml:8-22` lint, typecheck, unit, npm audit, build; `:24-40` migration dry-run (skip bila secrets Supabase kosong); `:42-95` disposable Supabase reset, RLS matrix, seeded E2E, browser E2E.
- Prior handoff 3 Nov menyatakan 13 file test / 48 test lulus, Next build/typecheck/lint lulus pada commit saat itu; E2E login masih gagal sehingga CI belum hijau penuh.
- Handoff 5 Nov menyatakan 17 temuan masih partial/perlu verifikasi eksternal dan menegaskan tidak ada tanggungan commit/push.

## Matriks pengujian
| Skenario | Hasil | Bukti yang dibutuhkan |
|---|---|---|
| npm ci + lint + typecheck + unit test + build | NOT EXECUTED | CI run URL/log dari commit yang sama |
| Migration reset bersih | NOT EXECUTED | `supabase db reset --local --yes` output |
| RLS dua user / dua role / dua team | NOT EXECUTED | pgTAP output + direct REST tests |
| Login pertama perangkat bersih | NOT EXECUTED | Playwright trace, cookie/session log |
| Approval/reject/suspend | NOT EXECUTED | audit row + response + cross-device result |
| Create/update/delete antar dua device | NOT EXECUTED | server event timestamp + client receive timestamp |
| Concurrent edit / double submit | NOT EXECUTED | test result + unique/version evidence |
| Notification cron duplicate | NOT EXECUTED | cron logs + unique job claim rows |
| FCM foreground/background/killed | NOT EXECUTED | physical Android test, FCM ID and receipt time |
| Deep link notification | NOT EXECUTED | logged-in and logged-out route trace |
| Backup/restore | NOT EXECUTED | provider backup ID + staging restore + row counts |
| 10k/50k scale | NOT EXECUTED | load report + query plans |
| Android release build/install | NOT EXECUTED | Gradle output + APK checksum + device smoke test |
| Accessibility 200% zoom | NOT EXECUTED | screenshots + keyboard/screen-reader checklist |

## Acceptance failure/gap known from static evidence
1. Inbox item does not navigate to `item.url` (`src/app/(app)/notifikasi/page.tsx:48-59`).
2. Inbox fetch runs only once on mount (`:15-19`).
3. UI marks items read without checking action result (`:21-30`).
4. Backup cron records metadata only (`src/app/api/cron/backups/route.ts:19-32`).
5. Root viewport disables user zoom (`src/app/layout.tsx:16-21`).
6. Identity resolver silently assigns `santri` when no active role rows (`src/lib/auth/session.ts:102-104`).
7. Push notification chain and cron schedule not accepted on a real device/environment.

## Regression tests to add
- `role_missing` never resolves to `santri` automatically.
- transient profile DB error renders recoverable state, not login redirect.
- inbox INSERT arrives on second device/tab and channel cleans up on logout.
- failed mark-read action does not mutate UI read state.
- notification item opens only validated same-origin route.
- publish + FCM failure leaves durable outbox pending.
- backup job is not marked successful until provider artifact ID is verified.
- production env rejects placeholder URL/key/cron secret.
- viewport allows pinch zoom at 200%.
