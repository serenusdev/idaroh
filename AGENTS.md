# AGENTS.md — Aturan Kerja Agen IDE (IDAROH / Pondok OS)

Repo ini SUDAH LIVE di produksi. Prioritas: jangan merusak yang sudah jalan.
Satu perbaikan = satu cakupan kecil, di branch terisolasi sendiri.

## Sumber kebenaran

- **Izin/otorisasi tunggal: [`PERMISSIONS.md`](PERMISSIONS.md)** (standar lintas proyek: [`docs/standards/UNIVERSAL-PERMISSION.md`](docs/standards/UNIVERSAL-PERMISSION.md)). Jika kode, PRD, dan PERMISSIONS.md berbeda, ikuti PERMISSIONS.md dan LAPORKAN selisihnya. Jangan menyelaraskan diam-diam.
- Keputusan kebijakan **D1–D7 sudah dikunci** di PERMISSIONS.md §4 (final 2026-11-22). Jangan membuka ulang tanpa persetujuan product owner.
- Protokol kerja per perbaikan (Tahap A→D) dan urutan backlog: [`docs/standards/AGENT-WORKFLOW.md`](docs/standards/AGENT-WORKFLOW.md). Temuan sumber: `docs/audit/` + `FULL-AUDIT-FINDINGS-2026-11-22.md`.

## Aturan izin

- Jangan cek role dengan rank/hierarki (`hasMinimumRole()`, `roleRank >= ...`). Cek pasangan eksplisit `(permission, scope)`; evaluasi SELURUH `roles[]` multi-peran.
- Jangan turunkan hak akses dari `profiles.member_type` — deskriptif semata; peran hanya dari `user_roles` + `roles.key`.
- Jangan percaya nilai dari client untuk hal yang menentukan integritas (`is_late`, tanggal efektif, `p_user_id`, status). Hitung di database dengan WIB `Asia/Jakarta`.
- Setiap RPC `SECURITY DEFINER`: `SET search_path` terkunci, validasi `auth.uid()`, cek `app.is_active_member()`, cek permission+scope sesuai matriks §3, tulis `audit_logs` dalam transaksi yang sama.
- Jangan melonggarkan RLS agar sebuah fitur jalan. Jangan izinkan self-review (laporan/koreksi/tugas).

## Aturan perubahan

- Migrasi yang sudah diterapkan (hingga `20261121000001`) TIDAK BOLEH diedit. Buat migrasi baru (`202611220000NN_...sql`, idempoten, diakhiri `NOTIFY pgrst, 'reload schema';`) beserta rollback di `supabase/rollback/`.
- Jangan menyentuh file di luar cakupan yang disetujui pada Tahap A. Jika perlu, berhenti dan laporkan dulu.
- Jangan refactor, rename, atau "merapikan" kode yang tidak diminta.
- Jangan hapus/ubah tes lama yang gagal agar lolos — itu sinyal regresi; laporkan.
- Jangan push ke `origin/main` dan jangan `supabase db push --remote` tanpa persetujuan eksplisit operator.
- Perubahan izin wajib disinkronkan serentak di 5 lapisan: Navigasi UI ↔ Server Action Guard ↔ Helper SQL ↔ RLS Policy ↔ RPC + tests — lalu PERMISSIONS.md ikut diperbarui.

## Aturan otonomi & pengujian runtime (update operator 2026-11-22)

- D1–D7 final → jalankan siklus Tahap A→B→C→D per item backlog secara berkesinambungan tanpa berhenti meminta persetujuan per item. Persetujuan tetap dibutuhkan hanya untuk: perubahan di luar cakupan yang dianalisis, atau tindakan yang menyentuh garis merah di bawah.
- Runtime call / simulasi request sebagai user dan pemanggilan RPC langsung DIIZINKAN untuk memverifikasi bug dan hasil perbaikan.
  - Utamakan lingkungan lokal/CI/staging.
  - Jika verifikasi perlu menyentuh produksi setelah migrasi diterapkan: hanya akun uji coba khusus (bukan akun asli santri/pengurus/admin), dilarang mengubah/menghapus data pengguna asli, dan wajib cleanup data dummy setelahnya.
- Dalam cakupan item, boleh memodifikasi file pemanggil (callers), `types.ts`, komponen UI terkait, dan file tes yang terdampak langsung, agar `npm run build` dan `tsc --noEmit` lulus bersih.
- Boleh menjalankan `npm run build`, server lokal, Playwright E2E, dan simulasi runtime dengan akun uji terisolasi.
- **Garis merah (tetap mutlak):** JANGAN push ke `origin/main`; JANGAN `supabase db push --remote` ke produksi; keduanya hanya atas perintah rilis akhir eksplisit dari operator. Push ke branch remediation sendiri diizinkan sebagai bagian dari siklus kerja (CI butuh branch remote).

## Aturan laporan

- Bedakan: **terverifikasi** (sudah dijalankan/dites) vs **dugaan** (hanya dibaca).
- Sebutkan setiap file yang diubah dan alasannya.
- Sebutkan risiko sisa dan hal yang belum bisa diverifikasi.
- Jangan melaporkan "selesai" tanpa menjalankan tes dan menunjukkan hasilnya (`npm test` penuh + `npx tsc --noEmit`, zero regression).
