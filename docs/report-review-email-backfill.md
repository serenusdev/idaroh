# Backfill Design — Orphan `report_review_email` Events

Status: **design + prepared SQL, never executed**. No hosted database was
accessed while preparing this. Execution requires a separately approved
database and explicit operator approval.

## Problem

Review decisions persisted before migration `20261118000001` (12) may have no
matching `email_outbox` event, because the outbox insert only became part of
the review transaction in migration 12. The inventory quantifies this; the
backfill repairs only the still-relevant subset.

## Event identity (deterministic)

```
reference_type = 'report_review_email'
reference_id   = report_reviews.id::text
```

This matches migration 12 and the Resend idempotency key derivation in
`src/lib/email-outbox.ts` (`idaroh-email/sha256(reference_type:reference_id)`).
The unique index `uq_email_outbox_business_reference` (migration 11) plus
`ON CONFLICT (reference_type, reference_id) DO NOTHING` make the backfill
idempotent: re-running it inserts nothing new, and a concurrent live review
command for the same decision can never produce a duplicate logical event.

## Artifacts

| File | Mode |
| --- | --- |
| `supabase/operator/report_review_email_inventory.sql` | Read-only. Orphan detail, counts by decision/month, eligible-subset summary. No email addresses or names in output. |
| `supabase/operator/report_review_email_backfill.sql` | **Dry-run by default.** Inserts only when the operator sets `app.backfill_execute = 'on'` in the same session. |

## Notification policy respected by the backfill

A candidate is backfilled only when ALL hold:

1. No existing `report_review_email` event for the review ID.
2. The decision is the **latest** decision for its report (`decided_at, id`
   ordering — deterministic under ties).
3. The report is still `submitted` and the decision concerns the report's
   **current revision** — superseded revisions are never emailed.
4. `decided_at` is within the operator window (default **7 days**, override
   with `SET app.backfill_window = '<interval>'`). Older orphans stay
   inventory-only; sending them would be "blindly sending old notifications".
5. Recipient resolves fail-closed exactly like the review RPC: valid author
   email, author display name, reviewer display name. Unresolvable candidates
   are reported as skipped, never inserted.

Subject/body formats are copied verbatim from the migration-12 RPC so a
backfilled email is indistinguishable from a live one.

## Operator procedure

1. Run the inventory against the approved database; review counts and detail.
2. Run the backfill file as-is (dry-run). Review the preview: same identity
   and eligibility rules as the insert, `recipient_resolvable` flag included.
   No personal email addresses appear in any output.
3. Obtain explicit approval to send the listed notifications. Remember:
   inserted rows are `pending` and **will be delivered by the notification
   cron worker** (`/api/cron/notifications`, ±15-minute heartbeat).
4. In the same session: `SET app.backfill_execute = 'on';` then run the
   backfill file again. The `RAISE NOTICE` reports inserted/skipped counts.
5. Re-run the inventory to confirm the eligible orphan count dropped to zero.

## Push notifications — intentionally out of scope

Before this remediation, review push events used `reference_id = report_id`,
which cannot be attributed to a specific decision when a report has several
decisions. Legacy push orphans therefore cannot be backfilled deterministically
and are deliberately excluded. From migration 12 onward the push identity is
`notification_type + reference_id(review_id)` and is committed atomically with
the decision, so no new push orphans can be created.