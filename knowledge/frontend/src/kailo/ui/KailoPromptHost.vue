<template>
  <!-- DD-167 (07 §4.8.10, 20 §9): the page's own one-line dialog, used only when
       Kailo does not offer `prompt` (an older host or a top-level visit). -->
  <Teleport to="body">
    <div v-if="pending" class="kailo-prompt" @mousedown.self="cancel">
      <form class="kailo-prompt__dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId"
        @submit.prevent="confirm" @keydown.esc.prevent.stop="cancel">
        <h2 :id="titleId" class="kailo-prompt__title">{{ pending.options.title }}</h2>
        <p v-if="pending.options.description" class="kailo-prompt__desc">{{ pending.options.description }}</p>
        <label class="kailo-prompt__label" :for="inputId">{{ pending.options.label }}</label>
        <input :id="inputId" ref="input" v-model="value" class="kailo-prompt__input" type="text" autocomplete="off"
          :placeholder="pending.options.placeholder" :maxlength="maxLength + 1" />
        <p v-if="tooLong" class="kailo-prompt__error">{{ text('prompt.tooLong', { n: maxLength }) }}</p>
        <div class="kailo-prompt__actions">
          <t-button theme="default" variant="outline" type="button" @click="cancel">
            {{ pending.options.cancelLabel || text('prompt.cancel') }}
          </t-button>
          <t-button theme="primary" type="submit" :disabled="!valid">
            {{ pending.options.confirmLabel || text('prompt.confirm') }}
          </t-button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ownPrompt, promptAnswer } from '../prompt'
import { ux, type UxKey } from '../uxText'

const { locale } = useI18n()
const text = (key: UxKey, params?: Record<string, string | number>) => ux(key, locale.value, params)

const pending = ownPrompt
const value = ref('')
const input = ref<HTMLInputElement | null>(null)
const titleId = 'kailo-prompt-title'
const inputId = 'kailo-prompt-input'
let returnFocus: HTMLElement | null = null

const maxLength = computed(() => pending.value?.options.maxLength ?? 255)
const tooLong = computed(() => value.value.trim().length > maxLength.value)
const valid = computed(() => promptAnswer(value.value, maxLength.value) !== null)

watch(pending, async (next) => {
  if (!next) return
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  value.value = next.options.value ?? ''
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

function close(answer: string | null) {
  const current = pending.value
  if (!current) return
  current.resolve(answer)
  returnFocus?.focus?.()
  returnFocus = null
}

function confirm() {
  if (valid.value) close(value.value)
}

function cancel() {
  close(null)
}
</script>

<style scoped>
.kailo-prompt {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: hsl(0 0% 0% / 0.4);
  backdrop-filter: blur(2px);
}

:global(html[data-kailo-theme="dark"]) .kailo-prompt {
  background: hsl(0 0% 0% / 0.6);
}

.kailo-prompt__dialog {
  width: 100%;
  max-width: 480px;
  padding: 24px;
  border: 1px solid var(--kailo-color-border);
  border-radius: var(--kailo-radius-2xl);
  background: var(--kailo-color-popover);
  box-shadow: var(--kailo-shadow-xl);
  color: var(--kailo-color-popover-foreground);
}

.kailo-prompt__title {
  margin: 0;
  font: 600 var(--kailo-text-title2)/24px var(--kailo-font-sans);
  letter-spacing: -0.012em;
}

.kailo-prompt__desc {
  margin: 6px 0 0;
  color: var(--kailo-color-text-secondary);
  font: 400 var(--kailo-text-body)/20px var(--kailo-font-sans);
}

.kailo-prompt__label {
  display: block;
  margin: 16px 0 6px;
  color: var(--kailo-color-foreground);
  font: 500 var(--kailo-text-callout)/18px var(--kailo-font-sans);
}

.kailo-prompt__input {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--kailo-color-line-strong);
  border-radius: var(--kailo-radius-md);
  background: var(--kailo-color-background);
  color: var(--kailo-color-foreground);
  font: 400 var(--kailo-text-body)/20px var(--kailo-font-sans);
  outline: none;
  transition: border-color var(--kailo-duration-fast) var(--kailo-ease-standard),
    box-shadow var(--kailo-duration-fast) var(--kailo-ease-standard);
}

.kailo-prompt__input:focus {
  border-color: var(--kailo-color-brand);
  box-shadow: 0 0 0 3px hsl(var(--kailo-hsl-primary) / 0.15);
}

.kailo-prompt__error {
  margin: 6px 0 0;
  color: var(--kailo-color-danger-text);
  font: 400 var(--kailo-text-caption)/16px var(--kailo-font-sans);
}

.kailo-prompt__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
</style>
