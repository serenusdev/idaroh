-- FUNC-01: Fix broken duration regex in save_report RPC.
-- The original migration 20261102000006 used dollar-quoting which turned
-- '^\d+$' into a literal two-backslash string that never matches a digit;
-- every duration fell through to the ELSE branch → always 60 minutes.
-- This migration replaces the check with a plain E-string escape so the
-- regex behaves correctly. No schema or RLS changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_report(
  p_user_id      uuid,
  p_report_date  date,
  p_submission_status text,
  p_is_late      boolean,
  p_items        jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report_id    uuid;
  v_revision_no  int := 1;
  v_item         jsonb;
  v_duration     int;
  v_cat_id       uuid;
BEGIN
  -- Upsert the report header
  INSERT INTO public.daily_reports (
    user_id, report_date, submission_status, is_late, first_submitted_at
  )
  VALUES (
    p_user_id,
    p_report_date,
    p_submission_status,
    p_is_late,
    CASE WHEN p_submission_status = 'submitted' THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id, report_date) DO UPDATE
    SET submission_status = EXCLUDED.submission_status,
        is_late            = EXCLUDED.is_late,
        first_submitted_at = COALESCE(daily_reports.first_submitted_at, EXCLUDED.first_submitted_at),
        updated_at         = now()
  RETURNING id, revision_no INTO v_report_id, v_revision_no;

  IF v_report_id IS NULL THEN
    SELECT id, revision_no
      INTO v_report_id, v_revision_no
      FROM public.daily_reports
     WHERE user_id = p_user_id AND report_date = p_report_date;
  END IF;

  -- Delete existing items so we can reinsert
  DELETE FROM public.report_items WHERE report_id = v_report_id;

  -- Insert new items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- FUNC-01 fix: use E-string so \d is treated as a regex digit class
    v_duration := CASE
      WHEN (v_item->>'durationMinutes') ~ E'^\\d+$'
        THEN (v_item->>'durationMinutes')::int
      ELSE 60
    END;

    -- Resolve category by UUID or slug
    SELECT id INTO v_cat_id
      FROM public.report_categories
     WHERE (id::text = v_item->>'categoryId' OR slug = v_item->>'categoryId')
       AND is_active = true
     LIMIT 1;

    INSERT INTO public.report_items (
      report_id, category_id, title, description,
      result_progress, obstacles, duration_minutes, sort_order
    ) VALUES (
      v_report_id,
      v_cat_id,
      v_item->>'title',
      v_item->>'description',
      COALESCE(v_item->>'resultProgress', ''),
      COALESCE(v_item->>'obstacles', ''),
      v_duration,
      COALESCE((v_item->>'sortOrder')::int, 1)
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'report_id', v_report_id, 'revision_no', v_revision_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

COMMIT;
