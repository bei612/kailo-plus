// Types for client-kit/embed/kailo-embed.js (DD-133). The script installs one
// frozen global; TypeScript components reference this file for the shape.
export type KailoTheme = "light" | "dark";
export type KailoLocale = "zh-CN" | "en";
/** DD-167: Kailo's text-only size preference (body 13 / 14 / 15 px). */
export type KailoFontSize = "smaller" | "default" | "larger";

export interface KailoPresentationState {
  theme: KailoTheme;
  locale: KailoLocale;
  /**
   * DD-167: Kailo's font size preference; scales text only (`--kailo-type-scale`). Always present
   * from this runtime; optional so that a component's own fallback state (no runtime) stays valid.
   */
  fontSize?: KailoFontSize;
  /** DD-167: Kailo's ⌘± zoom, 0.75–1.5; scales the whole page (`--kailo-zoom`, `data-kailo-zoomed`). */
  zoom?: number;
  /** 13/14, 1 or 15/14 for fontSize: multiply native text sizes by it. */
  typeScale?: number;
  /** The page runs inside a frame (Kailo's content area). */
  embedded: boolean;
  /** A validated presentation message from the Kailo host has arrived. */
  hostConnected: boolean;
  /** DD-157: features the Kailo host announced it handles (present once it answered). */
  hostFeatures?: (KailoEmbedFeature | "files" | "confirm-option")[];
}

/** Declared preference key -> BOOLEAN value or ENUM option (design 07 §4.8.2). */
export type KailoPreferenceValues = Record<string, boolean | string>;

export interface KailoPresentationChange {
  theme: boolean;
  locale: boolean;
  fontSize?: boolean;
  zoom?: boolean;
}

export interface KailoTypeState {
  fontSize: KailoFontSize;
  zoom: number;
  typeScale: number;
}

/** DD-157 (07 §4.8.7): what a build opts into with <meta name="kailo-embed-features">. */
export type KailoEmbedFeature = "page" | "toast" | "confirm" | "shortcuts" | "prompt";

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
  /**
   * DD-157: the action needs files the user chooses. Kailo opens its file picker inside the
   * user's click (a frame never receives the host's user activation) and delivers the files
   * with the action. accept: same syntax as <input accept>, 1–200 chars.
   */
  files?: { accept?: string; multiple?: boolean; directory?: boolean };
  disabled?: boolean;
  busy?: boolean;
}

/** The header Kailo renders for the page (20 §13.2). */
export interface KailoPage {
  /** Current page title, 1–120 chars. Kailo adds the product name (云盘/知识工程/数据建模) itself. */
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

/** Files chosen in Kailo's picker; paths are relative paths for a directory pick, else file names. */
export interface KailoFileSelection {
  files: File[];
  paths: string[];
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

/** One unchecked choice inside the confirmation, e.g. "delete permanently" (host feature "confirm-option"). */
export interface KailoConfirmOption {
  label: string;
  warning?: string;
}

/** DD-167: one line of text from the user, asked in Kailo's dialog (e.g. a new folder's name). */
export interface KailoPrompt {
  /** 1–120 chars, a question or an action ("新建文件夹"). */
  title: string;
  /** Field label, 1–80 chars. */
  label: string;
  description?: string;
  placeholder?: string;
  /** Initial text (selected when the dialog opens); at most maxLength. */
  value?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 1–255, default 255. */
  maxLength?: number;
}

export interface KailoEmbedRuntime {
  readonly version: 1;
  readonly themes: readonly KailoTheme[];
  readonly locales: readonly KailoLocale[];
  getState(): KailoPresentationState;
  onChange(listener: (state: KailoPresentationState, changed: KailoPresentationChange) => void): () => void;
  onThemeChange(listener: (theme: KailoTheme) => void): () => void;
  onLocaleChange(listener: (locale: KailoLocale) => void): () => void;
  /** DD-167: either type dial changed. */
  onTypeChange(listener: (type: KailoTypeState) => void): () => void;
  useIdentityLocale(locale: string): boolean;
  requestTopLevelSignIn(): boolean;
  /**
   * DD-138(6): the declared admin surface key Kailo launched this page for
   * (`kailo_admin_surface`), or null. Render only that admin function; it is no authorization.
   */
  adminSurface(): string | null;
  /** DD-138: values Kailo supplied for the release's declared settings items. */
  getPreferences(): KailoPreferenceValues;
  onPreferencesChange(listener: (values: KailoPreferenceValues, changed: string[]) => void): () => void;
  /** DD-157: declared features of this build. */
  readonly features: readonly KailoEmbedFeature[];
  /** DD-157: Kailo renders the page header; false when the feature is undeclared or no Kailo frame. Throws on an invalid shape. */
  setPage(page: KailoPage | null): boolean;
  /** DD-157: the Kailo host announced this feature; false until it answered. Re-check in onChange. */
  hostSupports(feature: KailoEmbedFeature | "files" | "confirm-option"): boolean;
  onNavigate(listener: (target: KailoNavigateTarget) => void): () => void;
  onAction(listener: (id: string, selection?: KailoFileSelection) => void): () => void;
  /** DD-157: shown by Kailo; false at top level (show your own Kailo-styled toast). */
  toast(toast: KailoToast): boolean;
  /** DD-157: Kailo's confirmation dialog; null at top level (use your own Kailo-styled dialog). */
  confirm(options: KailoConfirm): Promise<boolean> | null;
  /** Null unless the host announced "confirm-option"; `option` is false on a cancel. */
  confirm(options: KailoConfirm & { option: KailoConfirmOption }): Promise<{ confirmed: boolean; option: boolean }> | null;
  /** DD-167: Kailo's one-line text dialog; resolves the trimmed answer or null. Null when unsupported (use your own dialog). */
  prompt(options: KailoPrompt): Promise<string | null> | null;
}

declare global {
  interface Window {
    KailoEmbed?: KailoEmbedRuntime;
  }
}
