# Runbook Spike MFA Non-Produksi (T0.1 / T0.2 / T0.3)

Panduan operator untuk memverifikasi perilaku provider Supabase Auth yang **belum diketahui** sebelum fitur recovery codes diimplementasikan. Ditulis untuk operator/pemilik yang punya akses dashboard provider. **Eksekusi live = tanggung jawab operator.** Repo hanya menyiapkan script; tidak ada panggilan ke provider mana pun dari CI/build.

Aturan tetap (selaras `docs/operator-release-gates.md` dan Master Prompt §1.3/§4.3):

- **Hanya proyek Supabase disposable NON-PRODUKSI.** Jangan pernah arahkan ke proyek production. Spike membuat user uji, faktor TOTP, dan recovery codes — itu perubahan data, dilarang di produksi tanpa otorisasi.
- Jangan taruh secret (URL/key proyek, password, token, recovery codes) di repo, log, screenshot, atau chat. Script tidak pernah mencetak recovery codes/token plaintext.
- **§4.3:** jangan implementasikan recovery codes di aplikasi sebelum T0.1 melaporkan `SUPPORTED`. Bila tidak didukung → fallback "Reset MFA oleh admin" (WS4).
- Jangan menghapus faktor MFA pengguna nyata. Script hanya beroperasi pada user throwaway yang ia buat sendiri di proyek disposable.

## Status persiapan (jujur)

| Item | Status |
|---|---|
| Script spike T0.1/T0.2/T0.3 + helper | **Implemented locally** (ada di `scripts/spike/`) |
| Validasi sintaks (`node --check`) | **Verified** lulus 4 file |
| Generator TOTP RFC 6238 (vektor uji 59s/1111111109s) | **Verified** lulus (94287082 / 287082 / 07081804) |
| Guard target non-prod (6 skenario) | **Verified** menolak sebelum kontak jaringan |
| Perilaku provider live (recovery codes, refresh aal2, challenge aal1) | **Unknown** — hanya terbukti setelah operator menjalankan spike |

## 0. Prasyarat

1. Buat **proyek Supabase baru yang disposable** (boleh Free plan). Usahakan versi GoTrue/Auth dan pengaturan MFA sama dengan produksi agar hasilnya representatif. Catat di laporan bila versi berbeda.
2. Di proyek disposable: **Authentication → Providers → Email** → matikan **"Confirm email"** supaya `signUp` langsung mengembalikan sesi (script butuh sesi tanpa verifikasi email).
3. Pastikan **MFA/TOTP aktif** di proyek disposable (Authentication → MFA). Recovery codes adalah fitur server terpisah; keberadaannya diuji oleh T0.1.
4. Ambil **Project URL** dan **anon public key** proyek disposable (Settings → API). Masukkan lewat environment variable saat menjalankan — **jangan** tulis di chat/repo.
5. Di mesin operator: Node.js (repo pakai v24) + dependency terpasang (`npm ci`). Tidak perlu `supabase` CLI/`psql` untuk spike ini.

## 1. Environment variable (nama saja, tanpa nilai)

Script memakai namespace **`SPIKE_*` terpisah** dari env aplikasi, supaya `.env` produksi yang ter-load tidak bisa tak-sengaja terpakai.

| Variabel | Wajib | Keterangan |
|---|---|---|
| `SPIKE_CONFIRM` | ya | Set `yes` sebagai pengakuan target adalah proyek disposable non-prod. |
| `SPIKE_SUPABASE_URL` | ya | Project URL proyek disposable (HTTPS). |
| `SPIKE_SUPABASE_ANON_KEY` | ya | anon public key proyek disposable. |
| `NEXT_PUBLIC_SUPABASE_URL` | tidak | Bila ter-set, guard menolak jika `SPIKE_SUPABASE_URL` sama dengannya (anti-tertarget produksi). |
| `NODE_ENV` | tidak | Bila `production`, script menolak jalan. |

