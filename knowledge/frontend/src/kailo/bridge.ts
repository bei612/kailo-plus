// Kailo host bridge (DD-133 §4). This is the single protocol layer between the
// native page and the Kailo host; the platform's kailo-embed.js may later
// replace it without touching callers.
//
// Initial values: URL parameters `kailo_theme` / `kailo_locale` (persisted in
// sessionStorage so they survive the OIDC round trip). Live updates:
// postMessage from the parent window, accepted only from configured Kailo
// origins.

export type HostTheme = 'light' | 'dark'

export const SESSION_THEME_KEY = 'kailo_theme'
export const SESSION_LOCALE_KEY = 'kailo_locale'
export const SESSION_EMBED_KEY = 'kailo_embed'

export const COMPONENT_ID = 'knowledge'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export interface HostPreferences {
  theme: HostTheme | null
  /** Raw Kailo locale tag (BCP 47), not yet mapped. */
  locale: string | null
  embedRequested: boolean
}

export function parseHostTheme(value: unknown): HostTheme | null {
  return value === 'light' || value === 'dark' ? value : null
}

const LOCALE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,3}$/

export function parseHostLocale(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length <= 35 && LOCALE_TAG.test(trimmed) ? trimmed : null
}

/** Maps a Kailo locale tag to the native page's supported locales. */
export function mapKailoLocale(value: string | null | undefined): string {
  const tag = (value || '').trim().toLowerCase()
  if (tag.startsWith('zh')) return 'zh-CN'
  if (tag.startsWith('en')) return 'en-US'
  if (tag.startsWith('ja')) return 'ja-JP'
  if (tag.startsWith('ko')) return 'ko-KR'
  if (tag.startsWith('ru')) return 'ru-RU'
  return 'zh-CN'
}

function safeGet(storage: StorageLike | null | undefined, key: string): string | null {
  try { return storage?.getItem(key) ?? null } catch { return null }
}

function safeSet(storage: StorageLike | null | undefined, key: string, value: string): void {
  try { storage?.setItem(key, value) } catch { /* storage unavailable */ }
}

/**
 * Reads the host preferences from the URL, persisting any provided values so
 * they survive navigations (OIDC redirects drop the query string).
 */
export function readHostPreferences(search: string, storage: StorageLike | null | undefined): HostPreferences {
  const params = new URLSearchParams(search || '')
  const theme = parseHostTheme(params.get('kailo_theme'))
  const locale = parseHostLocale(params.get('kailo_locale'))
  const embed = params.get('kailo_embed') === '1'
  if (theme) safeSet(storage, SESSION_THEME_KEY, theme)
  if (locale) safeSet(storage, SESSION_LOCALE_KEY, locale)
  if (embed) safeSet(storage, SESSION_EMBED_KEY, '1')
  return {
    theme: theme ?? parseHostTheme(safeGet(storage, SESSION_THEME_KEY)),
    locale: locale ?? parseHostLocale(safeGet(storage, SESSION_LOCALE_KEY)),
    embedRequested: embed || safeGet(storage, SESSION_EMBED_KEY) === '1',
  }
}

type WindowLike = {
  self?: unknown
  top?: unknown
  parent?: { postMessage: (message: unknown, targetOrigin: string) => void } | unknown
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

/** True inside a frame (cross-origin access to top throws, which also means framed). */
export function isFramed(win: Pick<WindowLike, 'self' | 'top'>): boolean {
  try {
    return win.self !== win.top
  } catch {
    return true
  }
}

export function isEmbedded(win: Pick<WindowLike, 'self' | 'top'>, prefs?: Pick<HostPreferences, 'embedRequested'>): boolean {
  return isFramed(win) || prefs?.embedRequested === true
}

export interface HostBridgeHandlers {
  onTheme?: (theme: HostTheme) => void
  /** Receives the raw Kailo locale tag. */
  onLocale?: (locale: string) => void
}

/**
 * Listens to host messages. Only messages whose source is the parent window
 * and whose origin is one of the configured Kailo origins are accepted.
 */
export function installHostBridge(
  win: WindowLike,
  origins: readonly string[],
  handlers: HostBridgeHandlers,
  storage?: StorageLike | null,
): () => void {
  const allowed = new Set(origins)
  const listener = (event: MessageEvent) => {
    if (!event || event.source !== win.parent || event.source === win.self) return
    if (!allowed.has(event.origin)) return
    const data = event.data as { type?: unknown; theme?: unknown; locale?: unknown } | null
    if (!data || typeof data !== 'object') return
    if (data.type === 'kailo:theme') {
      const theme = parseHostTheme(data.theme)
      if (!theme) return
      safeSet(storage, SESSION_THEME_KEY, theme)
      handlers.onTheme?.(theme)
    } else if (data.type === 'kailo:locale') {
      const locale = parseHostLocale(data.locale)
      if (!locale) return
      safeSet(storage, SESSION_LOCALE_KEY, locale)
      handlers.onLocale?.(locale)
    }
  }
  if (allowed.size === 0) return () => {}
  win.addEventListener('message', listener)
  return () => win.removeEventListener('message', listener)
}

export type HostMessage =
  | { type: 'kailo:auth-required'; component: string }
  | { type: 'kailo:logout-request'; component: string }

/**
 * Posts a message to the Kailo parent. It is addressed to each configured
 * origin; the browser drops copies whose target origin does not match the
 * actual parent, so the message is only ever delivered to Kailo.
 * Returns the number of origins addressed (0 when not framed).
 */
export function postToHost(win: WindowLike, origins: readonly string[], message: HostMessage): number {
  if (!isFramed(win)) return 0
  const parent = win.parent as { postMessage?: (message: unknown, targetOrigin: string) => void } | undefined
  if (!parent || typeof parent.postMessage !== 'function') return 0
  let sent = 0
  for (const origin of origins) {
    try {
      parent.postMessage(message, origin)
      sent++
    } catch {
      // A mismatched or invalid target origin must not break the page.
    }
  }
  return sent
}
