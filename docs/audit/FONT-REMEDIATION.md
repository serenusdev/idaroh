# FONT REMEDIATION — IDAROH

## Temuan source
| Bukti | Status | Severity | Temuan |
|---|---|---|---|
| `src/app/globals.css:7` | HARDCODED | MEDIUM | CSS menetapkan `--font-hanken-grotesk: "Hanken Grotesk"` tanpa `@font-face` di repository |
| `tailwind.config.ts:175-186` | HARDCODED | MEDIUM | Typography tokens mengacu Hanken Grotesk dan IBM Plex Mono |
| `src/app/layout.tsx:33-37` | SETENGAH | MEDIUM | Google Material Symbols stylesheet eksternal, `display=swap`; menambah dependency eksternal |
| `package.json` dependency `@fontsource/noto-sans` | UNVERIFIED | LOW | Package tercantum tetapi tidak ditemukan importnya pada source; belum tentu dipakai |
| Repository asset scan | TIDAK ADA | MEDIUM | Tidak ditemukan file `.woff/.woff2/.ttf/.otf` di snapshot source |

## Strategi final
1. Putuskan font brand final. Jika Hanken Grotesk + IBM Plex Mono tetap menjadi token desain, sertakan font WOFF2 berlisensi ke `public/fonts/`.
2. Tambahkan `@font-face` untuk keluarga dan bobot yang benar-benar dipakai. Set `font-display: swap`; jangan memuat semua varian.
3. Preload hanya regular/semibold yang dipakai above-the-fold. Gunakan `crossorigin` untuk font preload.
4. Material Symbols: ganti dengan `lucide-react` SVG icons yang sudah menjadi dependency, atau self-host subset WOFF2 jika ikon font memang diperlukan.
5. Tambahkan metric-matched fallback setelah memperoleh font final; jangan menebak `size-adjust`/`ascent-override`.

## Konfigurasi siap adaptasi (path harus sesuai file font yang benar-benar ditambahkan)
```css
@font-face {
  font-family: "Hanken Grotesk";
  src: url("/fonts/hanken-grotesk-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/fonts/ibm-plex-mono-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 700;
  font-display: swap;
}
```
Tambahkan `<link rel="preload" href="/fonts/hanken-grotesk-latin-variable.woff2" as="font" type="font/woff2" crossorigin>` hanya setelah file tersebut ada dan dipastikan font LCP.

## Anggaran dan verifikasi
- Anggaran awal usulan: maksimal 2 keluarga font, maksimal 2 file WOFF2 untuk latin (variable bila lisensi/fit mendukung); bukan angka aktual.
- Ukur ukuran file, request count, FCP/LCP/CLS, filmstrip, dan fallback saat font request diblokir.
- `size-adjust`, `ascent-override`, `descent-override`, `line-gap-override` baru ditetapkan dari pengukuran font metric, bukan nilai rekaan.
