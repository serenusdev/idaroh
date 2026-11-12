import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey || /placeholder|dummy|your[-_]|change[-_]?me/i.test(`${supabaseUrl} ${supabaseAnonKey}`)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Konfigurasi Supabase tidak lengkap atau masih menggunakan placeholder di lingkungan produksi (F-23).'
      );
    }
  }

  const effectiveUrl = supabaseUrl || 'https://placeholder.supabase.co';
  const effectiveKey = supabaseAnonKey || 'placeholder-anon-key';

  return createServerClient(effectiveUrl, effectiveKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing user sessions.
        }
      },
    },
  });
}
