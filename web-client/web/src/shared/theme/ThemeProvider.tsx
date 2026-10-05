import { createContext, useContext, useState, type ReactNode } from "react";
import { migrateWebThemePreference, useAppearance, type Appearance } from "@client-kit/platform/theme/use-appearance";
const ThemeContext = createContext<Appearance | undefined>(undefined);
export function ThemeProvider({ children }: { children: ReactNode }) {
  useState(migrateWebThemePreference);
  const preview = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("previewTheme") : null;
  const appearance = useAppearance({ previewTheme: preview === "light" || preview === "dark" ? preview : undefined });
  return <ThemeContext.Provider value={appearance}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
