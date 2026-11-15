import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import configuration from "../../next.config.mjs";

// FUNC-03: pdf.ts reads the WOFF2 at runtime via readFile, which Next's output
// tracing cannot detect. Without an explicit include the font is missing from
// the Vercel serverless bundle and PDF export fails in production.
describe("FUNC-03 — PDF font bundled for serverless", () => {
  it("includes the runtime WOFF2 in output file tracing for all routes", () => {
    const config = configuration("phase-development-server") as {
      outputFileTracingIncludes?: Record<string, string[]>;
    };
    const includes = config.outputFileTracingIncludes?.["/*"] ?? [];
    expect(includes.some((entry) => entry.includes("noto-sans-latin-ext-400-normal.woff2"))).toBe(true);
  });

  it("font file exists at the path pdf.ts reads at runtime", () => {
    const fontPath = path.join(
      process.cwd(),
      "node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2",
    );
    expect(existsSync(fontPath)).toBe(true);
  });
});