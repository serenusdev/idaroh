# Operasi Tim via SQL — interim PPL-002

**Tanggal:** 2026-11-13 · **Keputusan:** pengguna menyetujui CRUD tim aplikasi ditunda **v1.1**. Dokumen ini menyediakan prosedur operator NOW, **bukan bukti SQL telah dijalankan**.

## Batas dan skema aktual

Hanya buat/ubah/arsip **tim** yang disetujui. Tidak menghapus data, mengganti skema/policy/provider, menetapkan role, atau mengubah koordinator. Keanggotaan tetap lewat jalur PPL yang berwenang; penundaan PPL-002 tidak otomatis menunda PPL-003/004.

Skema yang dibaca dari migrasi repository (operator harus mencocokkan dengan lingkungan sebelum menjalankan):

| Tabel | Kolom aktual dan batas penting |
| --- | --- |
| `public.teams` | `id uuid` PK default `gen_random_uuid()`, `name text NOT NULL`, `slug text NOT NULL UNIQUE`, `description text`, `status text NOT NULL` default `active` dengan CHECK `active/archived`, `created_at timestamptz NOT NULL`, `archived_at timestamptz` |
| `public.team_members` | `id uuid` PK, `team_id uuid` FK teams, `user_id uuid` FK auth.users, `team_role text` default `member` dengan CHECK `coordinator/member/assistant`, `title text`, `valid_from date NOT NULL`, `valid_to date`, `created_at timestamptz NOT NULL` |
| `public.audit_logs` | `id`, `event_name`, `actor_id`, `actor_name`, `target_id text`, `target_label`, `action_detail`, `payload jsonb`, `ip_address`, `created_at`, `hash`, `previous_hash`; append-only dan hash diisi trigger |

`teams` **tidak memiliki** `created_by`, `updated_at`, atau `parent_team_id`; `team_members` **tidak memiliki** `added_by`, `removed_by`, atau `note`. Itu model target PRD, bukan kolom yang boleh dipakai pada SQL sekarang. Role `other` pada PRD bukan nilai CHECK aktual.

- Satu membership terbuka per `(team_id,user_id)` melalui unique partial index `WHERE valid_to IS NULL`.
- Maksimal satu koordinator terbuka per tim melalui unique partial index `WHERE team_role='coordinator' AND valid_to IS NULL`.
- `valid_from/valid_to` bertipe **date**, bukan timestamp. Jangan membuka kembali baris historis atau menyimpulkan semua query mengartikan tanggal akhir dengan cara sama; sejumlah jalur memakai `valid_to IS NULL`, lainnya rentang tanggal.
- FK membership memiliki `ON DELETE CASCADE`; itu **bukan izin menghapus tim/pengguna**. Runbook hanya arsip logis. Jangan menutup membership massal agar pemeriksaan arsip lolos.
- `team_role='coordinator'` bukan bukti `user_roles` tersinkron. Jangan INSERT/UPDATE role atau memakai RPC koordinator sebagai bukti otomatis semua invarian PRD-07 §4.3 terpenuhi.

Sumber: `20261101000007_people_teams_schema.sql`, `20261102000005_audit_hardening.sql` (unique koordinator/RPC), `20261102000009_active_membership_constraints.sql`, `20261105000002_remedy_permissive_rls_policies.sql`, `20261101000008_analytics_audit_schema.sql`, `20261102000015_notifications_audit_integrity.sql`, `20261102000016_integrity_guardrails.sql` di `supabase/migrations/`.

## Prasyarat operator dan audit

