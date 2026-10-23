// Types for client-kit/embed/kailo-embed.js (DD-133). The script installs one
// frozen global; TypeScript components reference this file for the shape.
export type KailoTheme = "light" | "dark";
export type KailoLocale = "zh-CN" | "en";

export interface KailoPresentationState {
  theme: KailoTheme;
  locale: KailoLocale;
  /** The page runs inside a frame (Kailo's content area). */
  embedded: boolean;
  /** A validated presentation message from the Kailo host has arrived. */
  hostConnected: boolean;
}

/** Declared preference key -> BOOLEAN value or ENUM option (design 07 §4.8.2). */
export type KailoPreferenceValues = Record<string, boolean | string>;

export interface KailoPresentationChange {
  theme: boolean;
  locale: boolean;
}

export interface KailoEmbedRuntime {
  readonly version: 1;
  readonly themes: readonly KailoTheme[];
  readonly locales: readonly KailoLocale[];
  getState(): KailoPresentationState;
  onChange(listener: (state: KailoPresentationState, changed: KailoPresentationChange) => void): () => void;
  onThemeChange(listener: (theme: KailoTheme) => void): () => void;
  onLocaleChange(listener: (locale: KailoLocale) => void): () => void;
  useIdentityLocale(locale: string): boolean;
  requestTopLevelSignIn(): boolean;
  /** DD-138: values Kailo supplied for the release's declared settings items. */
  getPreferences(): KailoPreferenceValues;
  onPreferencesChange(listener: (values: KailoPreferenceValues, changed: string[]) => void): () => void;
}

declare global {
  interface Window {
    KailoEmbed?: KailoEmbedRuntime;
  }
}
