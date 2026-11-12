import { describe, expect, it, vi } from "vitest";
import { cachedFetch, hasCache, invalidateCache, onInvalidate, readCache, writeCache } from "@/lib/data-cache";

describe("data-cache", () => {
  it("stores fetched data and reports cache presence", async () => {
    const data = await cachedFetch("test:store", async () => ({ value: 1 }));
    expect(data).toEqual({ value: 1 });
    expect(hasCache("test:store")).toBe(true);
    expect(readCache("test:store")).toEqual({ value: 1 });
  });

  it("deduplicates concurrent fetches for the same key", async () => {
    let resolveFetch: (value: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>((resolve) => { resolveFetch = resolve; }));
    const first = cachedFetch("test:dedup", fetcher);
    const second = cachedFetch("test:dedup", fetcher);
    resolveFetch("ok");
    expect(await first).toBe("ok");
    expect(await second).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fetches again after the previous request settled", async () => {
    const fetcher = vi.fn(async () => "fresh");
    await cachedFetch("test:refetch", fetcher);
    await cachedFetch("test:refetch", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures and allows retry", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("recovered");
    await expect(cachedFetch("test:failure", fetcher)).rejects.toThrow("offline");
    expect(hasCache("test:failure")).toBe(false);
    expect(await cachedFetch("test:failure", fetcher)).toBe("recovered");
  });

  it("caches undefined results as present entries", async () => {
    await cachedFetch("test:undefined", async () => undefined);
    expect(hasCache("test:undefined")).toBe(true);
    expect(readCache("test:undefined")).toBeUndefined();
  });

  it("invalidateCache removes only matching prefixes and notifies listeners", async () => {
    writeCache("inv:attendance:history", [1]);
    writeCache("inv:attendance:policy", { name: "p" });
    writeCache("inv:tasks", [2]);
    const listener = vi.fn();
    const unsubscribe = onInvalidate(listener);
    invalidateCache("inv:attendance");
    expect(hasCache("inv:attendance:history")).toBe(false);
    expect(hasCache("inv:attendance:policy")).toBe(false);
    expect(hasCache("inv:tasks")).toBe(true);
    expect(listener).toHaveBeenCalledWith("inv:attendance");
    unsubscribe();
    invalidateCache("inv:");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasCache("inv:tasks")).toBe(false);
  });

  it("invalidateCache without prefix clears everything", () => {
    writeCache("global:a", 1);
    writeCache("global:b", 2);
    invalidateCache();
    expect(hasCache("global:a")).toBe(false);
    expect(hasCache("global:b")).toBe(false);
  });
});