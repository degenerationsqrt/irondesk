import { createContext, useContext } from "react";

export interface PwaContextValue {
  installed: boolean;
  installControlVisible: boolean;
  openInstall: () => Promise<void>;
}

export const PwaContext = createContext<PwaContextValue>({
  installed: false,
  installControlVisible: false,
  openInstall: async () => undefined,
});

export function usePwaInstall() {
  return useContext(PwaContext);
}
