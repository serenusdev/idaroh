import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";

function getSafeLoginMessage(message: string) {
  if (
    message.includes("Invalid login credentials") ||
    message.includes("invalid_grant") ||
    message.includes("Email not confirmed")
  ) {
    return "Email atau password yang Anda masukkan salah.";
  }

  return "Terjadi kesalahan saat masuk ke sistem.";
}

export async function POST(request: NextRequest) {
  let payload: { email?: unknown; password?: unknown; turnstileToken?: unknown };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Data login tidak valid." },
      { status: 400 },
    );
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { success: false, message: "Email dan kata sandi wajib diisi." },
      { status: 400 },
    );
  }

  // SEC-11 + TRC-01: fail-closed Turnstile in production; dev/CI skip so real-DB E2E can sign in.
  if (!process.env.VITEST && process.env.NODE_ENV !== "development") {
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (!turnstileSecret) {
      return NextResponse.json(
        { success: false, message: "Verifikasi keamanan belum dikonfigurasi. Hubungi administrator sistem." },
        { status: 503 },
      );
    }
    const turnstileToken = typeof payload.turnstileToken === "string" ? payload.turnstileToken : "";
    if (!turnstileToken) {
      return NextResponse.json(
        { success: false, message: "Verifikasi keamanan wajib diselesaikan." },
        { status: 400 },
      );
    }
    try {
      const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: turnstileSecret, response: turnstileToken }),
      });
      const result = (await verification.json()) as { success?: boolean };
      if (!verification.ok || !result.success) {
        return NextResponse.json(
          { success: false, message: "Verifikasi keamanan gagal. Silakan coba lagi." },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, message: "Verifikasi keamanan tidak dapat dihubungi. Silakan coba lagi." },
        { status: 503 },
      );
    }
  }

  if (!process.env.VITEST) {
    try {
      const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const allowed = await enforceRateLimit(
        `login:${email.toLowerCase()}:${clientIp}`,
        10,
        60 * 15
      );
      if (!allowed) {
        return NextResponse.json(
          {
            success: false,
            message: "Terlalu banyak percobaan login gagal. Harap tunggu beberapa saat sebelum mencoba kembali.",
          },
          { status: 429 },
        );
      }
    } catch {
      // Fall through if rate limiting storage is temporarily unavailable
    }
  }

  const response = NextResponse.json({ success: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set({ name, value, ...options });
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return NextResponse.json(
      {
        success: false,
        message: getSafeLoginMessage(error?.message || "Login gagal."),
      },
      { status: 401 },
    );
  }

  return response;
}
