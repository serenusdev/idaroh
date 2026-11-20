#!/usr/bin/env bash
# Concurrency drill: report review command idempotency under parallel callers.
# Runs in CI (database-integration job) after migrations + pgTAP, and locally
# against the disposable Supabase database (see docs/disposable-db-verification.md).
#
# Usage:
#   DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
#     bash scripts/drill/review-concurrency.sh
set -euo pipefail

DB_URL="${DB_URL:?set DB_URL to the LOCAL disposable database URL}"
case "$DB_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Refusing a non-local DB_URL; this drill is disposable-only." >&2; exit 1 ;;
esac

PSQL=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1)
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Audit rows survive re-runs (append-only); count only this run's records.
DRILL_START="$("${PSQL[@]}" -tA -c 'SELECT now();')"

OWNER='00000000-0000-0000-0000-000000000601'
REVIEWER='00000000-0000-0000-0000-000000000602'
REPORT='00000000-0000-0000-0000-000000000603'

echo "== Setup fixtures =="
# Idempotent setup: clear operational rows from any previous drill run first.
# Audit rows are append-only and hash-chained, so they are never deleted; the
# disposable database is destroyed later with `supabase stop --no-backup`.
"${PSQL[@]}" <<SQL
DELETE FROM public.email_outbox
WHERE reference_type = 'report_review_email'
  AND reference_id IN (SELECT id::text FROM public.report_reviews WHERE report_id = '$REPORT');
DELETE FROM public.notifications
WHERE user_id = '$OWNER'
  AND reference_id IN (SELECT id::text FROM public.report_reviews WHERE report_id = '$REPORT');
DELETE FROM public.daily_reports WHERE id = '$REPORT';
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('$OWNER', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'drill-owner@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('$REVIEWER', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'drill-reviewer@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('$OWNER', 'drill-owner@example.test', 'Drill Owner', 'active', 'santri'),
  ('$REVIEWER', 'drill-reviewer@example.test', 'Drill Reviewer', 'active', 'super_admin')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role_id)
SELECT '$REVIEWER', id FROM public.roles WHERE key = 'super_admin'
ON CONFLICT DO NOTHING;
INSERT INTO public.daily_reports (id, user_id, report_date, submission_status, review_status, revision_no)
VALUES ('$REPORT', '$OWNER', DATE '2026-11-18', 'submitted', 'not_reviewed', 1);
SQL

call_review() {
  local key="$1" outfile="$2" decision="${3:-approved}" notes="${4:-}"
  "${PSQL[@]}" -tA > "$outfile" <<SQL
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"$REVIEWER"}', false);
SELECT public.review_report('$REPORT', 1, '$decision', '$notes', '$key');
SQL
}

echo "== Phase 1: same actor/key in parallel =="
call_review "drill-concurrent-same" "$WORK/a.json" &
PID_A=$!
call_review "drill-concurrent-same" "$WORK/b.json" &
PID_B=$!
wait "$PID_A" "$PID_B"

