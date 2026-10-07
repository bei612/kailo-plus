import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invokeTauri } from "@/shared/api/tauri";
import { isMacPlatform } from "@/shared/lib/platform";
import { getStorageItem } from "@/shared/lib/safeStorage";
import { useAppearance, type Appearance } from "@client-kit/platform/theme/use-appearance";
import type { SyntaxThemeName } from "@client-kit/platform/theme/theme-loader";
import { DEFAULT_GLASS_OPACITY, GLASS_OPACITY_MAX, GLASS_OPACITY_MIN, type GlassAppearance } from "@client-kit/platform/theme/glass-preference";
export { ACCENT_COLORS, ACCENT_STORAGE_KEY, NEUTRAL_ACCENT, THEME_STORAGE_KEY, isBuzzTheme } from "@client-kit/platform/theme/use-appearance";
export const GLASS_BACKGROUND_STORAGE_KEY = "buzz-glass-background";
export const GLASS_OPACITY_STORAGE_KEY = "buzz-glass-opacity";
const GLASS_VIBRANCY_MATERIAL = "sidebar";
type ThemeContextValue = Appearance & GlassAppearance;
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
/**
 * Toggle the transparent CSS surfaces that reveal native macOS vibrancy behind
 * the navigation and outer chrome. The center content panel remains opaque.
 *
 * IMPORTANT: enabling glass exposes whatever the compositor paints
 * behind the webview. Only enable it once the native `NSVisualEffectView`
 * vibrancy layer and the active theme colors are both ready.
 */
function setGlassBackgroundActive(enabled: boolean) {
  const root = document.documentElement;
  if (enabled) {
    // WKWebView keeps its page canvas opaque unless the root background is an
    // inline transparent value, even when the equivalent author rule wins in
    // the stylesheet. Clear it before exposing the native vibrancy layer.
    root.style.setProperty("background", "transparent");
    root.setAttribute("data-glass-background", "");
  } else {
    root.removeAttribute("data-glass-background");
    root.style.removeProperty("background");
  }
}

function clampGlassOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GLASS_OPACITY;
  return Math.min(
    GLASS_OPACITY_MAX,
    Math.max(GLASS_OPACITY_MIN, Math.round(value)),
  );
}

function readStoredGlassOpacity(): number {
  const stored = getStorageItem(GLASS_OPACITY_STORAGE_KEY);
  return stored === null
    ? DEFAULT_GLASS_OPACITY
    : clampGlassOpacity(Number(stored));
}

/** Set the tint opacity layered above native blur; lower values reveal more. */
function applyGlassOpacity(value: number) {
  document.documentElement.style.setProperty(
    "--glass-background-opacity",
    `${clampGlassOpacity(value)}%`,
  );
}

/** Only the newest overlapping native glass request may update CSS state. */
let glassVibrancyRequest = 0;

/** Whether the native vibrancy layer is confirmed installed. */
let glassVibrancyReady = false;

/** The native layer does not need rebuilding when only the theme changes. */
let glassVibrancyEnabled = false;

/** Mirrors the current preference for the async theme/native handshake. */
let glassBackgroundPreferenceEnabled = false;

/** Theme colors must be installed before the transparent surface is exposed. */
let glassThemeReady = false;

/**
 * Theme loading and native vibrancy can finish in either order. Whichever lands
 * last reveals the glass once both prerequisites are ready.
 */
function maybeEnableGlassBackground(requestToken: number) {
  if (requestToken !== glassVibrancyRequest) return;
  if (!glassBackgroundPreferenceEnabled || !isMacPlatform()) return;
  if (!glassVibrancyReady || !glassThemeReady) return;
  setGlassBackgroundActive(true);
}

/**
 * Install native vibrancy before making the webview transparent. Non-macOS and
 * web builds retain the normal opaque theme surface.
 */
