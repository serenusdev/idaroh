# REMEDIATION SUMMARY — IDAROH

## Kesimpulan eksekutif
IDAROH adalah platform internal operasional Pondok OS. Repository menunjukkan implementasi cukup luas: Next.js 15.5.29 + React 19, Supabase SSR/Postgres/Auth/Storage, Capacitor Android, FCM, PWA, dan modul IAM, resource, attendance, reports, tasks, schedules, people, analytics/admin. PRD Master v2.0 dan delapan PRD modul v2.0 tersedia.

**Status keseluruhan: BELUM DAPAT DINYATAKAN SIAP PRODUCTION / ACCEPTANCE.** Source mengandung banyak remediation terdokumentasi, tetapi runtime lintas akun/perangkat, FCM end-to-end, backup/restore, load, dan browser E2E terbaru belum dapat dibuktikan pada audit ini. Handoff 5 Nov 2026 sendiri menyatakan 17 item masih partial/perlu verifikasi eksternal.

## Tiga risiko terbesar
| Risiko | Severity | Bukti dan dampak pengguna | Patch utama |
|---|---|---|---|
| Notifikasi belum menjadi rantai end-to-end yang terbukti; UI inbox hanya load awal dan klik hanya menandai dibaca, tidak membuka URL/deep link | HIGH | `src/app/(app)/notifikasi/page.tsx:15-59`; pengguna dapat melewatkan notifikasi baru dan tidak dapat menavigasi ke objek terkait dari inbox | Implementasikan subscription/refetch focus/reconnect; klik item navigasi ke URL tervalidasi; mark-read hanya setelah aksi berhasil |
| Backup cron hanya mencatat manifest row-count, bukan membuat backup artefak | CRITICAL | `src/app/api/cron/backups/route.ts:19-32`; operator dapat mengira backup tersedia padahal endpoint hanya menghitung baris | Integrasikan provider PITR/export terenkripsi dan storage terpisah; pisahkan status `manifest_only` dari `backup_verified` |
| Font family yang dikonfigurasi tidak disediakan oleh source yang ditemukan dan Google Material Symbols dimuat melalui stylesheet eksternal | MEDIUM | `src/app/globals.css:7,63`; `src/app/layout.tsx:33-37`; font gagal/terlambat dapat menyebabkan fallback typography dan layout shift | Self-host WOFF2 Hanken/IBM jika memang brand final; jika belum tersedia gunakan font yang benar-benar diimport; preload hanya font above-the-fold |

## Peta sistem singkat
- **Nama:** IDAROH / Pondok OS.
- **Domain:** operasional internal pondok: identitas, kehadiran, laporan, tugas/proyek, jadwal/pengumuman, tim/orang, pustaka, analitik, administrasi.
- **Role PRD:** `super_admin`, `yayasan`, `pengurus`, `koordinator` (scoped team), `santri`; `ustadz` dimodelkan sebagai `member_type` dan reviewer assignment (OD-014).
- **Platform:** desktop web, mobile web/PWA, Android Capacitor. iOS/native iOS out of scope menurut Master PRD.
- **Auth/data:** Supabase Auth + Postgres + RLS, server actions Next.js, service-role client untuk operasi server istimewa.
- **Notifikasi:** durable in-app inbox dan FCM push; email hanya untuk auth flows yang diputuskan provider, tidak ada bukti kanal email notifikasi operasional.
- **PRD:** Master v2.0 + PRD-01—08 v2.0; 149 requirement rows terstruktur ditemukan pada tabel PRD modul.

## Baseline status
Tidak ada angka LCP/INP/CLS/TTFB, request waterfall, query timing, sync latency, push latency, atau login-ready time yang diukur dari runtime pada audit ini. Semua status tersebut `NOT EXECUTED`. Lihat `BASELINE-AND-TARGETS.md`.

## Prioritas remediasi
1. **Gelombang 1:** validasi role resolution tanpa fallback diam-diam; sinkronisasi inbox dan state akun; audit push per perangkat; pastikan backup provider nyata.
2. **Gelombang 2:** tetapkan font family final dan self-host; jalankan Web Vitals + request waterfall; optimasi hanya pada jalur kritis yang terbukti lambat.
3. **Gelombang 3:** PRD traceability 149 requirement, acceptance role matrix, hardening aksesibilitas, offline/replay, scale/load, release/restore drill.

