import { type PlatformThemeMode, platformThemeModeKeys } from "@client-kit/platform/i18n";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

type Theme = PlatformThemeMode;

type ThemeContextValue = {
  theme: Theme;
  isDark: boolean;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getInitialTheme(): Theme {
  const stored = window.localStorage.getItem("buzz-web-theme");
  if (stored && Object.keys(platformThemeModeKeys).includes(stored)) return stored as Theme;
  const previewTheme = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("previewTheme")
    : null;
  return previewTheme === "light" || previewTheme === "dark" ? previewTheme : "system";
}

function applyClass(isDark: boolean) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(isDark ? "dark" : "light");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [isDark, setIsDark] = useState<boolean>(() => {
    const initialTheme = getInitialTheme();
    const dark = initialTheme === "system" ? getSystemDark() : initialTheme === "dark";
    applyClass(dark);
    return dark;
  });

  useEffect(() => {
    const dark = theme === "system" ? getSystemDark() : theme === "dark";
    applyClass(dark);
    setIsDark(dark);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      applyClass(e.matches);
      setIsDark(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    window.localStorage.setItem("buzz-web-theme", t);
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, isDark, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
