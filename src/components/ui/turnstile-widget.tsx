"use client";

/**
 * Cloudflare Turnstile widget — lightweight implementation without external package.
 * Loads the Turnstile challenge script from Cloudflare CDN and renders the widget
 * via the implicit render API.
 *
 * Usage:
 *   <TurnstileWidget siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
 *                    onToken={(token) => setTurnstileToken(token)} />
 *
 * The widget calls onToken with the cf-turnstile-response token once the user
 * completes the challenge. Pass this token to the server action.
 * onExpire is called when the token expires; callers should clear their token state.
 */

import * as React from "react";

interface TurnstileWidgetProps {
  siteKey: string;
  onToken: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  /** Override theme; defaults to "auto" */
  theme?: "light" | "dark" | "auto";
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        params: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: string;
          size?: string;
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    _turnstileCallbackQueue?: Array<() => void>;
    _turnstileLoaded?: boolean;
  }
}

const TURNSTILE_SCRIPT_ID = "cf-turnstile-script";
const TURNSTILE_CDN = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_turnstileOnLoad&render=explicit";

function loadTurnstileScript(onReady: () => void): void {
  // Queue callbacks until the script fires its onload
  if (!window._turnstileCallbackQueue) {
    window._turnstileCallbackQueue = [];
  }

  if (window._turnstileLoaded && window.turnstile) {
    onReady();
    return;
  }

  window._turnstileCallbackQueue.push(onReady);

  if (document.getElementById(TURNSTILE_SCRIPT_ID)) {
    // Script tag already added; wait for the queue to flush via onload
    return;
  }

  // Define the global onload callback before inserting the script
  (window as Window & { _turnstileOnLoad?: () => void })._turnstileOnLoad = () => {
    window._turnstileLoaded = true;
    const queue = window._turnstileCallbackQueue || [];
    window._turnstileCallbackQueue = [];
    for (const cb of queue) cb();
  };

  const script = document.createElement("script");
  script.id = TURNSTILE_SCRIPT_ID;
  script.src = TURNSTILE_CDN;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

export function TurnstileWidget({
  siteKey,
  onToken,
  onExpire,
  onError,
  theme = "auto",
}: TurnstileWidgetProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!siteKey) return;
    const container = containerRef.current;
    if (!container) return;

    let mounted = true;

    loadTurnstileScript(() => {
      if (!mounted || !container || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token: string) => {
          if (mounted) onToken(token);
        },
        "expired-callback": () => {
          if (mounted && onExpire) onExpire();
        },
        "error-callback": () => {
          if (mounted && onError) onError();
        },
        theme,
        size: "normal",
      });
    });

    return () => {
      mounted = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore removal errors during cleanup
        }
        widgetIdRef.current = null;
      }
    };
    // onToken/onExpire/onError should not be listed: they are inline functions
    // that change identity every render; siteKey and theme are stable config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, theme]);

  return (
    <div
      ref={containerRef}
      aria-label="Verifikasi keamanan Cloudflare Turnstile"
    />
  );
}
