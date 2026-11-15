# DAFTAR TEMUAN AUDIT TRIAGE — IDAROH — 2026-11-12

Status: **TRIAGE SELESAI; keputusan pengguna 2026-11-13 diterapkan pada PRD dan implementasi lokal terbatas**. Bagian A–G mempertahankan bukti/nomor baris baseline audit 2026-11-12, bukan status kode terkini. Bagian I menjadi rujukan keputusan dan status tindak lanjut terbaru. Perbaikan lokal belum berarti sudah diterapkan di produksi; temuan keamanan/data lainnya tetap terbuka.

## Skala severity
- **P0**: kebocoran/kehilangan data, sistem tidak bisa dipakai, akses salah.
- **P1**: alur inti rusak dengan workaround menyakitkan.
- **P2**: mengganggu tetapi masih bisa dipakai.
- **P3**: kosmetik.

## Definisi "siap rilis"
1. Nol P0 di semua kategori; nol P1 di alur inti (pengajuan→approval→login, check-in, laporan→review, tugas, pengumuman, pengaturan admin).
2. Kelima peran (santri, koordinator, pengurus, yayasan, super_admin) diuji end-to-end dengan akun nyata.
3. Semua requirement PRD prioritas M: terpenuhi, atau keputusan eksplisit **tunda v1.1 / ubah PRD** — tidak ada yang menggantung.
4. Otorisasi app-layer wajib diuji (guard, scope pemilik/tim, penolakan akses); RLS tetap aktif sebagai defense-in-depth dan tidak boleh dilonggarkan; service-role tidak boleh bocor ke klien.
5. Backup dan uji restore lulus (operator); scheduler eksternal aktif dengan heartbeat. Manifest jumlah baris tidak menggantikan backup nyata.
6. Regresi penuh hijau + smoke browser alur inti; fixture dengan provider yang dimock tidak menggantikan E2E akun/DB nyata.
7. Semua super_admin existing mengaktifkan dan memverifikasi TOTP manual di Pengaturan Profil; operator mencatat bukti tanpa secret/QR. Pemaksaan MFA saat login ditunda v1.1.
8. Android wrapper diakui sebagai lingkup produk, tetapi dikeluarkan dari syarat siap rilis awal.

Urutan perbaikan setelah keputusan: keamanan/data → alur inti PRD → UX alur utama → sisanya. Regresi ulang alur inti setelah perbaikan.

---

## A. Keamanan & hak akses (kategori 3)
Agen: security-triage. Klaim P1 diverifikasi ulang oleh main agent terhadap kode/migrasi; satu klaim ditolak sebagai false positive.

| ID | Sev | Temuan | Bukti | Dampak | PRD | Usulan keputusan | Verifikasi |
|---|---|---|---|---|---|---|---|
| SEC-01 | P1 | `adminUpdateUserAction` ubah status/peran tanpa audit & non-atomik (3 tulis terpisah: profiles.update → revoke user_roles → insert user_roles; gagal tengah = inkonsisten) | src/modules/iam/actions.ts:1041-1076 | Perubahan akses tak terlacak; state bisa korup | IAM-005, IAM-010, §7 | Perbaiki sekarang (RPC atomik beraudit, pola approve_account_application) | Terkonfirmasi main agent |
| SEC-02 | P1 | `resetUserSessionAction` tanpa cek hierarki target — pengurus dapat cabut sesi super_admin/yayasan (bandingkan `revokeDeviceTokenAction` yang mengecek) | src/modules/iam/actions.ts:622-660 vs :674 | DoS akun puncak oleh peran lebih rendah | IAM-004, hierarki §7 | Perbaiki sekarang | Terkonfirmasi main agent |
| SEC-03 | P1 | Masking nomor HP regex tidak berjangkar `(\d{4})\d{4}(\d{2,4})` — gagal untuk nomor berformat (+62, tanda hubung, <10 digit) → nomor penuh bocor ke yang tak berwenang | src/modules/people/actions.ts:91 (pola sama dilaporkan di :345) | Kebocoran PII | PPL-008 | Perbaiki sekarang (mask berbasis panjang/posisi) | Terkonfirmasi main agent (baris 91) |
| SEC-04 | P1 | Upload lampiran tugas tanpa allowlist MIME (hanya cek ≤10MB), contentType asli disimpan, disajikan inline via signed URL — HTML/SVG berbahaya bisa diunggah. Catatan: origin storage ≠ origin aplikasi (bukan XSS sesi aplikasi langsung), tetap berbahaya. Avatar sudah punya allowlist (pola tersedia) | src/modules/operations/actions.ts:427-445, signed URL :394; pembanding iam/actions.ts:821-868 | Stored content berbahaya / phishing | TSK-001, REP-006 (pola lampiran) | Perbaiki sekarang (allowlist + Content-Disposition attachment) | Terkonfirmasi main agent |
| SEC-05 | P2 | Suspend via `adminUpdateUserAction` tidak set `session_revoked_at` → sesi tidak dicabut seketika (menunggu request berikutnya) | src/modules/iam/actions.ts:1041-1053 | Akun suspended masih bisa dipakai sesaat | §4.5, §7 "seketika" | Perbaiki sekarang (bundle dengan SEC-01) | Terkonfirmasi main agent |
| SEC-06 | P2 | Reset password tanpa rate-limit aplikasi (hanya batas default Supabase); pesan sudah seragam (baik) | src/app/(auth)/forgot-password/page.tsx:22-24 | Abuse email reset | IAM-001, §7 | Tunda v1.1 | Terkonfirmasi main agent |
| SEC-07 | P2 | Enumerasi akun: registrasi membocorkan status permohonan ("Status: pending"); login membedakan "Email belum dikonfirmasi" | src/modules/iam/actions.ts:186; src/app/api/auth/login/route.ts:13-14 | Informasi keberadaan akun bocor | §7 anti-enumerasi | Perbaiki sekarang (pesan seragam, murah) | Terkonfirmasi main agent |
| SEC-08 | P2 | Injeksi filter PostgREST pada audit explorer — sanitasi hanya strips `,()` bukan kutip/% | src/modules/analytics/actions.ts:101-105 | Manipulasi filter audit | ADM-008 | Tunda v1.1 (verifikasi dulu sebelum fix) | Laporan agen, belum diverifikasi ulang |
| SEC-09 | P2 | Ekspor "users" membuka email seluruh profil; tanpa izin ekspor per-jenis & batas frekuensi | src/app/api/exports/[exportId]/route.ts:59-63; src/modules/analytics/actions.ts:24 | Data pribadi terekspos luas | ADM-016 | Tunda v1.1 | Laporan agen |
| SEC-10 | P2 | Self-service `updateProfileAction`/`changePasswordAction` tanpa audit | src/modules/iam/actions.ts:765, :885 | Perubahan diri tak terlacak | IAM-010 | Tunda v1.1 | Laporan agen |
| SEC-11 | P2 | Turnstile opsional: bila `TURNSTILE_SECRET_KEY` kosong, verifikasi dilewati & `turnstile_verified=true`. **TERKAIT TRC-01 (P1)**: UI register tak punya widget/token — men-set secret SEKARANG justru merusak registrasi | src/modules/iam/actions.ts:128-138, :230; grep turnstile di register: nihil | Registrasi tanpa proteksi bot; bila secret diset prematur → registrasi rusak | IAM-001 | Perbaiki sekarang bersama TRC-01 (widget + fail-closed); operator set secret SETELAH widget rilis | Terkonfirmasi main agent |
| SEC-12 | P2 | Hardening SECURITY DEFINER parsial — beberapa fungsi `search_path` tanpa `pg_temp` | supabase/migrations/20261101000004:98, 20261101000005:99 (laporan agen) | Risiko hijack search_path | §7 | Tunda v1.1 (audit menyeluruh) | Laporan agen |
| SEC-13 | P3 | Argumen klien misleading pada reveal kontak (`"pengurus","usr-salman"` dikirim tapi server abaikan & pakai sesi — aman) | src/app/(app)/tim/page.tsx:69; people/actions.ts:304-308 | Kebingungan maintenance | — | Bersihkan (hapus parameter klien) | Laporan agen |
| SEC-14 | P3 | Token kalender di query URL (`?token=`) berpotensi ter-log; sudah di-hash sha256, expiry 90 jam, revocable | src/modules/schedules/actions.ts:303; api/calendar/feed/route.ts:39-48 | Token bocor via log | SCH-009 | Tunda v1.1 | Laporan agen |
| SEC-15 | P3 | Rate limit login fail-open bila storage rate-limit error (catch → lanjut) | src/app/api/auth/login/route.ts:59-61 | Proteksi hilang saat DB gangguan | IAM-001 | Catatan (trade-off ketersediaan dapat diterima) | Terkonfirmasi main agent |

**DITOLAK (false positive agen):** klaim "RLS bocor: task_comments/task_attachments/task_mentions USING(true)". Kebijakan permisif 20261102000004:45,57,69 **sudah diganti** di 20261102000005_audit_hardening.sql:156-187 dengan `app.can_access_task(task_id)`; fungsi terbaru 20261105000001:14-49 (search_path ter-pin, REVOKE PUBLIC, GRANT authenticated). Tidak ada temuan RLS terbuka pada tabel-tabel ini.

**Terverifikasi aman (agen + spot-check):** service-role hanya server (src/lib/supabase/admin.ts); tanpa `dangerouslySetInnerHTML` (markdown pengumuman teks polos); gate status middleware+layout menolak pending/rejected/suspended/deactivated; revokasi sesi JWT `iat` vs `session_revoked_at` (src/lib/auth/session.ts:57-102); cron Bearer `timingSafeEqual` + klaim idempoten; unduhan ekspor gerbang peran+kepemilikan + CSV anti-formula-injection; avatar allowlist tipe/ukuran + kepemilikan path; safe-url cegah open-redirect; audit_logs SELECT admin-only, append-only + rantai hash; rate limit login per email+IP 10/15 menit (route.ts:44-49); RLS 54 tabel aktif + remedy 20261105000002.

---

