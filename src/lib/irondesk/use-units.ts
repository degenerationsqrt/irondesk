import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-provider";

import { accountQuery } from "./queries";
import type { Units } from "./units";

/** Preferred display units for the current viewer (demo defaults to metric). */
export function useUnits(): Units {
  const { mode } = useAuth();
  const { data } = useQuery({ ...accountQuery, enabled: mode === "live" });
  return data?.preferences?.units === "imperial" ? "imperial" : "metric";
}
