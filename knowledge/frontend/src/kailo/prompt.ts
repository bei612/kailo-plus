// DD-167 (07 §4.8.10): one line of text from the user (a chat or folder
// name) is asked in Kailo's dialog, whose scrim covers the whole window.
// When Kailo does not offer it (an older host, a top-level visit) the page
// draws the same dialog itself (KailoPromptHost.vue, 20 §9). The answer is
// validated here as well: trimmed, 1–maxLength characters, no control
// characters; anything else is a cancel.

import { shallowRef } from 'vue'
import { kailoEmbed, type KailoEmbedRuntime, type KailoPrompt } from './bridge'

const CONTROL = /[\u0000-\u001f\u007f]/

function squash(text: string | undefined, max: number): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

/** The request within the wire limits (title 120, label 80, description 400, placeholder 80, buttons 24). */
export function promptPayload(options: KailoPrompt): KailoPrompt | null {
  const title = squash(options.title, 120)
  const label = squash(options.label, 80)
  if (!title || !label) return null
  const maxLength = Number.isInteger(options.maxLength) && options.maxLength! >= 1 && options.maxLength! <= 255 ? options.maxLength! : 255
  const out: KailoPrompt = { title, label, maxLength }
  const description = squash(options.description, 400)
  if (description) out.description = description
  const placeholder = squash(options.placeholder, 80)
  if (placeholder) out.placeholder = placeholder
  const value = (options.value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')
  if (value) out.value = value.slice(0, maxLength)
  const confirmLabel = squash(options.confirmLabel, 24)
  if (confirmLabel) out.confirmLabel = confirmLabel
  const cancelLabel = squash(options.cancelLabel, 24)
  if (cancelLabel) out.cancelLabel = cancelLabel
  return out
}

/** A valid answer (trimmed, 1–maxLength characters, no control characters), else null. */
export function promptAnswer(value: unknown, maxLength = 255): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > maxLength || CONTROL.test(text)) return null
  return text
}

/** Kailo's dialog, or null when the page must draw its own. */
export function hostPrompt(options: KailoPrompt, runtime: KailoEmbedRuntime | null = kailoEmbed()): Promise<string | null> | null {
  if (!runtime || typeof runtime.prompt !== 'function') return null
  const payload = promptPayload(options)
  if (!payload) return null
  let pending: Promise<string | null> | null
  try {
    pending = runtime.prompt(payload)
  } catch {
    return null
  }
  if (!pending) return null
  return pending.then((answer) => promptAnswer(answer, payload.maxLength), () => null)
}

export interface PendingPrompt {
  options: KailoPrompt
  resolve: (value: string | null) => void
}

/** The page's own prompt while one is open (drawn by KailoPromptHost.vue). */
export const ownPrompt = shallowRef<PendingPrompt | null>(null)

/**
 * Asks for one line of text: Kailo's dialog when offered, else the page's
 * own. Resolves the validated answer, or null when cancelled. Only one
 * dialog at a time: a second request while one is open is a cancel.
 */
export function askText(options: KailoPrompt, runtime: KailoEmbedRuntime | null = kailoEmbed()): Promise<string | null> {
  const viaHost = hostPrompt(options, runtime)
  if (viaHost) return viaHost
  const payload = promptPayload(options)
  if (!payload || ownPrompt.value) return Promise.resolve(null)
  return new Promise((resolve) => {
    ownPrompt.value = {
      options: payload,
      resolve: (value) => {
        ownPrompt.value = null
        resolve(promptAnswer(value, payload.maxLength))
      },
    }
  })
}
