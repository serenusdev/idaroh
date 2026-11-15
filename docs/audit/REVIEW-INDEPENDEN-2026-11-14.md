# Review Independen — 2026-11-14 (sesi lanjutan)

Reviewer: agen utama (Qoder), independen terhadap klaim `.agents/tasks/abba-os-audit-backlog/batch-a-review.md`, `batch-b-review.md`, dan `docs/audit/PROGRESS-2026-11-13-LANJUTAN.md`.
Cakupan: commit `0f4a2f8`, `d83c5b8`, `c7ed95b`, `fe6abe7`, `d5d2ac3` + perubahan working-tree fase 2/3.
Metode: baca kode + migrasi, `npm run typecheck`, `vitest run --maxWorkers=2` (414 test), e2e Playwright fixture terhadap dev server :3001 (bukan E2E DB produksi).

## 1. Terverifikasi sesuai klaim

- SEC-01/FUNC-04/SEC-05: RPC `app.admin_update_user` atomik (update profil + rotasi role + audit satu transaksi), grant hanya `service_role`, guard hierarki tetap di app (`adminUpdateUserAction`), `session_revoked_at` saat suspend. Index parsial `idx_user_roles_one_active_grant` membuat `ON CONFLICT DO NOTHING` aman.
- SEC-02/SEC-04/FUNC-05/FUNC-06 (commit 0f4a2f8): guard hierarki reset sesi, allowlist MIME lampiran, guard email duplikat, scope riwayat per user — tercakup test.
- SEC-03: `maskPhoneNumber` + `phoneUnmasked: ""` untuk peran non-privileged (people/actions.ts).
- SEC-07: pesan login seragam (`getSafeLoginMessage`).
- FUNC-02/TRC-14: `is_late` dihitung server-side di **reports/actions.ts:493,553** (bukan guards.ts seperti tertulis di PROGRESS) dan diteruskan ke RPC `p_is_late`; diuji backlog-phase2.
- TRC-02: layar pending/rejected di session.ts:96-107.
- REG-02: HIBP k-anonymity (SHA-1 prefix 5), fail-open saat outage; REG-04 rate limit per-IP.
- TRC-04 sisi enqueue: insert `email_outbox` pada approve/reject akun & keputusan laporan.
- TRC-20 sisi aksi: `cancelEventAction` + push EVENT_CANCELLED; guard `assertEventNotCancelled`.
- TRC-22/23 sisi backend: gate review `reviewer_id = auth.uid()`, `assignReviewerToTaskAction` (pembuat/operator), `parseMentionUsernames` + resolusi @username + push TASK_MENTION, `getAssignableMembersAction` scoped tim.
- Font/zoom: subset self-host, sumbu FILL/wght/GRAD/opsz utuh.

## 2. Temuan cacat (diperbaiki sesi ini)

