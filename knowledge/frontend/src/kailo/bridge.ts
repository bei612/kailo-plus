// Adapter over the platform presentation runtime (DD-133, design 07 §4.7.2).
//
// client-kit/embed/kailo-embed.js is a build input served from this page's
// own origin and loaded synchronously in <head>; it owns the wire protocol v1
// (launch parameters, tab persistence, origin/source checks, postMessage).
// This module only connects its callbacks to the native theme and i18n and
// never speaks the protocol itself.

/**
 * Minimal copy of client-kit/embed/kailo-embed.d.ts (the authoritative types);
 * keep in step with that file. Copied because the .d.ts is not a build input
 * of this artifact.
 */
export type KailoTheme = 'light' | 'dark'
export type KailoLocale = 'zh-CN' | 'en'

/** DD-167: Kailo's text-only size preference (body 13 / 14 / 15 px). */
export type KailoFontSize = 'smaller' | 'default' | 'larger'

export interface KailoPresentationState {
  theme: KailoTheme
  locale: KailoLocale
  /** DD-167 (absent on older runtimes): scales text only through --kailo-type-scale. */
  fontSize?: KailoFontSize
  /** DD-167 (absent on older runtimes): Kailo's ⌘± zoom, 0.75–1.5, published as --kailo-zoom. */
  zoom?: number
  /** DD-167: 13/14, 1 or 15/14. */
  typeScale?: number
  embedded: boolean
  hostConnected: boolean
}

export interface KailoPresentationChange {
  theme: boolean
  locale: boolean
  fontSize?: boolean
  zoom?: boolean
}

/** DD-138 (07 §4.8.2): declared preference key -> BOOLEAN value or ENUM option. */
export type KailoPreferenceValues = Record<string, boolean | string>

/** DD-157 (07 §4.8.7): what a build opts into with <meta name="kailo-embed-features">. */
export type KailoEmbedFeature = 'page' | 'toast' | 'confirm' | 'shortcuts' | 'prompt'

/** Closed icon vocabulary for header actions; Kailo draws them with its own (Lucide) icons. */
export type KailoActionIcon = 'upload' | 'plus' | 'folder-plus' | 'share' | 'download' | 'rocket' | 'refresh'
  | 'settings' | 'message-square-plus' | 'play' | 'trash' | 'pencil' | 'filter' | 'search' | 'more'

export interface KailoPageItem {
  id: string
  label: string
}

export interface KailoPageAction {
  id: string
  label: string
  variant?: 'primary' | 'secondary' | 'menu'
  icon?: KailoActionIcon
  /**
   * DD-157: the action needs files the user chooses. Kailo opens its file
   * picker inside the user's click (a frame never receives the host's user
   * activation) and delivers the files with the action. accept: same syntax as
   * <input accept>, 1–200 chars of letters, digits and `.+-/*, `.
   */
  files?: KailoActionFiles
  disabled?: boolean
  busy?: boolean
}

export interface KailoActionFiles {
  accept?: string
  multiple?: boolean
  directory?: boolean
}

/** Files chosen in Kailo's picker; paths are relative paths for a directory pick, else file names. */
export interface KailoFileSelection {
  files: File[]
  paths: string[]
}

export interface KailoPage {
  title: string
  breadcrumbs?: KailoPageItem[]
  tabs?: KailoPageItem[]
  activeTab?: string
  actions?: KailoPageAction[]
}

export interface KailoNavigateTarget {
  kind: 'tab' | 'breadcrumb'
  id: string
}

export interface KailoToast {
  tone?: 'success' | 'info' | 'warning' | 'error'
  title: string
  description?: string
}

export interface KailoConfirm {
  tone?: 'default' | 'danger'
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
}

/** DD-167 (07 §4.8.10): one line of text from the user, asked in Kailo's dialog. */
export interface KailoPrompt {
  title: string
  label: string
  description?: string
  placeholder?: string
  value?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 1–255, default 255. */
  maxLength?: number
}

export interface KailoEmbedRuntime {
  readonly version: 1
  getState(): KailoPresentationState
  /** All presentation changes at once (theme, locale and — DD-167 — fontSize, zoom). */
  onChange?(listener: (state: KailoPresentationState, changed: KailoPresentationChange) => void): () => void
  onThemeChange(listener: (theme: KailoTheme) => void): () => void
  onLocaleChange(listener: (locale: KailoLocale) => void): () => void
  /** DD-167: either type dial changed. */
  onTypeChange?(listener: (type: { fontSize: KailoFontSize; zoom: number; typeScale: number }) => void): () => void
  /** DD-138: values Kailo supplied for the release's declared settings items. */
  getPreferences?(): KailoPreferenceValues
  onPreferencesChange?(listener: (values: KailoPreferenceValues, changed: string[]) => void): () => void
  useIdentityLocale(locale: string): boolean
  requestTopLevelSignIn(): boolean
  /**
   * DD-138(6): the declared admin surface key Kailo launched this page for
   * (`kailo_admin_surface`), or null. It selects what to render; it is no
   * authorization. Absent on runtimes before DD-138(6).
   */
  adminSurface?(): string | null
  /** DD-157: declared features of this build (absent on runtimes before DD-157). */
  readonly features?: readonly KailoEmbedFeature[]
  /** DD-157: true = Kailo renders the page header; throws TypeError on an invalid shape. */
  setPage?(page: KailoPage | null): boolean
  onNavigate?(listener: (target: KailoNavigateTarget) => void): () => void
  onAction?(listener: (id: string, selection?: KailoFileSelection) => void): () => void
  /** DD-157: true = Kailo showed it; false at top level. */
  toast?(toast: KailoToast): boolean
  /** DD-157: Kailo's dialog, or null when the page must use its own. */
  confirm?(options: KailoConfirm): Promise<boolean> | null
  /** DD-157: the Kailo host announced it handles this feature (false until it answers). */
  hostSupports?(feature: KailoEmbedFeature | 'files' | 'confirm-option'): boolean
  /** DD-167: Kailo's one-line text dialog; null when the page must draw its own. */
  prompt?(options: KailoPrompt): Promise<string | null> | null
}

