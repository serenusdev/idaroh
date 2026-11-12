"use client";

import * as React from "react";
import { cachedFetch, hasCache, onInvalidate, readCache } from "@/lib/data-cache";

type CachedState<T> = {
  key: string | null;
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
};

function initialState<T>(key: string | null): CachedState<T> {
  const cached = key !== null && hasCache(key);
  return { key, data: cached ? readCache<T>(key) : undefined, error: null, isLoading: !cached && key !== null };
}

export function useCachedData<T>(key: string | null, fetcher: () => Promise<T>) {
  const [state, setState] = React.useState<CachedState<T>>(() => initialState(key));
  // Key changed since last render: reseed synchronously so a new scope never
  // flashes the previous scope's data.
  if (state.key !== key) setState(initialState(key));

  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;
  const activeKeyRef = React.useRef(key);
  activeKeyRef.current = key;

  const revalidate = React.useCallback(async (requestKey: string, showLoading: boolean): Promise<T | undefined> => {
    if (showLoading) {
      setState((current) => (current.key === requestKey ? { ...current, isLoading: true, error: null } : current));
    }
    try {
      const data = await cachedFetch(requestKey, () => fetcherRef.current());
      if (activeKeyRef.current !== requestKey) return data;
      setState({ key: requestKey, data, error: null, isLoading: false });
      return data;
    } catch (err) {
      if (activeKeyRef.current !== requestKey) return undefined;
      const error = err instanceof Error ? err : new Error(String(err));
      setState((current) => (current.key === requestKey ? { ...current, error, isLoading: false } : current));
      return undefined;
    }
  }, []);

  React.useEffect(() => {
    if (key === null) return;
    if (hasCache(key)) {
      setState({ key, data: readCache<T>(key), error: null, isLoading: false });
    }
    void revalidate(key, !hasCache(key));
    return onInvalidate((prefix) => {
      if (!key.startsWith(prefix)) return;
      void revalidate(key, !hasCache(key));
    });
  }, [key, revalidate]);

  const refresh = React.useCallback((): Promise<T | undefined> => {
    if (key === null) return Promise.resolve(undefined);
    return revalidate(key, !hasCache(key));
  }, [key, revalidate]);

  return { data: state.data, error: state.error, isLoading: state.isLoading, refresh };
}