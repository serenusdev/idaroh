-- BACKFILL (DRY-RUN BY DEFAULT): create missing report_review_email outbox
-- events for eligible historical review decisions.
--
-- Authorization: run ONLY against a separately approved database, ONLY after
-- an operator has reviewed supabase/operator/report_review_email_inventory.sql
-- output and explicitly approved execution. Inserted rows are 'pending' and
-- WILL be emailed by the notification cron worker once this commits.
--
-- Identity rule (deterministic, idempotent):
--   reference_type = 'report_review_email'
--   reference_id   = report_reviews.id::text
-- The unique index uq_email_outbox_business_reference (migration
-- 20261117000001) plus ON CONFLICT DO NOTHING make re-runs no-ops.
--
-- Policy filters (avoid blindly sending old notifications):
--   * the decision is the latest decision for its report;
--   * the report is still 'submitted' and the decision concerns the report's
--     current revision (superseded revisions are never backfilled);
--   * decided_at is within the operator window (default 7 days);
--   * the author has a valid email and the reviewer has a display name,
--     matching the fail-closed recipient rules of the review RPC.
--
-- Usage in one session (e.g. SQL Editor or psql):
--   DRY-RUN (default):  run this file as-is; review the preview output.
--   EXECUTE (explicit approval): before running, issue:
--     SET app.backfill_execute = 'on';
--     -- optional: SET app.backfill_window = '3 days';
--   then run this file in the SAME session.

BEGIN;

-- Preflight: the idempotency index must exist; never backfill without it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_email_outbox_business_reference'
  ) THEN
    RAISE EXCEPTION 'uq_email_outbox_business_reference missing; apply migration 20261117000001 first';
  END IF;
END
$$;

CREATE TEMP TABLE backfill_candidates ON COMMIT DROP AS
SELECT
  r.id AS review_id,
  r.report_id,
  r.revision_no,
  r.decision,
  r.decided_at,
  dr.report_date,
  NULLIF(btrim(author.email), '') AS recipient,
  NULLIF(btrim(author.full_name), '') AS recipient_name,
  NULLIF(btrim(reviewer.full_name), '') AS reviewer_name
FROM public.report_reviews r
JOIN public.daily_reports dr ON dr.id = r.report_id
JOIN public.profiles author ON author.id = dr.user_id
LEFT JOIN public.profiles reviewer ON reviewer.id = r.reviewer_id
LEFT JOIN public.email_outbox eo
  ON eo.reference_type = 'report_review_email'
 AND eo.reference_id = r.id::text
WHERE eo.id IS NULL
  AND dr.submission_status = 'submitted'
  AND dr.revision_no = r.revision_no
  AND r.decided_at >= now() - COALESCE(NULLIF(current_setting('app.backfill_window', true), ''), '7 days')::interval
  AND NOT EXISTS (
    SELECT 1 FROM public.report_reviews newer
    WHERE newer.report_id = r.report_id
      AND (newer.decided_at, newer.id) > (r.decided_at, r.id)
  );

-- Preview: identical in dry-run and execute mode. No email addresses or
-- personal names are selected here.
SELECT review_id, report_id, revision_no, decision, decided_at, report_date,
       (recipient ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND recipient_name IS NOT NULL
        AND reviewer_name IS NOT NULL) AS recipient_resolvable
FROM backfill_candidates
ORDER BY decided_at DESC, review_id;

DO $$
DECLARE
  v_execute text := current_setting('app.backfill_execute', true);
  v_inserted integer := 0;
  v_skipped integer;
BEGIN
  SELECT count(*) INTO v_skipped
  FROM backfill_candidates
  WHERE recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR recipient_name IS NULL
     OR reviewer_name IS NULL;

  IF v_execute IS DISTINCT FROM 'on' THEN
    RAISE NOTICE 'DRY-RUN: % candidate(s), % unresolvable recipient(s). No rows inserted. Set app.backfill_execute=on to execute after explicit approval.',
      (SELECT count(*) FROM backfill_candidates), v_skipped;
    RETURN;
  END IF;

  INSERT INTO public.email_outbox (recipient, subject, body_text, reference_id, reference_type, status)
  SELECT
    c.recipient,
    CASE WHEN c.decision = 'approved'
      THEN format('Laporan Harian Anda (%s) Telah Disetujui', c.report_date)
      ELSE format('Laporan Harian Anda (%s) Memerlukan Revisi', c.report_date)
    END,
    CASE WHEN c.decision = 'approved' THEN
      format(
        E'Yth. %s,\n\nLaporan harian Anda untuk tanggal %s pada revisi ke-%s telah disetujui oleh %s.\n\nTerima kasih atas laporan yang Anda kirimkan.',
        c.recipient_name, c.report_date, c.revision_no, c.reviewer_name
      )
    ELSE
      format(
        E'Yth. %s,\n\nLaporan harian Anda untuk tanggal %s pada revisi ke-%s memerlukan revisi.\n\nCatatan dari ustadz/pembina: %s\n\nSilakan perbaiki dan kirim ulang laporan Anda.',
        c.recipient_name, c.report_date, c.revision_no, r.notes
      )
    END,
    c.review_id::text,
    'report_review_email',
    'pending'
  FROM backfill_candidates c
  JOIN public.report_reviews r ON r.id = c.review_id
  WHERE c.recipient ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    AND c.recipient_name IS NOT NULL
    AND c.reviewer_name IS NOT NULL
  ON CONFLICT (reference_type, reference_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'EXECUTED: % outbox event(s) inserted, % skipped (unresolvable recipient). Pending rows will be delivered by the notification cron worker.',
    v_inserted, v_skipped;
END
$$;

COMMIT;