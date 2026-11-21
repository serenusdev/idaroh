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
import { Button } from "@/components/ui/button";

interface TurnstileWidgetProps {
  siteKey: string;
  onToken: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  /** Called when the challenge script itself fails to load. */
  onScriptError?: () => void;
  /** Increment to force the widget to re-render (e.g. after a rejected server action). */
  resetNonce?: number;
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
    _turnstileLoaded?: boolean;
  }
}

const TURNSTILE_SCRIPT_ID = "cf-turnstile-script";
const TURNSTILE_CDN = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_turnstileOnLoad&render=explicit";

type ScriptStatus = "idle" | "loading" | "loaded" | "error";

let scriptStatus: ScriptStatus = "idle";
const readyCallbacks = new Set<() => void>();
const failCallbacks = new Set<() => void>();

function flushReady(): void {
  scriptStatus = "loaded";
  for (const cb of [...readyCallbacks]) {
    readyCallbacks.delete(cb);
    failCallbacks.delete(cb);
    cb();
  }
}

function flushFailure(): void {
  scriptStatus = "error";
  for (const cb of [...failCallbacks]) {
    readyCallbacks.delete(cb);
    failCallbacks.delete(cb);
    cb();
  }
}

function loadTurnstileScript(onReady: () => void, onFail: () => void): void {
  if (scriptStatus === "loaded" && window.turnstile) {
    onReady();
    return;
  }

  readyCallbacks.add(onReady);
  failCallbacks.add(onFail);

  if (scriptStatus === "error") {
    failCallbacks.delete(onFail);
    onFail();
    return;
  }

  if (scriptStatus === "loading") {
    // Script tag already in flight; wait for its onload/onerror to flush queues.
    return;
  }

  scriptStatus = "loading";

  // Define the global onload callback before inserting the script
  (window as Window & { _turnstileOnLoad?: () => void })._turnstileOnLoad = () => {
    window._turnstileLoaded = true;
    flushReady();
  };

  const script = document.createElement("script");
  script.id = TURNSTILE_SCRIPT_ID;
  script.src = TURNSTILE_CDN;
  script.async = true;
  script.defer = true;
  script.addEventListener("error", flushFailure);
  script.addEventListener("load", () => {
    // onload= query param normally fires first; this is a safety net if the
    // global callback never ran (e.g. script blocked by an intermediary).
    if (scriptStatus === "loading") {
      if (window.turnstile) flushReady();
      else flushFailure();
    }
  });
  document.head.appendChild(script);
}

/** Reset module-level load state so a retry can re-attempt fetching the script. Exported for tests. */
export function __resetTurnstileScriptStateForTests(): void {
  scriptStatus = "idle";
  readyCallbacks.clear();
  failCallbacks.clear();
  document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
}

export function TurnstileWidget({
  siteKey,
  onToken,
  onExpire,
  onError,
  onScriptError,
  resetNonce = 0,
  theme = "auto",
}: TurnstileWidgetProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const [challengeError, setChallengeError] = React.useState(false);
  const [scriptError, setScriptError] = React.useState(false);
  const [retryNonce, setRetryNonce] = React.useState(0);

  React.useEffect(() => {
    if (!siteKey) return;
    const container = containerRef.current;
    if (!container) return;

    let mounted = true;

    const handleFailure = () => {
      if (!mounted) return;
      setScriptError(true);
      onScriptError?.();
    };

    loadTurnstileScript(() => {
      if (!mounted || !container || !window.turnstile) {
        handleFailure();
        return;
      }
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token: string) => {
          if (mounted) {
            setChallengeError(false);
            onToken(token);
          }
        },
        "expired-callback": () => {
          if (!mounted) return;
          setChallengeError(true);
          if (onExpire) onExpire();
        },
        "error-callback": () => {
          if (!mounted) return;
          setChallengeError(true);
          if (onError) onError();
        },
        theme,
        size: "normal",
      });
    }, handleFailure);

    return () => {
      mounted = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore removal errors during cleanup
        }
      }
      widgetIdRef.current = null;
    };
    // onToken/onExpire/onError/onScriptError should not be listed: they are
    // inline functions that change identity every render; siteKey and theme are
    // stable config. resetNonce/retryNonce intentionally re-trigger rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, theme, resetNonce, retryNonce]);

  if (scriptError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-2 rounded-xl border border-error/30 bg-error/10 p-3 text-center"
      >
        <p className="text-[13px] text-error">
          Verifikasi keamanan gagal dimuat. Periksa koneksi atau pemblokir iklan Anda, lalu coba lagi.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setScriptError(false);
            __resetTurnstileScriptStateForTests();
            setRetryNonce((n) => n + 1);
          }}
        >
          Muat ulang verifikasi
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={containerRef}
        aria-label="Verifikasi keamanan Cloudflare Turnstile"
      />
      {challengeError && (
        <p className="text-[12px] text-warning">
          Verifikasi keamanan kedaluwarsa atau gagal. Selesaikan ulang tantangan sebelum melanjutkan.
        </p>
      )}
    </div>
  );
}
