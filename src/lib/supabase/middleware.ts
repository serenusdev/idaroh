import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { toSafeInternalPath } from '@/lib/safe-url';

export const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/offline',
  '/api/auth/login',
  '/api/calendar/feed',
  '/sw.js',
  '/manifest.webmanifest',
];

export const PUBLIC_PREFIXES = [
  '/api/cron/',
];

export function isPublicRoute(pathname: string): boolean {
  const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (PUBLIC_PATHS.includes(normalized)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pathname = request.nextUrl.pathname;
  const isPublic = isPublicRoute(pathname);

  if (!supabaseUrl || !supabaseAnonKey || /placeholder|dummy|your[-_]|change[-_]?me/i.test(`${supabaseUrl} ${supabaseAnonKey}`)) {
    if (isPublic) return supabaseResponse;
    return NextResponse.json(
      { error: 'Server authentication is not configured.' },
      { status: 503 }
    );
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // An auth session alone does not prove active application membership.
  let identityUnavailable = authError?.name === 'AuthRetryableFetchError';
  let activeProfile = false;
  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('status')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) identityUnavailable = true;
    activeProfile = profile?.status === 'active';
  }

  if (!isPublic) {
    const isApi = pathname.startsWith('/api/');

    if (identityUnavailable) {
      // Pages fall through to the app layout, which renders a retry state.
      if (isApi) {
        return NextResponse.json(
          { error: 'IDENTITY_UNAVAILABLE: Layanan akun sementara tidak tersedia.' },
          { status: 503 }
        );
      }
      return supabaseResponse;
    }

    if (!user) {
      if (isApi) {
        return NextResponse.json(
          { error: 'UNAUTHORIZED: Otentikasi diperlukan.' },
          { status: 401 }
        );
      }
      const url = request.nextUrl.clone();
      const destination = `${url.pathname}${url.search}`;
      url.pathname = '/login';
      url.search = '';
      if (destination !== '/') url.searchParams.set('next', destination);
      return NextResponse.redirect(url);
    }

    // The layout renders only account recovery for inactive pages.
    if (!activeProfile && isApi) {
      return NextResponse.json(
        { error: 'FORBIDDEN: Akun tidak aktif.' },
        { status: 403 }
      );
    }
  }

  // If already authenticated and accessing login or register
  if (user && activeProfile && (pathname === '/login' || pathname === '/register')) {
    const destination = toSafeInternalPath(request.nextUrl.searchParams.get('next'));
    return NextResponse.redirect(new URL(destination || '/', request.nextUrl.origin));
  }

  return supabaseResponse;
}
