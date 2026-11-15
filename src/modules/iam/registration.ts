export const MEMBER_CATEGORIES = [
  { value: "santri", label: "Santri" },
  { value: "ustadz", label: "Ustadz" },
  { value: "pengurus", label: "Pengurus" },
  { value: "yayasan", label: "Yayasan" },
  { value: "lainnya", label: "Lainnya" },
] as const;

export type ClaimedMemberType = (typeof MEMBER_CATEGORIES)[number]["value"];

export const REGISTRATION_PRIVACY_VERSION = "2026-11-13.1";

export const REGISTRATION_PRIVACY_NOTICE = [
  "Nama, email, nomor WhatsApp, kategori keanggotaan, tim yang dituju, dan catatan permohonan digunakan untuk verifikasi pendaftaran, pengelolaan akun, serta komunikasi operasional pondok.",
  "Data pendaftaran diperiksa oleh pengurus yang berwenang. Sistem menggunakan layanan Supabase untuk akun dan penyimpanan data serta Vercel untuk menjalankan aplikasi.",
  "Versi persetujuan dan waktu persetujuan disimpan bersama permohonan. Untuk meminta koreksi data atau menyampaikan pertanyaan privasi, hubungi pengurus pondok melalui jalur komunikasi yang biasa Anda gunakan.",
  "Jangan menuliskan data sensitif yang tidak diperlukan dalam catatan. Jika Anda belum dewasa, mintalah pendampingan orang tua atau wali sebelum mengajukan akun; pengurus perlu memastikan persetujuan yang sesuai sebelum aktivasi.",
] as const;
