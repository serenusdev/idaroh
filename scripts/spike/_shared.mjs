// Shared helpers for the non-production MFA provider spikes (T0.1 / T0.2 / T0.3).
// These scripts are OPERATOR-run against a DISPOSABLE Supabase project. They are
// not part of the app build and never execute in CI or production. See
// docs/mfa-spike-runbook.md. No secret value is ever hardcoded or printed.
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Refuse to run against production or the app's configured project. The spike
// uses a dedicated SPIKE_* env namespace so a loaded production .env cannot be
// picked up accidentally.
export function assertSpikeTarget() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Spike must never run with NODE_ENV=production.");
  }
  if (process.env.SPIKE_CONFIRM !== "yes") {
    throw new Error(
      "Set SPIKE_CONFIRM=yes to acknowledge the target is a DISPOSABLE NON-PRODUCTION Supabase project.",
    );
  }
  const url = process.env.SPIKE_SUPABASE_URL;
  const anon = process.env.SPIKE_SUPABASE_ANON_KEY;
  if (!url?.trim() || !anon?.trim()) {
    throw new Error(
      "Spike requires SPIKE_SUPABASE_URL and SPIKE_SUPABASE_ANON_KEY from a disposable non-prod project.",
    );
  }
  const appUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (appUrl && url.replace(/\/+$/, "") === appUrl.replace(/\/+$/, "")) {
    throw new Error(
      "SPIKE_SUPABASE_URL must differ from the app's NEXT_PUBLIC_SUPABASE_URL — never spike against the configured (possibly production) project.",
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SPIKE_SUPABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("SPIKE_SUPABASE_URL must use HTTPS.");
  }
  return { url, anon };
}

export function spikeClient({ url, anon }, { recoveryCodes = false } = {}) {
  return createClient(url, anon, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      experimental: { recoveryCodes },
    },
  });
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) using node:crypto only — no new dependency.
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input).replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secretBase32, { step = 30, digits = 6, timestamp = Date.now() } = {}) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestamp / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

// Local JWT decode (no network). Mirrors src/lib/auth/mfa-assurance.ts decodeAalClaim.
export function decodeAal(accessToken) {
  if (!accessToken) return null;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims.aal === "string" ? claims.aal : null;
  } catch {
    return null;
  }
}

export function decodeAmr(accessToken) {
  if (!accessToken) return [];
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return [];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Array.isArray(claims.amr) ? claims.amr.map((entry) => entry?.method ?? entry) : [];
  } catch {
    return [];
  }
}

export async function currentSession(client) {
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(`getSession failed: ${error.message}`);
  return data.session ?? null;
}

export function errCode(error) {
  return error?.code ?? error?.name ?? "n/a";
}

// Creates a throwaway user on the disposable project. Requires "Confirm email"
// to be DISABLED on that project so signUp returns a session immediately.
export async function createDisposableUser(client, label) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `spike-${label}-${suffix}@example.com`;
  const password = `Spike-${Math.random().toString(36).slice(2)}-${Date.now()}Aa1!`;
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new Error(`signUp failed: ${error.message} (code ${errCode(error)})`);
  }
  if (!data.session) {
    throw new Error(
      'signUp returned no session. On the disposable project disable Auth → "Confirm email", then re-run.',
    );
  }
  return { email, password, user: data.user };
}

// Enrolls a TOTP factor and verifies it, upgrading the in-memory session to aal2.
export async function enrollAndVerifyTotp(client, friendlyName = "Spike Authenticator") {
  const { data: factor, error: enrollError } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });
  if (enrollError) {
    throw new Error(`mfa.enroll failed: ${enrollError.message} (code ${errCode(enrollError)})`);
  }
  const secret = factor?.totp?.secret;
  if (!secret) throw new Error("mfa.enroll returned no TOTP secret.");

  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeError) {
    throw new Error(`mfa.challenge failed: ${challengeError.message} (code ${errCode(challengeError)})`);
  }
  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: totp(secret),
  });
  if (verifyError) {
    throw new Error(`mfa.verify failed: ${verifyError.message} (code ${errCode(verifyError)})`);
  }
  const session = await currentSession(client);
  return { factorId: factor.id, secret, aalAfterVerify: decodeAal(session?.access_token) };
}

export async function freshAal1Session(client, { email, password }) {
  await client.auth.signOut();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`signInWithPassword failed: ${error.message} (code ${errCode(error)})`);
  }
  return data.session;
}

export function maskToken(token) {
  if (!token) return "(none)";
  return `${token.slice(0, 6)}…${token.slice(-4)} (len ${token.length})`;
}

export function banner(title) {
  console.log(`\n=== ${title} ===`);
}

export function result(decision, details) {
  console.log(`\nRESULT: ${decision}`);
  for (const [key, value] of Object.entries(details)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(
    "\nPaste this RESULT block into docs/audit/MFA-VERIFIKASI-2026-11-16.md. Recovery codes / tokens are never printed.",
  );
}