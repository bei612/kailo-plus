// DD-165/DD-167 (07 §4.8.9): a question Kailo's quota refused is answered with
// a notice in place of the answer. The server names the decision in the error
// details ({"kailo_usage": "<decision>"}); the page words it from ./uxText in
// the current Kailo language, so a language switch re-words it live.

import { isQuotaDecision, type QuotaDecision } from './uxText'

/** The refusal decision of an error response body, or null when it is no quota refusal. */
export function quotaDecisionOf(body: unknown): QuotaDecision | null {
  if (!body || typeof body !== 'object') return null
  const error = (body as { error?: unknown }).error
  const details = error && typeof error === 'object' ? (error as { details?: unknown }).details : undefined
  const decision = details && typeof details === 'object' ? (details as { kailo_usage?: unknown }).kailo_usage : undefined
  return isQuotaDecision(decision) ? decision : null
}

/** Thrown by the answer stream when Kailo's quota refused the question. */
export class KailoUsageRefusal extends Error {
  readonly decision: QuotaDecision
  constructor(decision: QuotaDecision, message = '') {
    super(message || decision)
    this.name = 'KailoUsageRefusal'
    this.decision = decision
  }
}

/** Reads the refusal of a failed stream response (429/503), else null; never throws. */
export async function readQuotaRefusal(response: { status: number; clone?: () => { json(): Promise<unknown> }; json?: () => Promise<unknown> }): Promise<QuotaDecision | null> {
  if (response.status !== 429 && response.status !== 503) return null
  try {
    const source = typeof response.clone === 'function' ? response.clone() : response
    return quotaDecisionOf(await (source as { json(): Promise<unknown> }).json())
  } catch {
    return null
  }
}
