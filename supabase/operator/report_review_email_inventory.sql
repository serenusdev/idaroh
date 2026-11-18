-- READ-ONLY INVENTORY: report review decisions without a matching
-- report_review_email outbox event (potential pre-migration-12 orphans).
--
-- Authorization: an operator may run this ONLY against a separately approved
-- database (disposable copy or explicitly approved production read session).
-- This file performs no writes and outputs no personal email addresses or
-- names. It was prepared locally and has never been executed by the agent.
--
-- Event identity rule: email_outbox.reference_type = 'report_review_email'
-- AND email_outbox.reference_id = report_reviews.id::text.

-- 1. Orphan detail -----------------------------------------------------------
SELECT
  r.id                       AS review_id,
  r.report_id,
  r.revision_no,
  r.decision,
  r.decided_at,
  dr.report_date,
  dr.revision_no             AS report_current_revision_no,
  dr.submission_status,
  dr.review_status           AS report_current_review_status,
  p.status                   AS author_account_status,
  NOT EXISTS (
    SELECT 1 FROM public.report_reviews newer
    WHERE newer.report_id = r.report_id
      AND (newer.decided_at, newer.id) > (r.decided_at, r.id)
  )                          AS is_latest_decision_for_report,
  (dr.submission_status = 'submitted' AND dr.revision_no = r.revision_no)
                             AS decision_still_current_revision
FROM public.report_reviews r
JOIN public.daily_reports dr ON dr.id = r.report_id
JOIN public.profiles p ON p.id = dr.user_id
LEFT JOIN public.email_outbox eo
  ON eo.reference_type = 'report_review_email'
 AND eo.reference_id = r.id::text
WHERE eo.id IS NULL
ORDER BY r.decided_at DESC, r.id;

-- 2. Counts by decision type and month ---------------------------------------
SELECT
  r.decision,
  date_trunc('month', r.decided_at) AS decision_month,
  count(*)                          AS orphan_reviews
FROM public.report_reviews r
LEFT JOIN public.email_outbox eo
  ON eo.reference_type = 'report_review_email'
 AND eo.reference_id = r.id::text
WHERE eo.id IS NULL
GROUP BY 1, 2
ORDER BY 2, 1;

-- 3. Summary + backfill-eligible subset ---------------------------------------
-- Eligibility mirrors supabase/operator/report_review_email_backfill.sql:
-- latest decision, still the current revision, submitted, within 7 days.
SELECT
  count(*) AS total_orphan_reviews,
  count(*) FILTER (
    WHERE r.decided_at >= now() - interval '7 days'
      AND dr.submission_status = 'submitted'
      AND dr.revision_no = r.revision_no
      AND NOT EXISTS (
        SELECT 1 FROM public.report_reviews newer
        WHERE newer.report_id = r.report_id
          AND (newer.decided_at, newer.id) > (r.decided_at, r.id)
      )
  ) AS backfill_eligible_reviews
FROM public.report_reviews r
JOIN public.daily_reports dr ON dr.id = r.report_id
LEFT JOIN public.email_outbox eo
  ON eo.reference_type = 'report_review_email'
 AND eo.reference_id = r.id::text
WHERE eo.id IS NULL;