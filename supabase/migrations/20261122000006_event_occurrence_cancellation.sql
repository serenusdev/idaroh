-- Migration: 20261122000006_event_occurrence_cancellation.sql
-- SCH-01: give a recurring agenda a per-day "cancel this one" that the read paths
-- actually honour.
--
-- Current state: recurrence lives only in JavaScript. expandEventRows() multiplies
-- one events row into many display rows and overwrites the primary key with the
-- synthetic string `<uuid>:<YYYY-MM-DD>`, then updateEventAction/deleteEventAction
-- feed that value straight into `.eq("id", ...)`, so Postgres rejects it as a uuid
-- and every edit of a recurring agenda fails with a generic message. The only real
-- cancellation is whole-series (`events.status = 'cancelled'`), so calling off one
-- session of a weekly kajian means cancelling the other eleven.
--
-- After this migration:
--   * event_occurrence_exceptions(event_id, occurrence_date) records the days of a
--     series that do not happen. UNIQUE per (event, date), RLS-protected, readable
--     by the schedule managers, and writable only through the RPC below.
--   * occurrence_date is a WIB calendar date, the same key expandEventRows() already
--     uses for the synthetic id, so a read path and a write path agree on what
--     "that Thursday" means without a new timezone contract.
--   * app.event_occurrence_set() is the single writer: it re-checks the manager
--     tier (§3 schedule.event.update, pengurus/yayasan/super_admin), refuses a date
--     that the rule never produces or that falls outside the series window, and
--     writes its audit_logs row in the same transaction, so a cancelled occurrence
--     can never commit without its ledger entry.
-- Nothing here changes the whole-series status column; a cancelled series and a
-- cancelled single day stay two distinct facts.

-- ---------------------------------------------------------------------------
-- 1. The per-occurrence exception table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_occurrence_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  reason text,
  CONSTRAINT event_occurrence_exceptions_unique UNIQUE (event_id, occurrence_date),
  CONSTRAINT event_occurrence_exceptions_reason_length CHECK (reason IS NULL OR char_length(reason) <= 300)
);

CREATE INDEX IF NOT EXISTS event_occurrence_exceptions_event_id_idx
  ON public.event_occurrence_exceptions(event_id);

-- The santri schedule read asks for every exception of the visible series at once.
CREATE INDEX IF NOT EXISTS event_occurrence_exceptions_occurrence_date_idx
  ON public.event_occurrence_exceptions(occurrence_date);

ALTER TABLE public.event_occurrence_exceptions ENABLE ROW LEVEL SECURITY;

-- The exceptions are an editorial decision about the schedule, so the tier that
-- manages the schedule reads them; everyone else only experiences the missing day.
-- Writes stay service-role only because app.event_occurrence_set() owns
-- validation and the audit ledger.
DROP POLICY IF EXISTS "Schedule managers can read occurrence exceptions" ON public.event_occurrence_exceptions;
CREATE POLICY "Schedule managers can read occurrence exceptions"
  ON public.event_occurrence_exceptions FOR SELECT TO authenticated
  USING (app.is_active_member() AND app.has_any_role('pengurus', 'yayasan', 'super_admin'));

REVOKE ALL ON public.event_occurrence_exceptions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.event_occurrence_exceptions FROM authenticated;
GRANT SELECT ON public.event_occurrence_exceptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.is_event_occurrence_cancelled: the predicate the read paths share.
-- ---------------------------------------------------------------------------
-- Date arithmetic here is deliberately plain `date` math: the caller passes the WIB
-- calendar date it already derived from starts_at, so no timezone conversion can
-- shift an occurrence into a neighbouring day.
CREATE OR REPLACE FUNCTION app.is_event_occurrence_cancelled(p_event_id uuid, p_occurrence_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_occurrence_exceptions v
    WHERE v.event_id = p_event_id
      AND v.occurrence_date = p_occurrence_date
  );
$$;