type RuntimeHost = { KailoEmbed?: unknown }

/** The runtime installed by kailo-embed.js, or null when it is absent or not wire v1. */
export function kailoEmbed(host: RuntimeHost | undefined = typeof window !== 'undefined' ? (window as unknown as RuntimeHost) : undefined): KailoEmbedRuntime | null {
  const runtime = host?.KailoEmbed as Partial<KailoEmbedRuntime> | undefined
  if (!runtime || runtime.version !== 1 || typeof runtime.getState !== 'function') return null
  return runtime as KailoEmbedRuntime
}

type RootLike = { documentElement: { hasAttribute(name: string): boolean } }

/** Inside the Kailo frame the runtime marks <html data-kailo-embedded>. */
export function isEmbedded(doc: RootLike | undefined = typeof document !== 'undefined' ? document : undefined): boolean {
  try {
    return !!doc?.documentElement.hasAttribute('data-kailo-embedded')
  } catch {
    return false
  }
}

/** Kailo locales (wire v1: zh-CN | en) onto the native locales. */
export function mapKailoLocale(locale: string | null | undefined): 'zh-CN' | 'en-US' | null {
  if (locale === 'zh-CN') return 'zh-CN'
  if (locale === 'en') return 'en-US'
  return null
}

/**
 * The OIDC `locale` claim (stored by the backend in user preferences) in the
 * runtime's vocabulary; anything else is not offered to the runtime.
 */
export function identityLocaleForRuntime(locale: string | null | undefined): KailoLocale | null {
  const tag = (locale || '').trim().toLowerCase()
  if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh-CN'
  if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) return 'en'
  return null
}

export interface KailoTypeDials {
  fontSize: KailoFontSize
  zoom: number
}

export interface HostHandlers {
  onTheme(theme: KailoTheme): void
  /** Receives the native locale (already mapped). */
  onLocale(locale: 'zh-CN' | 'en-US'): void
  /**
   * DD-167: Kailo's type dials. The runtime already mirrors them on <html>
   * (data-kailo-font-size, --kailo-zoom), which the token sheet and the
   * overlay turn into text sizes and the app-root zoom; this is for code
   * that measures or draws text itself.
   */
  onType?(type: KailoTypeDials): void
}

/** The type dials of a state, defaults for runtimes before DD-167. */
export function typeDialsOf(state: Partial<KailoPresentationState>): KailoTypeDials {
  const fontSize = state.fontSize === 'smaller' || state.fontSize === 'larger' ? state.fontSize : 'default'
  const zoom = typeof state.zoom === 'number' && state.zoom >= 0.75 && state.zoom <= 1.5 ? state.zoom : 1
  return { fontSize, zoom }
}

/**
 * Applies the runtime's current theme, locale and type dials, then follows
 * every change in the same document (no reload, route and input kept;
 * 07 §4.8.10). Uses the runtime's single onChange when it has one (DD-167),
 * else the theme and locale listeners of older runtimes.
 * Returns the unsubscribe function.
 */
export function connectHost(runtime: KailoEmbedRuntime, handlers: HostHandlers): () => void {
  const state = runtime.getState()
  const theme = (value: KailoTheme) => handlers.onTheme(value === 'dark' ? 'dark' : 'light')
  const locale = (value: KailoLocale) => {
    const mapped = mapKailoLocale(value)
    if (mapped) handlers.onLocale(mapped)
  }
  theme(state.theme)
  locale(state.locale)
  handlers.onType?.(typeDialsOf(state))
  if (typeof runtime.onChange === 'function') {
    return runtime.onChange((next, changed) => {
      if (changed.theme) theme(next.theme)
      if (changed.locale) locale(next.locale)
      if (changed.fontSize || changed.zoom) handlers.onType?.(typeDialsOf(next))
    })
  }
  const offTheme = runtime.onThemeChange(theme)
  const offLocale = runtime.onLocaleChange(locale)
  return () => { offTheme(); offLocale() }
}

/**
 * Top-level visits: seed the language from the identity locale. The runtime
 * ignores it once Kailo supplied a locale.
 */
export function offerIdentityLocale(runtime: KailoEmbedRuntime | null, locale: string | null | undefined): boolean {
  const value = identityLocaleForRuntime(locale)
  if (!runtime || !value) return false
  return runtime.useIdentityLocale(value)
}

/** Silent OIDC needs interaction inside the frame: Kailo signs in at top level. */
export function requestTopLevelSignIn(runtime: KailoEmbedRuntime | null): boolean {
  return runtime ? runtime.requestTopLevelSignIn() : false
}

/**
 * DD-157: Kailo renders this page's header, toasts and confirmations when the
 * build declared the `page` feature and the page runs inside the Kailo frame.
 * The component then renders content only (no own title, breadcrumbs or
 * product navigation).
 */
export const HOST_WITHOUT_PAGE_KEY = 'kailo-knowledge-host-without-page'

export function hostRendersPage(runtime: KailoEmbedRuntime | null): boolean {
  if (!runtime || typeof runtime.setPage !== 'function') return false
  const features = Array.isArray(runtime.features) ? runtime.features : []
  if (!features.includes('page') || runtime.getState().embedded !== true) return false
  // DD-157: an older Kailo answered without drawing headers (remembered for this tab).
  try { if (window.sessionStorage.getItem(HOST_WITHOUT_PAGE_KEY) === '1') return false } catch { /* storage denied */ }
  return true
}