## B. Registrasi & IAM — gap PRD (kategori 1, temuan main agent)
Diverifikasi kode + runtime browser (http://127.0.0.1:3001/register, 2026-11-12).

| ID | Sev | Temuan | Bukti | PRD | Usulan keputusan |
|---|---|---|---|---|---|
| REG-01 | P2 | **Beda dari spec**: form "Peran yang Diajukan" hanya opsi Santri; PRD meminta field "Kategori keanggotaan" 5 opsi (Santri/Ustadz/Pengurus/Yayasan/Lainnya) sebagai klaim `claimed_member_type`, peran tetap ditetapkan admin. Kolom DB `role_requested`, bukan `claimed_member_type`. Runtime: select hanya 1 opsi, label "Peran yang Diajukan" | src/app/(auth)/register/page.tsx:252-260; src/modules/iam/actions.ts:118-121; supabase/migrations/20261101000001_iam_schema.sql:85 | PRD-01 §5.1 baris 168, §5.2 baris 178, OD-014 | **Perbaiki sekarang**: select kategori 5 opsi + kolom claimed_member_type (migrasi aman) + tampil di antrean admin; enforcement peran tetap di admin |
| REG-02 | P2 | Password minimal 8 di kode vs minimal 10 + cek kata sandi umum/bocor di PRD | src/modules/iam/actions.ts:27-33 | PRD-01 §5.1 baris 167 | Perbaiki sekarang (naikkan min 10; cek bocor opsional via layanan eksternal = tunda) |
| REG-03 | P2 | Tidak ada persetujuan kebijakan privasi (checkbox + versi + waktu); runtime: tanpa penyebutan privasi sama sekali | register/page.tsx (runtime); iam_schema.sql:79-95 tanpa kolom consent | PRD-01 §5.1 baris 172, IAM-017 (S) | Perbaiki sekarang (bundle dengan REG-01) atau tunda v1.1 — keputusan user |
| REG-04 | P2 | Rate limit registrasi hanya per-email (5/jam), tanpa per-IP; login sudah per email+IP | src/modules/iam/actions.ts:140-144 vs api/auth/login/route.ts:44-49 | IAM-001 (5/jam/IP & per email) | Perbaiki sekarang (tambah kunci IP, pola login) |
| REG-05 | P3 | Nomor HP wajib di kode vs opsional di PRD | src/modules/iam/actions.ts:109 | PRD-01 §5.1 baris 169 | Ubah PRD (pertahankan wajib — kebutuhan kontak WA pondok) — keputusan user |
| REG-06 | P3 | Pengajuan ulang setelah ditolak langsung tanpa jeda 24 jam (PRD: rekomendasi, dapat dikonfigurasi) | src/modules/iam/actions.ts:156-183 | PRD-01 §4.2 baris 138 [REKOMENDASI] | Tunda v1.1 |
| REG-07 | P3 | Validasi server manual, bukan Zod seperti disebut PRD (fungsi setara ada) | src/modules/iam/actions.ts:106-121 | IAM-001 | Ubah PRD (validasi manual setara diterima) — keputusan user |

---

## C. Fungsional, state machine & race (kategori 2)
Agen: functional-triage. Klaim P1 diverifikasi ulang main agent; satu klaim teknis dikoreksi (fontkit); duplikat dengan bagian A ditandai.

| ID | Sev | Temuan | Bukti | Dampak | PRD | Usulan keputusan | Verifikasi |
|---|---|---|---|---|---|---|---|
| FUNC-01 | P1 | Durasi laporan selalu 60 menit: regex `'^\\d+$'` dalam dollar-quoting SQL = literal dua backslash, tak pernah cocok angka → ELSE 60 | supabase/migrations/20261102000006_audit_followup.sql:95-98 | Statistik durasi salah untuk semua laporan | REP-004/REP-010 | Perbaiki sekarang (migrasi baru: `'^\d+$'`) | Terkonfirmasi main agent |
| FUNC-02 | P1 | `is_late` dipercaya dari klien: wrapper `public.save_report` SECURITY INVOKER meneruskan `p_is_late` mentah → santri bisa RPC langsung mengaku tidak terlambat | 20261102000006:61 (INSERT p_is_late); 20261105000004:58-74 (wrapper) | Klasifikasi kehadiran bisa dipalsukan | ATT-004, REP-003 | Perbaiki sekarang (hitung ulang di RPC dari policy + first_submitted_at; abaikan param) | Terkonfirmasi main agent |
| FUNC-03 | P1 | PDF font dibaca runtime dari `process.cwd()/node_modules/...woff2` — di Vercel serverless path bisa tak ter-trace → ekspor PDF gagal produksi. **Dikoreksi**: fontkit 1.1.1 mendukung WOFF2 (klaim agen "hanya TTF/OTF" salah); deps+file ada. **Terkonfirmasi**: next.config.mjs TANPA outputFileTracingIncludes/serverExternalPackages untuk font | src/lib/pdf.ts:15-23; package.json (@fontsource/noto-sans 5.3.0, @pdf-lib/fontkit 1.1.1, pdf-lib 1.17.1); next.config.mjs (grep nihil) | Ekspor PDF mati di produksi | REP-011, ADM-016 | Perlu uji runtime produksi; fix preventif murah: bundle font ke src (TTF/OTF) atau outputFileTracingIncludes | Diverifikasi main agent (klaim agen dikoreksi) |
| FUNC-04 | P1 | Duplikat SEC-01 (adminUpdateUserAction non-atomik tanpa audit) | lihat SEC-01 | — | — | Bundle SEC-01 | — |
| FUNC-05 | P1 | Pembuatan akun manual: `inviteUserByEmail` lalu upsert profiles `status:'active'` tanpa syarat — bila email sudah ada, profil lama bisa tertimpa/reaktivasi tanpa cek | src/modules/iam/actions.ts:548-589 | Akun existing berubah status tak terkendali | IAM-006 | Perlu uji runtime invite-email-existing; lalu perbaiki (cek existing dulu) | Terkonfirmasi sebagian main agent |
| FUNC-06 | P2 | Riwayat kehadiran admin: `attendance_effective` tanpa scope user (limit 30 global) + Map raw keyed tanggal saja → jam check-in user lain bisa tertempel ke baris user berbeda | src/modules/attendance/actions.ts:114-125 | Data riwayat admin salah/kontaminasi silang | ATT-009 | Perbaiki sekarang (scope per user + key Map user+date) | Terkonfirmasi main agent |
| FUNC-07 | P2 | Dashboard: `todayCheckedIn` menghitung semua record hari ini vs `totalSantri` hanya santri → persentase bisa >100% | src/modules/analytics/actions.ts:368 vs :358-364 | Angka dashboard menyesatkan | ADM-001 | Tunda v1.1 | Laporan agen |
| FUNC-08 | P2 | Koordinator multi-tim dihitung ganda pada agregasi tim | src/modules/operations/actions.ts:103-111 | Statistik tim ganda | ADM-001 | Tunda v1.1 | Laporan agen |
| FUNC-09 | P2 | Race revisi resource: cek versi lalu update tanpa lock (check-then-act) | src/modules/library/actions.ts:385-388 | Revisi bersamaan saling timpa | LIB-006 | Tunda v1.1 | Laporan agen |
| FUNC-10 | P2 | Deteksi bentrok jadwal mengabaikan acara berulang (hanya cek instance tanggal) | src/modules/schedules/actions.ts:488-508 | Bentrok tak terdeteksi untuk acara rutin | SCH-004 | Tunda v1.1 | Laporan agen |
| FUNC-11 | P2 | Feed iCal tanpa RRULE — acara berulang hanya muncul instance tersimpan | src/app/api/calendar/feed/route.ts | Kalender eksternal tak lengkap | SCH-009 | Tunda v1.1 | Laporan agen |
| FUNC-12 | P2 | Koreksi kehadiran: race check-then-insert + klasifikasi hasil koreksi hardcode `on_time` (:248) tanpa hitung ulang terhadap policy → koreksi approved SELALU menjadikan record "tepat waktu" | src/modules/attendance/actions.ts:236-244 (race), :248 (hardcode) | Integritas data presensi: koreksi bisa selalu "tepat waktu" | ATT-007 | Perbaiki sekarang (bundle TRC-03: klasifikasi diminta sesuai alasan + hitung ulang + guard) | Terkonfirmasi main agent |
| FUNC-13 | P2 | Review laporan: kegagalan tulis audit dilaporkan sebagai sukses review; audit tanpa actor_id | src/modules/reports/actions.ts:570-584 | Jejak audit hilang tanpa sadar | REP-008, ADM-008 | Tunda v1.1 | Laporan agen |
| FUNC-14 | P2 | Ekspor audit: `row_count` selalu 0; tanpa filter tanggal mengekspor SELURUH baris | src/modules/analytics/actions.ts:41 | Metadata salah; ekspor tak terbatas | ADM-008/016 | Tunda v1.1 | Laporan agen |
| FUNC-15 | P2 | Reveal kontak fallback ke fixture `INITIAL_PEOPLE_PROFILES.phoneUnmasked` bila jalur DB fall-through → nomor fixture (bukan data nyata) tersaji | src/modules/people/actions.ts:366-380 | Data palsu tersaji sebagai nyata | PPL-008 | Perbaiki sekarang (hapus fallback fixture; gagal = error jujur) | Terkonfirmasi main agent |
| FUNC-16 | P2 | RPC `iam_assign_role`/`iam_revoke_role` disebut PRD tidak ada; diganti server action + guard last-super-admin | grep migrasi: nihil; iam/actions.ts | Beda nama mekanisme, fungsi setara sebagian | IAM-005 | Keputusan user: implement RPC atau ubah PRD | Laporan agen |
| FUNC-17 | P2 | Check-in tanpa batas bawah jam 04:00 (policy menyebut jendela mulai 04:00) | supabase/migrations/20261102000013:45-64 | Check-in dini hari tak wajar diterima | ATT-002 | Tunda v1.1 | Laporan agen |
| FUNC-18 | P2 | Impor CSV tanpa cap jumlah baris | src/modules (import actions, laporan agen) | Memori/waktu habis untuk file besar | ADM-015 | Tunda v1.1 | Laporan agen |
| FUNC-19 | P2 | Race revisi event (check-then-act versi) | src/modules/schedules/actions.ts | Revisi bersamaan saling timpa | SCH-005 | Tunda v1.1 | Laporan agen |
| FUNC-20 | P3 | `publishAnnouncement` tanpa cap panjang isi | src/modules/operations/actions.ts | Payload ekstrem | SCH-007 | Tunda v1.1 (batch validasi) | Laporan agen |
| FUNC-21 | P3 | Validasi URL avatar `.includes` longgar | src/modules/iam/actions.ts | URL aneh lolos (dampak rendah, allowlist MIME sudah ada) | IAM-009 | Tunda v1.1 | Laporan agen |
| FUNC-22 | P2 | Duplikat SEC-08 (injeksi filter PostgREST audit explorer) | lihat SEC-08 | — | — | Bundle SEC-08 | — |
| FUNC-23 | P3 | Favorite: check-then-insert tanpa unique → duplikat mungkin saat race | src/modules/library/actions.ts | Duplikat favorit | LIB-008 | Tunda v1.1 (partial unique) | Laporan agen |
| FUNC-24 | P3 | Double-approve laporan jinak (idempoten, tanpa efek ganda) | src/modules/reports/actions.ts | — | REP-008 | Catatan (sudah aman) | Laporan agen |
| FUNC-25 | P1 | Duplikat SEC-04 (MIME lampiran tugas) | lihat SEC-04 | — | — | Bundle SEC-04 | — |
| FUNC-26 | P3 | `createTask` membuang `projectId` bila panjang ≤30 (kondisi terbalik) | src/modules/operations/actions.ts | Proyek tak tertaut untuk id pendek | TSK-002 | Perbaiki sekarang (murah, satu kondisi) | Laporan agen |
| FUNC-27 | P3 | `updateTaskStatus` gate transisi dari parameter klien (server trigger sudah memvalidasi ulang — aman, tapi misleading) | src/modules/operations/actions.ts | Kebingungan maintenance | TSK-004 | Bersihkan (hapus gate klien) | Laporan agen |

**Terverifikasi benar (agen + spot-check main agent):** check-in idempoten (UNIQUE user+tanggal, ON CONFLICT, timezone WIB, Minggu libur); `task_transition` hardened (FOR UPDATE + can_access_task + trigger, 20261102000005:398-440, 20261102000016:66-98); `review_report` atomik (20261102000006:125-189); `first_submitted_at` immutable via COALESCE; suspended ditolak mutasi (reject_inactive_mutation, 20261102000005:215-235); `approve_account_application` atomik (20261112000005); outbox idempoten (lease + SKIP LOCKED + dead_letter@8); cron idempoten (klaim unique); audit hash-chain + verify; CSV anti formula-injection; token kalender hash+expiry+revoke.

## D. Traceability PRD-01/03/04 (IAM, ATT, REP)
Agen: prd-trace-iam-att-rep. Klaim P0/P1 diverifikasi ulang main agent; dua klaim agen dikoreksi (REP-013, IAM-015 — lihat catatan). Status: DONE / PARTIAL / BEDA-SPEC / MISSING. "Test mock" = fast-path `process.env.VITEST` memvalidasi logika validasi, BUKAN perilaku DB nyata (lihat OPS-26).

### Matriks IAM (PRD-01, 19 requirement)
| ID | Status | Bukti & gap ringkas | Test |
|---|---|---|---|
| IAM-001 | BEDA-SPEC | Turnstile server kondisional tapi UI TANPA widget/token (TRC-01); rate limit per-email tanpa IP (REG-04); min 8 vs 10 (REG-02); kategori 1 opsi (REG-01); validasi manual (REG-07); reapply tanpa cooldown (REG-06) | ya (validasi) |
| IAM-002 | PARTIAL | Antrean+detail ada (iam:256-298); tanpa filter status/pencarian | tidak |
| IAM-003 | PARTIAL | Approve atomik+audit+peran/tim (20261112000005_fix_account_approval.sql); reject non-atomik (iam:503-509); TANPA email keputusan ke pemohon (TRC-04) | ya |
| IAM-004 | DONE | Gerbang middleware+RLS (middleware.ts:74-82,114-119); minor enumerasi "Email not confirmed" (SEC-07) | ya (e2e) |
| IAM-005 | PARTIAL | Beri/cabut+riwayat revoked_at; perubahan peran TANPA audit (SEC-01); scope tim tidak dipakai | ya (validasi+hierarki) |
| IAM-006 | PARTIAL | DB multi-peran; UI cabut-semua-lalu-insert-satu → efektif peran tunggal (iam:1058-1076) | tidak |
| IAM-007 | PARTIAL | Enum+whitelist action; tanpa validasi transisi di DB | sebagian |
| IAM-008 | PARTIAL | Reset email pesan seragam; ganti password verifikasi lama+revoke; min 8 vs 10; reset email tak revoke sesi lain; tanpa reset paksa admin | tidak |
| IAM-009 | PARTIAL | Reset sesi admin+cabut perangkat (SEC-02 hierarki); suspend tak set session_revoked_at (SEC-05); tanpa daftar sesi/logout-all mandiri | ya |
| IAM-010 | PARTIAL | Approve/reject/manual/sesi beraudit; ubah peran & suspend TANPA audit/alasan (SEC-01) | sebagian |
| IAM-011 | PARTIAL | Gate email_confirmed_at saat approve (iam:424-428); tanpa flag verified/prioritas antrean | tidak |
| IAM-012 | PARTIAL | Enroll/verify/unenroll TOTP ada (iam:702-757); TIDAK dipaksakan saat login, tanpa wajib super_admin (TRC-10) | tidak |
| IAM-013 | DONE | Invite+profil aktif+peran+audit (iam:527-617); catatan FUNC-05 (email existing) | ya |
| IAM-014 | PARTIAL | Impor CSV+laporan kesalahan → antrean pending (operations:260-324); tanpa pratinjau & ubah peran massal | tidak |
| IAM-015 | PARTIAL | **Dikoreksi**: tanpa guard eksplisit super-admin terakhir/empat mata, TAPI hierarki implisit memblokir modifikasi target super_admin oleh siapa pun (iam:1010-1015 terverifikasi) → risiko rendah (TRC-11) | sebagian |
| IAM-016 | PARTIAL | Layar status jelas+logout (account-state-screen); TANPA kontak admin nyata (UX-20); pemohon pending jatuh ke profile_missing (TRC-02) | ya (e2e) |
| IAM-017 | MISSING | Kolom privacy_consent & checkbox nihil (REG-03) | tidak |
| IAM-018 | MISSING | Tanpa email keamanan (perubahan password/peran); hanya push saat approve | tidak |
| IAM-019 | PARTIAL | Batas hardcoded (5/jam, 10/15mnt), tanpa konfigurasi admin; masa sesi default Supabase | tidak |

### Matriks ATT (PRD-03, 18 requirement)
| ID | Status | Bukti & gap ringkas | Test |
|---|---|---|---|
| ATT-001 | DONE | Tombol besar dashboard+status hari ini (page.tsx:776-827; kehadiran:237-302) | ya (e2e retry) |
| ATT-002 | DONE | Jam server WIB (20261102000013:34-36); klien hanya meta; batas bawah 04:00 tak ditegakkan (FUNC-17) | ya |
| ATT-003 | DONE | cutoff/grace+59s (≈truncation menit), policy_version_id (20261102000013:58-72); label versi hardcode (OPS-08) | ya |
| ATT-004 | DONE | UNIQUE+ON CONFLICT idempoten (20261101000003:34; 20261102000013:74-85) | ya |
| ATT-005 | PARTIAL | Strip bulanan+daftar+status efektif; bukan kalender penuh; 30 entri terakhir (UX-21) | ya |
| ATT-006 | PARTIAL | Agregat scope tim (20261102000013:101-199); tanpa daftar harian per scope+filter+cari nama | tidak |
| ATT-007 | BEDA-SPEC | Guard duplikat ada; requested_classification hardcode "on_time" (attendance:248, FUNC-12 terkonfirmasi); tanpa batas 7 hari (TRC-08); bukti opsional | ya (validasi) |
| ATT-008 | BEDA-SPEC | Approve MENGUBAH record asli (20261102000005:511) melanggar append-only; TANPA guard self-review (:500-513) → TRC-03 | tidak (DB) |
| ATT-009 | PARTIAL | on_time/grace/late ada; tanpa rincian izin/sakit/belum; tanpa rekap mingguan/bulanan | tidak |
| ATT-010 | PARTIAL | Jam kebijakan berversi+dua tahap+audit; hari ops hardcoded Ahad; jendela & kalender non-op tanpa UI (tabel ada) | tidak |
| ATT-011 | MISSING | Penandaan belum-presensi eksplisit tiada (no_checkin hanya layer efektif + target cron) | tidak |
| ATT-012 | PARTIAL | Pengajuan+persetujuan ada (attendance:280-354,411-429); pereview tak bisa input atas nama pengguna | ya |
| ATT-013 | PARTIAL | Pengingat 07:30 in-app (cron/actions:31-32; api/cron/notifications:109-124); TANPA opt-out per pengguna (OPS-12, M) | ya (e2e cron UI) |
| ATT-014 | DONE | CSV+export_logs+audit (analytics:18-67; exports route:36-48) | tidak |
| ATT-015 | MISSING | Tampilan live 08:00–09:00 tiada | tidak |
| ATT-016 | PARTIAL | duty_flags+prioritas efektif di DB (20261102000011:13-35,59-129); RPC check-in abaikan attendance_required (TRC-13); tanpa UI penandaan | tidak |
| ATT-017 | MISSING | Input manual presensi (source=manual) tiada | tidak |
| ATT-018 | MISSING | Flag selisih jam klien/server tiada (client_meta disimpan) | tidak |

### Matriks REP (PRD-04, 22 requirement; prioritas dari PRD baris 150-171)
| ID | Prio | Status | Bukti & gap ringkas | Test |
|---|---|---|---|---|
| REP-001 | M | PARTIAL | Item dinamis mobile-first (reports:361-503); hanya hari ini (:403-405); tanpa cek hari operasional (Ahad boleh) | ya |
| REP-002 | M | PARTIAL | Flag report_required+target belum-lapor (20261102000011:13-24; cron:127-145); tanpa pelacakan kewajiban per santri/hari | tidak |
| REP-003 | M | BEDA-SPEC | Tenggat WIB kebijakan ✓; is_late dihitung di action lalu dikirim sebagai parameter RPC → forgeable (FUNC-02); 21:00:01 sudah late vs truncation menit (TRC-14) | ya |
| REP-004 | M | DONE | Late tetap bisa kirim; first_submitted_at & is_late permanen (20261102000006:68-70) | ya |
| REP-005 | S | PARTIAL | Kategori dari DB (reports:52-69); tanpa UI CRUD admin | ya |
| REP-006 | S | MISSING | Lampiran laporan tiada (tanpa report_attachments) | tidak |
| REP-007 | M | PARTIAL | Penugasan+antrean scoped (20261102000007; reports:188-301); snapshot penugasan saat submit tiada (lihat REP-013) | tidak |
| REP-008 | M | DONE | Catatan revisi wajib; guard self-review (reports:509-597; 20261102000006:145-158); identitas reviewer palsu di UI (UX-01) | ya |
| REP-009 | M | DONE | Snapshot revisi+revision_no++ +riwayat utuh (20261102000006:47-78) | ya |
| REP-010 | M | PARTIAL | 5 tab+pencarian (review:12,34-40,66-79); tanpa filter tanggal | ya |
| REP-011 | M | PARTIAL | Daftar belum-lapor untuk pengingat (cron:127-134); tanpa UI monitoring pasca-21:00 | tidak |
| REP-012 | M | PARTIAL | **Riwayat laporan pribadi NIHIL** — hanya getTodayReportAction (reports:74-183, terkonfirmasi); pereview scoped ✓ → TRC-05 | tidak |
| REP-013 | M | PARTIAL | **Resolusi kontradiksi agen**: reviewer_id diisi saat review (20261102000006:180), bukan snapshot submit; laporan TER-review tetap pereview aslinya ✓; laporan menunggu ikut penugasan baru = perilaku reassign yang diminta ✓ (atomik, people:275-281). Gap tersisa: snapshot eksplisit saat submit (TRC-06, ringan) | tidak |
| REP-014 | S | BEDA-SPEC | Default pengingat 21:00 = tepat tenggat (seed 20261112000004:23 terkonfirmasi); PRD minta sebelum (19:30/20:30); konfigurasi UI cron ada → TRC-07 | ya (e2e) |
| REP-015 | S | MISSING | Autosave draft tiada (tombol draft manual, laporan:151-174) | ya (manual) |
| REP-016 | C | MISSING | Salin kemarin tiada | tidak |
| REP-017 | C | MISSING | Thread komentar tiada | tidak |
| REP-018 | C | MISSING | Review massal tiada (keputusan tunggal, review:94-127) | tidak |
| REP-019 | S | MISSING | Reopen approved tiada (terkunci permanen, 20261102000006:43-45,159-161) | tidak |
| REP-020 | S | MISSING | Rekap per santri tiada (hanya agregat) | tidak |
| REP-021 | S | PARTIAL | CSV/PDF+audit ✓ tapi hanya metadata (id/tanggal/status/is_late), TANPA isi item (exports route:49-53) | tidak |
| REP-022 | C | BEDA-SPEC | Backfill diblok total (reports:403-405) — LEBIH KETAT dari PRD (7 hari+persetujuan); aman → TRC-09 usul ubah PRD | ya |

### Temuan baru bagian D (di luar SEC/REG/FUNC/UX/OPS yang sudah tercatat)
| ID | Sev | Temuan | Bukti | PRD | Usulan keputusan | Verifikasi |
|---|---|---|---|---|---|---|
| TRC-01 | P1 | **Turnstile UI nihil**: register tak mengirim token; bila operator set TURNSTILE_SECRET_KEY, verifikasi server gagal → registrasi RUSAK. Bila tidak diset, proteksi bot dilewati. Nasihat operator SEC-11 berbahaya tanpa fix ini | grep turnstile di (auth)/register: nihil; iam/actions.ts:128-138, :230 | IAM-001 | Perbaiki sekarang (widget UI + fail-closed produksi, bundle SEC-11). **H-1 direvisi: JANGAN set secret sebelum widget ada** | Terkonfirmasi main agent |
| TRC-02 | P1 | Pemohon pending login → layar "Profil Akun Belum Tersedia" (profile_missing), bukan "Menunggu Persetujuan": registrasi tak membuat profil; resolver tak cek account_requests | src/lib/auth/session.ts:95; (app)/layout.tsx:22-23; account-state-screen.tsx:56-62; grep account_requests di lib/auth: nihil | IAM-016, alur §4.2 | Perbaiki sekarang (resolver fallback account_requests → state pending/rejected) | Terkonfirmasi main agent |
| TRC-03 | P1 | Approve koreksi presensi memutasi record asli (classification ditimpa) + TANPA guard self-review → pengurus bisa menyetujui koreksinya sendiri; riwayat mentah hilang. Agen menilai P0; diturunkan: butuh aktor privileged, jejak koreksi+audit masih ada | 20261102000005:500-513 (tak ada cek reviewer≠pemohon; UPDATE record asli :511) | ATT-008, append-only | Perbaiki sekarang (tulis ke layer efektif saja + guard self-review; bundle FUNC-12) | Terkonfirmasi main agent |
| TRC-04 | P2 | Approve/reject tanpa email ke pemohon; push hanya setelah approve (pemohon belum bisa login → praktis tak terinformasi). Agen P1; diturunkan: workaround coba-login/kontak admin ada | grep outbox/email di iam/actions.ts: nihil; 20261112000005 DB-only | IAM-003/018 | Perbaiki sekarang (email keputusan via outbox yang sudah ada) | Terkonfirmasi main agent |
| TRC-05 | P1 | Riwayat laporan pribadi nihil (M) — santri hanya bisa lihat laporan hari ini; tidak ada cara melihat laporan lama di aplikasi | reports/actions.ts:74-183 satu-satunya query personal (eq report_date=today); daftar fungsi: tanpa history | REP-012 (M) | Perbaiki sekarang (daftar riwayat sederhana) — keputusan user | Terkonfirmasi main agent |
| TRC-06 | P3 | Snapshot penugasan pereview saat submit tiada (reviewer_id baru terisi saat review). Perilaku praktis sudah memenuhi intent REP-013 untuk laporan ter-review & reassign pending | 20261102000006:57-80 (INSERT tanpa reviewer_id), :180 (set saat review) | REP-013 (M) | Tunda v1.1 / pertegas PRD (snapshot saat submit opsional) | Terkonfirmasi main agent (resolusi kontradiksi) |
| TRC-07 | P2 | Default pengingat laporan 21:00 = tepat tenggat (PRD: sebelum, mis 19:30/20:30); prioritas S; konfigurasi UI sudah ada | seed 20261112000004:23 | REP-014 (S) | Perbaiki sekarang (ubah default 19:30, murah) | Terkonfirmasi main agent |
| TRC-08 | P3 | Koreksi tanpa batas mundur 7 hari; bukti opsional semua tipe | attendance/actions.ts:205-275 | ATT-007 | Tunda v1.1 / ubah PRD | Laporan agen |
| TRC-09 | P3 | Backfill diblok total (lebih ketat & aman dari PRD 7 hari+persetujuan) | reports/actions.ts:403-405 | REP-022 (C) | Ubah PRD (pertahankan blokir total) — keputusan user | Laporan agen |
| TRC-10 | P2 | MFA TOTP tersedia tapi tidak dipaksakan (login tanpa langkah MFA; tanpa wajib super_admin) | iam/actions.ts:702-757; login/route.ts:83-86 | IAM-012 | Keputusan user: wajibkan super_admin sekarang / tunda v1.1 | Laporan agen |
| TRC-11 | P3 | Guard eksplisit super-admin terakhir & empat mata tiada; hierarki implisit sudah memblokir modifikasi target super_admin (terverifikasi) → risiko rendah | iam/actions.ts:1010-1015 | IAM-015 | Tunda v1.1 | Terkonfirmasi main agent (koreksi klaim agen FUNC-16) |
| TRC-12 | P3 | Koordinator tak bisa review koreksi presensi (guard pengurus+); PRD belum tegas pereview koreksi | attendance/actions.ts:383-389 | ATT-012 | Ubah PRD (pereview = pengurus) atau tunda v1.1 — keputusan user | Laporan agen |
| TRC-13 | P3 | RPC check-in abaikan attendance_required/duty flag saat check-in (layer efektif yang menangani) | 20261102000013; 20261102000011:59-129 | ATT-016 | Tunda v1.1 | Laporan agen |
| TRC-14 | P3 | 21:00:01 sudah late (PRD truncation menit → 21:00:59 masih tepat waktu) | reports/actions.ts:428-482 | REP-003 | Bundle perbaikan FUNC-02 | Laporan agen |

**MISSING lain bagian D (keputusan eksplisit, usul tunda v1.1 kecuali disebut):** IAM-017 (=REG-03, usul perbaiki sekarang bundle), IAM-018 (email keamanan), ATT-011 (penandaan belum-presensi), ATT-015 (monitor live), ATT-017 (input manual), ATT-018 (flag selisih jam), REP-006 (lampiran, S), REP-015 (autosave, S), REP-016/017/018 (C), REP-019 (reopen, S), REP-020 (rekap per santri, S). Prioritas ATT mengikuti PRD-03; requirement M yang MISSING (ATT-011 bila M) tidak boleh menggantung — konfirmasi prioritas saat keputusan.

### Alur end-to-end per peran (hasil trace, klaim kunci terverifikasi)
- **Santri:** register ✓ → verifikasi email ✓ → **pending: layar salah (TRC-02)** → approve ✓ (tanpa email, TRC-04) → login ✓ → check-in ✓ (Ahad ditolak; jendela 04:00 tak ditegakkan) → laporan hari ini ✓ (revisi+riwayat revisi ✓) → **riwayat laporan buntu (TRC-05)**; koreksi selalu minta on_time (FUNC-12).
- **Pengurus/Yayasan/Super Admin:** antrean akun ✓ approve atomik ✓ reject beralasan ✓ (tanpa email); kelola pengguna ✓ tetapi ubah peran/suspend tanpa audit (SEC-01); review koreksi ✓ tapi memutasi record asli + bisa self-approve (TRC-03); review laporan ✓ scoped ✓; monitoring harian presensi tidak ada (ATT-006/015).
- **Koordinator:** antrean laporan tim ✓; analitik tim ✓; review koreksi presensi ditolak guard (TRC-12); dashboard tim tidak ada (TRC-30); approve tugas requires_review mustahil (TRC-22).

### Edge case bisnis (D)
Duplikat: check-in/laporan idempoten ✓; koreksi guard pending/approved ✓; izin guard overlap ✓; account_requests tanpa unique pending (OPS-02). Pembatalan mandiri: enum cancelled ada, jalur kode nihil (koreksi/izin/permohonan). Mid-state: under_review/claim di enum tanpa jalur kode; pending tanpa profil = TRC-02; revoke sesi mid-JWT ✓.

## E. Traceability PRD-02/05/06/07/08 + Master (LIB, TSK, SCH, PPL, ADM)
Agen: prd-trace-lib-tsk-sch-ppl-adm. Klaim kunci diverifikasi ulang main agent; severity agen disesuaikan dengan skala audit (dicatat per baris). Dua caveat lintas modul: (1) hampir semua action memakai service-role → otorisasi di app-code, RLS defense-in-depth (TRC-28); (2) unit test sering memvalidasi fast-path VITEST/mock, bukan DB nyata (OPS-26).

### Matriks LIB (PRD-02, 17)
| ID | Status | Bukti & gap ringkas | Test |
|---|---|---|---|
| LIB-001 | DONE | resources/page.tsx (nav+count); library:14; kategori flat (tanpa pohon) | ya |
| LIB-002 | PARTIAL | Search nama/deskripsi/5 bidang/doc_status (library:137,130; 20261102000019:8-16); kategori & tag TAK masuk vector; tanpa sort relevansi; limit 100 tanpa paginasi | ya (mock) |
| LIB-003 | PARTIAL | Modal ✓; halaman slug membuang bidang kosong (langgar BR-LIB-02) + deep-link pecah >100 resource → TRC-27 | tidak |
| LIB-004 | DONE | "Belum didokumentasikan"+kelengkapan 6/6 (resources:618,750); label "Belum diverifikasi"≠spec (minor) | ya |
| LIB-005 | PARTIAL | Buat/ubah/arsip pengurus+ (library:363,401); form TANPA pratinjau Markdown | tidak |
| LIB-006 | DONE | Favorit pribadi+"Favorit saya" (library:225) | tidak |
| LIB-007 | PARTIAL | Tag auto-upsert slug (library:307); TANPA merge duplikat/rename/taksonomi terpusat | tidak |
| LIB-008 | PARTIAL | Impor idempoten max 1000+error/baris (library:460; 20261103000001); TANPA pratinjau/staging | tidak |
| LIB-009 | MISSING | Ekspor resource beraudit tiada (exports route tanpa resources) | tidak |
| LIB-010 | PARTIAL | Revisi+restore ada (library:409,417); TANPA diff | tidak |
| LIB-011 | PARTIAL | Filter kategori/tag/favorit/kelengkapan; TANPA status dok/visibilitas/updated | ya |
| LIB-012 | BEDA-SPEC | Restricted hanya 3 peran app-filter (library:127-129); TANPA per tim; tabel visibility_rules tiada | tidak |
| LIB-013 | MISSING | Penanda tinjau ulang 180 hari tiada | tidak |
| LIB-014 | MISSING | Lampiran resource Storage tiada | tidak |
| LIB-015 | DONE | Salin tautan+internal login (resources:108); deep-link tak andal (LIB-003) | tidak |
| LIB-016 | MISSING | Lapor masalah resource tiada | tidak |
| LIB-017 | MISSING | Cek tautan manual tiada (W) | tidak |

### Matriks TSK (PRD-05, 20)
| ID | Status | Bukti & gap ringkas | Test |
|---|---|---|---|
| TSK-001 | PARTIAL | Form tanpa assignee picker/tim/start_date/lampiran saat buat; UI kirim assignees:[] (tugas:218 terkonfirmasi) → TRC-23 | ya (mock) |
| TSK-002 | BEDA-SPEC | Assignee hanya cek aktif; TANPA cek cakupan tim pembuat (20261102000017_audience_and_task_transactions.sql:115-121) | tidak |
| TSK-003 | PARTIAL | Transisi bebas antar status valid (tanpa matriks §3); gate review+riwayat ada (20261102000005:398-438); alasan batal/reopen tak wajib | ya |
| TSK-004 | DONE | Assignee ubah status/komentar/lampiran sesuai izin (tasks:306; operations:409,427) — tapi assignee tak bisa di-set dari UI (TRC-23) | ya |
| TSK-005 | BEDA-SPEC | **reviewer_id TAK pernah di-set** (grep migrasi: hanya gate :426, tanpa setter) → hanya pengurus+ bisa approve; pembuat/koordinator tidak → TRC-22 | ya |
| TSK-006 | PARTIAL | Nama/desc/status/pemilik/arsip ada (tasks:227,260,282); TANPA tanggal; team_id teks bebas | ya |
| TSK-007 | BEDA-SPEC | progress=done/total termasuk cancelled (tasks:208-210 terkonfirmasi); tanpa kontributor & terlambat per proyek → TRC-24 | tidak |
| TSK-008 | PARTIAL | TASK_ASSIGNED ada (tasks:506); push status/review/tenggat/terlambat tiada | tidak |
| TSK-009 | PARTIAL | Grup Terlambat/Hari Ini/Minggu Ini/Nanti di /tugas (607-640); BUKAN beranda santri | tidak |
| TSK-010 | BEDA-SPEC | Kanban read-only TANPA DnD (tugas:744-806); filter hanya waktu | tidak |
| TSK-011 | PARTIAL | Filter tenggat saja (tugas:85-94); TANPA status/prioritas/assignee/tim/proyek/label/search | tidak |
| TSK-012 | PARTIAL | Backend mention+push ada (operations:418-422); UI kirim [] → @nama tak diparse (TRC-23) | tidak |
| TSK-013 | MISSING | Pengingat H-1/hari-H tiada (cron route) | tidak |
| TSK-014 | DONE | Checklist (tasks:366-463) | ya |
| TSK-015 | MISSING | Label tugas tiada | tidak |
| TSK-016 | MISSING | Duplikasi template tiada | tidak |
| TSK-017 | MISSING | Reassign massal saat nonaktif tiada (iam:942) → TRC-31 | tidak |
| TSK-018 | DONE | Ekspor CSV tugas beraudit (exports route:54-58; analytics:18) | ya |
| TSK-019 | BEDA-SPEC | Lintas tim boleh tanpa cek otoritas pembuat atas kedua tim (20261102000017:115-135) → bundle TRC-23 | tidak |
| TSK-020 | MISSING | Arsip otomatis N hari tiada | tidak |

### Matriks SCH (PRD-06, 20)
| ID | Status | Bukti & gap ringkas | Test |
|---|---|---|---|
| SCH-001 | PARTIAL | schedules:601; admin/jadwal:528; tanpa all_day/organizer UI/tim terkait/lampiran | ya |
| SCH-002 | BEDA-SPEC | Hanya agenda+strip minggu; TANPA grid bulan/minggu | tidak |
| SCH-003 | BEDA-SPEC | cancelled DISEMBUNYIKAN (`.eq("status","scheduled")` schedules:104 terkonfirmasi), bukan "Dibatalkan" → TRC-20 | tidak |
| SCH-004 | PARTIAL | Push body generik tanpa detail perubahan (schedules:583-586); badge location_changed ada | tidak |
| SCH-005 | MISSING | Pengingat acara tiada; UI klaim palsu "15 menit" (jadwal:392 terkonfirmasi) → TRC-21 | tidak |
| SCH-006 | PARTIAL | daily/weekly 180h (schedules:43-72); TANPA monthly & pengecualian | tidak |
| SCH-007 | BEDA-SPEC | Bentrok MENOLAK (bukan warning); hanya lokasi (schedules:488,542) | tidak |
| SCH-008 | PARTIAL | Tabel+RPC non-op ada (20261102000011:6); TANPA penanda kalender & UI kelola | tidak |
| SCH-009 | PARTIAL | iCal+cek revoked/expires (schedules:266; feed:38-44); TANPA aksi cabut di UI (lihat SEC-14) | ya |
| SCH-010 | PARTIAL | Filter kategori+tanggal (jadwal:140-143); TANPA search teks & tim | tidak |
| SCH-011 | PARTIAL | Tanpa lampiran; Markdown plain text (schedules:315; admin/jadwal:693) | ya |
| SCH-012 | PARTIAL | Backend all/role/team/users ada (schedules:11-41); UI hanya all/member_type (UX-23) | tidak |
| SCH-013 | DONE | Draft→Published→Archived+jadwal tayang (schedules:315,438; cron) | ya |
| SCH-014 | DONE | Feed beranda, pinned di atas (page:717; jadwal) | tidak |
| SCH-015 | PARTIAL | Tandai dibaca ada (schedules:225); TANPA agregat pembaca & daftar belum baca | ya |
| SCH-016 | PARTIAL | Revisi ada; push SELALU (bukan opt-in); TANPA penanda "diperbarui" (schedules:755-786) | tidak |
| SCH-017 | PARTIAL | Arsip expired otomatis (cron:53-61); TANPA pencarian/lihat arsip | tidak |
| SCH-018 | MISSING | Pratinjau audiens sebelum terbit tiada | tidak |
| SCH-019 | PARTIAL | Pinned+push penting ada; TANPA wajib konfirmasi baca | ya |
| SCH-020 | MISSING | Deep link ber-otorisasi tiada (tanpa rute [id]/useSearchParams) | tidak |

### Matriks PPL (PRD-07, 16)
| ID | Status | Bukti & gap ringkas | Test |
|---|---|---|---|
| PPL-001 | PARTIAL | Self+admin edit struktural teks bebas (settings/profile:101; iam:942); TANPA tanggal join/keluar/duty; bio: guard length>30 + tulis ke notes + tanpa UI → TRC-26 | ya (mock) |
| PPL-002 | MISSING | Buat/ubah/arsip tim tiada jalur kode (20261101000007:12 skema saja) → TRC-25 | tidak |
| PPL-003 | DONE | Tambah/keluar, multi-tim, riwayat valid_to (people:242,265) | tidak |
| PPL-004 | PARTIAL | Koordinator atomik+peran (people:211; 20261102000007); title tak di-expose UI | ya |
| PPL-005 | PARTIAL | Per pengguna+periode ada (people:275); TANPA massal per tim | tidak |
| PPL-006 | PARTIAL | Riwayat di DB (valid_to); TANPA UI timeline | tidak |
| PPL-007 | PARTIAL | Anggota/koordinator/jumlah ada (people:154; tim:535); TANPA ringkasan aktivitas & tautan ATT/REP/TSK | ya |
| PPL-008 | BEDA-SPEC | santri hanya diri, koordinator tim sendiri (bukan direktori semua); argumen klien reveal misleading tapi server aman (SEC-13); masking SEC-03; fallback fixture FUNC-15 | ya (mock) |
| PPL-009 | PARTIAL | Flag bertanggal efektif ada+dibaca historis aman (20261102000011:13; people:49-65); TANPA UI edit | tidak |
| PPL-010 | MISSING | Pindah tim satu aksi tiada | tidak |
| PPL-011 | MISSING | Reassign reviewer massal+pratinjau tiada → TRC-31 | tidak |
| PPL-012 | MISSING | Dashboard peringatan struktur tiada | tidak |
| PPL-013 | PARTIAL | Validasi+error+batch→antrean (operations:260); TANPA pratinjau; kolom pereview tiada | ya (mock) |
| PPL-014 | MISSING | Bagan Yayasan→Pengurus→Tim tiada (kartu, bukan bagan) | tidak |
| PPL-015 | PARTIAL | Batas 2MB+tipe ada (iam:818-837); TANPA pemangkasan otomatis | tidak |
| PPL-016 | MISSING | Status cuti/alumni pengaruhi flag tiada (mock saja, people/data:51) | tidak |

### Matriks ADM (PRD-08, 17)
| ID | Status | Bukti & gap ringkas | Test |
|---|---|---|---|
| ADM-001 | BEDA-SPEC | Hanya 2 view (admin gabungan & santri); TANPA dashboard khusus Koordinator/Yayasan/SuperAdmin (Master §8.3 tidak ada) → TRC-30 | tidak |
| ADM-002 | PARTIAL | Ringkasan+klasifikasi+drilldown (20261102000004:154; admin/analytics:71-74); TANPA tren mingguan/bulanan & belum-check-in eksplisit | ya |
| ADM-003 | PARTIAL | Pengumpulan/terlambat/backlog ada; TANPA usia backlog & revisi | ya |
| ADM-004 | PARTIAL | Terbuka/selesai/terlambat ada; progres proyek formula salah (TRC-24) | ya |
| ADM-005 | MISSING | Analitik Library tiada | tidak |
| ADM-006 | PARTIAL | CSV+PDF beraudit (exports:74-91); TANPA XLSX/asinkron/batas baris | ya |
| ADM-007 | PARTIAL | 3 jam berversi+kalender non-op DB; TANPA hari ops/jendela/zona/ambang/kategori/batas file & UI | ya |
| ADM-008 | PARTIAL | Search+scope+paginasi+hash ada (analytics:72; admin/audit:30,504-527); TANPA filter aktor/aksi/entitas/tanggal; before/after ter-redaksi; SEC-08; UX-04 angka palsu | ya |
| ADM-009 | PARTIAL | Manifest jujur+riwayat (operations:495; admin/backup:42-44); backup/restore nyata belum teruji → OPS-01 (P0) | ya |
| ADM-010 | PARTIAL | Usulan→approve(yayasan)→aktif(superadmin) (analytics:191-326; 20261102000005:447); TANPA pratinjau dampak | ya |
| ADM-011 | PARTIAL | Konfig job+antrean push+uji push (admin/cron; admin/notifications:40-50); TANPA status run/kegagalan terbaru → OPS-18 | ya |
| ADM-012 | PARTIAL | Kategori/tag library ada; TANPA pusat referensi & merge/rename → OPS-10 | tidak |
| ADM-013 | MISSING | Rekap periodik otomatis tiada | tidak |
| ADM-014 | MISSING | Period lock tiada → TRC-32 | tidak |
| ADM-015 | MISSING | Retensi/pemusnahan (OD-006) — sesuai prioritas W, ditunda | tidak |
| ADM-016 | PARTIAL | Role+ownership ada (exports:19,30); TANPA izin per jenis & batas frekuensi → SEC-09 | tidak |
| ADM-017 | MISSING | Halaman "Tentang Data" definisi metrik tiada (hanya catatan singkat admin/analytics:93) | ya (di test) |

### Temuan baru bagian E
| ID | Sev | Temuan | Bukti | PRD | Usulan keputusan | Verifikasi |
|---|---|---|---|---|---|---|
| TRC-20 | P2 | Acara cancelled disembunyikan dari kalender (bukan tampil "Dibatalkan") → user bisa hadir ke acara batal. Push EVENT_CANCELLED ada (workaround). Agen P0; diturunkan: bukan kehilangan/kebocoran data | schedules/actions.ts:104 (terkonfirmasi); push :679 (laporan agen) | SCH-003 | Perbaiki sekarang (tampilkan status Dibatalkan) | Terkonfirmasi main agent |
| TRC-21 | P2 | UI menjanjikan "Pengingat dikirim 15 menit sebelum setiap agenda" padahal job pengingat acara TIDAK ADA. Agen P0; diturunkan: klaim palsu, bukan kerusakan data | jadwal/page.tsx:392 (terkonfirmasi); cron route tanpa event reminder | SCH-005 | Perbaiki sekarang (hapus klaim palsu); job pengingat: tunda v1.1 | Terkonfirmasi main agent |
| TRC-22 | P1 | `tasks.reviewer_id` tak pernah di-set di mana pun → gate approve `reviewer_id = auth.uid()` tak pernah cocok; tugas requires_review HANYA bisa di-approve pengurus+; koordinator/pembuat (pereview dimaksud) tidak bisa | grep migrasi: satu-satunya referensi gate 20261102000005:426; tanpa INSERT/UPDATE setter | TSK-005 | Perbaiki sekarang (set reviewer saat buat/assign tugas) | Terkonfirmasi main agent |
| TRC-23 | P1 | UI tugas tanpa assignee picker (kirim `assignees: []`) & tanpa parser mention → penugasan tugas MUSTAHIL dari UI; push TASK_ASSIGNED tak pernah terpicu; backend TSK-004 siap tapi tak terjangkau. Bundle: cek cakupan tim pembuat (TSK-002/019) | tugas/page.tsx:218 (terkonfirmasi), :1230-1233 hanya display; operations:418-422 backend ada | TSK-001/004/012 (M) | Perbaiki sekarang (picker assignee + parse mention + scope check) | Terkonfirmasi main agent |
| TRC-24 | P2 | Progres proyek = done/total INCLUDING cancelled (cancelled menurunkan progres); blockedTasks = jumlah cancelled (nama menyesatkan). Agen P1; diturunkan: metrik menyesatkan, masih bisa dipakai | tasks/actions.ts:206-210 (terkonfirmasi) | TSK-007, ADM-004 | Tunda v1.1 (atau fix murah: exclude cancelled) | Terkonfirmasi main agent |
| TRC-25 | P2 | CRUD tim tiada jalur kode (skema saja) — kelola tim hanya via SQL/operator | 20261101000007:12; grep nihil | PPL-002 | Keputusan user: tunda v1.1 / operator SQL sementara | Laporan agen |
| TRC-26 | P2 | Bio: guard `userId.length > 30` (UUID 36 lolos; id pendek silent no-op tapi return success), bio ditulis ke kolom `notes` (bertabrakan dengan catatan admin), tanpa UI | people/actions.ts:396-399 (terkonfirmasi) | PPL-001, BR-PPL-10 | Perbaiki sekarang (hapus guard, kolom bio terpisah/merge aman, UI settings) | Terkonfirmasi main agent |
| TRC-27 | P2 | Deep-link resource: ambil via getResourcesAction limit 100 → resource ke-101+ notFound; bidang kosong dibuang (langgar BR-LIB-02 harus tampil "Belum didokumentasikan"). Agen P0; diturunkan | resources/[slug]/page.tsx:11,22 (terkonfirmasi) | LIB-003/004, BR-LIB-02 | Perbaiki sekarang (query slug langsung + tampil 6 bidang) | Terkonfirmasi main agent |
| TRC-28 | P2 | **Arsitektur vs Master PRD**: 154 pemakaian createAdminClient di 26 file → otorisasi ditegakkan di app-code, RLS di-bypass service-role. RLS tetap aktif sebagai defense-in-depth akses langsung; guard app terverifikasi. Master PRD minta "otorisasi di database". Agen P0; diturunkan: bukan kebocoran aktif, kesenjangan spec | grep createAdminClient (terkonfirmasi); Master PRD §arsitektur | Master | Keputusan user: ubah PRD (akui app-layer + RLS defense-in-depth) + hardening bertahap; memaksa RLS penuh sekarang berisiko regresi besar | Terkonfirmasi main agent |
| TRC-29 | — | **Scope drift** (ada di kode, tidak di PRD): (1) Android Capacitor wrapper — Master §4.2 native iOS/Android out-of-scope; (2) FCM push native — R3 hanya "PWA/Web Push"; (3) presence heartbeat — tanpa PRD; (4) cron-job.org eksternal + admin/cron UI — arsitektur tambahan | android/; capacitor.config.ts; lib/fcm.ts; 20261102000018; 20261112000004 | Master §4.2, R3 | Keputusan user: ubah PRD (akui wrapper+push+presence) / cabut dari rilis awal; dokumentasikan ADR cron eksternal | Laporan agen |
| TRC-30 | P2 | Dashboard per peran: Koordinator TIDAK punya dashboard tim (beranda = view santri); Yayasan = view pengurus (tanpa ringkasan strategis); SuperAdmin tanpa dashboard teknis terpisah di beranda; Master §8.3 tidak ada | page.tsx:30,663; admin/analytics:45 | ADM-001, Master §8.3 | Keputusan user: tunda v1.1 / ubah PRD (2 view cukup untuk rilis awal) | Laporan agen |
| TRC-31 | P2 | Nonaktifkan pengguna tanpa reassign tugas/reviewer → tugas yatim & reviewee tanpa pereview | iam/actions.ts:942 (set deactivated+revoke sesi/token, tanpa reassign) | TSK-017, PPL-011 | Tunda v1.1 (alur offboarding) | Laporan agen |
| TRC-32 | P2 | Period lock tiada → rekap periode lampau bisa dikoreksi bebas tanpa otorisasi khusus beraudit | grep nihil | ADM-014 | Tunda v1.1 / keputusan user | Laporan agen |
| OPS-26 | P2 | **Kualitas test**: banyak action return early saat `process.env.VITEST` → unit test memvalidasi mock, bukan perilaku DB; acceptance DB hanya via Playwright terbatas. Klaim "tested" di matriks harus dibaca dengan caveat ini | iam:535-599, attendance:397,417, cron:29-35, dll (pola tersebar) | Kategori 1 (acceptance tested) | Tunda v1.1 (integration test staging); syarat siap rilis: acceptance alur inti diuji runtime, bukan unit mock | Terkonfirmasi main agent (pola) |

**MISSING lain bagian E (usul tunda v1.1 / ubah PRD untuk C/W):** LIB-009/013/014/016/017; TSK-013/015/016/020; SCH-018/020; PPL-010/012/014/016; ADM-005/013/017; ADM-015 (W, sudah ditunda sesuai PRD).
**BEDA-SPEC lain bagian E (keputusan user):** SCH-002 grid bulan/minggu (tunda/ubah PRD); SCH-007 bentrok menolak vs warning (usul ubah PRD: menolak lebih aman); TSK-003 matriks transisi (tunda; trigger sudah validasi status sah); TSK-010 DnD kanban (tunda); LIB-012 visibilitas per tim (tunda/ubah PRD); PPL-008 cakupan direktori koordinator (ubah PRD/pertegas).

### Konformitas dashboard per peran & edge case (E)
- Empty state umumnya ada (Illustration) di resources/tugas/jadwal/tim/admin ✓.
- Tag duplikat: upsert slug cegah duplikat slug, tanpa merge nama-sama-slug-beda (LIB-007).
- Pembatalan acara: push ada, tampilan hilang (TRC-20) → gagal edge case.
- Arsip pengumuman: cron arsip ✓, tanpa UI arsip → hilang tanpa jejak terjangkau (SCH-017).
- Nonaktif pengguna: tanpa reassign (TRC-31). Period lock: tiada (TRC-32).
- Impor tanpa staging: LIB-008/PPL-013 commit langsung (undang akun/buat resource) tanpa pratinjau manusia → risiko data salah masuk (tunda v1.1: pratinjau impor).

## F. UX, UI responsif & aksesibilitas (kategori 4-5)
Agen: ux-a11y-triage. Klaim P1 diverifikasi ulang main agent (grep/read kode). Uji usability staf nyata & perangkat nyata tetap tugas operator (bagian H).

| ID | Sev | Temuan | Bukti | Dampak | PRD | Usulan keputusan | Verifikasi |
|---|---|---|---|---|---|---|---|
| UX-01 | P1 | Identitas reviewer palsu: UI review menampilkan "Ustadz Ahmad Fauzi"/"usr-fauzi"/"Batch #42" hardcode + fallback server `reviewerName \|\| "Ustadz Ahmad Fauzi"` | src/app/(app)/review/page.tsx:104,124-125,165,171; src/modules/reports/actions.ts:522 | Laporan di-review "oleh" orang fiktif; kepercayaan runtuh | REP-007/008 | Perbaiki sekarang (pakai identitas sesi; hapus fallback) | Terkonfirmasi main agent |
| UX-02 | P1 | Profil & MFA tak terjangkau di mobile: link /settings hanya ada di desktop-header | src/components/desktop-header.tsx:115 (satu-satunya hasil grep /settings) | Pengguna mobile tak bisa ubah profil/MFA | IAM-009/012 | Perbaiki sekarang (tambah di mobile nav/profile sheet) | Terkonfirmasi main agent |
| UX-03 | P1 | Submit koreksi & exception kehadiran: hanya cabang `res.success`, tanpa else/isSubmitting/try-catch → gagal = diam, tombol bisa dipencet berulang | src/app/(app)/kehadiran/page.tsx:92-130 | User mengira terkirim padahal gagal; duplikat | ATT-007/008 | Perbaiki sekarang (pola hotfix check-in 8ee8b81) | Terkonfirmasi main agent |
| UX-04 | P1 | Dashboard audit palsu: progres hardcode 0% + alasan approve canned "Disetujui setelah meninjau dampak operasional." tertulis ke audit | src/app/(app)/admin/audit/page.tsx:134,241,251,304 | Audit trail berisi alasan fiktif; metrik bohong | ADM-008 | Perbaiki sekarang (angka nyata + alasan dari input) | Terkonfirmasi main agent |
| UX-05 | P1 | Alasan tolak permohonan wajib tapi di-bypass: `rejectionReason \|\| "Persyaratan belum terpenuhi."` | src/app/(app)/admin/users/page.tsx:178-189 | Pemohon ditolak tanpa alasan spesifik | IAM-003 | Perbaiki sekarang (wajibkan input, tolak submit kosong) | Terkonfirmasi main agent |
| UX-06 | P1 | Modal tugas terpotong di layar kecil: wrapper `fixed inset-0 flex items-center justify-center p-4` + kartu `w-full max-w-lg` TANPA max-height/overflow-y-auto; form panjang (:926-1098) → konten lebih tinggi dari viewport mobile terpotong atas/bawah tanpa scroll | src/app/(app)/tugas/page.tsx:906-907 (struktur CSS terkonfirmasi) | Aksi tak terjangkau di mobile | TSK-001, kategori 5 | Perbaiki sekarang (max-h + overflow-y-auto); uji runtime terautentikasi terblokir (akun e2e tidak ada di DB terhubung — login fixture gagal) | Terkonfirmasi main agent (struktur CSS) |
| UX-07 | P2 | `error.message` mentah (Supabase/English teknis) tersaji ke user | src/modules/attendance/actions.ts:52,84,267,346,404,424; reports/actions.ts:491,582; iam/actions.ts:1081 | Pesan tak dimengerti staf non-teknis | Kategori 4 | Perbaiki sekarang (pemetaan pesan, pola query-error) | Laporan agen |
| UX-08 | P2 | State loading/error diabaikan di banyak halaman → error tampil sebagai "data kosong" menyesatkan | laporan, review, tugas, resources, jadwal, tim; admin/jadwal:44-48; admin/analytics:41-42 | User mengira tidak ada data padahal gagal load | Kategori 4 | Perbaiki sekarang (bedakan empty vs error) | Laporan agen |
| UX-09 | P2 | Kontras warning `#f0b94a` di latar terang ≈1.6–1.9:1 — gagal WCAG AA | resources:216,381; register:216; admin/audit:321 | Teks warning tak terbaca | Kategori 5 (AA) | Perbaiki sekarang (batch a11y, ganti token) | Laporan agen |
| UX-10 | P2 | Label form tanpa `htmlFor`/id (klik label tak fokus; screen reader tak tertaut) | kehadiran:576,600,664; laporan:479-578; admin/jadwal:530-784; settings/profile:199-302; register:249-291 | Aksesibilitas form buruk | Kategori 5 | Perbaiki sekarang (batch a11y; primitif Input sudah benar) | Laporan agen |
| UX-11 | P2 | Modal tanpa `role="dialog"`/aria-modal, focus-trap, Escape | komponen modal lintas halaman | Keyboard/screen reader terjebak | Kategori 5 | Perbaiki sekarang (batch a11y, primitif Dialog bersama) | Laporan agen |
| UX-12 | P2 | Kartu/tag klik via `onClick` div/span — tak bisa keyboard | review:380-387; resources:494-502; tim:254-257 | Pengguna keyboard tak bisa aksi | Kategori 5 | Perbaiki sekarang (batch a11y, jadikan button) | Laporan agen |
| UX-13 | P2 | Target tap kecil (<44px) di beberapa aksi sekunder | laporan agen lintas halaman | Salah pencet di mobile | Kategori 5 | Tunda v1.1 | Laporan agen |
| UX-14 | P2 | Toast/sukses-gagal tanpa `aria-live` | komponen toast | Screen reader tak tahu hasil aksi | Kategori 5 | Perbaiki sekarang (batch a11y, murah) | Laporan agen |
| UX-15 | P2 | Menu Review koordinator tersembunyi di grup "Lainnya" mobile nav | src/components/mobile-nav.tsx:57-82 | Alur inti koordinator sulit ditemukan | REP-007, kategori 4 | Perbaiki sekarang (promosikan ke nav utama) | Laporan agen |
| UX-16 | P2 | Tombol "Buat Pengumuman" tampil untuk semua peran; submit gagal diam untuk non-admin | src/app/(app)/jadwal/page.tsx:568-575,113-138 | Bingung + klik sia-sia | SCH-007 | Perbaiki sekarang (sembunyikan sesuai peran) | Laporan agen |
| UX-17 | P2 | Aksi destruktif tanpa konfirmasi: reset sesi (bandingkan revoke device yang pakai confirm), suspend/deactivate via select, arsip | src/app/(app)/admin/users/page.tsx:191-196 | Aksi tak sengaja tak terbatalkan | Kategori 4 | Perbaiki sekarang (confirm dialog seragam) | Terkonfirmasi main agent |
| UX-18 | P2 | Approvals kehadiran via `prompt()`: cancel tetap approve (nilai null lolos) | src/app/(app)/admin/kehadiran/page.tsx:22-32 | Approve tak sengaja | ATT-011 | Perbaiki sekarang (cek null → batal) | Laporan agen |
| UX-19 | P2 | Handler async tanpa try/catch → spinner macet bila action throw | register:60-71; task-discussion:25-56; admin/people:40-50; admin/resources:78-127 | UI beku, user reload paksa | Kategori 4 | Perbaiki sekarang (finally reset state) | Laporan agen |
| UX-20 | P2 | Layar status akun (pending/rejected/suspended) tanpa kontak admin nyata — IAM-016 meminta jalur bantuan | src/components/account-state-screen.tsx:17-38 | Pemohon buntu tanpa bantuan | IAM-016 | Perbaiki sekarang (kontak/WA admin dari config) | Laporan agen |
| UX-21 | P2 | Label "bulan ini" padahal data = 30 record terakhir (bukan kalender bulan berjalan) | src/app/(app)/kehadiran/page.tsx:413-435; attendance/actions.ts:103,118 | Statistik menyesatkan | ATT-009 | Perbaiki sekarang (label jujur atau filter bulan benar) | Terkonfirmasi main agent |
| UX-22 | P2 | Logout tanpa konfirmasi | komponen header | Tak sengaja keluar | Kategori 4 | Tunda v1.1 | Laporan agen |
| UX-23 | P2 | Dua model audiens pengumuman berbeda (jadwal user vs admin/jadwal) | jadwal:122-128 vs admin/jadwal:101-102 | Bingung targeting | SCH-007 | Keputusan user: konsolidasi / ubah PRD | Laporan agen |
| UX-24 | P2 | Halaman offline pakai kelas tak terdaftar (`bg-sand-50`, `forest-*`) → tampil tanpa gaya | src/app/offline/page.tsx:5-33 | Fallback PWA rusak tampilannya | Kategori 5 | Perbaiki sekarang (pakai token ada, murah) | Laporan agen |
| UX-25 | P3 | Jargon/terminologi drift (klasifikasi, istilah campur ID/EN) | lintas halaman | Konsistensi bahasa | Kategori 4 | Tunda v1.1 (glosarium) | Laporan agen |
| UX-26 | P3 | Data hardcode tampil sebagai live: "Semester", "Pekan 12", "Supabase Live Sync", "Server Sinkron", "Turnstile Valid" | lintas halaman | Kepercayaan palsu | Kategori 4 | Tunda v1.1 (batch dengan UX-04) | Laporan agen |
| UX-27 | P3 | Kontrol mati (tombol tanpa handler) + label EN tersisa | lintas halaman | Bingung | Kategori 4 | Tunda v1.1 | Laporan agen |
| UX-28 | P3 | Dark mode dead toggle; lebar body 884px di desktop besar; jam statis; tanggal device-local | lintas halaman | Kosmetik | Kategori 5 | Tunda v1.1 | Laporan agen |

**Terverifikasi baik (agen + spot-check):** check-in 1-tap + `role="alert"` untuk hasil; guard server solid (UI hanya lapisan kedua); ekspor CSV/PDF nyata + kepemilikan; primitif aksesibel (Button 44px + focus-visible, Input htmlFor + useId); notification-inbox lengkap (realtime, deep link, mark-read); admin/cron aksesibel; auth honeypot + strength meter + autoComplete; catatan revisi wajib di server.

## G. Data, performa & operasional (kategori 6-8)
Agen: data-ops-triage. Klaim kunci diverifikasi ulang main agent; beberapa severity disesuaikan dengan definisi skala (dicatat).

| ID | Sev | Temuan | Bukti | Dampak | PRD | Usulan keputusan | Verifikasi |
|---|---|---|---|---|---|---|---|
| OPS-01 | **P0** | Backup aplikasi hanya manifest (row-count 6 tabel, `artifact_ref:null`, status `manifest_only`) — bukan backup data. Label jujur sudah ditampilkan (catatan respons eksplisit "not a backup"). Risiko kehilangan data permanen bila provider korup/terhapus sampai PITR + drill restore terbukti | src/app/api/cron/backups/route.ts:42-52; src/modules/operations/actions.ts:495-517; docs/backup-restore.md:7 | Kehilangan data permanen | ADM-009 | **Tugas operator segera**: aktifkan PITR Supabase + drill restore terdokumentasi. Fitur export data nyata di aplikasi: usulan tunda v1.1 (keputusan user) | Terkonfirmasi main agent |
| OPS-02 | P1 | `account_requests` tanpa unique "satu pending per email" (hanya index status); cek aplikasi via maybeSingle bisa race & error bila duplikat terlanjur ada | supabase/migrations/20261101000001_iam_schema.sql:79-95; grep UNIQUE email hanya di profiles:26 | Duplikat antrean approval | PRD-01 §5.2 baris 180 | Perbaiki sekarang (partial unique index `WHERE status='pending'`, migrasi aman) | Terkonfirmasi main agent |
| OPS-03 | P2 | Migrasi awal tidak repeat-safe: CREATE POLICY tanpa DROP IF EXISTS (spot-check iam_schema:189-204; agen menghitung 95 di 8 migrasi awal). Re-run di SQL Editor gagal "policy already exists" | supabase/migrations/20261101000001_iam_schema.sql:189-204 dkk | Setup ulang environment tersendat | — | Perbaiki sekarang (guard) atau dokumentasikan run-once; severity diturunkan dari P1 agen (bukan alur inti pengguna) | Terkonfirmasi main agent (spot-check) |
| OPS-04 | P1 | Tanpa error monitoring/alerting (Sentry/Datadog nihil di package.json); query-error hanya console.error+correlationId | package.json (grep nihil); src/lib/query-error.ts:13 | Error produksi tak terdeteksi sampai user komplain | Kategori 7 checklist | Perbaiki sekarang (Sentry free tier / Vercel log drain + alert) | Terkonfirmasi main agent |
| OPS-05 | P2 | Boundary error minim: hanya (app)/error.tsx; tanpa global-error.tsx, tanpa boundary (auth)/root; loading.tsx hanya (app) | Glob src/app/**/*error*.tsx → 1 file | White-screen bila error root/layout; feedback slow-conn kurang | Kategori 2/7 | Perbaiki sekarang (global-error + boundary auth); severity diturunkan dari P1 agen (area terautentikasi sudah tercakup) | Terkonfirmasi main agent |
| OPS-06 | P2 | Dual audit_logs: `audit.audit_logs` (20261101000001:98) orphan vs `public.audit_logs` (20261101000008:7) yang dipakai src; tabel lama RLS-enabled tanpa policy lanjutan | supabase/migrations/20261101000001:98; 20261101000008:7 | Kebingungan operator saat audit/restore; bukan kebocoran aktif (tak ada kode menulis ke sana) | ADM-008 | Tunda v1.1 (drop/dokumentasikan废弃); severity diturunkan dari P1 agen | Laporan agen + grep src nihil |
| OPS-07 | P1 | Seed E2E tanpa guard produksi — service-role key dari env, tanpa cek NODE_ENV; bila operator run dengan env prod → data uji masuk produksi | scripts/seed-e2e-user.mjs:1-40 | Kontaminasi data produksi | — | Perbaiki sekarang (guard NODE_ENV/flag eksplisit, murah) | Terkonfirmasi main agent |
| OPS-08 | P2 | Label `policy_version_id TEXT 'v2.0-default'` hardcode, tidak FK ke policy_settings; cutoff sudah policy-driven tapi label versi tak tertaut | supabase/migrations/20261101000003:31; 20261102000003:167-173 | Audit trail tak link ke versi kebijakan aktual | ATT-003/010 | Tunda v1.1 | Laporan agen |
| OPS-09 | P2 | Triple truth: profiles.member_type vs account_requests.role_requested vs roles/user_roles tanpa sinkronisasi FK/CHECK | supabase/migrations/20261101000001:31,39,85 | Role drift saat approval | OD-014, IAM-005 | Tunda v1.1 (single source di roles; terkait REG-01) | Laporan agen |
| OPS-10 | P2 | Kategori tiga mekanisme: resources FK resource_categories, reports FK report_categories, events TEXT CHECK | 20261101000002:36; 20261101000004:52; 20261101000006:19 | Analitik lintas modul sulit; divergensi saat admin edit | ADM-012 | Tunda v1.1 / ubah PRD (unify) — keputusan user | Laporan agen |
| OPS-11 | — | **Resolusi kontradiksi antar-agen (REP-013)**: reviewer_id diisi saat review (20261102000006:180), bukan snapshot submit. Laporan ter-review tetap pereview aslinya ✓; laporan menunggu ikut penugasan baru = perilaku reassign yang diminta PRD ✓ (atomik, people:275-281). Klaim agen data-ops "divergen" dan agen IAM "laporan lama ikut penugasan baru" keduanya tidak akurat. Gap tersisa: snapshot eksplisit saat submit (TRC-06, P3) | PRD-04 REP-013 baris 162; 20261102000006:57-80,180 | — | REP-013 (M) | Tunda v1.1 / pertegas PRD (TRC-06) | Terkonfirmasi main agent (baca PRD + RPC) |
| OPS-12 | P2 | Preferensi notifikasi per pengguna absen (opt-out pengingat check-in diwajibkan ATT-013) | grep migrasi+src: nihil tabel preferences | Pengingat tak bisa dinonaktifkan per user | ATT-013 (M), REP-014 | Keputusan user: perbaiki sekarang / tunda v1.1 (requirement M tidak boleh menggantung; menunggu hasil traceability ATT-013) | Laporan agen |
| OPS-13 | P2 | FIREBASE_SERVICE_ACCOUNT_KEY opsional di env guard — push silently disabled bila missing | scripts/validate-production-env.mjs:10-16,36-45 | Notifikasi push mati tanpa peringatan | Kategori 8 | Perbaiki sekarang (require di guard ATAU warning eksplisit di admin health) | Terkonfirmasi main agent |
| OPS-14 | P3 | wrangler.jsonc dead config (referensi .open-next/worker.js, @opennextjs/cloudflare tak ada; CF Builds sengaja disabled) | wrangler.jsonc; package.json | Kebingungan ops | — | Tunda v1.1 (hapus/dokumentasikan); diturunkan dari P2 agen | Laporan agen |
| OPS-15 | P2 | Tanpa root README.md (setup/run/deploy tak terdokumentasi di root; hanya docs/audit/README.md) | ls root repo | Developer baru tersesat | Kategori 8 | Perbaiki sekarang (README root ringkas) | Terkonfirmasi main agent |
| OPS-16 | P2 | Tanpa materi training/transisi Excel/kertas/WhatsApp → aplikasi | grep docs: nihil | Adopsi staf terhambat | Kategori 8 | Tugas operator (SOP + training deck) | Laporan agen |
| OPS-17 | P2 | Logging terstruktur & uptime check absen | src/lib/query-error.ts; docs | Insiden lambat didiagnosis | Kategori 7 | Tunda v1.1 (setelah OPS-04) | Laporan agen |
| OPS-18 | P3 | **Diverifikasi kode (sebagian dikoreksi)**: halaman admin/notifications SUDAH menampilkan ringkasan outbox super_admin: Menunggu/Diproses/**Gagal permanen (deadLetter)** + catatan jujur. Gap tersisa: tanpa detail error/daftar kegagalan per pesan, dan ringkasan hanya super_admin (pengurus/yayasan tidak lihat). Agen P2; diturunkan | src/app/(app)/admin/notifications/page.tsx:40-51 (terkonfirmasi) | ADM-011 | Tunda v1.1 (detail kegagalan + perluasan peran); klaim "tidak tersurfacing" tidak akurat | Terkonfirmasi main agent |
| OPS-19 | P3 | vercel.json crons [] tanpa docs cron-job.org (job keys, jadwal, rotasi secret) | vercel.json | Ops tak terdokumentasi | Kategori 8 | Tunda v1.1 (docs/ops/cron.md) | Laporan agen |
| OPS-20 | P3 | enum vs TEXT campur (member_type/role_requested TEXT vs classification ENUM) | migrasi awal | Konsistensi skema | — | Tunda v1.1 | Laporan agen |
| OPS-21 | P3 | Tanpa down migration; backup-restore.md menyebut compensating migration tanpa contoh | docs/backup-restore.md:22 | Rollback manual tanpa pola | Kategori 6 | Tunda v1.1 (dokumentasikan pattern) | Laporan agen |
| OPS-22 | P3 | Ordering hazard skema audit (migrasi lanjut asumsi public.audit_logs; audit.audit_logs tak di-drop) — terkait OPS-06 | 20261102000002:70; 20261102000015:38 | Kebingungan operator | — | Tunda v1.1 (bundle OPS-06) | Laporan agen |
| OPS-23 | P3 | docs/pwa.md tanpa SOP release Android (signing, versioning) | docs/pwa.md; android/ | Release APK tak terstandar | Kategori 8 | Tugas operator | Laporan agen |
| OPS-24 | P3 | CSP script-src 'unsafe-inline' di produksi (trade-off inline script Next.js) | next.config.mjs | Proteksi XSS melemah | §7 | Tunda v1.1 (nonce-based bila feasible) | Terkonfirmasi main agent |
| OPS-25 | P3 | Tanpa seed volume realistis (hanya seed-e2e-user.mjs; tak ada supabase/seed.sql) | scripts/ | Load test tak bisa realistis | Kategori 6/7 | Tugas operator (seed staging) | Laporan agen |

**Terverifikasi baik (agen + spot-check):** unique attendance per user/hari + ON CONFLICT idempoten (20261101000003:34); active membership partial-unique (20261102000009:13); reviewer assignment atomik+unique; outbox retry attempt 0-8 + lease + partial index (20261112000003:7-23); cron heartbeat + halaman admin; select berlimit (attendance 30, operations 100, reports 50, audit 50, exports 500); pdf-lib server-only; env guard komprehensif (required vars, CRON_SECRET≥32, HTTPS, placeholder); CSP+security headers lengkap; timestamptz konsisten; FK+index hot-queries (GIN search_vector resources); tanpa N+1 loop-await di modul yang dicek; docs/backup-restore.md jujur mengakui manifest-only.

---

## H. Tugas operator / manusia (tidak bisa diotomasi agen)
1. **JANGAN set `TURNSTILE_SECRET_KEY` dulu** — UI register belum punya widget Turnstile (TRC-01); men-set secret sekarang membuat registrasi gagal. Set di Vercel SETELAH perbaikan TRC-01/SEC-11 rilis.
2. Pastikan 2 job cron-job.org aktif (GET 15 menit, Bearer CRON_SECRET, https://idaroh.pondokabdurrahmanbinauf.web.id/api/cron/notifications dan /api/cron/backups) + heartbeat terpantau.
3. **SEGERA (P0 OPS-01)**: aktifkan PITR Supabase + drill backup & restore terdokumentasi — ADM-009; backup aplikasi terkonfirmasi hanya manifest (bukan data).
4. Uji usability 3–5 staf nyata dengan tugas nyata tanpa bantuan (kategori 4).
5. Load test sederhana pada jumlah pengguna nyata (kategori 7) — butuh seed staging dulu (OPS-25).
6. Verifikasi FCM push & Safari di perangkat nyata (kategori 5/7).
7. Cek domain/SSL/SPF/DKIM email (kategori 8).
8. Pelatihan & rencana transisi dari Excel/kertas/WhatsApp (kategori 8) — OPS-16.
9. SOP release Android (signing, versioning) — OPS-23.
10. Seed volume realistis di staging untuk load test — OPS-25.
11. Rotasi CRON_SECRET terjadwal + docs cron-job.org (job keys, jadwal) — OPS-19.

## Keputusan gap PRD (rekap usulan awal 2026-11-12 — DIGANTIKAN oleh keputusan final 2026-11-13 di §I dan docs/HANDOVER-2026-11-13.md)
- **Perbaiki sekarang**:
  - Keamanan/data: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-07, SEC-11+TRC-01 (widget Turnstile + fail-closed, satu paket); OPS-02, OPS-03 (guard atau docs run-once), OPS-04, OPS-05, OPS-07, OPS-13, OPS-15.
  - Registrasi: REG-01, REG-02, REG-04 (+REG-03 bila disetujui bundle).
  - Fungsional: FUNC-01 (durasi 60), FUNC-02 (is_late dipalsukan, +TRC-14 truncation menit), FUNC-06 (riwayat admin silang user), FUNC-12+TRC-03 (koreksi: hardcode on_time, mutasi record asli, self-review — satu paket), FUNC-15 (fallback fixture kontak), FUNC-26 (projectId terbalik).
  - Alur inti PRD (traceability): TRC-02 (pending → layar salah), TRC-04 (email keputusan via outbox), TRC-07 (default pengingat 19:30), TRC-20 (acara batal tampil), TRC-21 (hapus klaim palsu "15 menit"), TRC-22 (reviewer tugas di-set), TRC-23 (assignee picker + mention + scope), TRC-26 (bio), TRC-27 (deep-link resource + 6 bidang).
  - UX alur utama: UX-01 (reviewer palsu), UX-02 (profil/MFA mobile), UX-03 (koreksi diam), UX-04 (audit palsu), UX-05 (alasan tolak), UX-07 (pesan error mentah), UX-08 (empty vs error), UX-15 (nav Review koordinator), UX-16 (tombol semua peran), UX-17 (konfirmasi destruktif), UX-18 (prompt cancel), UX-19 (spinner macet), UX-20 (kontak admin), UX-21 (label "bulan ini"), UX-24 (offline tanpa gaya).
  - Batch aksesibilitas (WCAG AA): UX-09 (kontras), UX-10 (label), UX-11 (dialog), UX-12 (keyboard), UX-14 (aria-live).
- **Tunda v1.1**: SEC-06, SEC-08, SEC-09, SEC-10, SEC-12, SEC-14, REG-06; OPS-06, OPS-08, OPS-09, OPS-10 (atau ubah PRD), OPS-14, OPS-17, OPS-19, OPS-20, OPS-21, OPS-22, OPS-24, OPS-26 (integration test staging); fitur export data nyata aplikasi (OPS-01); FUNC-07, FUNC-08, FUNC-09, FUNC-10, FUNC-11, FUNC-13, FUNC-14, FUNC-17, FUNC-18, FUNC-19, FUNC-20, FUNC-21, FUNC-23, FUNC-27 (bersihkan); UX-13, UX-22, UX-25, UX-26, UX-27, UX-28; TRC-06 (snapshot submit), TRC-08 (batas 7 hari koreksi), TRC-11 (guard eksplisit super-admin), TRC-13 (duty saat check-in), TRC-24 (progres cancelled), TRC-31 (reassign offboarding), TRC-32 (period lock); job pengingat acara (TRC-21) & pengingat tugas H-1 (TSK-013).
- **Requirement MISSING — keputusan eksplisit (usul tunda v1.1, kecuali disebut)**: IAM-017 (=REG-03, usul perbaiki sekarang bundle), IAM-018 (email keamanan); ATT-011/015/017/018; REP-006/015/016/017/018/019/020; LIB-009/013/014/016/017; TSK-013/015/016/020; SCH-018/020; PPL-010/012/014/016; ADM-005/013/017; ADM-015 (W, sudah ditunda sesuai PRD). Requirement M yang MISSING tidak boleh menggantung — konfirmasi prioritas ATT saat keputusan.
- **Ubah PRD (usul)**: REG-05, REG-07; TRC-09 (backfill blokir total dipertahankan); TRC-12 (pereview koreksi = pengurus); SCH-007 (bentrok menolak dipertahankan); PPL-008 (cakupan direktori koordinator); TRC-28 (arsitektur otorisasi app-layer + RLS defense-in-depth); TRC-29 (scope drift: Android wrapper, FCM native, presence, cron eksternal — akui atau cabut); TRC-30 (dashboard 2 view cukup untuk rilis awal, atau tunda).
- **Keputusan user (requirement M / arah produk, tidak boleh menggantung)**: OPS-12 (opt-out pengingat ATT-013, M); TRC-05 (riwayat laporan pribadi REP-012, M — usul perbaiki sekarang); TRC-10 (MFA wajib super_admin IAM-012); TRC-25 (CRUD tim PPL-002); TRC-28 (arsitektur otorisasi); TRC-29 (scope drift); TRC-30 (dashboard per peran); FUNC-16 (RPC iam_assign_role/revoke atau ubah PRD); UX-23 (konsolidasi audiens pengumuman).
- **Tugas operator**: bagian H (OPS-01 PITR/drill SEGERA, OPS-16, OPS-23, OPS-25). SEC-11/TRC-01: set Turnstile secret HANYA setelah widget rilis.
- **Perlu uji runtime/verifikasi dulu**: OPS-18 (surfacing kegagalan push); FUNC-03 (PDF font di serverless), FUNC-05 (invite email existing), UX-06 (modal terpotong mobile).
- **Duplikat (satu perbaikan)**: FUNC-04=SEC-01; FUNC-22=SEC-08; FUNC-25=SEC-04; FUNC-12+TRC-03 (paket koreksi); SEC-11+TRC-01 (paket Turnstile).
- **Ditolak/dikoreksi (false positive & klaim tidak akurat)**: klaim RLS tugas terbuka (sudah diperbaiki migrasi 20261102000005); klaim "pdf-lib hanya TTF/OTF" (fontkit mendukung WOFF2 — FUNC-03); kontradiksi REP-013 antar-agen (resolusi: reviewer_id saat review; perilaku praktis sesuai intent — OPS-11/TRC-06); klaim IAM-015 "tanpa proteksi super-admin terakhir" (hierarki implisit memblokir modifikasi target super_admin — TRC-11); klaim PPL-008 "bug otorisasi reveal" (server abaikan argumen klien, aman — SEC-13; yang nyata: masking SEC-03 & fixture FUNC-15).

## I. Keputusan final pengguna (2026-11-13) & status tindak lanjut
Rincian lengkap, bukti verifikasi, dan runbook lanjutan: **docs/HANDOVER-2026-11-13.md** (dokumen serah-terima; bagian A–G di atas tetap bukti baseline audit).

- **NOW (diimplementasikan lokal, belum produksi)**: TRC-05/REP-012 riwayat laporan pribadi; OPS-12/ATT-013 satu toggle opt-out pengingat check-in (prioritas dinaikkan S→M); REG-01+REG-03+IAM-017 kategori klaim 5 opsi + consent versi/waktu (data lama NULL, bukan consent tersirat).
- **NOW (dokumen/syarat rilis)**: TRC-10 pemaksaan MFA login = v1.1, tetapi TOTP manual semua super_admin existing = syarat rilis; TRC-28 otorisasi app-layer + guard tests + RLS defense-in-depth (RLS tidak boleh dilonggarkan); TRC-29 akui cron eksternal/FCM/presence, Android wrapper diakui tapi bukan release gate, ADR cron-job.org dibuat; TRC-30 dua view dashboard cukup, koordinator v1.1; TRC-25 CRUD tim v1.1 + runbook SQL operator; FUNC-16 terima server action + guard setara (SEC-01 RPC atomik tetap terbuka); UX-23 konsolidasi audiens v1.1 (UX-16 belum diimplementasikan).
- **B disetujui**: REG-05 HP wajib; REG-07 validasi manual; TRC-09 backfill diblok; TRC-12 reviewer koreksi pengurus+; SCH-007 bentrok ditolak; PPL-008 direktori koordinator scoped.
- **C**: semua MISSING lain tunda v1.1 eksplisit; ATT-011 (M) dan ATT-015 (S) tercatat tunda v1.1 di PRD-03, bukan penghapusan diam-diam.
- **Status verifikasi terakhir**: typecheck + 297 unit test (31 file) hijau; browser fixture pengingat 7/7 dan riwayat 7/7 hijau; fixture registrasi diperbaiki (export mock `getCurrentUserAction`) tetapi BELUM dijalankan ulang; screenshot ada tetapi belum diinspeksi visual; E2E suite penuh belum dijalankan; dua migrasi 20261113 BELUM diterapkan operator; tidak ada commit/push.
- **Fase 2 Backlog §4 (2026-11-14) — diimplementasikan lokal, belum produksi**:
  - **UX-16 ✅ SELESAI**: Tombol "Buat Pengumuman" tersembunyi untuk non-admin (`src/app/(app)/jadwal/page.tsx`); hanya tampil untuk `super_admin`, `yayasan`, `pengurus`.
  - **SEC-03 ✅ SELESAI**: Fungsi `maskPhoneNumber()` baru di `src/modules/people/actions.ts` — masking berbasis posisi yang menangani +62, tanda hubung, spasi, dan nomor pendek; menggantikan regex yang rusak di dua tempat.
  - **SEC-07 ✅ SELESAI**: Login route (`src/app/api/auth/login/route.ts`) tidak lagi membedakan "Email not confirmed"; registrasi (`src/modules/iam/actions.ts`) tidak lagi bocorkan status/email dalam pesan error duplikat.
  - **FUNC-01 ✅ SELESAI**: Validasi durasi integer positif di `serializeReportItems` (`src/modules/reports/actions.ts`); migrasi SQL baru `20261114000001_fix_duration_regex.sql` memperbaiki regex E-string di `save_report` RPC.
  - **FUNC-02 + TRC-14 ✅ SELESAI**: `is_late` sudah dihitung di server action (`submitReportAction`) — telah ada sebelumnya. Bug TRC-14 diperbaiki: `totalMinutes` di `src/lib/auth/guards.ts` tidak lagi menambahkan 0.5 untuk detik, sehingga 21:00:01 tidak dianggap terlambat.
  - **FUNC-15 ✅ SELESAI**: Fallback fixture `INITIAL_PEOPLE_PROFILES` di `revealContactAction` dihapus (`src/modules/people/actions.ts`); sekarang mengembalikan error jujur jika nomor tidak ditemukan di DB.
  - **FUNC-26 ✅ SELESAI**: Kondisi `projectId.length > 30` terbalik di `src/modules/tasks/actions.ts` — diperbaiki ke `projectId ? projectId : null` agar ID proyek pendek (seperti "proj-presensi-v2") tidak terbuang.
  - **TRC-02 ✅ SELESAI**: `resolveIdentity` di `src/lib/auth/session.ts` sekarang memeriksa `account_requests` jika profil tidak ditemukan — pengguna pending mendapat layar "Akun Menunggu Persetujuan", bukan "Profil Akun Belum Tersedia".
  - **TRC-07 ✅ SELESAI**: Migrasi baru `20261114000002_fix_report_reminder_default.sql` mengubah `report_reminder` dari `21:00` ke `19:30` via `ON CONFLICT DO UPDATE`.
  - **REG-02 ✅ SELESAI**: Password minimum diubah ke 10 karakter di `validatePassword` (`src/modules/iam/actions.ts`) dan UI register (`src/app/(auth)/register/page.tsx`); cek HIBP k-anonymity ditambahkan (graceful fail-open jika API tidak tersedia).
  - **REG-04 ✅ SELESAI**: Rate limit per-IP ditambahkan di `submitAccountApplicationAction` (`src/modules/iam/actions.ts`); menggunakan `headers()` dari `next/headers` dengan try/catch agar tidak memblokir jika context tidak tersedia.
  - **Test baru**: `src/__tests__/backlog-phase2.test.ts` (28 test); penambahan ke `registration-consent.test.ts` (+6 test) dan `tasks.test.ts` (+1 test). Total: 326 test hijau (32 file).
  - **Status**: typecheck ✅, `npm run test -- --maxWorkers=2` ✅ 326/326 hijau. Migrasi 20261114000001 dan 20261114000002 BELUM diterapkan operator.
- **Fase 3 P1 Batch 2 (2026-11-14 lanjutan) — diimplementasikan lokal, belum produksi**:
  - **SEC-02 ✅ SELESAI**: `resetUserSessionAction` di `src/modules/iam/actions.ts` sekarang memverifikasi hierarki pemanggil terhadap target sebelum reset sesi, mengikuti pola `revokeDeviceTokenAction`; pengurus tidak lagi bisa mencabut sesi super_admin/yayasan.
  - **SEC-04 ✅ SELESAI**: MIME allowlist diterapkan di `uploadTaskAttachmentAction` (`src/modules/operations/actions.ts`) — hanya PDF, JPEG, PNG, WebP, DOCX, XLSX, MP4, WebM yang diterima; header `Content-Disposition: attachment` ditambahkan pada respons signed URL agar file tidak disajikan inline.
  - **FUNC-05 ✅ SELESAI**: `inviteUserByEmail` (`src/modules/iam/actions.ts`) kini memeriksa duplikat email di tabel `profiles` maupun `account_requests` sebelum memanggil Supabase invite; mengembalikan pesan seragam tanpa membocorkan status keberadaan akun bila email sudah terdaftar.
  - **FUNC-06 ✅ SELESAI**: `getAttendanceHistoryAction` (`src/modules/attendance/actions.ts`) menerima parameter `targetUserId` opsional; query dikunci per user (scope), dan validasi hierarki pemanggil dilakukan sebelum mengambil data riwayat user lain.
- **Fase 4 — Review independen + verifikasi build produksi (2026-11-15) — diimplementasikan lokal, belum produksi**. Rincian bukti: **docs/audit/REVIEW-INDEPENDEN-2026-11-14.md §5**.
  - **BLOCKER `next build` diperbaiki**: verifikasi AI lain sebelumnya (typecheck/vitest/fixture esbuild) melewati compiler SWC Next + ESLint build, sehingga 3 helper sync yang diekspor dari file `"use server"` tidak terdeteksi merusak build (`Server Actions must be async functions`): `resolveCorrectionClassification` (attendance/FUNC-12), `maskPhoneNumber` (people/SEC-03), `parseMentionUsernames` (operations/TRC-23). Ketiganya diekstrak ke modul non-action (`classification.ts`/`masking.ts`/`mentions.ts`), perilaku sync + unit test tetap. Satu ESLint error (`batch-b-trc20-trc22-trc23.test.ts:96` `as any`) diganti cast type-safe. **Koreksi**: SEC-03 & TRC-23 yang sebelumnya diklaim "terverifikasi" ternyata hanya level unit dan merusak build produksi.
  - **UX-11 ✅ SELESAI**: 20 modal halaman dimigrasi ke primitif `Modal` bersama (`role="dialog"`, `aria-modal`, focus-trap, Escape, klik backdrop, restore fokus) + `more-sheet` diberi a11y setara; label form dipasangkan htmlFor/id. e2e baru `e2e/modal-a11y.spec.ts` 4/4 browser-verified.
  - **Gap fixture e2e diperbaiki**: `audit-ui.spec.ts` (define `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL/WHATSAPP`) dan `registration-consent.spec.ts` (define `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) — tanpa ini komponen crash "process is not defined" di browser fixture.
  - **Test stale diselaraskan (bukan dilemahkan)**: `report-history.spec.ts` (5 test) mengikuti UI riwayat yang sudah ditingkatkan UX-08 (filter/sort, badge klasifikasi+review, page size 20); informasi status tetap lengkap.
  - **Status verifikasi final**: `tsc --noEmit` bersih; `CI=true next build` **hijau** (compiled, lint hanya warning, types valid, 32/32 halaman); `vitest run` **431/431** (41 file); e2e penuh `--workers=1` **95 lulus + 1 skip + 0 gagal** (skip = `auth.spec.ts:13` E2E DB nyata terautentikasi, gate operator). `next build` lokal tanpa `CI=true` tetap gagal di validator env (placeholder `CRON_SECRET` dll.) = gate operator, bukan cacat kode. Belum ada commit/push; migrasi & gate operator §H tetap berlaku.