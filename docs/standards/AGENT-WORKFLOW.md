# AGENT-WORKFLOW.md — Aturan Kerja Agent IDE untuk IDAROH

> Tempel bagian **§1** ke file aturan agent (mis. `AGENTS.md`, `CLAUDE.md`, atau `.cursorrules`) agar berlaku di setiap sesi.
> Gunakan **§2** sebagai template prompt per perbaikan.

---

## 1. Aturan permanen (taruh di file aturan agent)

```
Kamu bekerja di repo IDAROH (Next.js + Supabase) yang SUDAH LIVE di produksi.
Prioritas: jangan merusak yang sudah jalan. Satu perbaikan = satu cakupan kecil.

SUMBER KEBENARAN
- Izin/otorisasi: PERMISSIONS.md. Jika kode, PRD, dan PERMISSIONS.md berbeda,
  ikuti PERMISSIONS.md dan LAPORKAN selisihnya. Jangan menyelaraskan diam-diam.
- Jika PERMISSIONS.md punya keputusan yang kosong (bagian "Keputusan yang perlu
  ditegaskan"), BERHENTI dan tanya. Jangan menebak.

ATURAN IZIN
- Jangan cek role dengan rank/hierarki. Cek permission + scope.
- Jangan turunkan role dari profiles.member_type.
- Jangan percaya nilai dari client untuk hal yang menentukan integritas
  (is_late, status efektif, user id). Hitung di database.
- Setiap RPC SECURITY DEFINER: search_path terkunci, validasi auth.uid(),
  cek is_active_member(), cek permission+scope, tulis audit.
- Jangan melonggarkan RLS agar sebuah fitur jalan.

ATURAN PERUBAHAN
- Migrasi yang sudah diterapkan TIDAK BOLEH diedit. Buat migrasi baru
  (timestamp lebih baru) beserta rollback di supabase/rollback.
- Jangan menyentuh file di luar cakupan yang disebut di prompt. Jika perlu
  menyentuh file lain, berhenti dan laporkan dulu alasannya.
- Jangan refactor, rename, atau "merapikan" kode yang tidak diminta.
- Jangan hapus tes yang gagal. Jika tes lama gagal setelah perubahanmu,
  itu sinyal regresi: laporkan, jangan ubah tesnya agar lolos.
- Jangan melaporkan "selesai" tanpa menjalankan tes dan menunjukkan hasilnya.

ATURAN LAPORAN
- Bedakan: terverifikasi (sudah dijalankan/dites) vs. dugaan (hanya dibaca).
- Sebutkan setiap file yang diubah dan alasannya.
- Sebutkan risiko sisa dan hal yang belum bisa kamu verifikasi.
```

---

## 2. Template prompt per perbaikan

Isi bagian `<...>`. Kirim **satu perbaikan per sesi**.

### Tahap A — Analisis dampak (JANGAN ubah kode)

```
Perbaikan: <ID temuan, mis. SEC-02 — save_report mempercayai p_is_late dari client>

Baca dulu: PERMISSIONS.md dan temuan di FULL-AUDIT-FINDINGS-2026-11-22.md untuk ID ini.

Tugas tahap ini: HANYA analisis, jangan ubah file apa pun.
1. Cari semua tempat yang memanggil/membaca/menulis <fungsi/tabel/policy terkait>
   (TypeScript, SQL, RPC, policy RLS, tes, cron, API route).
2. Daftar semua tempat yang akan terdampak bila perilakunya diubah.
3. Sebutkan perilaku saat ini vs. perilaku yang seharusnya menurut PERMISSIONS.md.
4. Usulkan rencana perubahan paling kecil: file apa saja, migrasi apa, tes apa.
5. Sebutkan apa yang bisa rusak dan bagaimana kamu akan mengeceknya.

Berhenti setelah laporan. Saya akan menyetujui sebelum kamu mengubah apa pun.
```

### Tahap B — Tes dulu (tes harus GAGAL sebelum perbaikan)

```
Rencana tahap A disetujui. Sekarang:
1. Tulis tes yang membuktikan bug ada (harus GAGAL pada kode saat ini).
   Untuk izin: tes per role (santri, koordinator, pengurus, yayasan, super_admin)
   dan tes panggilan RPC langsung, bukan hanya lewat UI.
2. Jalankan tes dan tunjukkan bahwa tes itu gagal karena alasan yang benar.
3. Jangan ubah kode produksi di tahap ini.
```

### Tahap C — Perbaikan minimal

```
Tes gagal terkonfirmasi. Sekarang perbaiki dengan perubahan paling kecil.
Cakupan file yang BOLEH diubah: <daftar file>.
Di luar daftar itu: jangan sentuh; jika perlu, berhenti dan tanya.

Wajib:
- Migrasi baru (jangan edit migrasi lama) + file rollback.
- Tes dari tahap B harus lolos.
- Jalankan SELURUH suite tes yang ada. Tidak boleh ada tes lama yang gagal.
- Laporkan: file yang diubah, hasil tes (sebelum vs. sesudah), risiko sisa.
```

### Tahap D — Review independen (sesi baru, konteks bersih)

```
Review diff di branch <nama-branch> terhadap main. Jangan ubah kode.
Periksa:
1. Apakah perubahan sesuai PERMISSIONS.md?
2. Apakah ada pemanggil lain yang terdampak dan terlewat?
3. Apakah ada izin yang tanpa sengaja melebar atau menyempit?
4. Apakah migrasi aman dijalankan pada data produksi yang sudah ada
   (nilai lama, baris yang melanggar constraint baru, lock tabel)?
5. Apakah rollback benar-benar mengembalikan keadaan semula?
Laporkan temuan berurutan dari yang paling serius.
```

---

## 3. Urutan perbaikan yang disarankan

Kerjakan **satu per satu**, masing-masing melalui tahap A → D di atas.

1. **SEC-02** — hitung `is_late` di database (WIB), abaikan parameter client
2. **SEC-03** — selaraskan RLS isi laporan dengan `report.read` (butuh keputusan D1)
3. **SEC-01** — scope + filter pada export; sementara batasi ke satu peran
4. **SEC-05, LIB-01** — audit log dan import library
5. **SEC-04, TASK-01** — Tasks: keluarkan SA, izinkan koordinator ubah status tim
6. **LIB-02** — `restricted` visibility (butuh keputusan D6)
7. **SCH-01** — jadwal berulang (ID stabil + occurrence key)
8. **MFA-01** — selaraskan dengan keputusan D5

---

## 4. Checklist sebelum merge ke produksi

- [ ] Branch terpisah per perbaikan, satu perbaikan per branch
- [ ] Migrasi diuji di Supabase branch/staging, bukan langsung ke produksi
- [ ] Seluruh tes lolos, termasuk tes lama
- [ ] Tes role-by-role + RPC langsung lolos
- [ ] Diff direview (tahap D) oleh sesi/orang berbeda dari yang menulis
- [ ] Rollback sudah diuji
- [ ] `PERMISSIONS.md` ikut diperbarui bila izin berubah
- [ ] Sebelum menerapkan ke produksi: cadangan data tabel yang disentuh
