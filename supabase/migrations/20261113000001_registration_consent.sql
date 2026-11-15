BEGIN;

ALTER TABLE public.account_requests
  ADD COLUMN IF NOT EXISTS claimed_member_type text,
  ADD COLUMN IF NOT EXISTS privacy_consent_version text,
  ADD COLUMN IF NOT EXISTS privacy_consent_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.account_requests'::regclass
      AND conname = 'account_requests_claimed_member_type_check'
  ) THEN
    ALTER TABLE public.account_requests
      ADD CONSTRAINT account_requests_claimed_member_type_check
      CHECK (claimed_member_type IS NULL OR claimed_member_type IN ('santri', 'ustadz', 'pengurus', 'yayasan', 'lainnya'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.account_requests'::regclass
      AND conname = 'account_requests_privacy_consent_pair_check'
  ) THEN
    ALTER TABLE public.account_requests
      ADD CONSTRAINT account_requests_privacy_consent_pair_check
      CHECK (
        (privacy_consent_version IS NULL AND privacy_consent_at IS NULL)
        OR (privacy_consent_version IS NOT NULL AND length(trim(privacy_consent_version)) > 0 AND privacy_consent_at IS NOT NULL)
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.account_requests.claimed_member_type IS 'Klaim kategori dari pemohon, bukan pemberian peran atau hak akses.';
COMMENT ON COLUMN public.account_requests.privacy_consent_at IS 'Waktu persetujuan yang dicatat server; NULL berarti belum tercatat, bukan persetujuan tersirat.';

COMMIT;
