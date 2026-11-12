# PLACEHOLDER REGISTER — IDAROH

## Hasil pencarian pola
- `FIXME`, `Lorem ipsum`, `Coming soon`, `Segera hadir`, `Dalam pengembangan`, `John Doe`: tidak ditemukan pada source files yang dipindai.
- Kata `TODO` menghasilkan 29 kecocokan, tetapi seluruhnya yang terlihat adalah status task `todo`/test fixture, bukan placeholder teks.
- `href="#"`: 14 kecocokan seluruhnya berada di folder `design system/` HTML prototype, bukan route aplikasi produksi yang terdeteksi.
- `setTimeout`: 17 kecocokan. Mayoritas toast/feedback expiry; bukan otomatis loading palsu. Ada delay navigasi setelah reset password (`src/app/(auth)/reset-password/page.tsx:35`) yang perlu diuji sebagai UX feedback, bukan diperlakukan sebagai fake loading.
- Tidak ditemukan font binary di repository snapshot.

## Register temuan
| ID | Lokasi | Jenis | Isi | Seharusnya | Severity | Aksi | Effort |
|---|---|---|---|---|---|---|---|
| PH-01 | `.env.example:2-15` | Placeholder konfigurasi | Supabase URL/key, cron secret, Turnstile, Firebase key, local URL | Contoh boleh ada di `.env.example`, tetapi deploy wajib fail-fast dan tidak boleh memakai nilai ini | CRITICAL bila lolos ke production | Tambahkan CI/deploy guard yang menolak `placeholder`, localhost, `example.test`, dan key dummy pada production env; jangan masukkan secret riil ke repo | S |
| PH-02 | `src/lib/auth/session.ts:10-23,35-38` | Dummy test identity | `DEFAULT_MOCK_USER` dan `TEST_ACTION_USER` | Mock hanya boleh aktif pada Vitest/test harness | CRITICAL bila dapat dieksekusi di production | Pertahankan guard `NODE_ENV=production && VITEST` di `:6-8`; tambahkan test asserting env production rejects mock path | S |
| PH-03 | `src/app/layout.tsx:33-37` | External font dependency | Google Material Symbols stylesheet | Self-host/SVG icons bila menghindari render dependency eksternal | MEDIUM | Ganti Material Symbols dengan SVG/Lucide atau self-host subset | M |
| PH-04 | `design system/**/code.html` | Prototype control | `href="#"` pada prototype HTML | Prototype ditandai non-production dan tidak didistribusikan sebagai fitur aktif | LOW | Simpan di design system; tambahkan lint scan scoped ke `src/` agar prototype tidak tercampur production | S |
| PH-05 | `src/lib/auth/session.ts:102-104` | Fallback identity hardcode | Tidak ada active role → `santri` | Missing role harus menjadi `role_missing`/recovery state, bukan role default | HIGH | Hapus fallback role implicit; provisioning eksplisit | M |
| PH-06 | `src/app/(app)/admin/audit/page.tsx:46-52` | Default policy form value | Default jam operasional 08:00/08:15/21:00 dan tanggal saat ini | Nilai UI harus berasal dari active policy; default hanya untuk create state yang memang baru | MEDIUM | Pastikan initial form tidak dianggap policy aktif; audit status load/failure | S |

## Tiga daftar
### WAJIB DIIMPLEMENTASIKAN
- Inbox realtime + navigation/deep link yang tervalidasi.
- Backup artefak provider + restore drill terukur.
- Identity `role_missing`/`identity_error` state.
- CI production environment placeholder guard.
- Aksesibilitas zoom: hapus `maximumScale: 1` dan `userScalable: false` di `src/app/layout.tsx:16-21` kecuali ada justifikasi dan alternatif aksesibel.

### WAJIB DIGANTI DENGAN DATA NYATA
- Font binary final (Hanken/IBM jika memang final brand).
- Status backup, FCM delivery, device/session list, job health yang tampil pada UI.
- Semua metrik analytics harus ditelusuri ke record sumber sesuai ADM-001/ADM-002.

### WAJIB DIHAPUS SEKARANG
- Tidak ada placeholder teks dummy yang terbukti berada di production route.
- Jangan hapus `todo` status task atau fixture test.
- Jangan hapus `.env.example`; perketat validasi nilai saat deploy.

## Pemeriksaan otomatis
```bash
# Jalankan pada source runtime saja, tidak pada design prototypes atau fixtures
rg -n -i 'lorem ipsum|coming soon|seg(a|e)ra hadir|dalam pengembangan|john doe|sample data|dummy data' src public
rg -n 'href=["'"']#["'"']' src
rg -n 'localhost|placeholder|example\.test' .env* capacitor.config.ts src
```
Buat CI allowlist untuk fixture test dan `.env.example`; kegagalan scan harus mencegah deploy jika placeholder ditemukan di runtime bundle.
