-- TRC-26 / BR-PPL-10: kolom bio pribadi terpisah.
-- Sebelumnya updatePersonalBioAction menulis bio ke profiles.notes. Kolom notes
-- hanya ditulis oleh action tersebut (single writer), sehingga backfill bio dari
-- notes aman. Migration ini diterapkan operator; tidak ada dependensi runtime.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';

UPDATE public.profiles
SET bio = notes
WHERE bio = '' AND notes IS NOT NULL AND notes <> '';

COMMENT ON COLUMN public.profiles.bio IS 'Bio singkat non-struktural (BR-PPL-10), diisi sendiri oleh pengguna lewat pengaturan profil.';