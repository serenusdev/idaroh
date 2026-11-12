-- Atomic inbox -> push enqueue. Only trusted server dispatchers can inspect or mutate delivery state.
BEGIN;

CREATE TABLE public.notification_push_outbox (
  notification_id uuid PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  delivered_token_hashes text[] NOT NULL DEFAULT '{}'::text[],
  last_error text CHECK (last_error IN (
    'no_device', 'oauth_failed', 'network_timeout', 'network_error',
    'fcm_unregistered', 'fcm_invalid_argument', 'fcm_transient', 'fcm_rejected',
    'device_lookup_failed', 'token_remove_failed', 'lease_expired', 'dispatch_budget'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX idx_notification_push_outbox_due
  ON public.notification_push_outbox(next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_notification_push_outbox_leases
  ON public.notification_push_outbox(lease_until) WHERE status = 'processing';
ALTER TABLE public.notification_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_push_outbox TO service_role;

CREATE FUNCTION public.enqueue_notification_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.notification_push_outbox(notification_id) VALUES (NEW.id)
  ON CONFLICT (notification_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_notification_push() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enqueue_notification_push AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_notification_push();

-- Publication and all recipient inbox/outbox rows commit or roll back together.
-- Reuse the existing active-profile audience matcher (including team id/name/slug).
CREATE FUNCTION public.enqueue_published_announcement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status <> 'published' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'published' THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public.notifications(user_id, notification_type, title, body, url, reference_id)
  SELECT p.id, 'ANNOUNCEMENT_PUBLISHED', left('Pengumuman Baru: ' || NEW.title, 200),
    'Tap untuk membaca instruksi lengkap.', '/jadwal?announcement=' || NEW.id::text, NEW.id::text
  FROM public.profiles p
  WHERE p.status = 'active'
    AND app.can_view_audience_for_user(NEW.audience_config, NULLIF(NEW.team_id, ''), p.id)
  ON CONFLICT (user_id, notification_type, reference_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_published_announcement() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enqueue_published_announcement AFTER INSERT OR UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_published_announcement();

-- Claim one at a time so a batch does not sit waiting while its leases expire.
-- An expired eighth attempt is terminal; earlier expired leases are reclaimable.
CREATE FUNCTION public.claim_notification_push(
  p_notification_ids uuid[] DEFAULT NULL,
  p_notification_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS TABLE (
  notification_id uuid, lease_token uuid, attempt_count integer, delivered_token_hashes text[],
  user_id uuid, notification_type text, title text, body text, url text, reference_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  WITH exhausted AS (
    SELECT o.notification_id FROM public.notification_push_outbox o
    WHERE o.status = 'processing' AND o.lease_until <= now() AND o.attempt_count >= 8
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_push_outbox o SET status = 'dead_letter',
    lease_token = NULL, lease_until = NULL, last_error = 'lease_expired'
  FROM exhausted e WHERE o.notification_id = e.notification_id;

  RETURN QUERY
  WITH candidate AS (
    SELECT o.notification_id
    FROM public.notification_push_outbox o JOIN public.notifications n ON n.id = o.notification_id
    WHERE o.attempt_count < 8
      AND ((o.status = 'pending' AND o.next_attempt_at <= now())
        OR (o.status = 'processing' AND o.lease_until <= now()))
      AND (p_notification_ids IS NULL OR o.notification_id = ANY(p_notification_ids))
      AND (p_notification_type IS NULL OR n.notification_type = p_notification_type)
      AND (p_reference_id IS NULL OR n.reference_id = p_reference_id)
    ORDER BY o.next_attempt_at, o.notification_id
    LIMIT 1 FOR UPDATE OF o SKIP LOCKED
  ), claimed AS (
    UPDATE public.notification_push_outbox o SET status = 'processing',
      attempt_count = o.attempt_count + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds'
    FROM candidate c WHERE o.notification_id = c.notification_id
    RETURNING o.*
  )
  SELECT c.notification_id, c.lease_token, c.attempt_count, c.delivered_token_hashes,
    n.user_id, n.notification_type, n.title, n.body, n.url, n.reference_id
  FROM claimed c JOIN public.notifications n ON n.id = c.notification_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_notification_push(uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_push(uuid[], text, text) TO service_role;

-- Fenced renewal/checkpoint before each request and immediately after each success.
CREATE FUNCTION public.checkpoint_notification_push(
  p_notification_id uuid, p_lease_token uuid, p_delivered_token_hash text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_delivered_token_hash IS NOT NULL AND p_delivered_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid token hash';
  END IF;
  UPDATE public.notification_push_outbox o SET lease_until = now() + interval '90 seconds',
    delivered_token_hashes = CASE
      WHEN p_delivered_token_hash IS NULL OR p_delivered_token_hash = ANY(o.delivered_token_hashes)
        THEN o.delivered_token_hashes
      ELSE array_append(o.delivered_token_hashes, p_delivered_token_hash) END
  WHERE o.notification_id = p_notification_id AND o.status = 'processing'
    AND o.lease_token = p_lease_token AND o.lease_until > now();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.checkpoint_notification_push(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_notification_push(uuid, uuid, text) TO service_role;

CREATE FUNCTION public.finish_notification_push(
  p_notification_id uuid, p_lease_token uuid, p_retry boolean, p_error_code text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.notification_push_outbox o SET
    status = CASE WHEN NOT p_retry THEN 'delivered' WHEN o.attempt_count >= 8 THEN 'dead_letter' ELSE 'pending' END,
    next_attempt_at = now() + make_interval(secs => LEAST(3600, 30 * power(2, o.attempt_count - 1))::integer),
    delivered_at = CASE WHEN NOT p_retry THEN now() ELSE NULL END,
    last_error = p_error_code, lease_token = NULL, lease_until = NULL
  WHERE o.notification_id = p_notification_id AND o.status = 'processing'
    AND o.lease_token = p_lease_token AND o.lease_until > now();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_notification_push(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_notification_push(uuid, uuid, boolean, text) TO service_role;

COMMIT;
