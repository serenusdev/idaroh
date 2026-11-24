BEGIN;

SELECT plan(25);

-- LIB-03 / LIB-08: saving a resource used to be four separate service-role
-- writes (row, tag links, revision read, revision insert), so a failure in the
-- middle left the row changed with stale or missing tags and no revision, and
-- two concurrent saves could both read the same revision_no. PERMISSIONS.md
-- §3.2 requires one atomic command with an audit row, so app.resource_upsert()
-- now owns the whole sequence on the caller's session.
--
--   901 santri        902 koordinator   903 pengurus
--   904 yayasan       905 super_admin   906 pengurus on a pending account
--   920 existing resource (2 tags, 1 revision, legacy_record_id legacy-920)
--
-- Disposable fixtures inside one rolled-back transaction; local/CI only.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT seed.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       seed.email, 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000901', 'ups-santri@example.test'),
  ('00000000-0000-0000-0000-000000000902', 'ups-koordinator@example.test'),
  ('00000000-0000-0000-0000-000000000903', 'ups-pengurus@example.test'),
  ('00000000-0000-0000-0000-000000000904', 'ups-yayasan@example.test'),
  ('00000000-0000-0000-0000-000000000905', 'ups-super-admin@example.test'),
  ('00000000-0000-0000-0000-000000000906', 'ups-pending-pengurus@example.test')
) AS seed (id, email);

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000901', 'ups-santri@example.test', 'Santri Baca', 'active', 'santri'),
  ('00000000-0000-0000-0000-000000000902', 'ups-koordinator@example.test', 'Koordinator Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000903', 'ups-pengurus@example.test', 'Pengurus Pusat', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000904', 'ups-yayasan@example.test', 'Yayasan Pengawas', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000905', 'ups-super-admin@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000906', 'ups-pending-pengurus@example.test', 'Pengurus Menunggu', 'pending', 'pengurus');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000901', (SELECT id FROM public.roles WHERE key = 'santri')),
  ('00000000-0000-0000-0000-000000000902', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000903', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000904', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000905', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000906', (SELECT id FROM public.roles WHERE key = 'pengurus'));

INSERT INTO public.resources (id, name, slug, description, visibility, status, legacy_record_id, created_by)
VALUES
  ('00000000-0000-0000-0000-000000000920', 'Resource Lama', 'r-existing', 'Punya dua tag.', 'internal', 'published',
   'legacy-920', '00000000-0000-0000-0000-000000000903');

INSERT INTO public.tags (id, name, slug)
VALUES
  ('00000000-0000-0000-0000-000000000931', 'otomasi', 'otomasi'),
  ('00000000-0000-0000-0000-000000000932', 'lama', 'lama');

INSERT INTO public.resource_tags (resource_id, tag_id)
VALUES
  ('00000000-0000-0000-0000-000000000920', '00000000-0000-0000-0000-000000000931'),
  ('00000000-0000-0000-0000-000000000920', '00000000-0000-0000-0000-000000000932');

INSERT INTO public.resource_revisions (id, resource_id, revision_no, snapshot, changed_by, change_note)
VALUES
  ('00000000-0000-0000-0000-000000000941', '00000000-0000-0000-0000-000000000920', 1,
   '{"name": "Resource Lama", "slug": "r-existing"}'::jsonb, '00000000-0000-0000-0000-000000000903', 'Revisi awal');

-- PostgreSQL has no temporary functions: this identity switcher lives only
-- inside the rolled-back transaction and is dropped again before finish().
CREATE FUNCTION public.ups_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

SET LOCAL ROLE authenticated;

-- 1-3: one command RPC, SECURITY DEFINER, pinned search_path.
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'resource_upsert'),
  'app.resource_upsert exists as the single write path');
SELECT ok((SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'resource_upsert'),
  'app.resource_upsert is SECURITY DEFINER');
SELECT ok((SELECT array_to_string(p.proconfig, ',') LIKE '%search_path=%'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'app' AND p.proname = 'resource_upsert'),
  'app.resource_upsert pins its search_path');

