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

export interface KailoPresentationState {
  theme: KailoTheme
  locale: KailoLocale
  embedded: boolean
  hostConnected: boolean
}

/** DD-152 (07 §4.8.7): what a build opts into with <meta name="kailo-embed-features">. */
export type KailoEmbedFeature = 'page' | 'toast' | 'confirm' | 'shortcuts'

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
  disabled?: boolean
  busy?: boolean
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

export interface KailoEmbedRuntime {
  readonly version: 1
  getState(): KailoPresentationState
  onThemeChange(listener: (theme: KailoTheme) => void): () => void
  onLocaleChange(listener: (locale: KailoLocale) => void): () => void
  useIdentityLocale(locale: string): boolean
  requestTopLevelSignIn(): boolean
  /** DD-152: declared features of this build (absent on runtimes before DD-152). */
  readonly features?: readonly KailoEmbedFeature[]
  /** DD-152: true = Kailo renders the page header; throws TypeError on an invalid shape. */
  setPage?(page: KailoPage | null): boolean
  onNavigate?(listener: (target: KailoNavigateTarget) => void): () => void
  onAction?(listener: (id: string) => void): () => void
  /** DD-152: true = Kailo showed it; false at top level. */
  toast?(toast: KailoToast): boolean
  /** DD-152: Kailo's dialog, or null when the page must use its own. */
  confirm?(options: KailoConfirm): Promise<boolean> | null
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

export interface HostHandlers {
  onTheme(theme: KailoTheme): void
  /** Receives the native locale (already mapped). */
  onLocale(locale: 'zh-CN' | 'en-US'): void
}

/**
 * Applies the runtime's current theme and locale, then follows its changes.
 * Returns the unsubscribe function.
 */
export function connectHost(runtime: KailoEmbedRuntime, handlers: HostHandlers): () => void {
  const state = runtime.getState()
  handlers.onTheme(state.theme === 'dark' ? 'dark' : 'light')
  const initial = mapKailoLocale(state.locale)
  if (initial) handlers.onLocale(initial)
  const offTheme = runtime.onThemeChange(theme => handlers.onTheme(theme === 'dark' ? 'dark' : 'light'))
  const offLocale = runtime.onLocaleChange(locale => {
    const mapped = mapKailoLocale(locale)
    if (mapped) handlers.onLocale(mapped)
  })
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
 * DD-152: Kailo renders this page's header, toasts and confirmations when the
 * build declared the `page` feature and the page runs inside the Kailo frame.
 * The component then renders content only (no own title, breadcrumbs or
 * product navigation).
 */
export function hostRendersPage(runtime: KailoEmbedRuntime | null): boolean {
  if (!runtime || typeof runtime.setPage !== 'function') return false
  const features = Array.isArray(runtime.features) ? runtime.features : []
  return features.includes('page') && runtime.getState().embedded === true
}