1. Ada persetujuan operasi terpisah: environment, operator manusia, reviewer, ID tim, aksi, alasan, referensi perubahan. Jangan menyalin kredensial ke dokumen/log; gunakan akses infrastruktur institusi yang sudah diotorisasi. Persetujuan dokumentasi ini tidak menjalankan operasi produksi.
2. Periksa backup nyata yang dapat dipulihkan sesuai [runbook backup](backup-restore.md), bukan manifest cron. Cocokkan migrasi, kolom, constraint, RLS, dan trigger dengan skema di atas; bila berbeda **berhenti** dan minta peninjauan, jangan ALTER skema agar contoh cocok.
3. SQL administratif (misalnya koneksi operator dengan hak istimewa) dan client server `service_role` dapat melewati RLS. **Jangan menonaktifkan/melonggarkan RLS, mengubah grant, atau menyamar sebagai `auth.uid()` pengguna.** SQL ini tidak bergantung pada guard UI; operator bertanggung jawab atas scope persetujuan. Jalur aplikasi tetap wajib guard tests + RLS defense-in-depth.
4. Penulisan tim langsung tidak otomatis menghasilkan audit aplikasi. Contoh di bawah memasukkan `public.audit_logs` dalam transaksi yang sama, dengan aktor manusia aktif ber-role global `super_admin`, alasan, referensi, serta snapshot tim sebelum/sesudah. Ini **bukan** tabel target `audit.audit_logs` dalam PRD. Jangan menulis hash sendiri atau menonaktifkan trigger; kegagalan audit membatalkan mutasi.
5. Tidak menyimpan kontak, token, atau rahasia pada nama/deskripsi/payload. `actor_id` harus operator sesungguhnya, bukan akun pinjaman. Identitas SQL/session dicatat sebagai pelengkap, bukan pengganti aktor manusia.

## Pratinjau baca-saja (belum dijalankan)

Gunakan ID dari permintaan yang disetujui; contoh hanya menampilkan inventaris terbatas. Jangan mengekspor daftar anggota ke catatan publik.

```sql
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'Asia/Jakarta';
SELECT id, name, slug, status, archived_at
FROM public.teams ORDER BY name;
SELECT team_id, count(*) AS open_memberships,
       count(*) FILTER (WHERE team_role = 'coordinator') AS open_coordinators
FROM public.team_members WHERE valid_to IS NULL GROUP BY team_id;
SELECT scope_team_id, count(*) AS active_scoped_roles
FROM public.user_roles
WHERE scope_team_id IS NOT NULL AND revoked_at IS NULL
GROUP BY scope_team_id;
ROLLBACK;
```

Sebelum arsip, periksa juga proyek/tugas, jadwal/pengumuman, reviewer, dan referensi tim lain; catat cara mempertahankan akses historis. Contoh menolak arsip jika ada membership terbuka atau role tim aktif, tetapi **bukan pemeriksa semua dependensi**. Jangan menganggap tim kosong pasti aman diarsipkan.

## Template transaksi tim — default ROLLBACK

Pilih **satu** operasi: `create`, `update`, atau `archive`. Isi variabel NULL berdasarkan perubahan yang disetujui. `update` mengganti nama dan deskripsi, bukan slug; NULL deskripsi berarti sengaja mengosongkan deskripsi. `archive` tidak menutup membership atau mencabut role. Nama baru tidak otomatis menyinkronkan cache tampilan `profiles.team_name`; rencanakan pemeriksaan/sinkronisasi terpisah berbasis ID bila diperlukan, jangan bulk-update profil berdasarkan kecocokan nama.