REVIEW_A="$(grep -o '"review_id": "[^"]*"' "$WORK/a.json" | head -1 | cut -d'"' -f4)"
REVIEW_B="$(grep -o '"review_id": "[^"]*"' "$WORK/b.json" | head -1 | cut -d'"' -f4)"
CREATED_TOTAL=$(( $(grep -c '"created": true' "$WORK/a.json" || true) + $(grep -c '"created": true' "$WORK/b.json" || true) ))
test -n "$REVIEW_A" && test "$REVIEW_A" = "$REVIEW_B"
test "$CREATED_TOTAL" -eq 1

"${PSQL[@]}" <<SQL
DO \$\$
BEGIN
  IF (SELECT count(*) FROM public.report_reviews WHERE report_id = '$REPORT') <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 decision, got %', (SELECT count(*) FROM public.report_reviews WHERE report_id = '$REPORT');
  END IF;
  IF (SELECT count(*) FROM public.email_outbox WHERE reference_type = 'report_review_email' AND reference_id = '$REVIEW_A') <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 email outbox event';
  END IF;
  IF (SELECT count(*) FROM public.notifications WHERE reference_id = '$REVIEW_A') <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 notification event';
  END IF;
  IF (SELECT count(*) FROM public.notification_push_outbox o JOIN public.notifications n ON n.id = o.notification_id WHERE n.reference_id = '$REVIEW_A') <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 push outbox row';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE event_name = 'report.review_approved' AND target_id = '$REPORT'
        AND created_at >= '$DRILL_START') <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 audit record';
  END IF;
END
\$\$;
SQL
echo "Phase 1 OK: one decision, one email/push/audit event; both callers got $REVIEW_A"

echo "== Phase 2: distinct keys, same payload, in parallel =="
# Reopen the report (postgres bypasses the authenticated-only guard trigger).
"${PSQL[@]}" -c "UPDATE public.daily_reports SET review_status = 'not_reviewed', reviewer_id = NULL, reviewed_at = NULL WHERE id = '$REPORT';"
# revision_required is non-terminal: the RPC only refuses a report whose
# review_status is already 'approved', so two distinct-key revision_required
# commands on the same report/revision each persist an independent decision.
# revision_required mandates non-empty notes, so both callers send the same
# payload (decision + notes) and differ only in the idempotency key.
PHASE2_NOTES='Mohon tambahkan rincian progres.'
call_review "drill-concurrent-distinct-1" "$WORK/c.json" revision_required "$PHASE2_NOTES" &
PID_C=$!
call_review "drill-concurrent-distinct-2" "$WORK/d.json" revision_required "$PHASE2_NOTES" &
PID_D=$!
wait "$PID_C" "$PID_D"

REVIEW_C="$(grep -o '"review_id": "[^"]*"' "$WORK/c.json" | head -1 | cut -d'"' -f4)"
REVIEW_D="$(grep -o '"review_id": "[^"]*"' "$WORK/d.json" | head -1 | cut -d'"' -f4)"
CREATED_PHASE2=$(( $(grep -c '"created": true' "$WORK/c.json" || true) + $(grep -c '"created": true' "$WORK/d.json" || true) ))
test -n "$REVIEW_C" && test -n "$REVIEW_D"
test "$REVIEW_C" != "$REVIEW_D"
test "$REVIEW_C" != "$REVIEW_A" && test "$REVIEW_D" != "$REVIEW_A"
test "$CREATED_PHASE2" -eq 2

"${PSQL[@]}" <<SQL
DO \$\$
BEGIN
  IF (SELECT count(*) FROM public.report_reviews WHERE report_id = '$REPORT') <> 3 THEN
    RAISE EXCEPTION 'expected 3 independent decisions, got %', (SELECT count(*) FROM public.report_reviews WHERE report_id = '$REPORT');
  END IF;
  IF (SELECT count(DISTINCT id) FROM public.report_reviews WHERE report_id = '$REPORT') <> 3 THEN
    RAISE EXCEPTION 'expected 3 distinct review IDs';
  END IF;
  IF (SELECT count(*) FROM public.report_reviews
      WHERE report_id = '$REPORT' AND id IN ('$REVIEW_A', '$REVIEW_C', '$REVIEW_D')) <> 3 THEN
    RAISE EXCEPTION 'caller-returned review IDs do not match the persisted decisions';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE event_name = 'report.review_approved' AND target_id = '$REPORT'
        AND created_at >= '$DRILL_START') <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 approved audit record';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE event_name = 'report.review_revision_required' AND target_id = '$REPORT'
        AND created_at >= '$DRILL_START') <> 2 THEN
    RAISE EXCEPTION 'expected exactly 2 revision_required audit records';
  END IF;
  IF (SELECT count(*) FROM public.email_outbox
      WHERE reference_type = 'report_review_email'
        AND reference_id IN ('$REVIEW_A', '$REVIEW_C', '$REVIEW_D')) <> 3 THEN
    RAISE EXCEPTION 'expected 3 email outbox events, one per decision';
  END IF;
  IF (SELECT count(DISTINCT reference_id) FROM public.email_outbox
      WHERE reference_type = 'report_review_email'
        AND reference_id IN ('$REVIEW_A', '$REVIEW_C', '$REVIEW_D')) <> 3 THEN
    RAISE EXCEPTION 'email outbox events must be keyed by distinct review IDs';
  END IF;
  IF (SELECT count(*) FROM public.notifications
      WHERE user_id = '$OWNER'
        AND reference_id IN ('$REVIEW_A', '$REVIEW_C', '$REVIEW_D')) <> 3 THEN
    RAISE EXCEPTION 'expected 3 durable notification events, one per decision';
  END IF;
  IF (SELECT count(*) FROM public.notifications
      WHERE user_id = '$OWNER' AND reference_id = '$REVIEW_A'
        AND notification_type = 'REPORT_APPROVED') <> 1
     OR (SELECT count(*) FROM public.notifications
      WHERE user_id = '$OWNER' AND reference_id IN ('$REVIEW_C', '$REVIEW_D')
        AND notification_type = 'REPORT_REVISION_REQUIRED') <> 2 THEN
    RAISE EXCEPTION 'notification types must follow each decision';
  END IF;
  IF (SELECT count(*) FROM public.notification_push_outbox o
      JOIN public.notifications n ON n.id = o.notification_id
      WHERE n.user_id = '$OWNER'
        AND n.reference_id IN ('$REVIEW_A', '$REVIEW_C', '$REVIEW_D')) <> 3 THEN
    RAISE EXCEPTION 'expected 3 push outbox rows, one per decision';
  END IF;
  IF (SELECT count(*) FROM public.report_review_idempotency
      WHERE report_id = '$REPORT' AND status = 'completed' AND review_id IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'expected 3 completed idempotency records';
  END IF;
END
\$\$;
SQL
echo "Phase 2 OK: distinct keys create independent decisions ($REVIEW_C, $REVIEW_D) with their own audit/email/push events"

echo "== Cleanup fixtures =="
# Audit rows are append-only and hash-chained: they are intentionally left in
# place (deleting them would break the chain). The whole disposable database
# is destroyed later with `supabase stop --no-backup`.
"${PSQL[@]}" <<SQL
DELETE FROM public.email_outbox
WHERE reference_type = 'report_review_email'
  AND reference_id IN (SELECT id::text FROM public.report_reviews WHERE report_id = '$REPORT');
DELETE FROM public.notifications
WHERE user_id = '$OWNER'
  AND reference_id IN (SELECT id::text FROM public.report_reviews WHERE report_id = '$REPORT');
DELETE FROM public.daily_reports WHERE id = '$REPORT';
SQL

echo "Concurrency drill PASSED on the disposable database."