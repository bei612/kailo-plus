// OIDC callback decisions for the root component in Kailo mode (DD-133 (2)).
// Kept free of Vue/store imports so it can be unit-tested with plain fakes.

import { kailoConfig, type KailoRuntimeConfig } from './runtime'
import { isEmbedded, kailoEmbed } from './bridge'
import {
  DEFAULT_RETURN_PATH,
  decideOIDCErrorAction,
  requestHostReauth,
  sanitizeReturnTo,
  signInRoute,
} from './sso'

type CallbackWindow = {
  /** The platform runtime installed by kailo-embed.js. */
  KailoEmbed?: unknown
  location: { replace?: (url: string) => void }
}

export interface CallbackEnv {
  win: CallbackWindow
  /** Defaults to the page document; the runtime marks <html data-kailo-embedded>. */
  doc?: Parameters<typeof isEmbedded>[0]
  config?: KailoRuntimeConfig
  apiBase?: string
}

/** Path the backend returned to (`<return_to>#oidc_...`), before the hash is cleared. */
export function callbackPath(location: { pathname?: unknown; search?: unknown }): string {
  const pathname = typeof location.pathname === 'string' ? location.pathname : ''
  const search = typeof location.search === 'string' ? location.search : ''
  return pathname ? pathname + search : ''
}

/**
 * Kailo-mode handling of `#oidc_error`. Returns the route to show, '' when the
 * page is navigating away (interactive restart), or null outside Kailo mode
 * so the caller keeps the native behaviour.
 */
export function resolveOIDCErrorRoute(
  code: string,
  prompt: string | null,
  returnPath: string,
  env: CallbackEnv,
): string | null {
  const cfg = env.config ?? kailoConfig()
  if (!cfg.mode) return null
  const embedded = isEmbedded(env.doc)
  const returnTo = sanitizeReturnTo(returnPath)
  const action = decideOIDCErrorAction({ code, prompt, embedded, returnTo }, env.apiBase ?? '')
  if (action.kind === 'request-host-reauth') {
    requestHostReauth(kailoEmbed(env.win))
    return signInRoute('reauth', returnTo)
  }
  if (action.kind === 'interactive') {
    env.win.location.replace?.(action.url)
    return ''
  }
  return signInRoute('error', returnTo)
}

/** Where a successful callback lands: the page the user asked for in Kailo mode. */
export function resolveSuccessRoute(returnPath: string, fallback: string, config?: KailoRuntimeConfig): string {
  const cfg = config ?? kailoConfig()
  if (!cfg.mode || !returnPath) return fallback
  const target = sanitizeReturnTo(returnPath)
  return target === DEFAULT_RETURN_PATH ? fallback : target
}

/** Native invitations do not exist in Kailo mode (membership comes from Kailo). */
export function nativeInvitationsEnabled(config?: KailoRuntimeConfig): boolean {
  return !(config ?? kailoConfig()).mode
}

/** Silent sign-in is invisible in Kailo mode: no native "signed in" notice. */
export function nativeLoginNoticeEnabled(config?: KailoRuntimeConfig): boolean {
  return !(config ?? kailoConfig()).mode
}
