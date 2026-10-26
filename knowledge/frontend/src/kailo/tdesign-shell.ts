// DD-157 (07 §4.8.7, 20 §13.6): the single exit for TDesign's imperative
// feedback. vite.config.ts resolves every `import … from 'tdesign-vue-next'`
// in this app to this module (this module itself gets the real package), so
// the ~800 native MessagePlugin calls and the DialogPlugin confirmations reach
// Kailo's toast and confirmation inside the Kailo frame without touching each
// call site. At top level, or whenever Kailo declines (non-text content,
// labels over the runtime limits), the native TDesign UI is used unchanged.
// <t-popconfirm> (55 trigger-bound confirmations) is registered as the Kailo
// popconfirm (./popconfirm.ts) under TDesign's own component name.

import NativeTDesign, {
  DialogPlugin as NativeDialogPlugin,
  MessagePlugin as NativeMessagePlugin,
} from 'tdesign-vue-next'
import type { DialogInstance, DialogOptions, MessageInstance } from 'tdesign-vue-next'
import type { App, Component } from 'vue'
import { hostConfirm, hostToast, type ToastTone } from './feedback'
import { KailoPopconfirm } from './popconfirm'

export * from 'tdesign-vue-next'
export { KailoPopconfirm as Popconfirm }

type InstallArgs = Parameters<typeof NativeTDesign.install>

/**
 * TDesign's plugin with <t-popconfirm> bound to the Kailo popconfirm. TDesign
 * registers each component through app.component(name, …); the TPopconfirm
 * registration is swapped while it installs, so no component is registered twice.
 */
const KailoTDesign: typeof NativeTDesign = {
  ...NativeTDesign,
  install(app: App, config?: InstallArgs[1]) {
    const original = app.component
    const register = original.bind(app) as (name: string, component?: Component) => unknown
    app.component = ((name: string, component?: Component) => (component === undefined
      ? register(name)
      : register(name, name === 'TPopconfirm' ? KailoPopconfirm : component))) as App['component']
    try {
      NativeTDesign.install(app, config)
    } finally {
      app.component = original
    }
  },
}

export default KailoTDesign

const settledInstance: MessageInstance = { close: () => {} }

/** The text of a message argument, or null when it is not plain text. */
export function messageText(message: unknown): string | null {
  if (typeof message === 'string') return message
  if (message && typeof message === 'object') {
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') return content
  }
  return null
}

type ToneMethod = (message: never, duration?: number) => Promise<MessageInstance>

function routed(tone: ToastTone, native: ToneMethod): ToneMethod {
  return ((message: never, duration?: number) => {
    const text = messageText(message)
    if (text !== null && hostToast(tone, text)) return Promise.resolve(settledInstance)
    return native(message, duration)
  }) as ToneMethod
}

const TONE_OF_THEME: Record<string, ToastTone> = { success: 'success', info: 'info', warning: 'warning', error: 'error' }

const messageCall = ((theme: string, message: never, duration?: number) => {
  const tone = TONE_OF_THEME[theme]
  const text = messageText(message)
  if (tone && text !== null && hostToast(tone, text)) return Promise.resolve(settledInstance)
  return (NativeMessagePlugin as unknown as (t: string, m: never, d?: number) => Promise<MessageInstance>)(theme, message, duration)
})

export const MessagePlugin: typeof NativeMessagePlugin = Object.assign(messageCall, NativeMessagePlugin, {
  success: routed('success', NativeMessagePlugin.success as ToneMethod),
  info: routed('info', NativeMessagePlugin.info as ToneMethod),
  warning: routed('warning', NativeMessagePlugin.warning as ToneMethod),
  error: routed('error', NativeMessagePlugin.error as ToneMethod),
}) as unknown as typeof NativeMessagePlugin

function buttonLabel(button: unknown): string | undefined {
  if (typeof button === 'string') return button
  if (button && typeof button === 'object') {
    const content = (button as { content?: unknown }).content
    if (typeof content === 'string') return content
  }
  return undefined
}

function isDanger(options: DialogOptions): boolean {
  if (options.theme === 'danger') return true
  const confirm = options.confirmBtn
  return !!confirm && typeof confirm === 'object' && (confirm as { theme?: unknown }).theme === 'danger'
}

const inertInstance: DialogInstance = {
  destroy: () => {},
  hide: () => {},
  setConfirmLoading: () => {},
  show: () => {},
  update: () => {},
}

/**
 * A text confirmation shown by Kailo; returns null when the native dialog must
 * be used (rich header/body, or Kailo not available).
 */
export function confirmThroughHost(options: DialogOptions): DialogInstance | null {
  const header = typeof options.header === 'string' ? options.header : null
  const body = typeof options.body === 'string' ? options.body : options.body === undefined ? '' : null
  if (body === null || (!header && !body)) return null
  const title = header || body
  const description = header ? body : ''
  const pending = hostConfirm({
    tone: isDanger(options) ? 'danger' : 'default',
    title,
    description: description || undefined,
    confirmLabel: buttonLabel(options.confirmBtn),
    cancelLabel: buttonLabel(options.cancelBtn),
  })
  if (!pending) return null
  const event = typeof MouseEvent === 'function' ? new MouseEvent('click') : ({} as MouseEvent)
  void pending.then((confirmed) => {
    if (confirmed) options.onConfirm?.({ e: event })
    else {
      options.onCancel?.({ e: event })
      options.onClose?.({ trigger: 'cancel', e: event })
    }
  })
  return inertInstance
}

const dialogConfirm = (options?: DialogOptions, context?: Parameters<typeof NativeDialogPlugin.confirm>[1]) =>
  (options && confirmThroughHost(options)) || NativeDialogPlugin.confirm(options, context)

export const DialogPlugin: typeof NativeDialogPlugin = Object.assign(
  ((options?: DialogOptions, context?: Parameters<typeof NativeDialogPlugin>[1]) => NativeDialogPlugin(options, context)),
  NativeDialogPlugin,
  { confirm: dialogConfirm },
) as unknown as typeof NativeDialogPlugin
