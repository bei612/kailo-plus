// Original Buzz ThemeProvider glass bounds; native persistence remains in its host.
export const GLASS_OPACITY_MIN = 30;
export const GLASS_OPACITY_MAX = 90;
export const DEFAULT_GLASS_OPACITY = 65;

export type GlassAppearance = {
  glassBackground: boolean;
  glassOpacity: number;
  glassBackgroundSupported: boolean;
  setGlassBackground: (enabled: boolean) => void;
  setGlassOpacity: (opacity: number) => void;
};
