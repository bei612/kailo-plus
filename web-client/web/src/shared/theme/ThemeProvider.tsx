import { type PlatformThemeMode, platformThemeModeKeys } from "@client-kit/platform/i18n";
import {
  applyNeutralThemeAccent,
  createThemeVars,
} from "@client-kit/platform/theme/adaptive-theme";
import {
  BUZZ_DARK_THEME_NAME,
  BUZZ_THEME_NAME,
  extractThemeInfo,
  loadThemeData,
} from "@client-kit/platform/theme/theme-loader";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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

async function applyClass(isDark: boolean, isCurrent: () => boolean): Promise<void> {
  const name = isDark ? BUZZ_DARK_THEME_NAME : BUZZ_THEME_NAME;
  const themeData = await loadThemeData(name);
  if (!isCurrent()) return;

  const info = extractThemeInfo(name, themeData);
  const { vars } = createThemeVars(info.bg, info.fg, info.comment, {
    added: info.added,
    deleted: info.deleted,
    modified: info.modified,
  });
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  applyNeutralThemeAccent(root);
  root.classList.remove("light", "dark");
  root.classList.add(isDark ? "dark" : "light");
  root.setAttribute("data-buzz-sidebar", "");
  root.setAttribute("data-buzz-theme", name);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [systemIsDark, setSystemIsDark] = useState(getSystemDark);
  const [themeError, setThemeError] = useState<unknown>(null);
  const generation = useRef(0);
  const isDark = theme === "system" ? systemIsDark : theme === "dark";

  useEffect(() => {
    const request = ++generation.current;
    const isCurrent = () => request === generation.current;
    void applyClass(isDark, isCurrent).catch((error: unknown) => {
      if (isCurrent()) setThemeError(() => error);
    });
    return () => {
      if (isCurrent()) generation.current++;
    };
  }, [isDark]);

  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };
    setSystemIsDark(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    window.localStorage.setItem("buzz-web-theme", t);
    setThemeState(t);
  }, []);

  if (themeError !== null) throw themeError;

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
