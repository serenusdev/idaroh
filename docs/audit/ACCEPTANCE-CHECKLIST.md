# ACCEPTANCE CHECKLIST — IDAROH

## Identity & access
- [ ] Pengguna aktif tanpa profile/role lengkap mendapat state recovery, bukan role default.
- [ ] Login baru mengaktifkan seluruh fitur role-dependent tanpa reload manual.
- [ ] Perubahan role berlaku pada request berikutnya dan terlihat di sesi/perangkat lain sesuai kebijakan.
- [ ] Akun pending/rejected/suspended/deactivated tidak dapat mengakses route dan data yang dilarang.
- [ ] Pergantian akun tidak pernah menampilkan data akun sebelumnya.
- [ ] RLS mencegah akses lintas user, tim, dan role melalui REST/RPC langsung.

## Sync & data integrity
- [ ] Create/update/archive/delete dari Client A terlihat pada Client B dan C tanpa reload manual.
- [ ] Median sync <2 detik untuk perubahan normal; p95 dan worst case tercatat.
- [ ] Subscription dibersihkan saat logout/unmount dan tidak menghasilkan event ganda.
- [ ] Konflik dua penulis menghasilkan aturan resolusi yang eksplisit; tidak ada silent lost update.
- [ ] Offline write tidak pernah diklaim tersimpan jika server belum mengonfirmasi.

## Notifications
- [ ] Setiap event PRD memiliki recipient, channel, template, deep link, suppression rule, dan latency SLO.
- [ ] In-app event tampil <3 detik di seluruh sesi penerima.
- [ ] Read/unread state sinkron lintas device.
- [ ] Klik item membuka tujuan yang benar, termasuk alur login lalu kembali ke deep link.
- [ ] Retry tidak menghasilkan duplikasi; kegagalan masuk DLQ dan terlihat admin.
- [ ] FCM diuji pada perangkat fisik foreground/background/killed dan permission denial.

## Performance & font
- [ ] First data <1s warm dan <2s cold 4G lambat, atau target revisi disetujui PRD.
- [ ] LCP <2.5s; INP <200ms; CLS <0.1; FCP/TBT tercatat per route.
- [ ] LCP element dan request waterfall diketahui untuk route utama.
- [ ] Teks terlihat sejak frame pertama; font gagal load tetap readable; tidak ada layout shift bermakna.
- [ ] Font file size, variant, license, preload, fallback metrics didokumentasikan.

## Placeholder / UX / accessibility
- [ ] Tidak ada placeholder, angka dummy, toast sukses palsu, kontrol mati pada runtime.
- [ ] `.env.example` tidak mungkin lolos sebagai production environment.
- [ ] User dapat zoom 200% dan pinch zoom; keyboard/focus/screen reader diuji.
- [ ] Error validasi, auth, network, conflict, dan server memiliki recovery action yang tepat.

## Backup, release, operations
- [ ] Backup provider artifact benar-benar ada, terenkripsi, dan disimpan terpisah.
- [ ] Restore staging berhasil; RPO/RTO dan operator tercatat.
- [ ] CI lint/typecheck/unit/build/security/migration/RLS/E2E lulus pada commit rilis.
- [ ] Android APK diuji di device dan remote URL/version behavior diterima.
- [ ] Klien lama tidak merusak data setelah deploy; service worker update lifecycle lulus.

## PRD
- [ ] Semua 149 requirement rows memiliki evidence dan status TERPENUHI atau remediation owner + tanggal.
- [ ] Semua OD terbuka diputuskan atau dibuat configurable dengan approval.
- [ ] Semua temuan CRITICAL memiliki mitigasi yang disetujui.
