import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredReviewCommand,
  localCommandDigest,
  readStoredReviewCommand,
  resolveReviewCommand,
  reviewCommandFingerprint,
  reviewCommandStorageKey,
  storeReviewCommand,
} from "@/modules/reports/review-command-storage";

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  raw(key: string) { return this.map.get(key); }
}

const identity = {
  actorId: "reviewer-1",
  reportId: "rep-1",
  revisionNo: 1,
  decision: "approved",
  notes: "catatan review",
};

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  vi.stubGlobal("sessionStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review command storage (Task D)", () => {
  it("mints a key for a new intentional command and persists it", () => {
    const first = resolveReviewCommand(identity, null);
    storeReviewCommand(first.storageKey, {
      fingerprint: first.fingerprint,
      idempotencyKey: first.idempotencyKey,
    });
    expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(readStoredReviewCommand(first.storageKey)).toEqual({
      fingerprint: first.fingerprint,
      idempotencyKey: first.idempotencyKey,
    });
  });

  it("recovers the same key after a simulated refresh (memory lost, storage intact)", () => {
    const first = resolveReviewCommand(identity, null);
    storeReviewCommand(first.storageKey, {
      fingerprint: first.fingerprint,
      idempotencyKey: first.idempotencyKey,
    });
    const afterRefresh = resolveReviewCommand(identity, null);
    expect(afterRefresh.idempotencyKey).toBe(first.idempotencyKey);
    expect(afterRefresh.storageKey).toBe(first.storageKey);
  });

  it("reuses the in-flight memory key for the exact same command (double-click)", () => {
    const first = resolveReviewCommand(identity, null);
    const second = resolveReviewCommand(identity, {
      fingerprint: first.fingerprint,
      idempotencyKey: first.idempotencyKey,
    });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("mints a new key when the notes change", () => {
    const first = resolveReviewCommand(identity, null);
    const changed = resolveReviewCommand({ ...identity, notes: "catatan berbeda" }, null);
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("scopes keys to the actor, report, revision, and decision", () => {
    const base = resolveReviewCommand(identity, null);
    for (const variant of [
      { ...identity, actorId: "reviewer-2" },
      { ...identity, reportId: "rep-2" },
      { ...identity, revisionNo: 2 },
      { ...identity, decision: "revision_required" },
    ]) {
      const other = resolveReviewCommand(variant, null);
      expect(other.storageKey).not.toBe(base.storageKey);
      expect(other.idempotencyKey).not.toBe(base.idempotencyKey);
    }
  });

  it("does not store raw notes, only a digest fingerprint and the key", () => {
    const first = resolveReviewCommand(identity, null);
    storeReviewCommand(first.storageKey, {
      fingerprint: first.fingerprint,
      idempotencyKey: first.idempotencyKey,
    });
    const raw = storage.raw(first.storageKey) ?? "";
    expect(raw).not.toContain(identity.notes);
    expect(raw).toContain(localCommandDigest(identity.notes));
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(["fingerprint", "idempotencyKey"]);
  });

  it("clears the stored command at the success lifecycle boundary", () => {
    const first = resolveReviewCommand(identity, null);
    storeReviewCommand(first.storageKey, {
      fingerprint: first.fingerprint,
      idempotencyKey: first.idempotencyKey,
    });
    clearStoredReviewCommand(first.storageKey);
    expect(readStoredReviewCommand(first.storageKey)).toBeNull();
    const next = resolveReviewCommand(identity, null);
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("handles blocked storage safely: no throw, memory-only fallback", () => {
    vi.stubGlobal("sessionStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    });
    const first = resolveReviewCommand(identity, null);
    expect(first.idempotencyKey).toBeTruthy();
    // Honest limitation: with storage blocked AND memory lost (refresh),
    // recovery is impossible and a new intentional key is minted.
    const afterRefresh = resolveReviewCommand(identity, null);
    expect(afterRefresh.idempotencyKey).not.toBe(first.idempotencyKey);
    // Within the same page life, the memory ref still deduplicates.
    const sameLife = resolveReviewCommand(identity, {
      fingerprint: first.fingerprint,
      idempotencyKey: first.idempotencyKey,
    });
    expect(sameLife.idempotencyKey).toBe(first.idempotencyKey);
    expect(() => storeReviewCommand(first.storageKey, first)).not.toThrow();
    expect(() => clearStoredReviewCommand(first.storageKey)).not.toThrow();
  });

  it("ignores corrupted stored payloads and mints a fresh key", () => {
    const key = reviewCommandStorageKey(identity);
    storage.setItem(key, "{not-json");
    const resolved = resolveReviewCommand(identity, null);
    expect(resolved.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    storage.setItem(key, JSON.stringify({ fingerprint: 42, idempotencyKey: null }));
    expect(readStoredReviewCommand(key)).toBeNull();
  });

  it("fingerprint and storage key are deterministic for the same identity", () => {
    expect(reviewCommandFingerprint(identity)).toBe(reviewCommandFingerprint({ ...identity }));
    expect(reviewCommandStorageKey(identity)).toBe(reviewCommandStorageKey({ ...identity }));
    expect(reviewCommandStorageKey(identity)).toContain(encodeURIComponent("reviewer-1:rep-1:1:approved"));
  });
});