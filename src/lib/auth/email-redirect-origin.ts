// Guard against confirmation/reset links landing on ephemeral preview
// deployments (*.vercel.app), where the Turnstile site key is not allowlisted
// and the URL dies with the deployment. In production builds the redirect
// origin must be the canonical production domain.
const PRODUCTION_ORIGIN = "https://idaroh.pondokabdurrahmanbinauf.web.id";

export function isEphemeralPreviewOrigin(origin: string): boolean {
  try {
    return /\.vercel\.app$/i.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function resolveEmailRedirectOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (process.env.NODE_ENV !== "production") {
    return configured || "http://localhost:3000";
  }
  if (!configured) return PRODUCTION_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    console.warn("[auth] NEXT_PUBLIC_APP_URL is not a valid URL; email redirects pinned to the production origin.");
    return PRODUCTION_ORIGIN;
  }
  if (isEphemeralPreviewOrigin(parsed.origin)) {
    console.warn(`[auth] NEXT_PUBLIC_APP_URL points to preview host ${parsed.hostname}; email redirects pinned to the production origin.`);
    return PRODUCTION_ORIGIN;
  }
  return parsed.origin;
}
