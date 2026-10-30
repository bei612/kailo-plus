<template>
  <!-- DD-167 (20 §15.4, §9): the in-place states of a list or detail area —
       empty, filtered empty, read error, permission refused, not set up. -->
  <div class="kailo-state" :class="[`kailo-state--${kind}`, { 'kailo-state--compact': compact }]"
    :role="kind === 'error' ? 'alert' : 'status'">
    <svg class="kailo-state__art" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style="stop-color: var(--kailo-color-brand-400, #a09aff)" />
          <stop offset="0.55" style="stop-color: var(--kailo-color-brand, #6d4fed)" />
          <stop offset="1" style="stop-color: var(--kailo-color-brand-700, #593cc9)" />
        </linearGradient>
      </defs>
      <g :stroke="`url(#${gradientId})`" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <template v-if="kind === 'forbidden'">
          <rect x="16" y="28" width="32" height="24" rx="6" />
          <path d="M22 28v-6a10 10 0 0 1 20 0v6" />
          <path d="M32 37v6" />
          <circle cx="32" cy="37" r="1.5" />
        </template>
        <template v-else-if="kind === 'error'">
          <path d="M20 44h26a10 10 0 0 0 1-19.9A14 14 0 0 0 20.2 22 11 11 0 0 0 20 44Z" />
          <path d="M33 29v8" />
          <circle cx="33" cy="41.5" r="0.9" />
        </template>
        <template v-else-if="kind === 'filtered'">
          <circle cx="28" cy="28" r="12" />
          <path d="m37 37 10 10" />
          <path d="M23 28h10" />
        </template>
        <template v-else-if="kind === 'unconfigured'">
          <circle cx="32" cy="32" r="6" />
          <path d="M32 14v6M32 44v6M14 32h6M44 32h6M19.3 19.3l4.3 4.3M40.4 40.4l4.3 4.3M19.3 44.7l4.3-4.3M40.4 23.6l4.3-4.3" />
        </template>
        <template v-else-if="art === 'chat'">
          <path d="M14 20a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H28l-9 7v-7a6 6 0 0 1-5-6Z" />
          <path d="M24 26h16M24 32h10" />
        </template>
        <template v-else-if="art === 'document'">
          <path d="M20 10h17l11 11v29a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4Z" />
          <path d="M37 10v11h11" />
          <path d="M23 32h18M23 39h18M23 46h10" />
        </template>
        <template v-else-if="art === 'star'">
          <path d="m32 12 6 12.6 13.8 1.8-10.1 9.6 2.6 13.7L32 43l-12.3 6.7 2.6-13.7-10.1-9.6L26 24.6Z" />
        </template>
        <template v-else>
          <path d="M14 16a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v34a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2Z" />
          <path d="M30 18a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v32a2 2 0 0 1-2 2H32a2 2 0 0 1-2-2Z" />
          <path d="m44 19 5-1.4a3 3 0 0 1 3.7 2.1l7.6 28.4a2 2 0 0 1-1.4 2.4l-5.2 1.4" />
          <path d="M20 22h4M36 24h2" />
        </template>
      </g>
    </svg>
    <div class="kailo-state__title">{{ title }}</div>
    <div v-if="description" class="kailo-state__desc">{{ description }}</div>
    <div v-if="$slots.default || actionLabel" class="kailo-state__actions">
      <slot>
        <t-button :theme="actionPrimary ? 'primary' : 'default'" :variant="actionPrimary ? 'base' : 'outline'"
          @click="emit('action')">{{ actionLabel }}</t-button>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
export type KailoStateKind = 'empty' | 'filtered' | 'error' | 'forbidden' | 'unconfigured'

withDefaults(defineProps<{
  kind: KailoStateKind
  title: string
  description?: string
  /** One action under the text (create, clear filters, retry). */
  actionLabel?: string
  actionPrimary?: boolean
  /** Illustration of an empty state: the kind of object that is missing. */
  art?: 'library' | 'document' | 'chat' | 'star'
  /** Smaller form for panes and filtered results. */
  compact?: boolean
}>(), { description: '', actionLabel: '', actionPrimary: false, art: 'library', compact: false })

const emit = defineEmits<{ (event: 'action'): void }>()

// One gradient per instance: several states can be on screen at once.
const gradientId = `kailo-state-art-${Math.random().toString(36).slice(2, 10)}`
</script>

<style scoped>
.kailo-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  padding: 48px 24px;
  text-align: center;
}

.kailo-state--compact {
  min-height: 0;
  padding: 32px 16px;
}

.kailo-state__art {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
}

.kailo-state--compact .kailo-state__art {
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
}

.kailo-state__title {
  max-width: 480px;
  color: var(--kailo-color-foreground);
  font: 600 var(--kailo-text-title2)/24px var(--kailo-font-sans);
  letter-spacing: -0.012em;
}

.kailo-state--compact .kailo-state__title {
  font: 600 var(--kailo-text-headline)/22px var(--kailo-font-sans);
}

.kailo-state__desc {
  max-width: 420px;
  margin-top: 6px;
  color: var(--kailo-color-muted-foreground);
  font: 400 var(--kailo-text-body)/20px var(--kailo-font-sans);
}

.kailo-state--compact .kailo-state__desc {
  font-size: var(--kailo-text-callout);
}

.kailo-state__actions {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}
</style>