Guard menolak (sebelum kontak jaringan apa pun): tanpa `SPIKE_CONFIRM=yes`; tanpa URL/anon key; `NODE_ENV=production`; URL sama dengan proyek aplikasi; URL bukan HTTPS.

## 2. Jalankan spike

Jalankan dari root repo. Ganti `...` dengan nilai asli di terminal operator (jangan di chat). Contoh bentuk perintah:

```bash
SPIKE_CONFIRM=yes SPIKE_SUPABASE_URL=... SPIKE_SUPABASE_ANON_KEY=... npm run spike:mfa:t01
SPIKE_CONFIRM=yes SPIKE_SUPABASE_URL=... SPIKE_SUPABASE_ANON_KEY=... npm run spike:mfa:t02
SPIKE_CONFIRM=yes SPIKE_SUPABASE_URL=... SPIKE_SUPABASE_ANON_KEY=... npm run spike:mfa:t03
```

Setiap script mencetak blok `RESULT: <decision>` berisi field temuan. **Salin blok itu** ke `docs/audit/MFA-VERIFIKASI-2026-11-16.md` (buat file saat run pertama). Jangan salin token/recovery codes (script memang tidak mencetaknya).

### T0.1 — Dukungan recovery codes (gate WS3, §4.3)

Script: `scripts/spike/mfa-t01-recovery-codes.mjs`. Alur: buat user disposable → enroll+verify TOTP (wajib aal2) → `mfa.recoveryCodes.generate()` → sesi aal1 baru → `mfa.recoveryCodes.verify(code)` → cek aal2 + klaim `amr` → uji single-use (replay code yang sama) → `getStatus()`.

| RESULT | Arti | Tindakan |
|---|---|---|
| `SUPPORTED` | generate + verify sukses, aal naik ke aal2 | WS3 recovery codes **boleh** lanjut (flag experimental, rate-limit, single-use). |
| `PARTIAL` | generate saja atau verify saja sukses | WS3 **ditahan**; catat error code, minta keputusan owner. |
| `NOT_SUPPORTED` | keduanya gagal (mis. `mfa_recovery_codes_enroll_not_enabled` / `mfa_recovery_codes_verify_not_enabled`) | WS3 recovery codes **batal** → fallback "Reset MFA oleh admin" (WS4). |
| `ERROR` | setup gagal (mis. Confirm email masih aktif) | Perbaiki prasyarat, ulangi. |

Error code server yang menentukan: `*_not_enabled` = proyek/plan tidak mengaktifkan recovery codes; `insufficient_aal` = sesi belum aal2 saat generate; `mfa_recovery_codes_sole_factor` = belum ada faktor TOTP verified lain.

### T0.2 — Persistensi aal2 saat refresh token

Script: `scripts/spike/mfa-t02-aal2-refresh.mjs`. Alur: enroll+verify TOTP → aal2 → `refreshSession()` → decode ulang klaim `aal`.

| RESULT | Arti | Tindakan |
|---|---|---|
| `AAL2_PERSISTED` | refresh mempertahankan aal2 | "Challenge sekali per sesi" aman; tidak ada prompt ulang tiap refresh. |
| `AAL2_DROPPED` | refresh menurunkan ke aal1 | Aplikasi akan meminta challenge lagi setelah refresh; dokumentasikan dampak UX sebelum rilis. |

### T0.3 — Challenge/verify live pada aal1 (perjalanan login nyata)

Script: `scripts/spike/mfa-t03-challenge-verify.mjs`. Alur: enroll+verify TOTP (buat faktor verified) → sign out → sign in password lagi (aal1 baru, faktor sudah ada) → `mfa.challenge({factorId})` pada aal1 → `mfa.verify` dengan kode TOTP segar.

| RESULT | Arti | Tindakan |
|---|---|---|
| `CHALLENGE_WORKS_AT_AAL1` | challenge diterima di aal1, verify → aal2 | UI `/mfa` mode challenge yang sudah diimplementasikan **valid**. |
| `CHALLENGE_REQUIRES_REAUTH` | challenge ditolak di aal1 | `/mfa` harus mengumpulkan email+password lagi sebelum verify (revisi UI). |
| `INCONCLUSIVE` / `ERROR` | hasil tidak tegas / setup gagal | Catat error code, ulangi atau minta keputusan. |

