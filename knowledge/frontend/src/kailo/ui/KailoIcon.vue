<template>
  <!-- Single-colour line icons in Kailo's icon language (Lucide geometry, 1.75 stroke,
       20 §7 / §13.6); colour follows the text. -->
  <svg class="kailo-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    :stroke-width="stroke" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <template v-if="name === 'search'"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></template>
    <template v-else-if="name === 'grid'"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></template>
    <template v-else-if="name === 'list'"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></template>
    <template v-else-if="name === 'star'"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9Z" /></template>
    <template v-else-if="name === 'more'"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></template>
    <template v-else-if="name === 'library'"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h2A1.5 1.5 0 0 1 9 4.5v15A1.5 1.5 0 0 1 7.5 21h-2A1.5 1.5 0 0 1 4 19.5Z" /><path d="M9 6.5A1.5 1.5 0 0 1 10.5 5h2A1.5 1.5 0 0 1 14 6.5v13a1.5 1.5 0 0 1-1.5 1.5h-2A1.5 1.5 0 0 1 9 19.5Z" /><path d="m14.5 6.3 2-.5a1.5 1.5 0 0 1 1.8 1.1l3 11.7a1.5 1.5 0 0 1-1.1 1.8l-1.9.5a1.5 1.5 0 0 1-1.8-1.1l-3-11.7" /></template>
    <template v-else-if="name === 'faq'"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></template>
    <template v-else-if="name === 'file'"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></template>
    <template v-else-if="name === 'pin'"><path d="M12 17v5M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.7V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
    <template v-else-if="name === 'message'"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></template>
    <template v-else-if="name === 'x'"><path d="M18 6 6 18M6 6l12 12" /></template>
    <template v-else-if="name === 'alert'"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></template>
    <template v-else-if="name === 'sparkles'"><path d="M9.9 15.5A2 2 0 0 0 8.5 14l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1L15.5 14a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0Z" /></template>
  </svg>
</template>

<script setup lang="ts">
export type KailoIconName = 'search' | 'grid' | 'list' | 'star' | 'more' | 'library' | 'faq' | 'file' | 'pin'
  | 'plus' | 'message' | 'x' | 'alert' | 'sparkles'

withDefaults(defineProps<{ name: KailoIconName; size?: number; stroke?: number }>(), { size: 16, stroke: 1.75 })
</script>

<style scoped>
.kailo-icon {
  flex-shrink: 0;
  display: block;
}
</style>
