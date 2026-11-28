/**
 * Peta prefix rute → judul halaman.
 * Gunakan getRouteTitle(pathname) untuk resolusi dengan aturan "prefix terpanjang menang".
 * Fallback: "IDAROH"
 */
const ROUTE_TITLES: Record<string, string> = {
  '/admin/live-telemetry': 'Telemetry Langsung',
  '/admin/users': 'Manajemen Pengguna',
  '/admin/roles': 'Manajemen Peran',
  '/admin/settings': 'Pengaturan Sistem',
  '/admin': 'Panel Admin',
  '/mutabaah': "Mutaba'ah & Halaqah",
  '/tasrih': 'E-Tasrih',
  '/rapor': 'Rapor Digital',
  '/reports': 'Laporan',
  '/attendance': 'Presensi',
  '/schedules': 'Jadwal',
  '/tasks': 'Tugas',
  '/announcements': 'Pengumuman',
  '/profile': 'Profil',
  '/settings': 'Pengaturan',
  '/admin/people': 'Anggota & Reviewer',
  '/admin/analytics': 'Analitik Operasional',
  '/admin/backup': 'Backup & Pemulihan',
  '/admin/kehadiran': 'Review Presensi',
  '/admin/notifications': 'Uji Notifikasi',
  '/admin/cron': 'Jadwal Otomatis',
  '/admin/audit': 'Dasbor Analitik & Audit',
  '/admin/resources': 'Resource Library',
  '/admin/jadwal': 'Jadwal & Pengumuman',
  '/kehadiran': 'Presensi Operasional',
  '/laporan': 'Laporan Aktivitas Harian',
  '/review': 'Antrean Review Laporan',
  '/tugas': 'Tugas & Proyek',
  '/jadwal': 'Jadwal & Pengumuman',
  '/resources': 'Resource Library',
  '/tim': 'Direktori Tim & Orang',
  '/': 'Beranda Santri',
};

/**
 * Kembalikan judul rute untuk `pathname` dengan mencocokkan prefix terpanjang.
 * Jika tidak ada yang cocok, kembalikan "IDAROH".
 */
export function getRouteTitle(pathname: string): string {
  // Urutkan kunci dari terpanjang ke terpendek agar prefix terpanjang menang.
  const sorted = Object.keys(ROUTE_TITLES).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return ROUTE_TITLES[prefix];
    }
  }
  return 'IDAROH';
}

export { ROUTE_TITLES };
