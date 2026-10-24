// DD-157 (07 §4.8.7, 20 §13): one notification and one confirmation surface.
// Inside the Kailo frame toasts and confirmations are shown by Kailo; at top
// level (or when Kailo declines) the caller keeps its own, Kailo-styled UI.

import { kailoEmbed, type KailoConfirm, type KailoEmbedRuntime, type KailoToast } from './bridge'

export type ToastTone = NonNullable<KailoToast['tone']>

const TITLE_MAX = 120
const DESCRIPTION_MAX = 280

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * A message as a Kailo toast: short text is the title; a long one is split at
 * the first sentence end that fits the title, the rest becomes the description.
 * Returns null for empty text.
 */
export function toastPayload(tone: ToastTone, message: string): KailoToast | null {
  const text = squash(typeof message === 'string' ? message : '')
  if (!text) return null
  if (text.length <= TITLE_MAX) return { tone, title: text }
  const head = text.slice(0, TITLE_MAX)
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('. '), head.lastIndexOf('; '))
  if (cut > 0) {
    const title = squash(text.slice(0, cut + 1))
    const rest = squash(text.slice(cut + 1))
    return rest ? { tone, title, description: clip(rest, DESCRIPTION_MAX) } : { tone, title }
  }
  return { tone, title: clip(text, TITLE_MAX), description: clip(text, DESCRIPTION_MAX) }
}

/** Shows the message through Kailo; false when the caller must show its own. */
export function hostToast(tone: ToastTone, message: string, runtime: KailoEmbedRuntime | null = kailoEmbed()): boolean {
  if (!runtime || typeof runtime.toast !== 'function') return false
  const payload = toastPayload(tone, message)
  if (!payload) return false
  try {
    return runtime.toast(payload) === true
  } catch {
    return false
  }
}

/** Kailo's confirmation dialog, or null when the caller must use its own. */
export function hostConfirm(options: KailoConfirm, runtime: KailoEmbedRuntime | null = kailoEmbed()): Promise<boolean> | null {
  if (!runtime || typeof runtime.confirm !== 'function') return null
  const title = squash(options.title || '')
  if (!title) return null
  const description = options.description ? squash(options.description) : ''
  try {
    return runtime.confirm({
      tone: options.tone ?? 'default',
      title: clip(title, TITLE_MAX),
      ...(description ? { description: clip(description, 400) } : {}),
      ...(options.confirmLabel ? { confirmLabel: options.confirmLabel } : {}),
      ...(options.cancelLabel ? { cancelLabel: options.cancelLabel } : {}),
    })
  } catch {
    return null
  }
}
