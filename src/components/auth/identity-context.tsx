"use client";

import * as React from "react";
import type { UserProfile } from "@/lib/auth/types";
import { getCurrentUserAction } from "@/modules/iam/actions";

interface IdentityContextValue {
  user: UserProfile;
  refresh: () => Promise<UserProfile | null>;
}

const IdentityContext = React.createContext<IdentityContextValue | null>(null);

export function IdentityProvider({
  initialUser,
  children,
}: {
  initialUser: UserProfile;
  children: React.ReactNode;
}) {
  const [user, setUser] = React.useState(initialUser);

  // The server layout re-resolves identity on navigation; keep the client in sync.
  React.useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

  const refresh = React.useCallback(async () => {
    const fresh = await getCurrentUserAction();
    if (fresh) setUser(fresh);
    return fresh;
  }, []);

  const value = React.useMemo(() => ({ user, refresh }), [user, refresh]);
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const context = React.useContext(IdentityContext);
  if (!context) throw new Error("useIdentity must be used within IdentityProvider");
  return context;
}