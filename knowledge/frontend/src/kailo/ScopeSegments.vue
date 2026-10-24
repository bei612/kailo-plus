<template>
  <!-- DD-152 (20 §13.3): list scopes as a segmented control at the top of the
       content area; replaces the native vertical icon strip inside the Kailo shell. -->
  <div class="kailo-segments" role="tablist" :aria-label="label">
    <button v-for="option in options" :key="option.value" type="button" role="tab" class="kailo-segments__item"
      :class="{ 'is-active': option.value === modelValue }" :aria-selected="option.value === modelValue"
      @click="emit('update:modelValue', option.value)">
      <span>{{ option.label }}</span>
      <span v-if="option.count" class="kailo-segments__count">{{ option.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
export interface ScopeOption {
  value: string
  label: string
  count?: number
}

defineProps<{
  modelValue: string
  options: ScopeOption[]
  label?: string
}>()

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()
</script>

<style scoped>
.kailo-segments {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--kailo-radius-lg, 8px);
  background: var(--kailo-color-hover);
}

.kailo-segments__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--kailo-radius-md, 6px);
  background: transparent;
  color: var(--kailo-color-muted-foreground);
  font: 500 13px/20px var(--kailo-font-sans);
  cursor: pointer;
  transition: background-color var(--kailo-duration-fast, 140ms) var(--kailo-ease-standard, ease),
    color var(--kailo-duration-fast, 140ms) var(--kailo-ease-standard, ease);
}

.kailo-segments__item:hover {
  color: var(--kailo-color-foreground);
}

.kailo-segments__item.is-active {
  background: var(--kailo-color-background);
  color: var(--kailo-color-foreground);
  box-shadow: var(--kailo-shadow-xs);
}

.kailo-segments__count {
  font-size: 12px;
  color: var(--kailo-color-muted-foreground);
  font-variant-numeric: tabular-nums;
}
</style>