## Effort awal (estimasi perencanaan, bukan pengukuran)
| Gelombang | Estimasi | Dependensi |
|---|---:|---|
| G1 identity/sync/notification/backup | 5–8 engineer-days | staging Supabase, akun role, perangkat Android, Firebase |
| G2 performance/font | 3–5 engineer-days | deployed staging, Lighthouse/Chrome traces, font license/assets |
| G3 PRD/hardening/acceptance | 8–15 engineer-days | keputusan OD terbuka, dataset staging, QA lintas role/perangkat |

## Kriteria akhir
Belum terpenuhi / belum terbukti: cross-device sync <2s, in-app notification <3s, FCP/LCP/INP/CLS target, backup restore drill, 0 placeholder runtime, dan seluruh PRD acceptance. Tidak ada klaim PASS tanpa eksekusi.

## Peta Sistem lengkap

### Route / halaman
- Auth: `/login`, `/register`, `/forgot-password`, `/reset-password`.
- App: `/`, `/kehadiran`, `/laporan`, `/tugas`, `/jadwal`, `/tim`, `/resources`, `/resources/{slug}`, `/notifikasi`, `/review`, `/settings/profile`, `/unauthorized`, `/offline`.
- Admin: `/admin/analytics`, `/admin/audit`, `/admin/backup`, `/admin/jadwal`, `/admin/kehadiran`, `/admin/notifications`, `/admin/people`, `/admin/resources`, `/admin/users`.
- API: `/api/auth/login`, `/api/calendar/feed`, `/api/cron/backups`, `/api/cron/notifications`, `/api/exports/{exportId}`.

### Role dan cakupan
`super_admin` global; `yayasan` global; `pengurus` global/dapat dibatasi unit; `koordinator` scope team; `santri` global dasar. Satu user dapat memiliki multi-role; membership menentukan scope. `ustadz` direkomendasikan sebagai `member_type` + reviewer assignment (OD-014), bukan role tambahan.

### Kanal notifikasi
- In-app durable inbox berbasis tabel `notifications`.
- Push Android/native melalui Capacitor Push Notifications + Firebase Cloud Messaging.
- Email: Supabase Auth email flow untuk verifikasi/reset password; notifikasi operasional email tidak terkonfirmasi dari scope/source.
- Web Push browser: tidak terkonfirmasi; source FCM native guard `Capacitor.isNativePlatform()`.

### Platform/perangkat
- Desktop browser web.
- Mobile browser/PWA (online-first, shell-only offline).
- Android Capacitor remote-web runtime (`capacitor.config.ts:3-13`).
- iOS native tidak menjadi scope Master PRD rilis awal.
- Multi-account/multi-device adalah kebutuhan IAM, tetapi acceptance belum dijalankan.

### Dependensi eksternal terdeteksi
| Dependensi | Tujuan | Bukti |
|---|---|---|
| Next.js 15.5.29 / React 19 | App Router, UI, server actions | `package.json` |
| Supabase Auth/Postgres/Storage/SSR | Auth, data, RLS, storage | `package.json`, `src/lib/supabase/*`, migrations |
| Firebase FCM | Native push | `src/lib/fcm.ts`, `src/lib/notifications.ts` |
| Capacitor Android 7.6.10 | Android wrapper | `capacitor.config.ts`, `android/` |
| Google Fonts Material Symbols | Icon font stylesheet | `src/app/layout.tsx:33-37` |
| Turnstile | Anti-bot signup config | `.env.example`; runtime wiring harus diverifikasi |
| Vercel/hosting scheduler | Cron deployment likely, but provider not verified | Cron routes exist; no deployment manifest/credentials in snapshot |
| Playwright/Vitest | E2E/unit tests | `package.json`, `playwright.config.ts`, `e2e/`, `src/__tests__/` |

### Ringkasan PRD
Master PRD v2.0 menyebut Pondok OS sebagai platform operasional internal, bukan website profil; prinsipnya least privilege, mobile-first, single source of truth, auditability, gradual rollout, ownership by foundation, and configurable unresolved decisions. In-scope: IAM, dashboard, resource library, attendance, activity reports, tasks/projects, schedules/announcements, people/teams, analytics/admin, audit log, in-app notifications. Out-of-scope release awal termasuk website publik, registrasi publik bebas, akuntansi/payroll, LMS penuh, native iOS/Android app, biometrik. Delapan PRD modul tersedia: IAM, Resource Library, Attendance, Activity Reports, Tasks & Projects, Schedules & Announcements, People & Teams, Analytics & Administration.
