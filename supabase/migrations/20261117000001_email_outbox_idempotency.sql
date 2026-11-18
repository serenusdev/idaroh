-- TRC-04: deduplicate email notifications by business event.
-- This migration never deletes or rewrites existing outbox rows. It refuses to
-- apply if historical duplicate business references exist, so an operator must
-- review that data instead of silently choosing which email to keep.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.email_outbox
    WHERE reference_type IS NOT NULL
      AND reference_id IS NOT NULL
    GROUP BY reference_type, reference_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'email_outbox contains duplicate business references; review before enabling idempotency';
  END IF;
END
$$;

DO $$
DECLARE
  v_existing_index_definition text;
BEGIN
  SELECT indexdef INTO v_existing_index_definition
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'uq_email_outbox_business_reference';

  IF v_existing_index_definition IS NOT NULL
     AND (
       v_existing_index_definition NOT LIKE '%ON public.email_outbox%'
       OR v_existing_index_definition NOT LIKE '%(reference_type, reference_id)%'
     ) THEN
    RAISE EXCEPTION
      'index uq_email_outbox_business_reference already exists with an incompatible definition';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_outbox_business_reference
  ON public.email_outbox(reference_type, reference_id);

COMMIT;

-- Reversible operator action if this constraint must be rolled back:
-- DROP INDEX IF EXISTS public.uq_email_outbox_business_reference;
