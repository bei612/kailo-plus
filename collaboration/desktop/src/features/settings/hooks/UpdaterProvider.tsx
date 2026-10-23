// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/hooks/UpdaterProvider.tsx.
import { createContext, useContext, type ReactNode } from "react";
import { useUpdater } from "./use-updater";

type UpdaterContextValue = ReturnType<typeof useUpdater>;

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const updater = useUpdater();
  return <UpdaterContext value={updater}>{children}</UpdaterContext>;
}

/** For surfaces that may render outside the app root (isolated views, tests): no provider, no updates UI. */
export function useOptionalUpdaterContext(): UpdaterContextValue | null {
  return useContext(UpdaterContext);
}

export function useUpdaterContext(): UpdaterContextValue {
  const ctx = useContext(UpdaterContext);
  if (!ctx) {
    throw new Error("useUpdaterContext must be used within an UpdaterProvider");
  }
  return ctx;
}
