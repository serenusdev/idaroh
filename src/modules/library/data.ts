import { ResourceItem, CategorySummary } from "./types";

export const CATEGORIES_DATA: CategorySummary[] = [
  { name: "Semua", slug: "all", count: 142, icon: "apps" },
  { name: "Database & Backend", slug: "database-backend", count: 28, icon: "database" },
  { name: "Frontend & UI", slug: "frontend-ui", count: 34, icon: "web" },
  { name: "DevOps & Tooling", slug: "devops-tooling", count: 19, icon: "terminal" },
  { name: "Media & Desain", slug: "media-desain", count: 24, icon: "palette" },
  { name: "Fikih & Tahfidz", slug: "fikih-tahfidz", count: 21, icon: "menu_book" },
  { name: "SOP & Operasional", slug: "sop-operasional", count: 16, icon: "verified_user" },
];

export const INITIAL_RESOURCES: ResourceItem[] = [
  {
    id: "res-001",
    name: "Supabase Database & Row-Level Security",
    slug: "supabase-db-rls",
    description:
      "Arsitektur PostgreSQL dengan kebijakan isolasi RLS (Row-Level Security), trigger otomatis audit, dan sinkronisasi realtime untuk data presensi dan laporan.",
    category: "Database & Backend",
    categorySlug: "database-backend",
    officialUrl: "https://supabase.com/docs",
    tags: ["Postgres", "RLS", "Backend", "Auth"],
    isFavorited: true,
    filledFieldsCount: 6,
    totalFieldsCount: 6,
    lastUpdated: "Hari ini, 07:30 WIB",
    author: "Tim IT Pondok",
    visibility: "internal",
    status: "published",
    accessSetup:
      "Proyek cloud region Singapura (ap-southeast-1), service role key terisolasi dalam vault pengurus IT. Jalur data utama wajib mematuhi RLS.",
    howToUse:
      "Menggunakan Supabase CLI untuk migrasi skema lokal dan sinkronisasi otomatis tipe data TypeScript (supabase gen types).",
    workflowExamples:
      "Helper app.is_active_member() diterapkan pada policy table attendance_records untuk proteksi presensi santri.",
    limitationsCautions:
      "Dilarang keras memakai Prisma atau client pihak ketiga dengan service role langsung di client-side tanpa mekanisme RLS aktif.",
    officialSources:
      "Buku panduan PostgreSQL 15 security manual dan dokumentasi resmi Supabase Auth & Storage.",
    documentationStatus: "Diverifikasi Tim IT Pondok (Nov 2026)",
  },
  {
    id: "res-002",
    name: "Next.js App Router Blueprint",
    slug: "nextjs-app-router-blueprint",
    description:
      "Struktur folder standar IDAROH dengan Tailwind CSS, Server Actions teroptimasi, font Hanken Grotesk, dan kepatuhan Safe Area iOS/Android.",
    category: "Frontend & UI",
    categorySlug: "frontend-ui",
    officialUrl: "https://nextjs.org/docs",
    tags: ["Framework", "Frontend", "Nextjs"],
    isFavorited: false,
    filledFieldsCount: 5,
    totalFieldsCount: 6,
    lastUpdated: "2 hari lalu",
    author: "Sentra Digitalpreneur",
    visibility: "internal",
    status: "published",
    accessSetup:
      "Repository GitHub internal yayasan. Node.js v24 LTS + npm/pnpm strict configuration.",
    howToUse:
      "Jalankan npm run dev pada port 3000. Gunakan Server Components sebagai default; use client hanya bila butuh interaktivitas dan state.",
    workflowExamples:
      "Penerapan route groups (auth) dan (app) dengan layout shell responsif mobile-first.",
    limitationsCautions:
      "Hindari penggunaan <img> mentah tanpa styling terkontrol atau bypass ke CDN luar yang tidak terdaftar di next.config.",
    officialSources: "Dokumentasi resmi Next.js 15 dan Vercel Edge Runtime.",
    documentationStatus: "Dalam Evaluasi Tahap 1",
  },
  {
    id: "res-003",
    name: "Figma UI Kit Clinic Pearl",
    slug: "figma-pondok-clinic-pearl",
    description:
      "Token desain resmi, tipografi Hanken Grotesk, spek ikon Google Material Symbols, dan komponen mobile shell IDAROH.",
    category: "Media & Desain",
    categorySlug: "media-desain",
    officialUrl: "https://figma.com/@pondok-os",
    tags: ["Desain", "DesignSystem", "ClinicPearl"],
    isFavorited: true,
    filledFieldsCount: 6,
    totalFieldsCount: 6,
    lastUpdated: "3 hari lalu",
    author: "Design Ops Santri",
    visibility: "internal",
    status: "published",
    accessSetup: "Akses view untuk seluruh santri, akses edit untuk pengurus media.",
    howToUse: "Gunakan token warna Clinic Pearl & Teal (#005451, #f2fbff) untuk semua mock-up operasional.",
    workflowExamples: "Komponen button 44px–52px untuk touch target ramah smartphone.",
    limitationsCautions: "Jangan memakai warna gradien mencolok di latar belakang tabel data atau form operasional.",
    officialSources: "Spesifikasi docs/design/design.md repositori IDAROH.",
    documentationStatus: "Disetujui Dewan Desain Yayasan",
  },
  {
    id: "res-004",
    name: "SOP Presensi Mandiri & Batas Toleransi",
    slug: "sop-presensi-mandiri",
    description:
      "Standar Operasional Prosedur check-in santri, aturan jam server WIB (08.00 batas tepat, 08.15 toleransi), serta alur pengajuan izin dispensasi.",
    category: "SOP & Operasional",
    categorySlug: "sop-operasional",
    officialUrl: "https://pondokos.app/docs/sop-att",
    tags: ["SOP", "Presensi", "Operasional"],
    isFavorited: false,
    filledFieldsCount: 6,
    totalFieldsCount: 6,
    lastUpdated: "5 hari lalu",
    author: "Biro Kesantrian",
    visibility: "internal",
    status: "published",
    accessSetup: "Terbuka untuk seluruh santri aktif dan asatidz pembina.",
    howToUse: "Buka menu Kehadiran setiap pagi sebelum pukul 08.00 WIB untuk 1-tap check-in.",
    workflowExamples: "Pengajuan izin sakit wajib melampirkan foto surat dokter/keterangan wali santri.",
    limitationsCautions: "Presensi tidak dapat dilakukan di luar hari kerja operasional (Senin–Sabtu).",
    officialSources: "SK Pengurus Yayasan No. 12/PST/2026.",
    documentationStatus: "Terkonfirmasi & Berlaku",
  },
];

