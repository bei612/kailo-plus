// Silent single sign-on (DD-133 §2).
//
// The native page never shows its own login UI in Kailo mode. Without a
// session it starts the backend OIDC flow: inside the Kailo iframe with
// `prompt=none` (silent, relying on the existing IdP session), at top level
// interactively (the IdP login page is Kailo's login). When the silent attempt
// reports that the IdP has no session, the page asks the Kailo host to sign
// in again at top level instead of showing anything inside the iframe.

import { postToHost, COMPONENT_ID, type HostMessage } from './bridge'

export const OIDC_START_PATH = '/api/v1/auth/oidc/start'
export const DEFAULT_RETURN_PATH = '/platform/knowledge-bases'

/** IdP answers to `prompt=none` meaning "an interactive login is needed". */
export const SILENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'login_required',
  'interaction_required',
  'consent_required',
  'account_selection_required',
])

export const SILENT_GUARD_KEY = 'kailo_silent_sso_at'
export const SILENT_GUARD_MS = 30_000

/** Login view states rendered by the Kailo sign-in page. */
export type KailoSignInState = 'loading' | 'reauth' | 'error'

const AUTH_ENTRY_PATHS = ['/login', '/register']

/**
 * Accepts only same-origin relative paths. Rejects scheme-relative (`//x`),
 * backslash tricks, control characters and the auth entry pages themselves.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_RETURN_PATH
  const raw = value.trim()
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return DEFAULT_RETURN_PATH
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_RETURN_PATH
  const withoutHash = raw.split('#')[0]
  const path = withoutHash.split('?')[0]
  if (AUTH_ENTRY_PATHS.includes(path) || path === '/') return DEFAULT_RETURN_PATH
  return withoutHash.length > 2048 ? DEFAULT_RETURN_PATH : withoutHash
}

/** Backend OIDC start URL; `silent` adds prompt=none. */
export function buildOIDCStartURL(returnTo: string, silent: boolean, apiBase = ''): string {
  const params = new URLSearchParams()
  params.set('return_to', sanitizeReturnTo(returnTo))
  if (silent) params.set('prompt', 'none')
  return `${apiBase.replace(/\/+$/, '')}${OIDC_START_PATH}?${params.toString()}`
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Loop guard: allows at most one silent attempt per SILENT_GUARD_MS per tab.
 * Returns true and records the attempt when allowed.
 */
export function claimSilentAttempt(storage: StorageLike | null | undefined, now: number): boolean {
  let last = 0
  try { last = Number(storage?.getItem(SILENT_GUARD_KEY) || 0) } catch { last = 0 }
  if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < SILENT_GUARD_MS) return false
  try { storage?.setItem(SILENT_GUARD_KEY, String(now)) } catch { /* storage unavailable */ }
  return true
}

export interface OIDCErrorContext {
  code: string
  /** `none` when the failed attempt was silent (backend echoes oidc_prompt). */
  prompt: string | null
  embedded: boolean
  returnTo: string
}

export type OIDCErrorAction =
  | { kind: 'request-host-reauth' }
  | { kind: 'interactive'; url: string }
  | { kind: 'error' }

/** Decides what a Kailo-mode page does with an OIDC callback error. */
export function decideOIDCErrorAction(ctx: OIDCErrorContext, apiBase = ''): OIDCErrorAction {
  const silentFailure = SILENT_ERROR_CODES.has(ctx.code)
  if (!silentFailure) return { kind: 'error' }
  if (ctx.embedded) return { kind: 'request-host-reauth' }
  // Top level: let the IdP (Kailo's login page) authenticate interactively.
  // A failure of an interactive attempt is a real error, never a loop.
  if (ctx.prompt !== 'none') return { kind: 'error' }
  return { kind: 'interactive', url: buildOIDCStartURL(ctx.returnTo, false, apiBase) }
}

export function authRequiredMessage(): HostMessage {
  return { type: 'kailo:auth-required', component: COMPONENT_ID }
}

export function logoutRequestMessage(): HostMessage {
  return { type: 'kailo:logout-request', component: COMPONENT_ID }
}

type HostWindow = Parameters<typeof postToHost>[0]

/** Asks the Kailo host to sign the user in again at top level. */
export function requestHostReauth(win: HostWindow, origins: readonly string[]): number {
  return postToHost(win, origins, authRequiredMessage())
}

export function signInRoute(state: KailoSignInState, returnTo?: string): string {
  const params = new URLSearchParams()
  if (state !== 'loading') params.set('kailo_state', state)
  if (returnTo) params.set('redirect', sanitizeReturnTo(returnTo))
  const query = params.toString()
  return query ? `/login?${query}` : '/login'
}

export type LogoutAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'request-host-logout' }
  | { kind: 'show-reauth' }

/**
 * Logout always ends at Kailo (DD-133 §2). Kailo's own logout is a POST behind
 * its gateway, so a top-level page goes to the configured Kailo logout URL or
 * back to Kailo itself, where the user signs out. It never lands on the native
 * /login, which would silently sign straight back in. Inside the frame the
 * Kailo host is asked to log out.
 */
export function decideLogoutAction(logoutUrl: string, origins: readonly string[], framed: boolean): LogoutAction {
  if (framed) return { kind: 'request-host-logout' }
  if (logoutUrl) return { kind: 'navigate', url: logoutUrl }
  const home = origins.find(origin => origin.startsWith('http://') || origin.startsWith('https://'))
  if (home) return { kind: 'navigate', url: `${home}/` }
  return { kind: 'show-reauth' }
}

export function requestHostLogout(win: HostWindow, origins: readonly string[]): number {
  return postToHost(win, origins, logoutRequestMessage())
}
