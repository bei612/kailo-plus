import { useCallback, useEffect, useState } from "react";

// Buzz 779af8886caae1317b4de962082429867ab61503 ThemeProvider preference.
export const PROMINENT_ACTIVE_TAB_STORAGE_KEY = "buzz-prominent-active-tab";
export const DEFAULT_PROMINENT_ACTIVE_TAB = false;

export function useProminentActiveTab(buzzTheme: boolean) {
  const [prominentActiveTab, setProminentActiveTabState] = useState(() => {
    try {
      const stored = window.localStorage.getItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY);
      return stored === null ? DEFAULT_PROMINENT_ACTIVE_TAB : stored === "true";
    } catch {
      // Preserve Buzz's safe initial read on storage-restricted origins.
      return DEFAULT_PROMINENT_ACTIVE_TAB;
    }
  });

  useEffect(() => {
    document.documentElement.toggleAttribute(
      "data-prominent-active-tab",
      prominentActiveTab && buzzTheme,
    );
  }, [buzzTheme, prominentActiveTab]);

  const setProminentActiveTab = useCallback((enabled: boolean) => {
    window.localStorage.setItem(
      PROMINENT_ACTIVE_TAB_STORAGE_KEY,
      enabled ? "true" : "false",
    );
    setProminentActiveTabState(enabled);
  }, []);

  return { prominentActiveTab, setProminentActiveTab };
}