-- 4-5: a santri is refused and the refusal leaves no row behind — the point of
-- moving the write behind one transaction.
SELECT public.ups_as('00000000-0000-0000-0000-000000000901');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Percobaan Santri', 'slug', 'r-santri-attempt',
                            'description', 'Tidak boleh tersimpan.', 'visibility', 'internal',
                            'status', 'published'), ARRAY['coba'], 'Catatan')->>'success'), 'false',
  'a santri cannot save a resource');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.resources WHERE slug = 'r-santri-attempt'), 0,
  'the refused write left no resource row');

-- 6-7: koordinator is not on the §3.2 authoring tier yet (D7 stays scoped to its
-- own item), and a pending account cannot use its role grant.
SET LOCAL ROLE authenticated;
SELECT public.ups_as('00000000-0000-0000-0000-000000000902');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Percobaan Koordinator', 'slug', 'r-ko-attempt',
                            'description', 'Tidak boleh tersimpan.', 'visibility', 'internal',
                            'status', 'published'), ARRAY[]::text[], 'Catatan')->>'message'),
  'Anda tidak memiliki akses menyimpan resource.',
  'a koordinator is refused by name rather than by a silent no-op');
SELECT public.ups_as('00000000-0000-0000-0000-000000000906');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Percobaan Tertunda', 'slug', 'r-pending-attempt',
                            'description', 'Akun belum aktif.', 'visibility', 'internal',
                            'status', 'published'), ARRAY[]::text[], 'Catatan')->>'message'),
  'Sesi tidak valid atau akun tidak aktif.',
  'a pengurus on a pending account cannot save a resource');

-- 8-13: yayasan creates a resource and the whole bundle lands together.
SELECT public.ups_as('00000000-0000-0000-0000-000000000904');
SELECT is((SELECT count(*)::int FROM public.resources
           WHERE slug = 'r-baru-yayasan'), 0,
  'the fixture starts without the new resource');

-- 9-13 are driven by one call so the row, its tags, its revision and its audit
-- entry are proven to come from the same statement.
SELECT public.ups_as('00000000-0000-0000-0000-000000000904');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Panduan Baru', 'slug', 'r-baru-yayasan',
                            'description', 'Dibuat sekali jalan.', 'visibility', 'restricted',
                            'status', 'draft', 'official_url', 'https://example.test'),
         ARRAY['Otomasi', 'Sanad Quran'], 'Draf awal')->>'success'), 'true',
  'yayasan can create a resource through the atomic command');
RESET ROLE;
SELECT is((SELECT visibility::text || '/' || status::text || '/' ||
                  coalesce(created_by::text, 'none') || '/' ||
                  coalesce(official_url, 'none')
           FROM public.resources WHERE slug = 'r-baru-yayasan'),
  'restricted/draft/00000000-0000-0000-0000-000000000904/https://example.test',
  'the stored row carries the payload and the acting user, not the service role');
SELECT is((SELECT count(*)::int FROM public.resource_revisions rr
           JOIN public.resources r ON r.id = rr.resource_id
           WHERE r.slug = 'r-baru-yayasan' AND rr.revision_no = 1 AND rr.change_note = 'Draf awal'), 1,
  'revision 1 is appended in the same call');
SELECT is((SELECT count(*)::int FROM public.resource_tags rt
           JOIN public.tags t ON t.id = rt.tag_id
           JOIN public.resources r ON r.id = rt.resource_id
           WHERE r.slug = 'r-baru-yayasan' AND t.slug IN ('otomasi', 'sanad-quran')), 2,
  'both tags are normalised, created and linked');
SELECT is((SELECT count(*)::int FROM public.audit_logs al
           JOIN public.resources r ON r.id::text = al.target_id
           WHERE al.event_name = 'library.resource_saved' AND r.slug = 'r-baru-yayasan'
             AND al.actor_id = '00000000-0000-0000-0000-000000000904'), 1,
  'the save is audited once, in its own transaction');

