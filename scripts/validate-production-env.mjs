const placeholder = /placeholder|dummy|example\.(?:test|com|org)|your[-_]|change[-_]?me|^\.{3}$/i;

export function validateProductionEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  if (env.VITEST) throw new Error('VITEST must never be enabled in production.');
  // GitHub CI performs a compile-only build without deployment credentials. Keep
  // that exception explicit and narrow: CI alone must never bypass production
  // validation, and the context must not be accepted outside GitHub Actions.
  if (env.IDAROH_BUILD_CONTEXT === 'ci-compile') {
    if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true') {
      throw new Error('IDAROH_BUILD_CONTEXT=ci-compile is only valid for GitHub Actions CI builds.');
    }
    return;
  }

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_APP_URL',
    'CRON_SECRET',
    // Turnstile widget renders only when the site key is present, while login and
    // registration fail-closed server-side requiring a token in production. Both keys
    // are mandatory together: a secret without a site key would lock out every sign-in.
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    // DX-01: the typed read path (analytics, audit explorer, export datasets) connects directly. It
    // fails closed without this secret rather than falling back to the service-role HTTP client.
    'SUPABASE_DB_URL',
  ];
  for (const key of required) {
    if (!env[key]?.trim() || placeholder.test(env[key])) {
      throw new Error(`Production environment variable ${key} is missing or contains a placeholder.`);
    }
  }

  // A connection string is not an HTTP URL, so it is checked separately: the scheme has to be a real
  // libpq URI with a host, and it must never be logged.
  if (!/^postgres(?:ql)?:\/\/[^/@\s]+/i.test(env.SUPABASE_DB_URL.trim())) {
    throw new Error('Production SUPABASE_DB_URL must be a postgresql:// connection string with a host.');
  }
  const sslMode = (env.SUPABASE_DB_SSL_MODE || 'verify-full').trim().toLowerCase();
  if (!['disable', 'no-verify', 'verify-full'].includes(sslMode)) {
    throw new Error('Production SUPABASE_DB_SSL_MODE must be disable, no-verify or verify-full.');
  }
  if (sslMode !== 'verify-full') {
    console.warn(`[env] SUPABASE_DB_SSL_MODE=${sslMode} — the analytic connection does not verify the database certificate. Use verify-full unless the endpoint cannot support it.`);
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
  // Optional: /api/worker/jobs falls back to CRON_SECRET, but a separate secret lets the scheduler
  // credential be rotated without touching the heartbeat endpoint.
  if (env.WORKER_SECRET && env.WORKER_SECRET.length < 32) {
    throw new Error('Production WORKER_SECRET must contain at least 32 characters.');
  }
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
  } else if (!env.VITEST) {
    // OPS-13: push is optional, but a missing key silently disables FCM. Warn
    // explicitly at deploy time so operators know push will not fire.
    console.warn('[env] FIREBASE_SERVICE_ACCOUNT_KEY is not set — native push notifications (FCM) stay disabled. Set it to enable push.');
  }
}
