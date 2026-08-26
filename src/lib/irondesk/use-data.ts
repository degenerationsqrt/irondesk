import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/lib/auth/auth-provider";

import type { ServiceMode } from "./service";

/** Resolves which data source the current visitor should read from. */
export function useServiceMode(): ServiceMode {
  const { mode } = useAuth();
  return mode === "live" ? "live" : "demo";
}

interface ModeQueryOptions<T> {
  queryKey: readonly unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFn?: (context: any) => Promise<T> | T;
}

/** Suspense read through the mode-aware service boundary. */
export function useModeData<T>(factory: (mode: ServiceMode) => ModeQueryOptions<T>): T {
  const mode = useServiceMode();
  const options = factory(mode);
  return useSuspenseQuery({
    queryKey: options.queryKey,
    queryFn: options.queryFn as () => Promise<T>,
  }).data;
}

/** Invalidates every IronDesk read after a write. */
export function useIronDeskInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["irondesk"] });
  }, [queryClient]);
}
