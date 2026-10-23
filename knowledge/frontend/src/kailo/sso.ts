// Silent single sign-on (DD-133 (2), design 07 §4.7.2).
//
// The native page never shows its own login UI in Kailo mode. Without a
// session it starts the backend OIDC flow: inside the Kailo iframe with
// `prompt=none` (silent, relying on the existing IdP session), at top level
// interactively (the IdP login page is Kailo's login). When the silent attempt
// reports that the IdP has no session, the page asks Kailo to sign in again at
// top level through the platform runtime (wire v1 `auth-required`) instead of
// showing anything inside the iframe.

import { requestTopLevelSignIn, type KailoEmbedRuntime } from './bridge'

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

/**
 * Login view states rendered by the Kailo sign-in page. `host`: Kailo received
 * `auth-required` and alone prompts for the new sign-in (V-SCN-226), so the
 * frame shows no notice of its own; `reauth` is the page's own explanation for
 * when Kailo could not be asked (top level, or no Kailo origin configured).
 */
export type KailoSignInState = 'loading' | 'host' | 'reauth' | 'error'

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

/** Asks Kailo to sign the user in again at top level (runtime `auth-required`). */
export function requestHostReauth(runtime: KailoEmbedRuntime | null): boolean {
  return requestTopLevelSignIn(runtime)
}

/**
 * Asks Kailo for the top-level sign-in and returns the view the frame shows:
 * nothing of its own once Kailo has the request (V-SCN-226), otherwise the
 * page's own re-login explanation.
 */
export function handOverReauth(runtime: KailoEmbedRuntime | null): KailoSignInState {
  return requestHostReauth(runtime) ? 'host' : 'reauth'
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
  | { kind: 'show-reauth' }

/** Kailo Web's post-logout landing path (design 07 §4.7.5: <PUBLIC_ORIGIN>/app/). */
export const KAILO_APP_PATH = '/app/'

/**
 * Logout always ends at Kailo (DD-133 (2)). Kailo's own logout is a POST behind
 * its gateway, so a top-level page goes to the configured Kailo logout URL or
 * to Kailo Web (<origin>/app/), where the user signs out. It never lands on the
 * native /login, which would silently sign straight back in. Inside the frame
 * Kailo owns logout (the item is hidden; wire v1 has no logout message), so
 * only the neutral state is shown.
 */
export function decideLogoutAction(logoutUrl: string, origins: readonly string[], embedded: boolean): LogoutAction {
  if (embedded) return { kind: 'show-reauth' }
  if (logoutUrl) return { kind: 'navigate', url: logoutUrl }
  if (origins.length > 0) return { kind: 'navigate', url: `${origins[0]}${KAILO_APP_PATH}` }
  return { kind: 'show-reauth' }
}
