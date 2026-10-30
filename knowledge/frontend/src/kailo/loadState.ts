// DD-167 (design 20 §15.4): what a failed read means for the person looking
// at the page. A read failure is shown in place (never a toast, never a jump
// back to the list); a refusal — HTTP 403, Kailo's KAILO_MANAGED /
// KAILO_ADMIN_REQUIRED, or an object this person cannot see — is a
// permission state without a retry and without internal codes.

export type LoadErrorKind = 'forbidden' | 'notFound' | 'network' | 'timeout' | 'unavailable' | 'unknown'

const FORBIDDEN_CODES = new Set(['KAILO_MANAGED', 'KAILO_ADMIN_REQUIRED', 'PERMISSION_DENIED', 'FORBIDDEN'])

function statusOf(error: Record<string, unknown>): number {
  for (const value of [error.status, error.$httpStatus, (error.response as { status?: unknown } | undefined)?.status]) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : NaN
    if (Number.isFinite(n)) return n
  }
  return 0
}

function codeOf(error: Record<string, unknown>): string {
  const nested = error.error && typeof error.error === 'object' ? (error.error as { code?: unknown }).code : undefined
  for (const value of [error.code, nested]) if (typeof value === 'string' && value) return value.toUpperCase()
  return ''
}

/** Classifies a rejected request (utils/request.ts shapes, axios errors, plain Errors). */
export function classifyLoadError(error: unknown): LoadErrorKind {
  if (!error || typeof error !== 'object') return 'unknown'
  const e = error as Record<string, unknown>
  if (e.kind === 'timeout') return 'timeout'
  if (e.kind === 'network') return 'network'
  const code = codeOf(e)
  if (FORBIDDEN_CODES.has(code)) return 'forbidden'
  const status = statusOf(e)
  if (status === 403) return 'forbidden'
  if (status === 404 || status === 410) return 'notFound'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 502 || status === 503 || status === 500) return 'unavailable'
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout'
  if (code === 'ERR_NETWORK') return 'network'
  return 'unknown'
}

/** Whether the state offers a retry (a refusal does not: retrying cannot change it). */
export function canRetry(kind: LoadErrorKind): boolean {
  return kind !== 'forbidden' && kind !== 'notFound'
}
