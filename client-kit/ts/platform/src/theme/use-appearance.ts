// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503.
// Native window effects remain in the Desktop host.
import { useCallback, useEffect, useRef, useState } from "react";
import { getStorageItem, removeStorageItem } from "./safe-storage";
import { useProminentActiveTab } from "./prominent-active-tab";
import { applyNeutralThemeAccent, createThemeVars, hexToHsl } from "./adaptive-theme";
import { SYNTAX_THEMES, type SyntaxThemeName, extractThemeInfo, getThemePair, loadThemeData, resolveSystemTheme } from "./theme-loader";
export const THEME_STORAGE_KEY = "buzz-theme";
const CACHE_KEY = "buzz-theme-cache";
export const ACCENT_STORAGE_KEY = "buzz-accent-color";
export const NEUTRAL_ACCENT = "neutral";
const FOLLOW_SYSTEM_KEY = "buzz-follow-system";
const VIDEO_REVIEW_CHIP_SURFACE = "#161616";
const VIDEO_REVIEW_TEXT_CONTRAST = 4.5;
const VIDEO_REVIEW_CHIP_BACKGROUND_ALPHAS = [0.15, 0.3] as const;

export const ACCENT_COLORS = [
  { name: "Neutral", value: NEUTRAL_ACCENT },
  { name: "Blue", value: "#3b82f6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Lilac", value: "#c0a2f1" },
  { name: "Purple", value: "#a855f7" },
  { name: "Indigo", value: "#6366f1" },
] as const;

const DEFAULT_ACCENT = "#3b82f6";

function isValidThemeName(name: string): name is SyntaxThemeName {
  return (SYNTAX_THEMES as readonly string[]).includes(name);
}

/** Read stored theme, migrating legacy "light"/"dark"/"system" values. */
function readStoredTheme(fallback: SyntaxThemeName): SyntaxThemeName {
  // block/buzz#5078 — WebKit throws SecurityError from getItem under a
  // denied-storage origin; the throw-safe helper lets the provider degrade to
  // the fallback instead of unmounting the root during first render.
  const stored = getStorageItem(THEME_STORAGE_KEY);
  if (!stored) return fallback;

  // Migrate legacy values
  if (stored === "light") return "catppuccin-latte";
  if (stored === "dark" || stored === "system") return "houston";

  return isValidThemeName(stored) ? stored : fallback;
}

function getContrastColor(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
  if (!m) return "#ffffff";
  const r = parseInt(m[1]!, 16);
  const g = parseInt(m[2]!, 16);
  const b = parseInt(m[3]!, 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? "#000000" : "#ffffff";
}

type Rgb = {
  r: number;
  g: number;
  b: number;
};

function hexToRgb(hex: string): Rgb {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(m[1]!, 16),
    g: parseInt(m[2]!, 16),
    b: parseInt(m[3]!, 16),
  };
}

function mixRgb(from: Rgb, to: Rgb, factor: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * factor,
    g: from.g + (to.g - from.g) * factor,
    b: from.b + (to.b - from.b) * factor,
  };
}

function compositeRgb(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return mixRgb(background, foreground, alpha);
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const aLum = relativeLuminance(a);
  const bLum = relativeLuminance(b);
  return (Math.max(aLum, bLum) + 0.05) / (Math.min(aLum, bLum) + 0.05);
}

function getReviewAccentForeground(hex: string): string {
  const accent = hexToRgb(hex);
  const surface = hexToRgb(VIDEO_REVIEW_CHIP_SURFACE);
  const white = { r: 255, g: 255, b: 255 };
  const backgrounds = VIDEO_REVIEW_CHIP_BACKGROUND_ALPHAS.map((alpha) =>
    compositeRgb(accent, surface, alpha),
  );
  let low = 0;
  let high = 1;

  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    const candidate = mixRgb(accent, white, mid);
    const minContrast = Math.min(
      ...backgrounds.map((background) => contrastRatio(candidate, background)),
    );

    if (minContrast >= VIDEO_REVIEW_TEXT_CONTRAST) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return hexToHsl(rgbToHex(mixRgb(accent, white, high)));
}

