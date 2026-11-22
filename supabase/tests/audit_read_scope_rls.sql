BEGIN;

SELECT plan(13);

-- SEC-05 / LIB-01: audit reads and the import log must match PERMISSIONS.md
-- §3.8 (admin.audit.read = yayasan/super_admin, "ditolak untuk pengurus") and
-- §3.2 (library.import.run = super_admin only).

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-yayasan@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-super-admin@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-pengurus@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000904', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-koordinator@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000905', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-santri@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.profiles (id, email, full_name, status, member_type)
VALUES
  ('00000000-0000-0000-0000-000000000901', 'audit-yayasan@example.test', 'Yayasan Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000902', 'audit-super-admin@example.test', 'Super Admin Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000903', 'audit-pengurus@example.test', 'Pengurus Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000904', 'audit-koordinator@example.test', 'Koordinator Uji', 'active', 'pengurus'),
  ('00000000-0000-0000-0000-000000000905', 'audit-santri@example.test', 'Santri Uji', 'active', 'santri');

INSERT INTO public.user_roles (user_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000000901', (SELECT id FROM public.roles WHERE key = 'yayasan')),
  ('00000000-0000-0000-0000-000000000902', (SELECT id FROM public.roles WHERE key = 'super_admin')),
  ('00000000-0000-0000-0000-000000000903', (SELECT id FROM public.roles WHERE key = 'pengurus')),
  ('00000000-0000-0000-0000-000000000904', (SELECT id FROM public.roles WHERE key = 'koordinator')),
  ('00000000-0000-0000-0000-000000000905', (SELECT id FROM public.roles WHERE key = 'santri'));

-- The chain trigger fills hash/previous_hash, so plain inserts stay verifiable.
INSERT INTO public.audit_logs (id, event_name, actor_id, actor_name, target_id, target_label, action_detail)
VALUES
  ('00000000-0000-0000-0000-000000000950', 'audit.scope.probe_one', '00000000-0000-0000-0000-000000000903', 'Pengurus Uji', 'probe-1', 'Proben satu', 'Baris audit pertama untuk matriks visibilitas.'),
  ('00000000-0000-0000-0000-000000000951', 'audit.scope.probe_two', '00000000-0000-0000-0000-000000000903', 'Pengurus Uji', 'probe-2', 'Proben dua', 'Baris audit kedua untuk matriks visibilitas.');

INSERT INTO public.resource_import_batches (id, uploaded_by, file_name, total_rows, status)
VALUES
  ('00000000-0000-0000-0000-000000000960', '00000000-0000-0000-0000-000000000902', 'everything-one.csv', 2, 'completed'),
  ('00000000-0000-0000-0000-000000000961', '00000000-0000-0000-0000-000000000902', 'everything-two.csv', 3, 'completed_with_errors');

-- PostgreSQL has no temporary functions: the switch helper is a plain function
-- inside this rolled-back transaction, dropped again before finish().
CREATE FUNCTION public.audit_vis_as(p_user uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims',
                    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

SET LOCAL ROLE authenticated;

-- 1) audit_logs SELECT: yayasan and super admin only (§3.8).
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000901');
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE id IN ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000951')), 2,
  'yayasan reads the audit trail');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000902');
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE id IN ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000951')), 2,
  'super admin reads the audit trail');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000903');
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE id IN ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000951')), 0,
  'pengurus is denied the audit trail by RLS (§3.8)');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000904');
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE id IN ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000951')), 0,
  'koordinator is denied the audit trail');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000905');
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE id IN ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000951')), 0,
  'santri is denied the audit trail');

-- 2) app.verify_audit_chain is SECURITY DEFINER, so its own guard is the
--    enforcement point. A permitted reader gets past it whatever the chain says.
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000901');
SELECT isnt(coalesce(app.verify_audit_chain()->>'message', ''), 'Tidak memiliki akses memverifikasi audit chain.',
  'yayasan may verify the audit chain');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000902');
SELECT isnt(coalesce(app.verify_audit_chain()->>'message', ''), 'Tidak memiliki akses memverifikasi audit chain.',
  'super admin may verify the audit chain');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000903');
SELECT is(app.verify_audit_chain()->>'message', 'Tidak memiliki akses memverifikasi audit chain.',
  'pengurus cannot verify the audit chain');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000904');
SELECT is(app.verify_audit_chain()->>'message', 'Tidak memiliki akses memverifikasi audit chain.',
  'koordinator cannot verify the audit chain');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000905');
SELECT is(app.verify_audit_chain()->>'message', 'Tidak memiliki akses memverifikasi audit chain.',
  'santri cannot verify the audit chain');

-- 3) resource_import_batches: the import log follows library.import.run (§3.2).
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000902');
SELECT is((SELECT count(*)::int FROM public.resource_import_batches WHERE id IN ('00000000-0000-0000-0000-000000000960', '00000000-0000-0000-0000-000000000961')), 2,
  'super admin reads the import batches');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000901');
SELECT is((SELECT count(*)::int FROM public.resource_import_batches WHERE id IN ('00000000-0000-0000-0000-000000000960', '00000000-0000-0000-0000-000000000961')), 0,
  'yayasan cannot read import batches (§3.2 exclusivity)');
SELECT public.audit_vis_as('00000000-0000-0000-0000-000000000903');
SELECT is((SELECT count(*)::int FROM public.resource_import_batches WHERE id IN ('00000000-0000-0000-0000-000000000960', '00000000-0000-0000-0000-000000000961')), 0,
  'pengurus cannot read import batches');

-- The helper belongs to the bootstrap role; the session is still authenticated.
RESET ROLE;
DROP FUNCTION public.audit_vis_as(uuid);

SELECT * FROM finish();
ROLLBACK;
