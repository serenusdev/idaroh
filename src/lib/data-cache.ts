type CacheEntry = { data: unknown; updatedAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<(prefix: string) => void>();

export function readCache<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function hasCache(key: string): boolean {
  return cache.has(key);
}

export function writeCache<T>(key: string, data: T): void {
  cache.set(key, { data, updatedAt: Date.now() });
}

export function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = fetcher()
    .then((data) => {
      writeCache(key, data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export function invalidateCache(prefix = ""): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const listener of listeners) listener(prefix);
}

export function onInvalidate(listener: (prefix: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}