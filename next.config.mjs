import path from 'path';
import { fileURLToPath } from 'url';
import { validateProductionEnvironment } from './scripts/validate-production-env.mjs';
import { PHASE_PRODUCTION_SERVER } from 'next/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== 'production';
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";
const cspHeader = `default-src 'self'; img-src 'self' data: blob: https://lh3.googleusercontent.com https://images.unsplash.com https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://fcm.googleapis.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; ${scriptSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '3mb',
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: cspHeader },
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    if (!dev) validateProductionEnvironment();
    // Webpack resolves @capacitor packages to a non-existent root index.js.
    // Explicitly alias them to their real CJS entry points.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@capacitor/core': path.resolve(
        __dirname,
        'node_modules/@capacitor/core/dist/index.cjs.js'
      ),
      '@capacitor/push-notifications': path.resolve(
        __dirname,
        'node_modules/@capacitor/push-notifications/dist/plugin.cjs.js'
      ),
    };
    return config;
  },
};

export default function configuration(phase) {
  if (phase === PHASE_PRODUCTION_SERVER) validateProductionEnvironment();
  return nextConfig;
}