function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b]
    .map((channel) => clamp(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function applyAccentColor(value: string) {
  const root = document.documentElement;
  if (value === NEUTRAL_ACCENT) {
    applyNeutralThemeAccent(root);
    return;
  }

  const hex = value;
  const accentHsl = hexToHsl(hex);
  const fgHsl = hexToHsl(getContrastColor(hex));
  root.style.setProperty("--buzz-selected-accent", accentHsl);
  root.style.setProperty("--buzz-video-review-accent", accentHsl);
  root.style.setProperty(
    "--buzz-video-review-accent-foreground",
    getReviewAccentForeground(hex),
  );
  root.style.setProperty("--primary", accentHsl);
  root.style.setProperty("--primary-foreground", fgHsl);
  root.style.setProperty("--sidebar-primary", accentHsl);
  root.style.setProperty("--sidebar-primary-foreground", fgHsl);
  root.style.setProperty("--sidebar-active", accentHsl);
  root.style.setProperty("--sidebar-active-foreground", fgHsl);
}

/**
 * The Buzz themes ship with a fixed neutral accent (the GitHub black/white
 * foreground) rather than a user-selectable accent color. When a Buzz theme is
 * active we force `NEUTRAL_ACCENT` regardless of the stored preference, and the
 * appearance panel hides the accent picker. The user's chosen accent is left
 * untouched in storage so it returns when they switch back to another theme.
 */
export function isBuzzTheme(themeName: string): boolean {
  return themeName === "buzz" || themeName === "buzz-dark";
}

/**
 * Resolve the accent to actually apply for a theme: Buzz themes are pinned to
 * the neutral accent; every other theme uses the stored/selected accent.
 */
function resolveEffectiveAccent(
  themeName: string,
  accentColor: string,
): string {
  return isBuzzTheme(themeName) ? NEUTRAL_ACCENT : accentColor;
}

/** Toggle the Buzz-specific gradient marker independently from glass. */
function applyBuzzSidebar(themeName: string) {
  const root = document.documentElement;
  if (isBuzzTheme(themeName)) {
    root.setAttribute("data-buzz-sidebar", "");
    // Keep the concrete Buzz variant on the root as well as the generic
    // marker. The gradient stylesheet matches this attribute directly, which
    // makes WKWebView invalidate the painted background when light/dark mode
    // changes instead of relying only on a custom-property dependency update.
    root.setAttribute("data-buzz-theme", themeName);
  } else {
    root.removeAttribute("data-buzz-sidebar");
    root.removeAttribute("data-buzz-theme");
  }
}

/** Apply cached CSS vars synchronously to prevent FOUC. */
function applyCachedVars(onThemeApplied?: () => void): string | null {
  try {
    const cached = window.localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const { themeName, vars, isDark } = JSON.parse(cached);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value as string);
    }
    root.classList.remove("light", "dark");
    root.classList.add(isDark ? "dark" : "light");
    applyBuzzSidebar(themeName);
    onThemeApplied?.();

    const accent = getStorageItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT;
    // Pin Buzz themes to the neutral accent here too, matching applyTheme.
    // Otherwise a cached Buzz theme + non-neutral stored accent flashes the
    // old accent on reload until the async applyTheme effect runs.
    applyAccentColor(resolveEffectiveAccent(themeName, accent));

    return themeName;
  } catch {
    return null;
  }
}

/** The latest theme load is the only one allowed to write document styles. */
let themeApplyRequest = 0;

