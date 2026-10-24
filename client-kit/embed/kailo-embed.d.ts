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

/** DD-152 (07 §4.8.7): what a build opts into with <meta name="kailo-embed-features">. */
export type KailoEmbedFeature = "page" | "toast" | "confirm" | "shortcuts";

/** Closed icon vocabulary for header actions; Kailo draws them with its own (Lucide) icons. */
export type KailoActionIcon = "upload" | "plus" | "folder-plus" | "share" | "download" | "rocket" | "refresh"
  | "settings" | "message-square-plus" | "play" | "trash" | "pencil" | "filter" | "search" | "more";

export interface KailoPageItem {
  /** Opaque to Kailo (1–256 chars, no control characters); echoed back in navigate. */
  id: string;
  /** Display text, 1–80 chars (tabs 1–40). */
  label: string;
}

export interface KailoPageAction {
  id: string;
  /** 1–40 chars, verb first, Kailo wording (20 §13.8). */
  label: string;
  /** primary: at most one, the page's main action; secondary: outline button; menu: in the "more" menu. */
  variant?: "primary" | "secondary" | "menu";
  icon?: KailoActionIcon;
  disabled?: boolean;
  busy?: boolean;
}

/** The header Kailo renders for the page (20 §13.2). */
export interface KailoPage {
  /** Current page title, 1–120 chars. Kailo adds the product name (云盘/知识库/问数) itself. */
  title: string;
  /** Ancestors of the current location, outermost first, at most 8; the title is not repeated. */
  breadcrumbs?: KailoPageItem[];
  /** Sections of the product shown as tabs under the header, at most 8. */
  tabs?: KailoPageItem[];
  activeTab?: string;
  /** At most 8, at most one primary. */
  actions?: KailoPageAction[];
}

export interface KailoNavigateTarget {
  kind: "tab" | "breadcrumb";
  id: string;
}

export interface KailoToast {
  tone?: "success" | "info" | "warning" | "error";
  /** 1–120 chars. */
  title: string;
  /** Up to 280 chars. */
  description?: string;
}

export interface KailoConfirm {
  tone?: "default" | "danger";
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
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
  /** DD-152: declared features of this build. */
  readonly features: readonly KailoEmbedFeature[];
  /** DD-152: Kailo renders the page header; false when the feature is undeclared or no Kailo frame. Throws on an invalid shape. */
  setPage(page: KailoPage | null): boolean;
  onNavigate(listener: (target: KailoNavigateTarget) => void): () => void;
  onAction(listener: (id: string) => void): () => void;
  /** DD-152: shown by Kailo; false at top level (show your own Kailo-styled toast). */
  toast(toast: KailoToast): boolean;
  /** DD-152: Kailo's confirmation dialog; null at top level (use your own Kailo-styled dialog). */
  confirm(options: KailoConfirm): Promise<boolean> | null;
}

declare global {
  interface Window {
    KailoEmbed?: KailoEmbedRuntime;
  }
}
