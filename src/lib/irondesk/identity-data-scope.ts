import { QueryClient } from "@tanstack/react-query";

/** Access tokens rotate; the account identity and effective data mode define ownership. */
export function dataScopeKey(userId: string | null, demo: boolean): string {
  return userId ? `user:${userId}` : demo ? "demo" : "anonymous";
}

/**
 * A cache belongs to one mounted auth scope, never to the lifetime of the router.
 * Feature keys can stay stable within that scope, including private imports and
 * account queries that do not pass through the mode-aware service.
 */
export function createIdentityDataScope() {
  const queryClient = new QueryClient();
  return {
    queryClient,
    dispose() {
      // clear() destroys/cancels active queries as well as removing their data.
      // Even a transport that ignores cancellation only owns the retired cache.
      queryClient.clear();
    },
  };
}
