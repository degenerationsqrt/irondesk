import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/lib/auth/auth-provider";
import { createIdentityDataScope, dataScopeKey } from "@/lib/irondesk/identity-data-scope";

/**
 * Switching accounts or entering/leaving demo remounts every data consumer.
 * That isolates query caches, mutation observers, form drafts, and queue views
 * before the next identity renders. Token refresh keeps the same scope.
 */
export function IdentityDataBoundary({ children }: { children: ReactNode }) {
  const { user, demo } = useAuth();
  return <MountedDataScope key={dataScopeKey(user?.id ?? null, demo)}>{children}</MountedDataScope>;
}

function MountedDataScope({ children }: { children: ReactNode }) {
  const [scope] = useState(createIdentityDataScope);
  useEffect(() => () => scope.dispose(), [scope]);
  return <QueryClientProvider client={scope.queryClient}>{children}</QueryClientProvider>;
}
