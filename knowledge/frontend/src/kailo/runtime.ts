// Kailo integration runtime configuration (DD-133).
//
// Values come from window.__RUNTIME_CONFIG__, written by docker-entrypoint.sh
// from the container environment. Every reader goes through this module so the
// white-label, silent SSO and host-bridge code share one validated view.

export interface KailoRuntimeConfig {
  /** Kailo integration mode: silent SSO, Kailo-managed membership, host bridge. */
  mode: boolean
  /** Kailo deployment display name (platform PLATFORM_DISPLAY_NAME). */
  displayName: string
  /** Exact Kailo origins allowed to exchange postMessage with this page. */
  origins: string[]
  /** Absolute Kailo logout URL for top-level logout; empty when not configured. */
  logoutUrl: string
}

type RawRuntimeConfig = {
  KAILO_MODE?: unknown
  PLATFORM_DISPLAY_NAME?: unknown
  KAILO_ORIGINS?: unknown
  KAILO_LOGOUT_URL?: unknown
}

/** Normalises one origin; returns '' unless it is an exact http(s)/tauri origin. */
export function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'tauri:'].includes(url.protocol)) return ''
    if (url.username || url.password) return ''
    // URL.origin is "null" for non-special schemes such as tauri:.
    const origin = url.origin !== 'null' ? url.origin : `${url.protocol}//${url.host}`
    // Reject anything that is not exactly an origin (paths, queries, fragments).
    if (value.replace(/\/$/, '') !== origin) return ''
    return origin
  } catch {
    return ''
  }
}

function absoluteHttpURL(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.username || url.password) return ''
    return url.toString()
  } catch {
    return ''
  }
}

export function parseKailoRuntimeConfig(raw: RawRuntimeConfig | undefined | null): KailoRuntimeConfig {
  const source = raw || {}
  const mode = source.KAILO_MODE === true || String(source.KAILO_MODE ?? '').trim().toLowerCase() === 'true'
  const displayName = typeof source.PLATFORM_DISPLAY_NAME === 'string'
    ? source.PLATFORM_DISPLAY_NAME.trim().slice(0, 80)
    : ''
  const origins = typeof source.KAILO_ORIGINS === 'string'
    ? Array.from(new Set(source.KAILO_ORIGINS.split(/\s+/).map(normalizeOrigin).filter(Boolean)))
    : []
  const logoutUrl = typeof source.KAILO_LOGOUT_URL === 'string' ? absoluteHttpURL(source.KAILO_LOGOUT_URL.trim()) : ''
  return { mode, displayName, origins, logoutUrl }
}

let cached: KailoRuntimeConfig | null = null

export function kailoConfig(): KailoRuntimeConfig {
  if (cached) return cached
  const raw = typeof window !== 'undefined'
    ? (window as unknown as { __RUNTIME_CONFIG__?: RawRuntimeConfig }).__RUNTIME_CONFIG__
    : undefined
  cached = parseKailoRuntimeConfig(raw)
  return cached
}

export function isKailoMode(): boolean {
  return kailoConfig().mode
}

/** Test seam: forget the cached configuration. */
export function resetKailoConfigForTest(): void {
  cached = null
}