## 3. Catatan pemetaan ke rencana

- Rencana awal menyebut T0.2 = "challenge di aal1" dan T0.3 = "uji `redirect()` RSC". Runbook ini memetakan ulang ke perilaku provider yang **masih benar-benar unknown** setelah WS2: T0.2 = persistensi aal2 saat refresh; T0.3 = challenge/verify live di aal1.

## 4. Authenticated browser E2E (gate terpisah)

Repository menyediakan `e2e/mfa-enforcement.spec.ts` untuk memverifikasi perjalanan browser nyata:

- Login password dengan factor TOTP yang sudah verified diarahkan ke `/mfa`.
- Challenge berhasil membawa session ke protected page.
- Akun admin dapat melihat badge `MFA: verified` sebagai bukti factor, bukan klaim live AAL2.

Test hanya boleh dijalankan terhadap user disposable non-production yang sudah memiliki factor TOTP verified. Masukkan variable berikut hanya melalui environment operator atau secret store disposable; jangan tulis nilainya ke repo, log, screenshot, atau chat:

| Variable | Kegunaan |
|---|---|
| `E2E_MFA_EMAIL` | User disposable untuk challenge flow |
| `E2E_MFA_PASSWORD` | Password user disposable |
| `E2E_MFA_TOTP_SECRET` | Secret TOTP user disposable |
| `E2E_MFA_ADMIN_EMAIL` | User disposable dengan role admin |
| `E2E_MFA_ADMIN_PASSWORD` | Password admin disposable |
| `E2E_MFA_ADMIN_TOTP_SECRET` | Secret TOTP admin disposable |

Jalankan dari root repo:

```bash
npm run test:e2e -- e2e/mfa-enforcement.spec.ts
```

Tanpa keenam variable yang relevan, test akan **skip**. `2 skipped` bukan bukti MFA browser E2E berhasil. Gate berubah menjadi PASS hanya setelah dua test berjalan dan berhasil pada environment disposable yang tercatat.
- Pertanyaan "apakah `redirect()` dari server action menavigasi" (T0.3 lama) **sudah resolved by design**: `/mfa` adalah server component yang memanggil `redirect()` untuk state active/unauthenticated, dan `MfaChallenge` (client) memakai `window.location.assign` setelah verify — tidak bergantung pada redirect server-action. Tidak perlu spike live untuk itu.
- T0.1 tetap gate keras WS3 sesuai §4.3 dan keputusan owner C-2/Plan Q2 ("Verifikasi spike dulu").

## 4. Setelah spike

1. Catat semua blok RESULT + versi GoTrue proyek disposable + tanggal ke `docs/audit/MFA-VERIFIKASI-2026-11-16.md`.
2. **Cleanup:** hapus proyek disposable (atau user uji di dalamnya). Jangan sentuh faktor/user produksi.
3. Bila T0.1 `SUPPORTED` → lanjut WS3 (recovery codes, flag opt-in default off, rate-limit + backoff, single-use). Bila tidak → WS4 fallback admin-reset MFA + runbook break-glass.
4. Hasil T0.2/T0.3 informing apakah UI `/mfa` perlu revisi sebelum Fase 4 verifikasi browser/E2E non-prod.

## 5. Yang TIDAK dilakukan runbook ini

- Tidak mengubah konfigurasi/produksi, tidak apply migrasi, tidak mengirim email/notifikasi nyata, tidak mengubah cron, tidak merotasi credential, tidak menghapus faktor MFA pengguna nyata, tidak deploy produksi (§1.3).
- Tidak mengimplementasikan recovery codes di aplikasi (itu WS3, digates hasil T0.1).
- Tidak melemahkan RLS/grant; tidak menyentuh `supabase/migrations/**`.
