# NOTIFICATION CONFORMANCE — IDAROH

## Kontrak PRD
Master PRD memasukkan notifikasi in-app sebagai scope awal. PRD modul mencantumkan pengingat presensi/laporan, task assignment/status/review/deadline, perubahan acara/pengumuman, serta administrasi job/notification health. Push FCM adalah kanal platform yang tampak di source, tetapi tidak semua event PRD terbukti menghasilkan inbox + push.

| Event | Penerima | Kanal terlihat | Deep link | Status source | Bukti / gap |
|---|---|---|---|---|---|
| Pengumuman terjadwal dipublish | Audience dari `audience_config` | FCM | `/jadwal` | SETENGAH | `api/cron/notifications/route.ts:30-59`; audience computed, publish then push; failure only logged, not durable retry queue |
| Reminder presensi | Santri active tanpa check-in & tanpa exception | FCM | `/kehadiran` | SETENGAH | `:70-120,132-150`; schedule depends cron invocation; exact send timing requires scheduler configuration proof |
| Reminder laporan | Santri active belum submit & tanpa exception | FCM | `/laporan` | SETENGAH | `:70-71,123-158`; job idempotency table used; no measured receipt |
| In-app inbox list | Current user | In-app DB | URL stored but not opened | SETENGAH | `modules/notifications/actions.ts:42-55`; page only loads on mount |
| Mark read / mark all | Current user | In-app DB | — | SETENGAH | actions `:70-96`; UI local state is updated regardless of success `notifikasi/page.tsx:21-30` |
| Push token lifecycle | Current native device/user | FCM | payload URL/route | SETENGAH | `lib/notifications.ts:21-94`; Android only native branch, no web push proof |
| Task assigned/status/review/deadline | Assignee/reviewer | In-app/FCM per PRD | Task route | UNVERIFIED | source event-by-event dispatch not acceptance-tested |
| Schedule changes/cancel/reminder | Snapshot audience | In-app/FCM | Event detail | UNVERIFIED | PRD-06 SCH-004/005; runtime chain untested |
| Resource/people/admin events | According to role | In-app | entity route | UNVERIFIED | no full event catalog acceptance evidence |

## Rantai pengiriman
- Scheduled announcements: cron -> due announcements query -> conditional update draft→published -> resolve audience -> `sendPushToUsers`. `src/app/api/cron/notifications/route.ts:30-59`.
- Reminder jobs: cron time-window check -> unique `cron_job_runs` claim -> resolve recipients -> push -> mark job completed. `:70-163`.
- FCM send routine exists in `src/lib/fcm.ts`; provider credentials and real delivery are not available in this audit.
- Inbox read/write operations exist in `src/modules/notifications/actions.ts:42-96`.

## Temuan prioritas
| ID | Status | Severity | Dampak | Patch konkret |
|---|---|---|---|---|
| NOT-AUD-01 | SETENGAH | HIGH | Inbox tidak memperbarui otomatis saat event masuk | Add `supabase.channel('notifications:'+user.id).on('postgres_changes', {event:'INSERT', schema:'public', table:'notifications', filter:'user_id=eq.'+user.id}, ...)`; cleanup channel on unmount; refetch on focus/reconnect |
| NOT-AUD-02 | MATI (aksi navigasi inbox) | HIGH | Klik notifikasi tidak membawa user ke tujuan; hanya mark-read | Make whole item a link/button; validate same-origin relative path; `router.push(item.url)` only after mark-read success or preserve navigation if read fails |
| NOT-AUD-03 | SETENGAH | MEDIUM | Local read state may diverge from server | In `notifikasi/page.tsx:21-30`, inspect action result; only commit state on success; rollback optimistic state on thrown error |
| NOT-AUD-04 | SETENGAH | HIGH | Push send failure after announcement publish is logged and announcement remains published; no retry queue evidenced | Persist `notification_outbox` row transactionally with publish; worker claims with `FOR UPDATE SKIP LOCKED`; retry exponential backoff; dead-letter after bounded attempts |
| NOT-AUD-05 | UNVERIFIED | HIGH | Actual cron cadence, FCM credentials, provider delivery, foreground/background behavior not available | Run acceptance matrix on physical Android with FCM message ID + server/client timestamps |
| NOT-AUD-06 | SETENGAH | MEDIUM | Page's unread count badge/realtime sync across app shell not proven by inbox page | Bind badge to exact unread count action and realtime updates; cross-tab BroadcastChannel optional only as cache invalidation, not source of truth |

## Idempotency and retry design
`cron_job_runs` unique key protects reminder job claims (`route.ts:77-92`), but it is not a general notification outbox. Add durable outbox only after checking whether a similar table exists in later migrations. Proposed fields: `id uuid`, `event_key text UNIQUE`, `recipient_id uuid`, `channel text`, `payload jsonb`, `status text`, `attempt_count int`, `next_attempt_at timestamptz`, `last_error_code text`, `sent_at timestamptz`, `created_at timestamptz`. Migration plan: expand (create table + RLS deny client writes) → deploy dual-write → worker reads outbox → backfill only if event history exists → monitor → contract old direct send. Rollback: stop worker and revert producer to existing direct send; retain outbox rows for forensic review. This is a proposal, not applied schema.

## Uji wajib
Test all notification event types on two Android devices and two web sessions; foreground/background/killed; offline then online; permission denied; recipient changed role; duplicate cron invocation; invalid token; deep link while logged out; read status from second device. All runtime results: NOT EXECUTED.

## Sequence diagram
sequenceDiagram
  participant E as Domain Event
  participant DB as Supabase Postgres
  participant W as Worker/Cron
  participant F as Firebase FCM
  participant C as Client Device
  E->>DB: Write domain record / outbox
  Note over DB,W: Outbox transaction is proposed, not yet evidenced
  W->>DB: Claim pending delivery
  W->>F: Send push payload
  F-->>C: Deliver push
  C->>DB: Mark in-app read after user action
  DB-->>C: Persisted read_at