1. **BLOCKER — urutan validasi registrasi**: cek HIBP (panggilan jaringan, fail-open) berjalan SEBELUM Turnstile fail-closed → hasil test bergantung jaringan; klaim "404 green" tidak reproduksibel. Fix: Turnstile dipindah sebelum HIBP/DB (src/modules/iam/actions.ts), mock test diubah berbasis URL.
2. **BLOCKER — subset font ketinggalan ikon baru** (`arrow_downward` dll.): test fonts gagal. Fix: pipeline reproducible `scripts/build-icon-font.mjs` (devDep `subset-font`, TTF upstream resmi google/material-design-icons), subset diregenerasi (145 ligatur). Fonts 6/6 green.
3. **BLOCKER — sintaks migrasi 20261114000005**: `FOREACH r.ids[n:] SLICE 0 IN ARRAY r.ids[2:]` tidak valid saat ada duplikat. Fix: dedup ditulis ulang dengan `row_number() OVER (PARTITION BY username ORDER BY created_at, id)` + suffix `_N` yang mengecek kolisi (`WHILE EXISTS`).
4. **TRC-20 sisi tampilan belum ada**: `getEventsAction` memfilter `.eq("status","scheduled")` sehingga acara batal hilang. Fix: `.in("status",["scheduled","cancelled"])` + badge "Dibatalkan" (ikon event_busy, kartu diredam) di jadwal/page.tsx. e2e `e2e/jadwal-cancelled.spec.ts` 2/2 + screenshot mobile 390px tanpa overflow.
5. **TRC-21 klaim palsu**: teks "Pengingat dikirim 15 menit…" diganti "Perubahan lokasi dan pembatalan acara dikirim sebagai notifikasi push." (job pengingat acara tetap tunda v1.1).
6. **TRC-04 tanpa drain**: `email_outbox` tidak pernah dikirim. Fix: `src/lib/email-outbox.ts` (Resend HTTP API sesuai Master PRD; claim per-baris, requeue processing basi >10 menit, maks 5 attempt), di-wire ke cron notifications, 6 unit test, validator production-env kini mewajibkan `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.
7. **TRC-22/23 wiring UI belum ada** (overclaim batch-b review): form tugas mengirim tanpa `assigneeIds` dan tidak pernah memanggil `assignReviewerToTaskAction`. Fix: picker assignee chip (scoped `getAssignableMembersAction`) + select reviewer wajib saat `requiresReview` di dialog buat tugas (tugas/page.tsx); payload `assigneeIds`, guard reviewer, panggilan `assignReviewerToTaskAction` pasca-create, assignees optimistis. Bonus: overflow mobile baris chip filter (`-mx-2` melebihi viewport 390px) dihapus + `min-w-0` kolom. e2e `e2e/tugas-assignee.spec.ts` 2/2 (alur create+reviewer, mobile tanpa overflow).
8. **TRC-26 bio rusak**: guard terbalik `userId.length > 30` (id pendek silent no-op tapi return success), bio ditulis ke `notes`, tanpa UI. Fix: migrasi `20261114000006_profile_bio.sql` (kolom `bio` + backfill aman dari `notes` single-writer), `updatePersonalBioAction` validasi ≤500 + tulis `bio`, `getPersonalBioAction` baru, direktori baca `bio`, kartu Bio Singkat di settings/profile. Test people 5/5; e2e `e2e/profile-bio.spec.ts` 2/2. Harness e2e settings lama ikut diperbaiki (mock `next/link` — Breadcrumb menarik kode Next yang menyentuh `process.env` di browser — dan mock `people/actions`).
9. **FUNC-12 + TRC-03 koreksi presensi**: `requested_classification` hardcode `on_time`, race check-then-insert, approve memutasi record asli, tanpa guard self-review. Fix: migrasi `20261114000007_correction_effective_layer.sql` (kolom `effective_classification`, unique index parsial per user/tanggal, RPC review baru dengan guard self-review + parameter klasifikasi pereview, refresh layer efektif prefer klasifikasi final, record asli tidak disentuh); app `resolveCorrectionClassification` (kategori → klasifikasi; `wrong_time` dihitung ulang terhadap cutoff/grace kebijakan aktif), handle 23505, parameter klasifikasi di `reviewAttendanceCorrectionAction`; UI review admin memilih klasifikasi efektif + copy jujur. Test attendance 7/7; e2e `e2e/attendance-correction-review.spec.ts` 2/2. Guard self-review & append-only berlaku setelah operator apply migrasi.
10. **TRC-27 deep-link resource**: halaman `[slug]` memuat daftar halaman 1 lalu `.find` (gagal untuk resource di luar halaman 1) dan menyembunyikan bidang kosong. Fix: `getResourceBySlugAction(slug)` query `.eq("slug")` langsung + `visibilityFilter(role)` (refactor `mapResourceRow`/`RESOURCE_SELECT` bersama `getResourcesAction`), halaman merender keenam bidang dengan fallback "Belum didokumentasikan" (BR-LIB-02), slug tak dikenal → `notFound()`. Test library 5/5; e2e `e2e/resource-detail.spec.ts` 3/3 (enam bidang + fallback, notFound, mobile tanpa overflow).

Hasil akhir sesi: typecheck bersih; unit test hijau; e2e jadwal 2/2 + tugas 2/2 + resource-detail 3/3.

## 3. Gap tersisa (masuk backlog, bukan cacat tersembunyi)

- `checkInForEventAction` belum dipakai UI (check-in harian bukan per-acara). Guard tetap defense-in-depth; kebutuhan TRC-20 (tampilan) sudah dipenuhi.
- Drift `profiles.member_type` diisi role key: perilaku LAMA (baseline 9bac409:1048), RPC hanya memirror → OPS-09, tunda v1.1.
- Pola bypass `process.env.VITEST` di kode produksi: pola lama seluruh codebase; dijaga validator (VITEST dilarang di production).

## 4. Gate operator (tidak berubah, bertambah)

- Apply migrasi (dengan otorisasi): 20261113000001/2, 20261114000001/2/3/4/5/6/7 (000006 = kolom bio + backfill dari notes; 000007 = layer efektif koreksi + guard self-review + unique index).
- Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (login & registrasi fail-closed tanpa ini).
- Set `RESEND_API_KEY` + `EMAIL_FROM` (domain terverifikasi) agar email keputusan terkirim; tanpa ini antrean pending jujur (drain skip).
- TOTP manual super_admin; cron eksternal; PITR/restore sesuai handover.

## 5. Verifikasi build produksi & penyelarasan test (2026-11-15)

**Temuan meta:** verifikasi AI lain sebelumnya hanya `typecheck` + `vitest` + fixture esbuild. Ketiganya **melewati compiler SWC Next** (aturan "use server": semua export nilai wajib async) **dan ESLint build**, sehingga cacat perusak `next build` tidak terdeteksi. `next build` tidak pernah dijalankan. Sesi ini menjalankannya dan menemukan 4 blocker build + 2 gap fixture + 5 test stale.

### 5a. BLOCKER — merusak `next build` (diperbaiki)

1. **Sync export di file `"use server"`** → SWC `Server Actions must be async functions` → kompilasi gagal (beranda 500 di dev; `next build` gagal). Tiga helper murni diekspor dari modul action:
   - `resolveCorrectionClassification` (attendance/actions.ts, FUNC-12) → diekstrak ke `src/modules/attendance/classification.ts`.
   - `maskPhoneNumber` (people/actions.ts, SEC-03) → `src/modules/people/masking.ts`.
   - `parseMentionUsernames` (operations/actions.ts, TRC-23) → `src/modules/operations/mentions.ts`.
   Ketiganya tetap **sync** (dipanggil sync di action & unit test); modul helper non-action di-import kembali ke actions. Import unit test diperbarui. **Koreksi §1:** SEC-03 dan TRC-23 sebelumnya tercatat "terverifikasi sesuai klaim" — itu hanya level unit; keduanya sebenarnya merusak build produksi. Kini diperbaiki.
2. **ESLint error memblokir build**: `src/__tests__/batch-b-trc20-trc22-trc23.test.ts:96` memakai `"invalid" as any` (`@typescript-eslint/no-explicit-any` = error). Fix: cast type-safe `"invalid" as unknown as Parameters<typeof submitTaskReviewAction>[1]`.

Catatan gate: `next build` lokal gagal tanpa `CI=true` karena `validateProductionEnvironment` menolak placeholder (`CRON_SECRET`, dll.) — itu **gate operator**, bukan cacat kode. Verifikasi compile memakai `CI=true` (bypass terdokumentasi di validator untuk build tanpa kredensial).

### 5b. Gap fixture e2e (diperbaiki)

3. **audit-ui.spec.ts**: `src/lib/admin-contact.ts` membaca `process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL/WHATSAPP` di top-level; fixture hanya mendefinisikan `NODE_ENV` → `process is not defined` → IIFE batal → 36 test gagal. Fix: tambah 2 define `NEXT_PUBLIC_*` (pola sama seperti account-state-contact.spec.ts).
4. **registration-consent.spec.ts**: `register/page.tsx:96` membaca `process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY` saat render; fixture tidak mendefinisikannya → komponen Register crash → form tidak render → 2 test gagal (mode admin/mobile lolos karena tidak merender Register). Fix: tambah define sitekey kosong. `TurnstileWidget` aman dengan key kosong (`if (!siteKey) return`); Turnstile memang boundary eksternal yang di-mock di fixture.

### 5c. Test stale vs UI yang benar (diselaraskan, bukan dilemahkan)

5. **report-history.spec.ts (5 test)**: UI riwayat laporan sudah ditingkatkan (UX-08: filter status Semua/Terkirim/Draft/Terlambat + tombol sort; badge klasifikasi "Tepat Waktu"/"Terlambat"/"Draft" + badge review; page size 20) tetapi assertion masih memakai skema lama. Informasi status pengiriman & tinjauan **tetap lengkap** di UI baru. Penyelarasan: empty-state memeriksa tidak ada tombol "Muat laporan lebih lama" (tombol filter/sort sah ada), badge `"Tepat Waktu"`/`"Draft"`/`"Disetujui"`/`"Belum Ditinjau"`/`"Sedang Ditinjau"`, dan `limit: 20`. Intent test (empty jujur, error≠empty, status terpisah, pagination cursor, refresh pasca-write, race safety, isolasi akun) dipertahankan.

### 5d. UX-11 selesai (batch a11y)

20 modal halaman dimigrasi ke primitif `Modal` bersama (`src/components/ui/modal.tsx`: `role="dialog"`, `aria-modal`, focus-trap Tab/Shift+Tab, Escape, klik backdrop menutup, restore fokus, `aria-label`/`aria-labelledby`): kehadiran (2), admin/jadwal (2), resources (1), tim (1), jadwal (3), tugas (2), beranda (1), admin/audit (4), admin/users (4). `more-sheet.tsx` (bottom-sheet nav) diberi focus-trap/Escape/restore fokus + `role="dialog"` (tidak dimigrasi ke primitif karena gaya sheet berbeda). Label form dipasangkan `htmlFor`/`id` di admin/audit & admin/users. e2e baru `e2e/modal-a11y.spec.ts` **4/4** browser-verified (dialog role+name, Escape+restore, focus-trap wrap, backdrop close).

### 5e. Hasil verifikasi final (2026-11-15)

- `npx tsc --noEmit`: **bersih**.
- `CI=true npx next build`: **hijau** — compiled, lint (hanya warning), types valid, **32/32 halaman** ter-generate.
- `npx vitest run --maxWorkers=2`: **431/431** (41 file).
- e2e penuh `--workers=1` terhadap dev :3001: **95 lulus, 1 skip, 0 gagal**. Skip = `auth.spec.ts:13` (E2E DB nyata terautentikasi, butuh kredensial/seed operator — bukan fixture).
- Catatan non-blocking: `kehadiran/page.tsx:30` warning `react-hooks/exhaustive-deps` (`historyItems`) — tidak memblokir build; dapat dirapikan v1.1.
- Belum ada commit/push. Migrasi & gate operator (§4) tetap berlaku.