import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "IDAROH — Platform Operasional Terpadu",
  description:
    "Platform operasional santri, pengurus, koordinator, dan yayasan Pondok Quran Digitalpreneur Abdurrahman bin Auf.",
  icons: {
    icon: [{ url: "/idaroh-icon.svg", type: "image/svg+xml" }],
    apple: "/idaroh-icon-192.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#185c45",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="bg-background font-body-md text-on-surface antialiased min-h-screen flex flex-col">
        <link rel="preload" href="/fonts/hanken-grotesk-latin-variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/ibm-plex-mono-latin-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/material-symbols-outlined-subset.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
