# BASELINE AND TARGETS — IDAROH

Semua pengukuran runtime di bawah berstatus **NOT EXECUTED**. Nilai saat ini tidak boleh diasumsikan nol atau sesuai target.

| Metrik | Halaman/Alur | Nilai Saat Ini | Cara Ukur | Status | Target |
|---|---|---:|---|---|---:|
| TTFB | Semua route utama | Tidak tersedia | Chrome DevTools / WebPageTest; cold & warm | NOT EXECUTED | Catat baseline; optimasi bila jalur kritis |
| First data paint | Dashboard, kehadiran, laporan, tugas, jadwal, library | Tidak tersedia | Performance marks di awal fetch dan render data | NOT EXECUTED | <1s warm; <2s cold pada 4G lambat |
| Full content | Semua route | Tidak tersedia | Navigation timing + app marks | NOT EXECUTED | Target ditetapkan setelah baseline |
| Interactive-ready | Semua route | Tidak tersedia | Playwright interaction timing | NOT EXECUTED | Navigasi terasa instan; tidak ada kontrol disabled tanpa alasan |
| LCP | Setiap route | Tidak tersedia | Lighthouse + `PerformanceObserver` LCP; catat elemen LCP aktual | NOT EXECUTED | <2.5s |
| INP | Interaksi inti | Tidak tersedia | Chrome UX / web-vitals field + lab interaction | NOT EXECUTED | <200ms |
| CLS | Semua route | Tidak tersedia | Lighthouse + layout-shift observer | NOT EXECUTED | <0.1 |
| FCP / TBT | Semua route | Tidak tersedia | Lighthouse mobile emulation | NOT EXECUTED | Catat; FCP sedini mungkin, TBT diminimalkan |
| Font FOIT / swap | Root layout | Tidak tersedia | Network + filmstrip + `document.fonts` | NOT EXECUTED | Teks terlihat frame pertama |
| Request count/bytes | Tiap route | Tidak tersedia | HAR; kelompok serial/paralel; payload per endpoint | NOT EXECUTED | Budget ditetapkan setelah HAR |
| Query DB duration | Supabase | Tidak tersedia | Supabase logs / `EXPLAIN (ANALYZE, BUFFERS)` staging | NOT EXECUTED | Tidak ada N+1; p95 per query ditetapkan berdasar baseline |
| Cross-device sync | Semua entitas | Tidak tersedia | Tandai event dengan timestamp server dan ukur penerimaan B/C | NOT EXECUTED | <2s perubahan normal |
| In-app notification latency | Inbox | Tidak tersedia | event timestamp vs received_at client | NOT EXECUTED | <3s |
| FCM delivery latency | Android | Tidak tersedia | FCM message ID, send/receive timestamp per device | NOT EXECUTED | Tetapkan SLO setelah acceptance |
| Login-to-role-ready | IAM | Tidak tersedia | Playwright marks: auth → profile → roles → shell | NOT EXECUTED | Tidak perlu reload manual |
| Request error ratio | Seluruh API/actions | Tidak tersedia | Structured logs + correlation ID | NOT EXECUTED | SLO disepakati sebelum release |
| Cold/warm 4G | Semua route | Tidak tersedia | Chrome throttling profil 4G lambat, cache disable/enable | NOT EXECUTED | Tampilkan data pertama <2s cold |

## Prosedur pengukuran siap dijalankan
1. Deploy commit audit ke staging dengan database anonim yang representatif.
2. Jalankan `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
3. Jalankan Playwright pada desktop dan viewport 390×844; rekam trace, HAR, console, screenshot.
4. Jalankan Lighthouse mobile pada `/`, `/kehadiran`, `/laporan`, `/tugas`, `/jadwal`, `/resources`, `/notifikasi`.
5. Untuk tiap halaman, lakukan 5 cold run + 5 warm run; laporkan median dan p75, bukan satu run.
6. Uji 4G lambat, offline, reconnect; catat request serial/paralel dan payload.
7. Untuk sync, jalankan dua akun dan tiga klien terpisah; simpan `event_created_at`, `received_at`, dan hitung median/p95/max.
8. Untuk push, uji Android fisik foreground/background/killed, permission granted/denied, logout/account switch.

## Script pengukuran Web Vitals
Tambahkan sementara pada layout client instrumentation atau test harness; jangan menambah delay atau menutupi loading.

```ts
import { onCLS, onINP, onLCP, onFCP, onTTFB } from "web-vitals";

onCLS(console.info);
onINP(console.info);
onLCP(console.info);
onFCP(console.info);
onTTFB(console.info);
```

Catatan: dependency `web-vitals` belum terdaftar pada `package.json`; tambahkan sebagai dev/runtime dependency sesuai strategi telemetry yang disetujui, atau gunakan Lighthouse tanpa menambah dependency.