async function applyWindowGlass(enabled: boolean) {
  glassBackgroundPreferenceEnabled = enabled;
  const requestToken = ++glassVibrancyRequest;

  if (!isTauri() || !isMacPlatform()) {
    glassBackgroundPreferenceEnabled = false;
    glassVibrancyEnabled = false;
    glassVibrancyReady = false;
    setGlassBackgroundActive(false);
    return;
  }

  if (enabled && glassVibrancyEnabled && glassVibrancyReady) {
    maybeEnableGlassBackground(requestToken);
    return;
  }

  glassVibrancyReady = false;

  try {
    await invokeTauri<void>("set_window_vibrancy", {
      enabled,
      material: GLASS_VIBRANCY_MATERIAL,
    });
    if (requestToken !== glassVibrancyRequest) return;
    glassVibrancyEnabled = enabled;
    if (enabled && isMacPlatform()) {
      glassVibrancyReady = true;
      maybeEnableGlassBackground(requestToken);
    }
  } catch (error) {
    console.warn("set_window_vibrancy failed", error);
    if (requestToken !== glassVibrancyRequest) return;
    glassVibrancyEnabled = false;
    setGlassBackgroundActive(false);
  }
}

function markThemeReady() {
  glassThemeReady = true;
  maybeEnableGlassBackground(glassVibrancyRequest);
}
function subscribeSystemTheme(listener: (isDark: boolean) => void) {
  return getCurrentWindow().onThemeChanged(({ payload }) => listener(payload === "dark"));
}
export function ThemeProvider({ children, defaultTheme = "buzz" }: { children: ReactNode; defaultTheme?: SyntaxThemeName }) {
  const glassBackgroundSupported = isTauri() && isMacPlatform();
  const appearance = useAppearance({ defaultTheme, onThemeApplied: markThemeReady, subscribeSystemTheme: isTauri() ? subscribeSystemTheme : undefined });
  const [glassBackground, setGlassBackgroundState] = useState<boolean>(() => {
    const stored = getStorageItem(GLASS_BACKGROUND_STORAGE_KEY);
    // Glass is opt-in. Explicitly saved preferences remain intact, while a
    // fresh profile starts with the normal opaque window treatment. Keep an
    // unsupported platform opaque without erasing a preference saved on Mac.
    const enabled = glassBackgroundSupported && stored === "true";
    glassBackgroundPreferenceEnabled = enabled;
    return enabled;
  });
  const [glassOpacity, setGlassOpacityState] = useState<number>(() => {
    const opacity = readStoredGlassOpacity();
    applyGlassOpacity(opacity);
    return opacity;
  });
  useEffect(() => {
    // `initial-render-ready` fires from a layout effect, so it is already
    // enqueued before this passive effect's IPC call is dispatched. The native
    // reveal can in theory precede the transparency call; the Rust-side
    // stable-geometry wait provides the gap in practice, and a brief opaque
    // first frame is the accepted worst case for glass users.
    void applyWindowGlass(glassBackground);
  }, [glassBackground]);

  const setGlassBackground = useCallback(
    (enabled: boolean) => {
      if (!glassBackgroundSupported) {
        glassBackgroundPreferenceEnabled = false;
        setGlassBackgroundActive(false);
        setGlassBackgroundState(false);
        return;
      }

      window.localStorage.setItem(
        GLASS_BACKGROUND_STORAGE_KEY,
        enabled ? "true" : "false",
      );
      glassBackgroundPreferenceEnabled = enabled;
      if (!enabled) {
        setGlassBackgroundActive(false);
      }
      setGlassBackgroundState(enabled);
    },
    [glassBackgroundSupported],
  );

  const setGlassOpacity = useCallback((opacity: number) => {
    const nextOpacity = clampGlassOpacity(opacity);
    window.localStorage.setItem(GLASS_OPACITY_STORAGE_KEY, String(nextOpacity));
    applyGlassOpacity(nextOpacity);
    setGlassOpacityState(nextOpacity);
  }, []);

  return <ThemeContext.Provider value={{ ...appearance, glassBackground, glassOpacity, glassBackgroundSupported, setGlassBackground, setGlassOpacity }}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
