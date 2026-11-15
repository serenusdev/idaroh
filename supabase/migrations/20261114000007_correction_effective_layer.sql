-- FUNC-12 + TRC-03: koreksi presensi menulis ke layer efektif saja, klasifikasi
-- final ditentukan pereview, dan pemohon tidak boleh mereview koreksinya sendiri.
-- Catatan asli (attendance_records) tetap append-only; hasil koreksi terlihat
-- lewat attendance_effective (PRD-03 §6.2/§6.3). Migration diterapkan operator.

-- Klasifikasi final hasil review; requested_classification tetap sebagai jejak
-- pengajuan awal agar riwayat koreksi tertelusur.
ALTER TABLE public.attendance_corrections
  ADD COLUMN IF NOT EXISTS effective_classification text;

ALTER TABLE public.attendance_corrections
  DROP CONSTRAINT IF EXISTS attendance_corrections_effective_classification_check;
ALTER TABLE public.attendance_corrections
  ADD CONSTRAINT attendance_corrections_effective_classification_check
  CHECK (effective_classification IS NULL OR effective_classification IN ('on_time', 'grace', 'late', 'excused', 'sick', 'duty'));

-- Backstop race check-then-insert di submitCorrectionAction: satu koreksi
-- terbuka (pending/approved) per user per tanggal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_corrections_one_open_per_date
  ON public.attendance_corrections (user_id, attendance_date)
  WHERE status IN ('pending', 'approved');

-- Signature lama (uuid, text, text) diganti; parameter keempat = klasifikasi
-- efektif pilihan pereview (default: klasifikasi yang diminta pemohon).
DROP FUNCTION IF EXISTS app.review_attendance_correction(uuid, text, text);

CREATE OR REPLACE FUNCTION app.review_attendance_correction(
  p_correction_id uuid,
  p_decision text,
  p_note text DEFAULT NULL,
  p_effective_classification text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_correction public.attendance_corrections%ROWTYPE;
  v_final text;
BEGIN
  IF auth.uid() IS NULL OR NOT app.has_any_role('super_admin', 'yayasan', 'pengurus') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak memiliki akses memproses koreksi.');
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Keputusan koreksi tidak valid.');
  END IF;
  SELECT * INTO v_correction FROM public.attendance_corrections WHERE id = p_correction_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', 'Koreksi tidak ditemukan atau sudah diproses.'); END IF;
  IF v_correction.user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda tidak dapat mereview koreksi presensi Anda sendiri.');
  END IF;
  IF p_decision = 'approved' THEN
    v_final := COALESCE(NULLIF(p_effective_classification, ''), v_correction.requested_classification);
    IF v_final NOT IN ('on_time', 'grace', 'late', 'excused', 'sick', 'duty') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Klasifikasi efektif koreksi tidak valid.');
    END IF;
    -- TRC-03: attendance_records TIDAK disentuh; trigger di bawah menyegarkan
    -- attendance_effective dari effective_classification.
    UPDATE public.attendance_corrections
    SET status = 'approved', reviewer_id = auth.uid(), review_note = p_note, decided_at = now(),
        effective_classification = v_final
    WHERE id = p_correction_id;
  ELSE
    UPDATE public.attendance_corrections
    SET status = 'rejected', reviewer_id = auth.uid(), review_note = p_note, decided_at = now()
    WHERE id = p_correction_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'message', 'Koreksi presensi berhasil diproses.');
END;
$$;
REVOKE ALL ON FUNCTION app.review_attendance_correction(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.review_attendance_correction(uuid, text, text, text) TO authenticated;

-- Refresh layer efektif: prefer klasifikasi final pereview atas requested.
CREATE OR REPLACE FUNCTION app.refresh_attendance_effective(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tanggal snapshot wajib diisi.');
  END IF;

  INSERT INTO public.attendance_effective (
    user_id, attendance_date, status, source_type, source_id, policy_version_id, generated_at
  )
  SELECT
    p.id,
    p_date,
    CASE
      WHEN nod.attendance_date IS NOT NULL THEN 'non_operational'
      WHEN COALESCE(df.attendance_required, (p.member_type IN ('santri', 'koordinator'))) = false THEN 'not_required'
      WHEN corr.id IS NOT NULL THEN corr.final_classification
      WHEN exc.id IS NOT NULL THEN exc.type
      WHEN ar.id IS NOT NULL THEN ar.classification::text
      ELSE 'no_checkin'
    END,
    CASE
      WHEN nod.attendance_date IS NOT NULL THEN 'calendar'
      WHEN COALESCE(df.attendance_required, (p.member_type IN ('santri', 'koordinator'))) = false THEN 'duty_flag'
      WHEN corr.id IS NOT NULL THEN 'correction'
      WHEN exc.id IS NOT NULL THEN 'exception'
      WHEN ar.id IS NOT NULL THEN 'attendance_record'
      ELSE 'attendance_record'
    END,
    COALESCE(corr.id, exc.id, ar.id),
    ar.policy_version_id,
    now()
  FROM public.profiles p
  LEFT JOIN public.non_operational_dates nod ON nod.attendance_date = p_date
  LEFT JOIN LATERAL (
    SELECT f.attendance_required
    FROM public.attendance_duty_flags f
    WHERE f.user_id = p.id AND f.date_from <= p_date AND (f.date_to IS NULL OR f.date_to >= p_date)
    ORDER BY f.created_at DESC LIMIT 1
  ) df ON true
  LEFT JOIN LATERAL (
    SELECT c.id, COALESCE(c.effective_classification, c.requested_classification) AS final_classification
    FROM public.attendance_corrections c
    WHERE c.user_id = p.id AND c.attendance_date = p_date AND c.status = 'approved'
    ORDER BY c.decided_at DESC NULLS LAST LIMIT 1
  ) corr ON true
  LEFT JOIN LATERAL (
    SELECT e.id, e.type
    FROM public.attendance_exceptions e
    WHERE e.user_id = p.id AND e.date_from <= p_date AND e.date_to >= p_date AND e.status = 'approved'
    ORDER BY e.decided_at DESC NULLS LAST LIMIT 1
  ) exc ON true
  LEFT JOIN public.attendance_records ar ON ar.user_id = p.id AND ar.attendance_date = p_date
  WHERE p.status = 'active'
  ON CONFLICT (user_id, attendance_date) DO UPDATE SET
    status = EXCLUDED.status,
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    policy_version_id = EXCLUDED.policy_version_id,
    generated_at = EXCLUDED.generated_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'attendance_date', p_date, 'rows', v_count);
END;
$$;
REVOKE ALL ON FUNCTION app.refresh_attendance_effective(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.refresh_attendance_effective(date) TO authenticated;

-- Trigger refresh ikut memantau kolom effective_classification.
CREATE OR REPLACE FUNCTION app.refresh_attendance_after_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
BEGIN
  PERFORM app.refresh_attendance_effective(NEW.attendance_date);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_attendance_after_correction ON public.attendance_corrections;
CREATE TRIGGER trg_refresh_attendance_after_correction
  AFTER INSERT OR UPDATE OF status, requested_classification, effective_classification, attendance_date ON public.attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION app.refresh_attendance_after_correction();