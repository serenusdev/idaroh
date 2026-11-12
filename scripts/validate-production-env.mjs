const placeholder = /placeholder|dummy|example\.(?:test|com|org)|your[-_]|change[-_]?me|^\.{3}$/i;

export function validateProductionEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  if (env.VITEST) throw new Error('VITEST must never be enabled in production.');

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_APP_URL',
    'CRON_SECRET',
  ];
  for (const key of required) {
    if (!env[key]?.trim() || placeholder.test(env[key])) {
      throw new Error(`Production environment variable ${key} is missing or contains a placeholder.`);
    }
  }

  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_APP_URL', 'CAPACITOR_SERVER_URL']) {
    if (!env[key]) continue;
    let url;
    try { url = new URL(env[key]); } catch { throw new Error(`Production URL ${key} is invalid.`); }
    if (url.protocol !== 'https:' || /^(?:localhost|127\.|0\.|\[?::1\]?$)/i.test(url.hostname) || url.hostname.endsWith('.test') || placeholder.test(url.hostname)) {
      throw new Error(`Production URL ${key} must use HTTPS and a non-local hostname.`);
    }
  }

  if (env.CRON_SECRET.length < 32) throw new Error('Production CRON_SECRET must contain at least 32 characters.');
  if (env.TURNSTILE_SECRET_KEY && placeholder.test(env.TURNSTILE_SECRET_KEY)) {
    throw new Error('Production TURNSTILE_SECRET_KEY contains a placeholder.');
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    let credentials;
    try {
      const raw = env.FIREBASE_SERVICE_ACCOUNT_KEY;
      credentials = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64url').toString('utf8'));
    } catch { throw new Error('Production Firebase credentials are invalid.'); }
    if (['project_id', 'client_email', 'private_key'].some((key) => !credentials?.[key] || placeholder.test(credentials[key]))) {
      throw new Error('Production Firebase credentials are incomplete or contain a placeholder.');
    }
  }
}
