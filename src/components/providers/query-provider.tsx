"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const DEFAULT_OPTIONS = {
  queries: {
    // Every read is a Server Action evaluated under RLS, so freshness is bounded by the
    // session, not by the row. 30s keeps back-navigation instant — what the manual data-cache
    // gave — without trusting a response from a minute ago.
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    // use-cached-data.ts refetched on window focus and on the "online" event; same recovery.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  },
  // A mutation is an RPC that already committed and wrote its audit row; replaying it is unsafe.
  mutations: { retry: 0 },
};

/**
 * CACHE-01: the client-side cache layer that replaces `useCachedData` surface by surface.
 *
 * The client is built inside `useState`, never at module scope: on a server runtime a shared
 * client would hand one session's rows to the next request. `AppShell` mounts this provider with
 * `key={user.id}:{user.role}`, so signing out or switching account unmounts the subtree and the
 * whole cache goes with it instead of waiting for gcTime.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: DEFAULT_OPTIONS }));

  React.useEffect(() => {
    return () => client.clear();
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