Blok sengaja gagal bila parameter/persetujuan belum diisi. Gunakan sesi singkat/maintenance window karena lock memblokir penulis lain. Konflik/timeout/constraint → **ROLLBACK dan tinjau**, bukan memaksa atau melemahkan constraint. Tidak ada upsert yang diam-diam mengubah tim lain.

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL TIME ZONE 'Asia/Jakarta';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $operator_team$
DECLARE
  v_operation text := NULL;       -- create / update / archive
  v_actor uuid := NULL;           -- ID operator manusia sebenarnya
  v_team_id uuid := NULL;         -- wajib untuk update/archive
  v_name text := NULL;            -- wajib untuk create/update
  v_slug text := NULL;            -- wajib untuk create, jangan pakai slug tim lain
  v_description text := NULL;     -- nilai baru; jangan isi rahasia
  v_reason text := NULL;          -- alasan yang telah disetujui
  v_change_ref text := NULL;      -- referensi persetujuan, bukan secret
  v_actor_name text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF v_operation IS NULL OR v_operation NOT IN ('create', 'update', 'archive')
     OR v_actor IS NULL OR NULLIF(btrim(v_reason), '') IS NULL
     OR NULLIF(btrim(v_change_ref), '') IS NULL THEN
    RAISE EXCEPTION 'STOP: lengkapi operasi, aktor, alasan, dan referensi persetujuan';
  END IF;

  LOCK TABLE public.teams, public.team_members, public.user_roles
    IN SHARE ROW EXCLUSIVE MODE;
  SELECT p.full_name INTO v_actor_name
  FROM public.profiles p
  WHERE p.id = v_actor AND p.status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = p.id AND r.key = 'super_admin'
        AND ur.scope_type = 'global' AND ur.revoked_at IS NULL
    )
  FOR SHARE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STOP: operator harus Super Admin aktif yang disetujui';
  END IF;

  IF v_operation IN ('create', 'update') AND NULLIF(btrim(v_name), '') IS NULL THEN
    RAISE EXCEPTION 'STOP: nama wajib';
  END IF;

  IF v_operation = 'create' THEN
    IF v_team_id IS NOT NULL OR v_slug IS NULL
       OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'STOP: ID dibuat server dan slug baru harus valid';
    END IF;
    INSERT INTO public.teams (name, slug, description, status)
    VALUES (btrim(v_name), v_slug, v_description, 'active')
    RETURNING id INTO v_team_id;
  ELSE
    SELECT to_jsonb(t) INTO v_before
    FROM public.teams t WHERE t.id = v_team_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STOP: tim target tidak ditemukan';
    END IF;
    IF v_before->>'status' <> 'active' THEN
      RAISE EXCEPTION 'STOP: contoh tidak mengubah/membuka kembali tim arsip';
    END IF;

    IF v_operation = 'update' THEN
      UPDATE public.teams SET name = btrim(v_name), description = v_description
      WHERE id = v_team_id;
    ELSE
      IF EXISTS (SELECT 1 FROM public.team_members
                 WHERE team_id = v_team_id AND valid_to IS NULL)
         OR EXISTS (SELECT 1 FROM public.user_roles
                    WHERE scope_team_id = v_team_id AND revoked_at IS NULL) THEN
        RAISE EXCEPTION 'STOP: arsip memerlukan penanganan membership/role terpisah';
      END IF;
      UPDATE public.teams SET status = 'archived', archived_at = now()
      WHERE id = v_team_id;
    END IF;
  END IF;

  SELECT to_jsonb(t) INTO v_after FROM public.teams t WHERE t.id = v_team_id;
  INSERT INTO public.audit_logs
    (event_name, actor_id, actor_name, target_id, target_label, action_detail, payload)
  VALUES
    (CASE v_operation WHEN 'create' THEN 'team.created'
                      WHEN 'update' THEN 'team.updated'
                      ELSE 'team.archived' END,
     v_actor, v_actor_name, v_team_id::text, v_after->>'name', v_reason,
     jsonb_build_object('source', 'operator_sql', 'change_ref', v_change_ref,
                       'database_session_user', session_user,
                       'before', v_before, 'after', v_after));
END;
$operator_team$;

-- Pratinjau transaksi sendiri: periksa tim target dan audit yang baru dibuat.
SELECT id, name, slug, status, archived_at FROM public.teams ORDER BY name;
SELECT event_name, actor_id, target_id, action_detail, payload
FROM public.audit_logs
WHERE xmin::text::bigint = txid_current() % 4294967296
ORDER BY created_at, id;

ROLLBACK; -- DEFAULT: tidak ada perubahan atau audit yang dipersistenkan.
```

## Penerapan dan penghentian

Default selalu **ROLLBACK**. Dry-run yang rollback juga membatalkan audit transaksi; catat hasil pratinjau tanpa data sensitif pada catatan operasi terpisah. Jangan menjalankan `COMMIT` setelah blok yang sudah rollback: tidak ada perubahan tertunda untuk disimpan.

Hanya operator dengan persetujuan **penerapan** boleh menjalankan ulang salinan yang telah direview, memastikan target/dampak masih sama, lalu mengganti penutup ROLLBACK dengan COMMIT pada salinan tersebut. Lakukan pemeriksaan pasca-commit atas satu tim target, audit, dan akses scope melalui prosedur operasi yang disetujui. Dokumen ini tidak menyatakan pemeriksaan itu telah lulus. Bila perlu koreksi setelah commit, gunakan perubahan kompensasi beraudit dan persetujuan baru; jangan menghapus tim, membership, atau audit untuk membatalkan riwayat.
