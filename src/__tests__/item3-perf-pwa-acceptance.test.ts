import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getVersion } from "@/app/api/version/route";
import { isPublicRoute } from "@/lib/supabase/middleware";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("Item 3 — Performance/SWR/Realtime, Font, Android/PWA & Acceptance Matrix", () => {
  it("exposes public /api/version with no-store headers and no secrets", async () => {
    expect(isPublicRoute("/api/version")).toBe(true);
    const res = await getVersion();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.app).toBe("idaroh");
    expect(typeof body.version).toBe("string");
    expect(typeof body.buildId).toBe("string");
    expect(body.swCache).toBe("idaroh-shell-v4");
  });

  it("wires SWR focus/online revalidation and scoped Realtime notification cleanup", () => {
    const swr = read("src/hooks/use-cached-data.ts");
    const realtime = read("src/components/notifications/use-notification-changes.ts");

    expect(swr).toContain('window.addEventListener("focus"');
    expect(swr).toContain('window.addEventListener("online"');
    expect(realtime).toContain("postgres_changes");
    expect(realtime).toContain("user_id=eq.${userId}");
    expect(realtime).toContain("removeChannel");
  });

  it("keeps PWA update prompt, offline shell, local font preloads, and HTTPS-only Capacitor config", () => {
    const pwa = read("src/components/pwa-register.tsx");
    const sw = read("public/sw.js");
    const layout = read("src/app/layout.tsx");
    const cap = read("capacitor.config.ts");
    const traceability = read("docs/audit/PRD-TRACEABILITY.md");

    expect(pwa).toContain('updateViaCache: "none"');
    expect(pwa).toContain("SKIP_WAITING");
    expect(sw).toContain('"/offline"');
    expect(sw).toContain("clients.claim()");
    expect(layout).toContain("/fonts/hanken-grotesk-latin-variable.woff2");
    expect(layout).toContain("/fonts/ibm-plex-mono-latin-400.woff2");
    expect(layout).toContain("/fonts/material-symbols-outlined-subset.woff2");
    expect(cap).toContain("cleartext: false");
    expect(cap).toContain("androidScheme: 'https'");
    expect(traceability).toContain("Rekonsiliasi Bukti Gelombang 1–3");
  });
});
