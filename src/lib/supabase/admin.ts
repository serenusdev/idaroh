/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";

if (process.env.NODE_ENV === 'production' && process.env.VITEST) {
  throw new Error('VITEST must never be enabled in production.');
}

/**
 * Supabase Admin Client
 * Uses SUPABASE_SERVICE_ROLE_KEY to perform privileged operations
 * on behalf of the server (e.g. background sync, initial seed, admin queries).
 */
export function createAdminClient() {
  if (process.env.VITEST) {
    // Return in-memory mock client to prevent outbound network timeouts during Vitest runs
    const createMockChain = () => {
      const chain: any = {
        select: () => chain,
        insert: () => chain,
        upsert: () => chain,
        update: () => chain,
        delete: () => chain,
        eq: () => chain,
        neq: () => chain,
        is: () => chain,
        or: () => chain,
        ilike: () => chain,
        in: () => chain,
        gte: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        rpc: () => Promise.resolve({ data: { success: true }, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    };

    return {
      from: () => createMockChain(),
      rpc: () => Promise.resolve({ data: { success: true }, error: null }),
      auth: {
        admin: {
          createUser: () => Promise.resolve({ data: { user: { id: "mock-user-id" } }, error: null }),
          deleteUser: () => Promise.resolve({ error: null }),
          updateUserById: () => Promise.resolve({ data: { user: { id: "mock-user-id" } }, error: null }),
          getUserById: () => Promise.resolve({ data: { user: { id: "mock-user-id", email_confirmed_at: "2026-01-01T00:00:00.000Z" } }, error: null }),
          inviteUserByEmail: () => Promise.resolve({ data: { user: { id: "mock-user-id" } }, error: null }),
          signOut: () => Promise.resolve({ error: null }),
        },
      },
    } as any;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey || (process.env.NODE_ENV === 'production' && /placeholder|dummy|your[-_]|change[-_]?me/i.test(`${supabaseUrl} ${serviceRoleKey}`))) {
    throw new Error(
      "Konfigurasi Supabase Admin tidak lengkap. Harap pastikan NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY terkonfigurasi di Environment Variables."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
