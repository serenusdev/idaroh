import { describe, it, expect } from "vitest";
import { cn, formatOperationalDateTime, formatTimeWIB } from "@/lib/utils";

describe("Utility functions", () => {
  it("merges classes with tailwind-merge correctly", () => {
    const result = cn("p-4 bg-white", "p-6", { "text-primary": true, "text-red-500": false });
    expect(result).toBe("bg-white p-6 text-primary");
  });

  it("formats operational date time in Indonesian WIB format", () => {
    const testDate = new Date("2026-11-18T00:42:00.000Z"); // 07:42 Asia/Jakarta
    const formatted = formatOperationalDateTime(testDate);
    expect(formatted).toContain("Nov 2026");
    expect(formatted).toContain("07:42 WIB");
  });

  it("formats time in WIB format", () => {
    const testDate = new Date("2026-11-18T01:15:00.000Z"); // 08:15 Asia/Jakarta
    const formatted = formatTimeWIB(testDate);
    expect(formatted).toBe("08:15 WIB");
  });
});

