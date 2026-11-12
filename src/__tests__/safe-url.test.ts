import { describe, expect, it } from "vitest";
import { toSafeInternalPath } from "@/lib/safe-url";

describe("toSafeInternalPath", () => {
  it.each([null, undefined, "", "https://example.test/a", "//example.test/a", "/\\example.test/a", "javascript:alert(1)", "data:text/html,test", "relative/path"]) ("rejects unsafe target %s", (target) => {
    expect(toSafeInternalPath(target)).toBeNull();
  });

  it.each(["/", "/tugas?task=abc#detail", "/jadwal?announcement=123", "/notifikasi"]) ("preserves internal target %s", (target) => {
    expect(toSafeInternalPath(target)).toBe(target);
  });
});
