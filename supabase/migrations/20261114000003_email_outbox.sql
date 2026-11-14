-- TRC-04: Email outbox table for decision notifications.
-- Emails are NOT sent directly by the application; a background job drains this
-- table and sends through the configured mail provider.  The table follows the
-- same outbox/at-least-once pattern as notification_push_outbox.

BEGIN;

CREATE TABLE public.email_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient     text NOT NULL CHECK (recipient <> ''),
  subject       text NOT NULL CHECK (subject <> ''),
  body_text     text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error    text,
  reference_id  text,
  reference_type text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_outbox_pending
  ON public.email_outbox(created_at) WHERE status = 'pending';

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_outbox TO service_role;

COMMIT;
