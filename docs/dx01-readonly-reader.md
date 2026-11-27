# DX-01 — Jalur Baca Tertype (Kysely + `pg`)

Item penutup Wave 4. Query agregasi analitik/audit/ekspor pindah dari PostgREST (service-role HTTP)
ke koneksi Postgres langsung yang **read-only dan tertype**. Tidak ada perubahan kebijakan izin:
`requireRole()` / `holdsRole()` / RLS tetap satu-satunya penentu siapa boleh melihat apa.

## Apa yang berubah, apa yang tidak

| Jalur | Sebelum | Sesudah |
| --- | --- | --- |
| `getAdminDashboardStatsAction` — blok D3 (7 head-count) + 6 KPI | 11 request REST | 2 SELECT tertype (`fetchSystemHealth`, `fetchOperationalCounts`) |
| `queryAuditLogsAction` | 2 request + `actor_id=in.(…)` tak terbatas | 1 SELECT dengan `EXISTS` + `count(*)::int over ()` |
| Dataset `/api/exports/[id]` | 6 cabang REST chain | SELECT Kysely dengan predikat & rentang WIB yang sama |
| **Semua tulis** (`export_logs` insert/update, `audit_logs` insert, RPC, mutation modul) | service-role + RLS + audit | **tidak berubah** |
| `src/modules/reports/actions.ts` | PostgREST (embedded resource, pin RVS-01) | **sengaja tidak dimigrasikan** |

## Tiga lapis "read-only"

1. **Tipe** — konsumen menerima `ReadonlyKysely<Database>` (`kysely/readonly`): `insertInto`,
   `updateTable`, `deleteFrom`, `mergeInto`, `replaceInto` adalah penanda `KyselyTypeError`, jadi
   tulis = error kompilasi.
2. **Eksekutor** — plugin `ReadOnlyGuardPlugin` menolak node akar non-`SelectQueryNode`
   **sebelum** koneksi diambil, jadi tulis yang diselundupkan lewat cast `unknown` atau
   ``sql`…`.execute(db)`` tidak pernah sampai ke socket.
3. **Sesi** — setiap koneksi dibuka dengan
   `set default_transaction_read_only = on`, `set time zone 'utc'`,
   `set statement_timeout = …` (250–30000 ms, default 5000, `DX01_STATEMENT_TIMEOUT_MS`).
   Ini yang menangkap `WITH x AS (DELETE …) SELECT` — satu-satunya bentuk tulis yang masih berupa
   `SelectQueryNode`.

## Secret baru: `SUPABASE_DB_URL` (wajib)

Nilai = **Connection string → URI** di *Connection pooling* (bukan IP direct):

```
postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

Kenapa pooler: runtime Vercel IPv4-only dan tidak punya IP tetap. Direct connect (`db.<ref>.supabase.co`)
menyelesaikan ke IPv6 `2606…` → `connect ETIMEDOUT`. Pooler DNS-nya IPv4.
Prasyarat: **DB_ALLOW Connections** untuk pooler harus ON (Session mode, port 5432).

`SUPABASE_DB_SSL_MODE` (opsional, default `verify-full`):

| nilai | dipakai untuk |
| --- | --- |
| `verify-full` | default produksi; verifikasi sertifikat |
| `no-verify` | endpoint pooler lama yang tidak mendukung verifikasi hostname |
| `disable` | hanya lokal / CI (Supabase disposable melayani plaintext di `127.0.0.1:54322`) |

Fail-closed: tanpa `SUPABASE_DB_URL`, `getReadOnlyDb()` melempar
`UNAVAILABLE: SUPABASE_DB_URL belum dikonfigurasi…` dan **tidak** jatuh balik ke service-role HTTP.
`scripts/validate-production-env.mjs` kini mewajibkan variabel itu saat build produksi, sehingga
deploy tanpa secret gagal lebih awal (context `ci-compile` tetap dikecualikan).

## Urutan rilis: Secret-First

Perubahan ini menambah secret, jadi urutannya terbalik dari pola Database-First:

1. **Aktifkan pooler** di dashboard Supabase (Project Settings → Database → Connection pooling),
   catat connection string URI.
2. **Simpan secret** di Vercel (Production + Preview): `SUPABASE_DB_URL`, dan
   `SUPABASE_DB_SSL_MODE` hanya bila perlu `no-verify`.
3. **Verifikasi** dengan skrip (tidak mencetak apa pun dari kredensial):
   ```bash
   SUPABASE_DB_URL='postgresql://…' node scripts/verify-readonly-reader.mjs
   ```
   Keluaran: host:port, versi Postgres, status `default_transaction_read_only`, percobaan DDL yang
   **harus** ditolak (SQLSTATE 25006), angka health read, dan kehadiran 11 relasi read model.
   Exit code 1 bila jaminan read-only tidak berlaku.
4. **Merge / deploy.** Setelah itu card Beranda, `/admin/audit`, dan unduhan ekspor tetap normal;
   bila langkah 1–3 dilewati, ketiganya gagal dengan pesan `INTERNAL`/`UNAVAILABLE` yang jelas.

## Rollback

Revert commit DX-01 (satu commit di satu branch) dan redeploy — tidak ada objek database baru,
tidak ada migrasi, tidak ada data yang berubah. Secret `SUPABASE_DB_URL` boleh dibiarkan (tidak
dipakai) atau dihapus; menghapusnya **tidak** mengembalikan jalur lama secara otomatis.

## Catatan presisi hasil

- `pg` mem-parse `timestamptz`/`date` menjadi JS `Date` (mikrodetik hilang). Reader karena itu
  merender kolom waktu di SQL: `to_jsonb(col) #>> '{}'` → teks ISO-8601 yang sama persis dengan yang
  dulu dihasilkan PostgREST. CSV ekspor dan kolom waktu di audit explorer tidak berubah.
- `count(*)` bertipe `bigint` dan dikembalikan sebagai string; semua agregat memakai `count(*)::int`.
- Semantik pencarian audit dipertahankan apa adanya: koma dan kurung `( )` dibuang (keduanya sintaks
  `.or()` PostgREST), `*` dirender sebagai wildcard LIKE, `%` dibiarkan hidup. Ini paritas, bukan
  "perbaikan".
- `ORDER BY audit_logs.created_at DESC` di audit explorer kini diikat `, audit_logs.id DESC`, dan
  keduanya menyebut **kolom**, bukan alias teks `created_at` yang se nama (alias itu mengurutkan
  berdasarkan teks). Sebelumnya dua log dengan timestamp identik bisa membuat satu baris muncul di dua
  halaman atau hilang sama sekali.
- Total baris satu halaman dibawa oleh `cast(count(*) over () as int)`, bukan request kedua. Bentuk
  `count(*)::int over ()` **gagal sintaks di Postgres** (cast mengikat sebelum `OVER` menempel pada
  function call) — kesalahan ini ketahuan oleh langkah paritas di CI, bukan oleh tes unit yang hanya
  membaca teks SQL.
- Plafon baris ikut dipindah: PostgREST diam-diam membatasi 1000 baris (`db-max-rows`); baca ekspor
  kini menulis `.limit(1000)` secara eksplisit (audit tetap 500). Tanpa ini, SELECT mentah bisa
  mengubah ekspor menjadi dump tabel tak terbatas.
- Read model hanya memuat 11 relasi yang benar-benar dibaca, dan nama/kolomnya dicocokkan dengan
  katalog `information_schema` project produksi. Tabel yang tidak ada di peta tidak bisa disebut.