/** Apply a theme: load data, derive CSS vars, set them on :root. */
async function applyTheme(
  name: SyntaxThemeName,
  onThemeApplied?: () => void,
  isCurrent: () => boolean = () => true,
): Promise<{ isDark: boolean } | null> {
  const requestToken = ++themeApplyRequest;
  const themeData = await loadThemeData(name);
  if (requestToken !== themeApplyRequest || !isCurrent()) return null;

  const info = extractThemeInfo(name, themeData);
  const { isDark, vars } = createThemeVars(info.bg, info.fg, info.comment, {
    added: info.added,
    deleted: info.deleted,
    modified: info.modified,
  });

  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  root.classList.remove("light", "dark");
  root.classList.add(isDark ? "dark" : "light");
  applyBuzzSidebar(name);
  onThemeApplied?.();

  // Apply the accent synchronously in the same batch as the theme vars so the
  // browser paints the new theme + accent together. Doing this in a later
  // microtask (e.g. the caller's `.then`) let the previous accent flash on the
  // new theme for a frame — the flicker seen when switching to Buzz. Buzz
  // themes resolve to the neutral accent regardless of the stored value.
  applyAccentColor(
    resolveEffectiveAccent(
      name,
      getStorageItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT,
    ),
  );

  // Cache for FOUC prevention
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ themeName: name, vars, isDark }),
    );
  } catch {
    // Storage full — non-critical
  }

  return { isDark };
}

