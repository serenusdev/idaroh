import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
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

  return createBrowserClient(effectiveUrl, effectiveKey);
}
