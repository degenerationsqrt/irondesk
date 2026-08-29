import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-provider";

import { accountQuery } from "./queries";
import { DEFAULT_UNITS, resolveUnits, type Units } from "./units";

/** Preferred display units for the current viewer (demo/new accounts default to pounds). */
export function useUnits(): Units {
  const { mode } = useAuth();
  const { data } = useQuery({ ...accountQuery, enabled: mode === "live" });
  if (mode !== "live") return DEFAULT_UNITS;
  return resolveUnits(data?.preferences?.units);
}