export function useAppearance({ defaultTheme = "buzz", previewTheme, onThemeApplied, subscribeSystemTheme }: {
  defaultTheme?: SyntaxThemeName;
  previewTheme?: "light" | "dark";
  onThemeApplied?: () => void;
  subscribeSystemTheme?: (listener: (isDark: boolean) => void) => Promise<() => void>;
} = {}) {

  // Apply cached vars synchronously before first render
  const [selectedTheme, setSelectedTheme] = useState<string>(() => {
    applyCachedVars(onThemeApplied);
    return readStoredTheme(previewTheme === "dark" ? "buzz-dark" : defaultTheme);
  });
  const [isDark, setIsDark] = useState<boolean>(() => {
    return document.documentElement.classList.contains("dark");
  });
  const [isLoading, setIsLoading] = useState(true);
  const [themeError, setThemeError] = useState<unknown>(null);
  const loadingRef = useRef<string | null>(null);
  const [accentColor, setAccentColorState] = useState<string>(() => {
    // block/buzz#5078 — use the throw-safe accessor for init-time reads; a
    // denied-storage origin would otherwise kill the root on first mount.
    return getStorageItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT;
  });
  const [followSystem, setFollowSystemState] = useState<boolean>(() => {
    const stored = getStorageItem(FOLLOW_SYSTEM_KEY);
    if (stored !== null) return stored === "true";
    if (previewTheme !== undefined && getStorageItem(THEME_STORAGE_KEY) === null) return false;
    // Fresh profiles (no saved theme) default to System mode so the Buzz
    // default tracks the OS light/dark scheme. Profiles that picked a theme
    // before this toggle existed keep their fixed theme until they opt in.
    return getStorageItem(THEME_STORAGE_KEY) === null;
  });
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Resolve the effective theme based on follow-system preference
  const effectiveTheme = (() => {
    if (!followSystem || !isValidThemeName(selectedTheme)) return selectedTheme;
    return resolveSystemTheme(selectedTheme as SyntaxThemeName, systemIsDark);
  })();
  const { prominentActiveTab, setProminentActiveTab } = useProminentActiveTab(
    isBuzzTheme(effectiveTheme),
  );

  // Check if the selected theme has a pair (for UI hint)
  const hasPair = isValidThemeName(selectedTheme)
    ? getThemePair(selectedTheme as SyntaxThemeName) !== null
    : false;

  useEffect(() => {
    if (!isValidThemeName(effectiveTheme)) return;

    // Track which theme we're loading to avoid race conditions
    const thisTheme = effectiveTheme;
    loadingRef.current = thisTheme;
    setIsLoading(true);

    let disposed = false;
    applyTheme(effectiveTheme as SyntaxThemeName, onThemeApplied, () => !disposed).then((result) => {
      if (!result) return;
      // Only update if this is still the theme we want. The accent is applied
      // inside applyTheme (synchronously with the theme vars), so there's no
      // separate re-application here — that avoided the switch-time flicker.
      if (loadingRef.current === thisTheme) {
        setIsDark(result.isDark);
        setIsLoading(false);
      }
    }).catch((error: unknown) => {
      if (!disposed) setThemeError(() => error);
    });
    return () => { disposed = true; };
  }, [effectiveTheme, onThemeApplied]);


  // Listen for system color scheme changes when followSystem is enabled
  useEffect(() => {
    if (!followSystem) return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setSystemIsDark(event.matches);
    };
    let disposed = false;
    let unlistenNativeTheme: (() => void) | undefined;

    setSystemIsDark(mq.matches);
    mq.addEventListener("change", handleMediaChange);

    // WKWebView can update the media query value without dispatching its
    // change event until the page reloads. Tauri's native window event arrives
    // immediately when macOS appearance changes, so use it as the reliable app
    // signal while retaining matchMedia for the browser build.
    if (subscribeSystemTheme) {
      void subscribeSystemTheme((isDark) => {
          if (!disposed) setSystemIsDark(isDark);
        })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlistenNativeTheme = unlisten;
          }
        })
        .catch((error) => {
          console.warn("system theme listener unavailable", error);
        });
    }

    return () => {
      disposed = true;
      mq.removeEventListener("change", handleMediaChange);
      unlistenNativeTheme?.();
    };
  }, [followSystem, subscribeSystemTheme]);

  // Re-apply the accent when the user picks a new swatch or the effective theme
  // changes. applyTheme already applies the (Buzz-neutral-aware) accent in the
  // same synchronous batch as the theme vars — the flicker fix — so this effect
  // is idempotent on theme changes and simply covers accent-only changes.
  useEffect(() => {
    applyAccentColor(resolveEffectiveAccent(effectiveTheme, accentColor));
  }, [accentColor, effectiveTheme]);

  const setTheme = useCallback((name: string) => {
    if (!isValidThemeName(name)) return;
    setSelectedTheme(name);
    window.localStorage.setItem(THEME_STORAGE_KEY, name);
  }, []);

  const setAccentColor = useCallback((color: string) => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, color);
    setAccentColorState(color);
  }, []);

  const setFollowSystem = useCallback((enabled: boolean) => {
    window.localStorage.setItem(FOLLOW_SYSTEM_KEY, enabled ? "true" : "false");
    setFollowSystemState(enabled);
  }, []);

  const applyAppearance = useCallback(
    (appearance: {
      theme: SyntaxThemeName;
      accent: string;
      followSystem: boolean;
    }) => {
      // Write the complete preference before updating state so applyTheme reads
      // the target community's accent in the same batch, never the previous one.
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, appearance.theme);
        window.localStorage.setItem(ACCENT_STORAGE_KEY, appearance.accent);
        window.localStorage.setItem(
          FOLLOW_SYSTEM_KEY,
          appearance.followSystem ? "true" : "false",
        );
      } catch {
        // Keep the active appearance responsive even if the local cache is full.
      }
      setSelectedTheme(appearance.theme);
      setAccentColorState(appearance.accent);
      setFollowSystemState(appearance.followSystem);
    },
    [],
  );

  if (themeError !== null) throw themeError;
  return {
    themeName: effectiveTheme,
    selectedThemeName: selectedTheme,
    isDark,
    isLoading,
    accentColor,
    followSystem,
    prominentActiveTab,
    hasPair,
    setTheme,
    setAccentColor,
    setFollowSystem,
    applyAppearance,
    setProminentActiveTab,
  };

}


/** Consume the former Web-only mode once; never overwrite a native preference. */
export function migrateWebThemePreference(): void {
  const mode = getStorageItem("buzz-web-theme");
  if (mode !== "light" && mode !== "dark" && mode !== "system") return;
  if (getStorageItem(THEME_STORAGE_KEY) !== null || getStorageItem(FOLLOW_SYSTEM_KEY) !== null) return;
  try {
    window.localStorage.setItem(FOLLOW_SYSTEM_KEY, mode === "system" ? "true" : "false");
    window.localStorage.setItem(THEME_STORAGE_KEY, mode === "dark" ? "buzz-dark" : "buzz");
    window.localStorage.removeItem("buzz-web-theme");
  } catch {
    // Keep the legacy preference for a subsequent successful migration.
    removeStorageItem(THEME_STORAGE_KEY);
    removeStorageItem(FOLLOW_SYSTEM_KEY);
  }
}

export type Appearance = ReturnType<typeof useAppearance>;
