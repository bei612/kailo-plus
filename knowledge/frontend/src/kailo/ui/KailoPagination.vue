<template>
  <!-- DD-167 (20 §15.3): the Kailo pagination bar. Full form under lists, tables
       and card grids; compact form ("‹ x / y ›") inside list panes. -->
  <nav v-if="compact" class="kailo-pager kailo-pager--compact" :aria-label="text('page.label')">
    <span class="kailo-pager__total">{{ text('page.total', { n: total }) }}</span>
    <span v-if="count > 1" class="kailo-pager__compact">
      <button type="button" class="kailo-pager__icon" :disabled="current <= 1" :aria-label="text('page.prev')"
        :title="text('page.prev')" @click="go(current - 1)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
      </button>
      <span class="kailo-pager__position">{{ current }} / {{ count }}</span>
      <button type="button" class="kailo-pager__icon" :disabled="current >= count" :aria-label="text('page.next')"
        :title="text('page.next')" @click="go(current + 1)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
      </button>
    </span>
  </nav>
  <nav v-else class="kailo-pager" :aria-label="text('page.label')">
    <span class="kailo-pager__total">{{ text('page.total', { n: total }) }}</span>
    <div v-if="count > 1 || total > Math.min(...sizes)" class="kailo-pager__controls">
      <t-select v-if="sizes.length > 1" class="kailo-pager__size" size="small" :model-value="pageSize"
        :options="sizeOptions" :popup-props="{ overlayClassName: 'kailo-pager__size-popup' }" auto-width
        @change="(value: unknown) => emit('update:pageSize', Number(value))" />
      <template v-if="count > 1">
        <span class="kailo-pager__position">{{ text('page.of', { x: current, y: count }) }}</span>
        <button type="button" class="kailo-pager__icon" :disabled="current <= 1" :aria-label="text('page.prev')"
          :title="text('page.prev')" @click="go(current - 1)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
        </button>
        <template v-for="token in tokens" :key="String(token)">
          <span v-if="typeof token !== 'number'" class="kailo-pager__gap" aria-hidden="true">…</span>
          <button v-else type="button" class="kailo-pager__page" :class="{ 'is-current': token === current }"
            :aria-current="token === current ? 'page' : undefined" :aria-label="text('page.goto', { n: token })"
            @click="go(token)">{{ token }}</button>
        </template>
        <button type="button" class="kailo-pager__icon" :disabled="current >= count" :aria-label="text('page.next')"
          :title="text('page.next')" @click="go(current + 1)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
        </button>
      </template>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LIST_PAGE_SIZES, clampPage, pageCount, pageTokens } from '../listing'
import { ux, type UxKey } from '../uxText'

const props = withDefaults(defineProps<{
  total: number
  page: number
  pageSize: number
  /** 20/50/100 under lists, 24/48/96 under card grids. */
  sizes?: readonly number[]
  /** The pane form: "共 N 条" and "‹ x / y ›". */
  compact?: boolean
}>(), { sizes: () => LIST_PAGE_SIZES, compact: false })

const emit = defineEmits<{
  (event: 'update:page', page: number): void
  (event: 'update:pageSize', size: number): void
}>()

const { locale } = useI18n()
const text = (key: UxKey, params?: Record<string, string | number>) => ux(key, locale.value, params)

const count = computed(() => pageCount(props.total, props.pageSize))
const current = computed(() => clampPage(props.page, props.total, props.pageSize))
const tokens = computed(() => pageTokens(current.value, count.value))
const sizeOptions = computed(() => props.sizes.map((size) => ({ value: size, label: text('page.size', { n: size }) })))

function go(page: number) {
  const next = clampPage(page, props.total, props.pageSize)
  if (next !== current.value) emit('update:page', next)
}
</script>

<style scoped>
.kailo-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
  padding: 0 4px;
  border-top: 1px solid var(--kailo-color-border);
  color: var(--kailo-color-muted-foreground);
  font: 400 var(--kailo-text-caption)/16px var(--kailo-font-sans);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.kailo-pager--compact {
  min-height: 40px;
  padding: 0 8px;
  gap: 8px;
}

.kailo-pager__controls,
.kailo-pager__compact {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.kailo-pager__position {
  margin: 0 8px;
  color: var(--kailo-color-muted-foreground);
  white-space: nowrap;
}

.kailo-pager--compact .kailo-pager__position {
  margin: 0 2px;
  min-width: 40px;
  text-align: center;
  color: var(--kailo-color-foreground);
}

.kailo-pager__size {
  width: auto;
  margin-right: 4px;
}

.kailo-pager__size :deep(.t-input) {
  height: 28px;
  font-size: var(--kailo-text-caption);
}

.kailo-pager__icon,
.kailo-pager__page {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--kailo-radius-md);
  background: transparent;
  color: var(--kailo-color-foreground);
  font: 500 var(--kailo-text-callout)/20px var(--kailo-font-sans);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color var(--kailo-duration-fast) var(--kailo-ease-standard),
    color var(--kailo-duration-fast) var(--kailo-ease-standard);
}

.kailo-pager__icon svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.kailo-pager__icon:hover:not(:disabled),
.kailo-pager__page:hover:not(.is-current) {
  background: var(--kailo-color-hover);
}

.kailo-pager__icon:disabled {
  color: var(--kailo-color-text-disabled);
  cursor: default;
}

.kailo-pager__page.is-current {
  background: var(--kailo-color-selected);
  color: var(--kailo-color-selected-foreground);
  cursor: default;
}

.kailo-pager__icon:focus-visible,
.kailo-pager__page:focus-visible {
  outline: none;
  box-shadow: var(--kailo-focus-ring);
}

.kailo-pager__gap {
  min-width: 20px;
  text-align: center;
  color: var(--kailo-color-muted-foreground);
}
</style>
