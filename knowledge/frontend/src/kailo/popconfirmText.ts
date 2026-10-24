// DD-157 (20 §13.4): the text of a <t-popconfirm> as Kailo's confirmation —
// question title, consequence description, danger tone, verb button. Pure
// functions (no TDesign import) so they run under node --test; the component
// lives in ./popconfirm.ts.

import type { KailoConfirm } from './bridge'
import { hostConfirm } from './feedback'

export interface PopconfirmText {
  content?: unknown
  theme?: unknown
  confirmBtn?: unknown
  cancelBtn?: unknown
  /** Accessible name of the trigger element, the verb when the confirm button has none. */
  triggerLabel?: string
}

const LABEL_MAX = 24
/** Confirm-button texts that say nothing about the action (20 §13.6: verbs only). */
const GENERIC_LABELS = new Set(['确认', '确定', '是', '好', '好的', '确认操作', 'ok', 'confirm', 'yes'])

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function buttonText(button: unknown): string {
  if (typeof button === 'string') return squash(button)
  if (button && typeof button === 'object') {
    const content = (button as { content?: unknown }).content
    if (typeof content === 'string') return squash(content)
  }
  return ''
}

function buttonTheme(button: unknown): unknown {
  return button && typeof button === 'object' ? (button as { theme?: unknown }).theme : undefined
}

const SENTENCE_END = /[。！；;!]|\.(?=\s)/g
const QUESTION = /[？?]/

/**
 * Splits a confirmation text into Kailo's question title and consequence
 * description (20 §13.4: "删除 3 个文件？" + what follows). The title is the
 * sentence that asks; text around it is the description. A question whose
 * head is a consequence clause ("删除后…会立即断开，确定删除？") keeps the
 * short asking clause as the title. Text without a question keeps everything
 * as the description and titles it with the confirm verb ("取消上传？").
 */
export function splitQuestion(content: string, verb: string): { title: string; description?: string } {
  const text = squash(content)
  const mark = text.search(QUESTION)
  if (mark < 0) {
    if (!verb) return { title: text }
    const ask = /[㐀-鿿]/.test(text + verb) ? '？' : '?'
    return { title: `${verb}${ask}`, description: text }
  }
  let start = 0
  for (const match of text.slice(0, mark).matchAll(SENTENCE_END)) start = (match.index ?? 0) + match[0].length
  let title = text.slice(start, mark + 1).trim()
  let before = text.slice(0, start).trim()
  // "删除后…会立即断开，确定删除？": a short asking clause after the last comma is the title.
  const zhComma = title.lastIndexOf('，')
  const comma = zhComma > 0 && title.length - zhComma - 1 <= 12 ? zhComma : title.length > 60 ? title.lastIndexOf(', ') : -1
  if (comma > 0) {
    before = `${before}${before ? ' ' : ''}${title.slice(0, comma).trim()}`.trim()
    title = title.slice(comma + 1).trim()
  }
  const after = text.slice(mark + 1).trim()
  const description = [before, after].filter(Boolean).join(' ')
  return description ? { title, description } : { title }
}

/**
 * The Kailo confirmation for a popconfirm, or null when it has no plain-text
 * content (the native bubble is used then).
 */
export function popconfirmRequest(input: PopconfirmText): KailoConfirm | null {
  if (typeof input.content !== 'string' || !squash(input.content)) return null
  const own = buttonText(input.confirmBtn)
  const trigger = squash(input.triggerLabel || '')
  const verb = own && !GENERIC_LABELS.has(own.toLowerCase())
    ? own
    : trigger && trigger.length <= LABEL_MAX ? trigger : own
  const danger = input.theme === 'danger' || buttonTheme(input.confirmBtn) === 'danger'
  const cancel = buttonText(input.cancelBtn)
  const { title, description } = splitQuestion(input.content, verb)
  const request: KailoConfirm = { tone: danger ? 'danger' : 'default', title }
  if (description) request.description = description
  if (verb && verb.length <= LABEL_MAX) request.confirmLabel = verb
  if (cancel && cancel.length <= LABEL_MAX) request.cancelLabel = cancel
  return request
}

// One Kailo dialog per question: several popconfirms bound to one shared
// `visible` (SystemSettings' programmatic confirmations) ask once and all
// receive the same answer.
const inflight = new Map<string, Promise<boolean>>()

export function askHostOnce(request: KailoConfirm, ask: (request: KailoConfirm) => Promise<boolean> | null = hostConfirm): Promise<boolean> | null {
  const key = JSON.stringify(request)
  const existing = inflight.get(key)
  if (existing) return existing
  const pending = ask(request)
  if (!pending) return null
  const settled = pending.catch(() => false).finally(() => inflight.delete(key))
  inflight.set(key, settled)
  return settled
}