REVOKE ALL ON FUNCTION app.is_event_occurrence_cancelled(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_event_occurrence_cancelled(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.event_occurrence_set: the only writer, with its audit row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.event_occurrence_set(
  p_event_id uuid,
  p_occurrence_date date,
  p_cancelled boolean DEFAULT true,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_base_date date;
  v_last_date date;
  v_reason text;
  v_actor_name text;
  v_event_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT app.is_active_member() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak valid atau akun tidak aktif.');
  END IF;
  -- §3 schedule.event.create/update/delete = pengurus/yayasan/super_admin at scope
  -- all. Koordinator team-scoped authoring is a separate open item and does not
  -- extend to deciding which days of a series are called off.
  IF NOT app.has_any_role('pengurus', 'yayasan', 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki izin mengelola agenda.');
  END IF;

  IF p_occurrence_date IS NULL OR p_cancelled IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tanggal occurrence dan status pembatalan wajib diisi.');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Agenda tidak ditemukan.');
  END IF;
  IF COALESCE(v_event.recurrence_rule, 'none') = 'none' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pembatalan harian hanya berlaku untuk agenda berulang; gunakan pembatalan seluruh agenda.');
  END IF;
  IF v_event.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Agenda seluruhnya sudah dibatalkan.');
  END IF;

  v_base_date := (v_event.starts_at AT TIME ZONE 'Asia/Jakarta')::date;
  -- The same 180-day horizon expandEventRows() renders, so an operator can never
  -- cancel a date the schedule surface cannot show.
  v_last_date := LEAST(
    v_base_date + 180,
    COALESCE((v_event.recurrence_until AT TIME ZONE 'Asia/Jakarta')::date, v_base_date + 180)
  );
  IF p_occurrence_date < v_base_date OR p_occurrence_date > v_last_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tanggal itu berada di luar rentang pengulangan agenda.');
  END IF;
  IF v_event.recurrence_rule = 'weekly' AND MOD((p_occurrence_date - v_base_date)::int, 7) <> 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tanggal itu bukan bagian dari pengulangan mingguan agenda ini.');
  END IF;

  v_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  -- The table also carries a CHECK; refusing here keeps the operator-facing answer
  -- a message instead of a database error.
  IF v_reason IS NOT NULL AND char_length(v_reason) > 300 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Alasan pembatalan maksimal 300 karakter.');
  END IF;

  IF p_cancelled THEN
    INSERT INTO public.event_occurrence_exceptions (event_id, occurrence_date, cancelled_by, reason)
    VALUES (p_event_id, p_occurrence_date, auth.uid(), v_reason)
    ON CONFLICT (event_id, occurrence_date) DO NOTHING;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', true, 'cancelled', true, 'message', 'Occurrence sudah berstatus dibatalkan.');
    END IF;
    v_event_name := 'event.occurrence_cancelled';
  ELSE
    DELETE FROM public.event_occurrence_exceptions
    WHERE event_id = p_event_id AND occurrence_date = p_occurrence_date;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', true, 'cancelled', false, 'message', 'Occurrence ini memang belum dibatalkan.');
    END IF;
    v_event_name := 'event.occurrence_restored';
  END IF;

  -- Same transaction as the exception change (AGENTS.md: every SECURITY DEFINER
  -- RPC writes audit_logs alongside its mutation).
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (event_name, actor_id, actor_name, target_id, target_label, action_detail)
  VALUES (
    v_event_name,
    auth.uid(),
    COALESCE(v_actor_name, auth.uid()::text),
    p_event_id::text,
    v_event.title,
    format(
      'Occurrence %s %s.%s',
      p_occurrence_date::text,
      CASE WHEN p_cancelled THEN 'dibatalkan' ELSE 'dipulihkan' END,
      COALESCE(' Alasan: ' || v_reason, '')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'cancelled', p_cancelled,
    'message', CASE WHEN p_cancelled THEN 'Occurrence agenda berhasil dibatalkan.' ELSE 'Occurrence agenda berhasil dipulihkan.' END
  );
END;
$$;

REVOKE ALL ON FUNCTION app.event_occurrence_set(uuid, date, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_occurrence_set(uuid, date, boolean, text) TO authenticated;

-- PostgREST wrapper, mirroring the app./public. pair used by every other
-- command RPC in this schema.
CREATE OR REPLACE FUNCTION public.event_occurrence_set(
  p_event_id uuid,
  p_occurrence_date date,
  p_cancelled boolean DEFAULT true,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, app
AS $$
  SELECT app.event_occurrence_set(p_event_id, p_occurrence_date, p_cancelled, p_reason);
$$;

REVOKE ALL ON FUNCTION public.event_occurrence_set(uuid, date, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_occurrence_set(uuid, date, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.event_occurrence_set(uuid, date, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
