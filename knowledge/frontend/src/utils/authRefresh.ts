/**
 * Shared access-token refresh used by both axios and the chat SSE client.
 *
 * Refresh tokens rotate, so concurrent 401s must queue behind one in-flight
 * /auth/refresh. The SSE handshake runs on raw fetch and cannot use the
 * axios interceptor; both planes call {@link refreshAccessTokenShared}.
 */

const AUTH_STORAGE_KEYS = [
  'weknora_token',
  'weknora_refresh_token',
  'weknora_user',
  'weknora_tenant',
  'weknora_knowledge_bases',
  'weknora_current_kb',
  'weknora_selected_tenant_id',
  'weknora_selected_tenant_name',
  'weknora_memberships',
] as const

type RefreshSession = {
  token: string | null
  refreshToken: string | null
  pending?: Promise<string>
}
let currentSession: RefreshSession | undefined

function sessionMatchesStorage(session: RefreshSession): boolean {
  return session === currentSession &&
    session.token === localStorage.getItem('weknora_token') &&
    session.refreshToken === localStorage.getItem('weknora_refresh_token')
}

// A request-local ownership snapshot, not a new persisted session or authority.
// Class identity survives axios config merging; only this module's successful
// refresh may advance the captured session's credentials.
export class AuthRequestContext {
  readonly initialToken: string | null
  readonly tenantId = localStorage.getItem('weknora_selected_tenant_id')

  constructor(private readonly session: RefreshSession) {
    this.initialToken = session.token
  }

  isCurrent(): boolean {
    return sessionMatchesStorage(this.session) &&
      this.tenantId === localStorage.getItem('weknora_selected_tenant_id')
  }

  assertCurrent(message = defaultMessages.pleaseRelogin): void {
    if (!this.isCurrent()) throw new Error(message)
  }

  get token(): string | null {
    this.assertCurrent()
    return this.session.token
  }
}

export function captureAuthRequestContext(): AuthRequestContext {
  if (!currentSession || !sessionMatchesStorage(currentSession)) {
    currentSession = {
      token: localStorage.getItem('weknora_token'),
      refreshToken: localStorage.getItem('weknora_refresh_token'),
    }
  }
  return new AuthRequestContext(currentSession)
}

export function invalidateAuthRequestContext(): void {
  currentSession = undefined
}

export type TokenRefreshResult = {
  success: boolean
  data?: { token: string; refreshToken: string }
  message?: string
}

export type RefreshAccessTokenOptions = {
  context?: AuthRequestContext
  refresh?: (refreshToken: string) => Promise<TokenRefreshResult>
  messages?: {
    pleaseRelogin: string
    tokenRefreshFailed: string
  }
}

const defaultMessages = {
  pleaseRelogin: 'Please log in again',
  tokenRefreshFailed: 'Token refresh failed',
}

export class StreamAuthError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'StreamAuthError'
  }
}

export function isStreamAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  if (err instanceof StreamAuthError) return true
  return (err as { name?: string }).name === 'StreamAuthError'
}

export function isEmbedPage(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/embed/')
}

export function redirectToLogin() {
  if (typeof window === 'undefined') return
  if (window.location.pathname === '/login') return
  if (isEmbedPage()) return
  window.location.href = '/login'
}

export function clearAuthStorage() {
  invalidateAuthRequestContext()
  for (const key of AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key)
  }
}

export function forceReloginRedirect() {
  clearAuthStorage()
  redirectToLogin()
}

async function defaultRefresh(refreshToken: string): Promise<TokenRefreshResult> {
  const { refreshToken: refreshTokenAPI } = await import('../api/auth/index')
  return refreshTokenAPI(refreshToken)
}

/**
 * Refresh the access token, de-duplicated only within the original session.
 *
 * Resolves with the new access token. On failure it has already cleared
 * credentials and redirected to /login only if that session still owns them.
 */
export async function refreshAccessTokenShared(
  options: RefreshAccessTokenOptions = {},
): Promise<string> {
  const messages = { ...defaultMessages, ...options.messages }
  const refresh = options.refresh ?? defaultRefresh
  const context = options.context ?? captureAuthRequestContext()
  context.assertCurrent(messages.pleaseRelogin)
  const session = currentSession!
  // Another request already rotated these exact credentials. Do not submit
  // the old refresh token again after its successful single-flight finished.
  if (session.token && context.initialToken !== session.token) return session.token

  if (!session.pending) {
    session.pending = (async () => {
      try {
        if (!session.refreshToken) throw new Error(messages.pleaseRelogin)
        const response = await refresh(session.refreshToken)
        if (!sessionMatchesStorage(session)) throw new Error(messages.pleaseRelogin)
        if (!response.success || !response.data?.token) {
          throw new Error(response.message || messages.tokenRefreshFailed)
        }
        const { token, refreshToken: newRefreshToken } = response.data
        localStorage.setItem('weknora_token', token)
        if (newRefreshToken) localStorage.setItem('weknora_refresh_token', newRefreshToken)
        session.token = token
        session.refreshToken = newRefreshToken || session.refreshToken
        return token
      } catch (refreshError) {
        // A stale success/failure must never overwrite or log out a newer
        // login (including a new login by the same human).
        if (context.isCurrent()) forceReloginRedirect()
        throw refreshError
      }
    })().finally(() => { session.pending = undefined })
  }
  const token = await session.pending
  context.assertCurrent(messages.pleaseRelogin)
  return token
}

/**
 * Replay an SSE handshake once after a 401. Refresh failure already
 * redirected; a second 401 after a successful refresh is surfaced to the
 * caller without wiping the newly minted session (axios does the same).
 *
 * Returns undefined when a newer send or an abort superseded the replay.
 */
export async function runStreamWithAuthRetry<T>(options: {
  run: (token: string) => Promise<T>
  initialToken: string
  isEmbed: boolean
  isCurrent: () => boolean
  refreshAccessToken: () => Promise<string>
  reloginMessage: string
}): Promise<T | undefined> {
  try {
    return await options.run(options.initialToken)
  } catch (err) {
    if (!isStreamAuthError(err) || options.isEmbed) throw err

    let refreshedToken: string
    try {
      refreshedToken = await options.refreshAccessToken()
    } catch {
      throw new Error(options.reloginMessage)
    }

    if (!options.isCurrent()) return undefined

    try {
      return await options.run(refreshedToken)
    } catch (retryErr) {
      if (isStreamAuthError(retryErr)) {
        throw new Error(options.reloginMessage)
      }
      throw retryErr
    }
  }
}

/** Reset module locks between unit tests. */
export function resetAuthRefreshStateForTests() {
  currentSession = undefined
}
