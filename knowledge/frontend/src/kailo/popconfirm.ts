// DD-157 (07 §4.8.7, 20 §13.4): <t-popconfirm> confirmations go to Kailo's
// confirmation dialog inside the Kailo frame. tdesign-shell.ts registers this
// component under TDesign's own name (TPopconfirm), so every template keeps
// writing <t-popconfirm> with the native props and events.
//
// Inside the frame the trigger click (or a programmatic `visible`) asks Kailo
// instead of opening the bubble: the content becomes a question title plus a
// consequence description, danger when the popconfirm or its confirm button
// is danger, the confirm button keeps its verb. Confirm/cancel then fire the
// native `confirm` / `cancel` handlers. At top level, when Kailo declines, or
// for rich (non-text) content the native popconfirm opens unchanged.

import { defineComponent, getCurrentInstance, h, ref, watch, type Component, type PropType } from 'vue'
import { Popconfirm as NativePopconfirm } from 'tdesign-vue-next'
import { askHostOnce, popconfirmRequest } from './popconfirmText'

function triggerLabelOf(el: unknown): string {
  if (typeof Element === 'undefined' || !(el instanceof Element)) return ''
  const target = el.matches('button, [role="button"]') ? el : el.querySelector('button, [role="button"]') || el
  return (target.getAttribute('aria-label') || target.getAttribute('title') || target.textContent || '').replace(/\s+/g, ' ').trim()
}

type Handler = ((...args: unknown[]) => unknown) | Array<(...args: unknown[]) => unknown> | undefined

function call(handler: Handler, ...args: unknown[]): void {
  if (Array.isArray(handler)) handler.forEach((fn) => fn(...args))
  else if (typeof handler === 'function') handler(...args)
}

export const KailoPopconfirm = defineComponent({
  name: 'TPopconfirm',
  inheritAttrs: false,
  props: {
    visible: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    defaultVisible: { type: Boolean, default: false },
  },
  emits: ['update:visible', 'visible-change'],
  setup(props, { attrs, slots, emit }) {
    const instance = getCurrentInstance()
    // A programmatic `visible` is applied by the watcher below (it may go to Kailo).
    const shown = ref(props.visible === undefined ? props.defaultVisible : false)
    let asking = false

    const settle = (confirmed: boolean) => {
      const event = typeof MouseEvent === 'function' ? new MouseEvent('click') : ({} as MouseEvent)
      call((confirmed ? attrs.onConfirm : attrs.onCancel) as Handler, { e: event })
      if (props.visible !== undefined) emit('update:visible', false)
      emit('visible-change', false, { trigger: confirmed ? 'confirm' : 'cancel', e: event })
    }

    /** Asks Kailo; false when the native bubble must open instead. */
    const askKailo = (): boolean => {
      if (asking) return true
      const request = popconfirmRequest({
        content: attrs.content,
        theme: attrs.theme,
        confirmBtn: attrs.confirmBtn ?? attrs['confirm-btn'],
        cancelBtn: attrs.cancelBtn ?? attrs['cancel-btn'],
        triggerLabel: triggerLabelOf(instance?.proxy?.$el),
      })
      if (!request || slots.content) return false
      const pending = askHostOnce(request)
      if (!pending) return false
      asking = true
      void pending.then((confirmed) => {
        asking = false
        settle(confirmed)
      })
      return true
    }

    // Programmatic opening (v-model:visible).
    watch(() => props.visible, (visible) => {
      if (visible === undefined) return
      if (visible && !shown.value && askKailo()) return
      shown.value = visible
    }, { immediate: true })

    const onVisibleChange = (visible: boolean, context?: unknown) => {
      if (visible && !shown.value && askKailo()) return
      if (props.visible === undefined) shown.value = visible
      emit('update:visible', visible)
      emit('visible-change', visible, context)
    }

    return () => h(NativePopconfirm as Component, { ...attrs, visible: shown.value, onVisibleChange } as Record<string, unknown>, slots)
  },
})
