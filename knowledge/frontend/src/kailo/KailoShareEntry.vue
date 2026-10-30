<template>
  <div class="kailo-share-entry">
    <h3 class="kailo-share-entry__title">{{ text('title') }}</h3>
    <p class="kailo-share-entry__hint">{{ text('hint') }}</p>
    <t-button theme="primary" :loading="busy" :disabled="!canShare" @click="share">
      <template #icon><t-icon name="share" /></template>
      {{ text('action') }}
    </t-button>
    <p v-if="!canShare" class="kailo-share-entry__note">{{ text('forbidden') }}</p>
  </div>
</template>

<script setup lang="ts">
// DD-164(4)②: Kailo mode replaces the native share settings of a knowledge
// base with Kailo's share dialog (07 §4.7.2 `share`).
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { post } from '@/utils/request'
import { kailoConfig } from './runtime'
import { kailoShareText, requestKailoShare } from './share'

const props = defineProps<{ kbId: string; canShare: boolean }>()
const { locale } = useI18n()
const busy = ref(false)

const text = (key: Parameters<typeof kailoShareText>[0]) =>
  kailoShareText(key, String(locale.value), kailoConfig().displayName)

async function share() {
  if (busy.value || !props.canShare) return
  busy.value = true
  try {
    const outcome = await requestKailoShare(props.kbId, {
      post: (url, body) => post(url, body as Record<string, unknown>) as Promise<{ intentId?: unknown }>,
    })
    if (outcome !== 'opened') MessagePlugin.warning(text(outcome))
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.kailo-share-entry { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.kailo-share-entry__title { margin: 0; font-size: 16px; font-weight: 600; color: var(--td-text-color-primary); }
.kailo-share-entry__hint, .kailo-share-entry__note { margin: 0; font-size: 13px; line-height: 1.6; color: var(--td-text-color-secondary); }
</style>
