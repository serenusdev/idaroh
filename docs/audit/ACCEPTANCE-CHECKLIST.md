# ACCEPTANCE CHECKLIST — IDAROH

## Identity & access
- [x] Pengguna aktif tanpa profile/role lengkap mendapat state recovery, bukan role default. (`identity-state.test.ts`, `auth-session.test.ts`)
- [ ] Login baru mengaktifkan seluruh fitur role-dependent tanpa reload manual.
- [ ] Perubahan role berlaku pada request berikutnya dan terlihat di sesi/perangkat lain sesuai kebijakan.
- [x] Akun pending/rejected/suspended/deactivated tidak dapat mengakses route dan data yang dilarang. (`role-sync-iam-matrix.test.ts`, `role_sync_iam_commands.sql`)
- [x] Pergantian akun tidak pernah menampilkan data akun sebelumnya. (Cache key di-namespace per `currentUser.id` pada beranda, jadwal, pengumuman, audit)
- [x] RLS mencegah akses lintas user, tim, dan role melalui REST/RPC langsung. (21 file pgTAP / 491 asersi PASS di CI)

## Sync & data integrity
- [ ] Create/update/archive/delete dari Client A terlihat pada Client B dan C tanpa reload manual.
- [ ] Median sync <2 detik untuk perubahan normal; p95 dan worst case tercatat.
- [x] Subscription dibersihkan saat logout/unmount dan tidak menghasilkan event ganda. (`use-notification-changes.ts` `removeChannel` cleanup)
- [x] Konflik dua penulis menghasilkan aturan resolusi yang eksplisit; tidak ada silent lost update. (`FOR UPDATE` pada RPC + review concurrency drill di CI)
- [x] Offline write tidak pernah diklaim tersimpan jika server belum mengonfirmasi. (`public/sw.js` shell-only, tanpa antrean tulis offline)

## Notifications
- [ ] Setiap event PRD memiliki recipient, channel, template, deep link, suppression rule, dan latency SLO.
- [ ] In-app event tampil <3 detik di seluruh sesi penerima.
- [ ] Read/unread state sinkron lintas device.
- [ ] Klik item membuka tujuan yang benar, termasuk alur login lalu kembali ke deep link.
- [x] Retry tidak menghasilkan duplikasi; kegagalan masuk DLQ dan terlihat admin. (`fcm-outbox.test.ts`, `notification-outbox-cron.test.ts`)
- [ ] FCM diuji pada perangkat fisik foreground/background/killed dan permission denial. (Butuh perangkat fisik Android)

## Performance & font
- [ ] First data <1s warm dan <2s cold 4G lambat, atau target revisi disetujui PRD. (Butuh trace staging/4G nyata)
- [ ] LCP <2.5s; INP <200ms; CLS <0.1; FCP/TBT tercatat per route.
- [ ] LCP element dan request waterfall diketahui untuk route utama.
- [x] Teks terlihat sejak frame pertama; font gagal load tetap readable; tidak ada layout shift bermakna. (Preload 3 `.woff2` lokal di `layout.tsx` + `fonts.test.ts`)
- [ ] Font file size, variant, license, preload, fallback metrics didokumentasikan.

## Placeholder / UX / accessibility
- [ ] Tidak ada placeholder, angka dummy, toast sukses palsu, kontrol mati pada runtime.
- [x] `.env.example` tidak mungkin lolos sebagai production environment. (`validate-production-env.mjs`, `seed-guard.test.ts`)
- [ ] User dapat zoom 200% dan pinch zoom; keyboard/focus/screen reader diuji.
- [ ] Error validasi, auth, network, conflict, dan server memiliki recovery action yang tepat.

## Backup, release, operations
- [ ] Backup provider artifact benar-benar ada, terenkripsi, dan disimpan terpisah. (Butuh eksekusi/verifikasi operator)
- [ ] Restore staging berhasil; RPO/RTO dan operator tercatat. (`restore-drill.test.ts` mengikat kontrak; drill nyata oleh operator)
- [x] CI lint/typecheck/unit/build/security/migration/RLS/E2E lulus pada commit rilis. (`Pondok OS CI`: `validate`, `migration-check`, `database-integration`)
- [ ] Android APK diuji di device dan remote URL/version behavior diterima. (Konfigurasi `cleartext: false` + `/api/version` siap; uji APK fisik oleh operator)
- [x] Klien lama tidak merusak data setelah deploy; service worker update lifecycle lulus. (`PwaRegister` + `SKIP_WAITING` + `/api/version` + `sw.js`)

## PRD
- [ ] Semua 149 requirement rows memiliki evidence dan status TERPENUHI atau remediation owner + tanggal.
- [ ] Semua OD terbuka diputuskan atau dibuat configurable dengan approval.
- [ ] Semua temuan CRITICAL memiliki mitigasi yang disetujui.
