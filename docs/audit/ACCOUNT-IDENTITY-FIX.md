# ACCOUNT IDENTITY FIX — IDAROH

## Alur aktual yang dapat dibuktikan
1. Middleware memanggil Supabase `auth.getUser()` (`src/lib/supabase/middleware.ts:65-67`).
2. Middleware membaca `profiles.status` (`:71-79`) dan mengalihkan user nonaktif/unauthenticated ke `/login` (`:81-92`).
3. App layout memanggil `getCurrentUserProfile()` (`src/app/(app)/layout.tsx:10`) dan memeriksa `user.status === active` (`:12-16`).
4. Resolver mengambil profile dan active user_roles secara paralel dengan service-role client (`src/lib/auth/session.ts:59-64`), menyusun role dari `user_roles` (`:66-75`), dan mewajibkan profile (`:77-81`).

## Temuan
| ID | Status | Severity | Bukti | Dampak | Patch |
|---|---|---|---|---|---|
| IAM-AUD-01 | SETENGAH | HIGH | `session.ts:102-104`: jika tidak ada role row, resolver menambahkan `santri` | Profil aktif yang kehilangan role assignment tampak seperti santri alih-alih kondisi provisioning/akses tidak lengkap; ini menyamarkan data IAM yang rusak | Hapus fallback diam-diam; return state `role_missing` atau `null`/typed error dan layar recovery. Santri harus memperoleh role melalui provisioning/approval eksplisit |
| IAM-AUD-02 | SETENGAH | MEDIUM | `session.ts:61-64` memakai `.select('*')` pada `profiles` | Mengambil field profil yang tidak diperlukan pada setiap request identitas | Ganti `.select('id,email,full_name,status,team_name,member_type,avatar_url,phone_number,created_at,updated_at,session_revoked_at')` sesuai field yang benar-benar dipakai |
| IAM-AUD-03 | UNVERIFIED | HIGH | `session.ts:124-129` catch mengembalikan `null`; middleware redirect ke login | Gangguan sementara DB dapat tampak seperti sesi hilang dan memicu login ulang | Bedakan `unauthenticated`, `profile_missing`, `inactive`, `identity_fetch_error`; jangan redirect error DB ke login; tampilkan retry dengan correlation ID |
| IAM-AUD-04 | SETENGAH | MEDIUM | middleware membaca status profile; layout juga resolve profile; dua tahap query identity | Login-ready time dan race window belum terukur; profile fetch berulang di request berbeda | Instrument auth/profile/role-ready marks; pastikan data identity request-scoped dan hindari query status ganda bila middleware strategy memungkinkan |
| IAM-AUD-05 | UNVERIFIED | HIGH | `session_revoked_at` dibandingkan dengan JWT `iat` `session.ts:83-92`; tidak ada multi-device acceptance evidence | Sesi perangkat lain mungkin tidak menyadari revocation sampai request berikutnya | Jalankan dua-device test; enforce revoked timestamp server-side pada every protected action/RLS where possible |

## State machine target
stateDiagram-v2
  [*] --> resolving_session
  resolving_session --> unauthenticated: no valid Supabase session
  resolving_session --> resolving_profile: auth user exists
  resolving_profile --> identity_error: DB/network error
  resolving_profile --> profile_missing: no profiles row
  resolving_profile --> inactive: status rejected/suspended/deactivated
  resolving_profile --> role_missing: active profile, no active role
  resolving_profile --> resolving_scope: profile + active role found
  resolving_scope --> active: team scope loaded
  resolving_scope --> identity_error: scope query failed
  identity_error --> resolving_session: retry with bounded backoff
  profile_missing --> recovery: admin provisioning required
  role_missing --> recovery: admin role assignment required
  inactive --> support: contact authorized admin
  active --> [*]

## Pseudocode target
```ts
const session = await auth.getUser();
if (!session.user) return { state: "unauthenticated" };

const profile = await loadProfile(session.user.id);
if (profile.error) return { state: "identity_error", retryable: true };
if (!profile.data) return { state: "profile_missing" };
if (profile.data.status !== "active") return { state: "inactive", status: profile.data.status };

const roles = await loadActiveRoles(session.user.id);
if (roles.error) return { state: "identity_error", retryable: true };
if (roles.data.length === 0) return { state: "role_missing" };

const scopes = await loadTeamScopes(session.user.id);
if (scopes.error) return { state: "identity_error", retryable: true };
return { state: "active", profile: profile.data, roles: roles.data, scopes: scopes.data };
```

## Kriteria verifikasi
- Akun baru disetujui pada perangkat bersih; semua role/menu yang benar tampil tanpa reload.
- Akun active tanpa profile/role tidak masuk dashboard dengan role default.
- Suspend/revoke oleh admin memblokir request berikutnya di dua perangkat dalam batas yang ditetapkan IAM.
- Gagal fetch profile menghasilkan recovery/retry state, bukan redirect loop.
- Ganti akun di browser yang sama tidak pernah menampilkan data profil akun sebelumnya.
