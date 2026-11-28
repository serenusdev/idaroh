import { describe, expect, it } from "vitest";
import { errorToMessage } from "@/lib/action-error";

describe("error serialization", () => {
  it.each([
    new Error("Koneksi gagal"),
    "Pesan biasa",
    { message: "Pesan objek" },
    { error: { message: "Pesan nested" } },
    { code: "23505", message: "duplicate key" },
    null,
    { unexpected: true },
  ])("never leaks object serialization for %j", (value) => {
    const message = errorToMessage(value);
    expect(message).not.toContain("[object Object]");
    expect(message).not.toMatch(/password|select .* from|postgres/i);
  });
});