-- 14-19: the validation the service-role path used to skip entirely.
SET LOCAL ROLE authenticated;
SELECT public.ups_as('00000000-0000-0000-0000-000000000903');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Tanpa Deskripsi', 'slug', 'r-tanpa-deskripsi',
                            'description', '', 'visibility', 'internal', 'status', 'published'),
         ARRAY[]::text[], 'Catatan')->>'message'), 'Nama, slug, dan deskripsi wajib diisi.',
  'a missing description is refused by the database');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Visibilitas Salah', 'slug', 'r-visibilitas-salah',
                            'description', 'Isi sah.', 'visibility', 'private', 'status', 'published'),
         ARRAY[]::text[], 'Catatan')->>'message'), 'Visibilitas resource tidak valid.',
  'an unknown visibility label is refused instead of cast');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Status Salah', 'slug', 'r-status-salah',
                            'description', 'Isi sah.', 'visibility', 'internal', 'status', 'hapus'),
         ARRAY[]::text[], 'Catatan')->>'message'), 'Status resource tidak valid.',
  'an unknown status label is refused instead of cast');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Kembar', 'slug', 'r-existing',
                            'description', 'Slug sudah ada.', 'visibility', 'internal', 'status', 'published'),
         ARRAY[]::text[], 'Catatan')->>'message'), 'Slug resource sudah dipakai resource lain.',
  'a duplicate slug is refused with a message, not a raw constraint error');
SELECT is((public.resource_upsert(NULL,
         jsonb_build_object('name', 'Kembar Legacy', 'slug', 'r-legacy-baru', 'legacy_record_id', 'legacy-920',
                            'description', 'Legacy sudah ada.', 'visibility', 'internal', 'status', 'published'),
         ARRAY[]::text[], 'Catatan')->>'message'), 'legacy_record_id resource sudah dipakai.',
  'a duplicate legacy id is refused too');
SELECT is((public.resource_upsert('00000000-0000-0000-0000-000000000999',
         jsonb_build_object('name', 'Entitas', 'slug', 'r-entitas',
                            'description', 'Id tidak ada.', 'visibility', 'internal', 'status', 'published'),
         ARRAY[]::text[], 'Catatan')->>'message'), 'Resource tidak ditemukan.',
  'an unknown resource id cannot be silently turned into a new row');

-- 20-25: updating the existing resource keeps history and replaces tags wholly.
SELECT public.ups_as('00000000-0000-0000-0000-000000000903');
SELECT is((public.resource_upsert('00000000-0000-0000-0000-000000000920',
         jsonb_build_object('name', 'Resource Diperbarui', 'slug', 'r-existing', 'legacy_record_id', 'legacy-920',
                            'description', 'Punya satu tag.', 'visibility', 'internal', 'status', 'published'),
         ARRAY['Baru'], 'Pembaruan tunggal')->>'revision_no'), '2',
  'the second save appends revision 2 instead of racing revision 1');
SELECT is((SELECT count(*)::int FROM public.resource_revisions
           WHERE resource_id = '00000000-0000-0000-0000-000000000920'), 2,
  'both revisions survive the update');
SELECT is((SELECT snapshot->>'name' FROM public.resource_revisions
           WHERE resource_id = '00000000-0000-0000-0000-000000000920' AND revision_no = 1),
  'Resource Lama',
  'the earlier revision still describes the older row');
SELECT is((SELECT snapshot->>'name' FROM public.resource_revisions
           WHERE resource_id = '00000000-0000-0000-0000-000000000920' AND revision_no = 2),
  'Resource Diperbarui',
  'the new snapshot describes the row that was just written');
SELECT is((SELECT string_agg(t.slug, ',' ORDER BY t.slug) FROM public.resource_tags rt
           JOIN public.tags t ON t.id = rt.tag_id
           WHERE rt.resource_id = '00000000-0000-0000-0000-000000000920'), 'baru',
  'the tag set is replaced wholly, never left half written');
SELECT is((SELECT count(*)::int FROM public.audit_logs al
           JOIN public.resources r ON r.id::text = al.target_id
           WHERE al.event_name = 'library.resource_saved' AND r.slug = 'r-existing'), 1,
  'only the accepted update was audited, the six refusals were not');

DROP FUNCTION IF EXISTS public.ups_as(uuid);

SELECT * FROM finish();

ROLLBACK;
