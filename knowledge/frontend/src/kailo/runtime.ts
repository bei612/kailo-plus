// Kailo integration runtime configuration (DD-133).
//
// Values come from window.__RUNTIME_CONFIG__, written by docker-entrypoint.sh
// from the container environment, and the Kailo Web origin from
// <meta name="kailo-web-origin"> (rendered from KAILO_FRAME_ANCESTORS, the same
// deployment fact as frame-ancestors; design 07 §4.7.1). Every reader goes
// through this module so the white-label, silent SSO and logout code share one
// validated view.

export interface KailoRuntimeConfig {
  /** Kailo integration mode: silent SSO, Kailo-managed membership, host bridge. */
  mode: boolean
  /** Kailo deployment display name (platform PLATFORM_DISPLAY_NAME). */
  displayName: string
  /** Exact Kailo Web origins from <meta name="kailo-web-origin"> (http/https only). */
  origins: string[]
  /** Absolute Kailo logout URL for top-level logout; empty when not configured. */
  logoutUrl: string
}

type RawRuntimeConfig = {
  KAILO_MODE?: unknown
  PLATFORM_DISPLAY_NAME?: unknown
  KAILO_LOGOUT_URL?: unknown
}

/** Normalises one origin; returns '' unless it is an exact http(s) origin. */
export function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.username || url.password) return ''
    // Reject anything that is not exactly an origin (paths, queries, fragments).
    if (value.replace(/\/$/, '') !== url.origin) return ''
    return url.origin
  } catch {
    return ''
  }
}

/** Origins listed in the kailo-web-origin meta content (space-separated). */
export function parseWebOrigins(content: string | null | undefined): string[] {
  return Array.from(new Set(String(content || '').split(/\s+/).map(normalizeOrigin).filter(Boolean)))
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

export function parseKailoRuntimeConfig(
  raw: RawRuntimeConfig | undefined | null,
  webOriginContent?: string | null,
): KailoRuntimeConfig {
  const source = raw || {}
  const mode = source.KAILO_MODE === true || String(source.KAILO_MODE ?? '').trim().toLowerCase() === 'true'
  const displayName = typeof source.PLATFORM_DISPLAY_NAME === 'string'
    ? source.PLATFORM_DISPLAY_NAME.trim().slice(0, 80)
    : ''
  const origins = parseWebOrigins(webOriginContent)
  const logoutUrl = typeof source.KAILO_LOGOUT_URL === 'string' ? absoluteHttpURL(source.KAILO_LOGOUT_URL.trim()) : ''
  return { mode, displayName, origins, logoutUrl }
}

let cached: KailoRuntimeConfig | null = null

export function kailoConfig(): KailoRuntimeConfig {
  if (cached) return cached
  const raw = typeof window !== 'undefined'
    ? (window as unknown as { __RUNTIME_CONFIG__?: RawRuntimeConfig }).__RUNTIME_CONFIG__
    : undefined
  let metaContent: string | null = null
  try {
    metaContent = document.querySelector('meta[name="kailo-web-origin"]')?.getAttribute('content') ?? null
  } catch {
    metaContent = null
  }
  cached = parseKailoRuntimeConfig(raw, metaContent)
  return cached
}

export function isKailoMode(): boolean {
  return kailoConfig().mode
}

/** Test seam: forget the cached configuration. */
export function resetKailoConfigForTest(): void {
  cached = null
}
