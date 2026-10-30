<template>
  <!-- DD-138(6), 07 §4.8.5: one declared admin function, nothing else — no Settings
       navigation, product menu, user menu or links to other admin functions. Kailo
       draws the page header ("管理 › 分类 › 标题"); this page has no title of its own. -->
  <main class="kailo-admin-surface" :data-surface="surface?.key || undefined">
    <template v-if="surface">
      <section v-if="readOnly" class="kailo-admin-surface__readonly">
        <div v-if="loading" class="kailo-admin-surface__skeleton" aria-busy="true">
          <t-skeleton :row-col="[{ width: '30%' }, 1, 1, { width: '30%' }, 1, 1]" animation="gradient" />
        </div>
        <div v-else-if="loadError" class="kailo-admin-surface__error" role="alert">
          <p class="kailo-admin-surface__error-title">{{ errorTitle }}</p>
          <p v-if="loadError !== errorTitle" class="kailo-admin-surface__error-hint">{{ loadError }}</p>
          <t-button variant="outline" @click="load">{{ retryLabel }}</t-button>
        </div>
        <template v-else>
          <section v-for="section in sections" :key="section.id" class="kailo-admin-surface__group">
            <h2 class="kailo-admin-surface__group-title">{{ section.title }}</h2>
            <p v-if="section.items.length === 0" class="kailo-admin-surface__empty-line">{{ section.empty }}</p>
            <article v-for="item in section.items" :key="item.id" class="kailo-admin-surface__item">
              <h3 class="kailo-admin-surface__item-title">
                <span>{{ item.title }}</span>
                <span v-if="item.badge" class="kailo-admin-surface__badge">{{ item.badge }}</span>
              </h3>
              <dl class="kailo-admin-surface__list">
                <div v-for="row in item.rows" :key="row.label" class="kailo-admin-surface__row">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </article>
          </section>
        </template>
      </section>
      <section v-else class="kailo-admin-surface__editable">
        <WebSearchSettings v-if="surface.key === 'answers.webSearch'" />
      </section>
    </template>
    <div v-else class="kailo-admin-surface__unavailable">
      <t-empty :title="unavailable.title" :description="unavailable.description" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import WebSearchSettings from '@/views/settings/WebSearchSettings.vue'
import { listModels } from '@/api/model'
import { listVectorStores } from '@/api/vector-store'
import { listStorageBackends } from '@/api/storage-backend'
import { getParserEngines } from '@/api/system'
import { isKailoMode } from './runtime'
import { kailoEmbed } from './bridge'
import { WHITE_LABEL_HIDDEN_PROVIDERS } from './surface'
import { adminSurfaceText, resolveAdminSurface, unavailableText } from './adminSurface'
import {
  modelSections,
  parserSections,
  storageSections,
  type ModelRecord,
  type ReadOnlySection,
} from './adminReadOnly'

const route = useRoute()
const { t, locale } = useI18n()
const runtime = kailoEmbed()

// The key Kailo launched this document for (bound to this path by the runtime);
// only Kailo mode serves admin surfaces at all.
const launchedKey = typeof runtime?.adminSurface === 'function' ? runtime.adminSurface() : null
const surface = computed(() => (isKailoMode() ? resolveAdminSurface(route.path, launchedKey) : null))
const readOnly = computed(() => surface.value?.access === 'READ_ONLY')
const unavailable = computed(() => unavailableText(locale.value))

const zh = computed(() => /^zh\b/i.test(locale.value || ''))
const errorTitle = computed(() => (zh.value ? `未能载入${surface.value ? adminSurfaceText(surface.value.title, locale.value) : ''}` : `Couldn't load ${surface.value ? adminSurfaceText(surface.value.title, 'en') : ''}`))
const retryLabel = computed(() => (zh.value ? '重试' : 'Retry'))

// Read-only surfaces start loading; the header is declared once content is ready.
const loading = ref(readOnly.value)
const loadError = ref('')
const raw = ref<{ kind: 'models'; models: ModelRecord[] } | { kind: 'storage'; storage: Awaited<ReturnType<typeof listStorageBackends>>; stores: Awaited<ReturnType<typeof listVectorStores>> } | { kind: 'parsers'; parsers: Awaited<ReturnType<typeof getParserEngines>> } | null>(null)

const parserNaming = {
  name(engine: string) {
    const key = `kbSettings.parser.engines.${engine}.name`
    const value = t(key)
    return value !== key ? value : engine
  },
  description(engine: string, fallback: string) {
    const key = `kbSettings.parser.engines.${engine}.desc`
    const value = t(key)
    return value !== key ? value : fallback
  },
}

const sections = computed<ReadOnlySection[]>(() => {
  const data = raw.value
  if (!data) return []
  if (data.kind === 'models') return modelSections(data.models, locale.value, WHITE_LABEL_HIDDEN_PROVIDERS)
  if (data.kind === 'storage') {
    return storageSections(data.storage?.data ?? [], data.storage?.default_storage_backend_id, data.stores?.data ?? [], locale.value)
  }
  return parserSections(data.parsers, locale.value, parserNaming, WHITE_LABEL_HIDDEN_PROVIDERS)
})

async function load() {
  const key = surface.value?.key
  if (!key || !readOnly.value) return
  loading.value = true
  loadError.value = ''
  try {
    if (key === 'models.catalog') {
      raw.value = { kind: 'models', models: (await listModels()) as ModelRecord[] }
    } else if (key === 'storage.backends') {
      const [storage, stores] = await Promise.all([listStorageBackends(), listVectorStores()])
      raw.value = { kind: 'storage', storage, stores }
    } else if (key === 'indexing.parsers') {
      raw.value = { kind: 'parsers', parsers: await getParserEngines() }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    loadError.value = message || errorTitle.value
  } finally {
    loading.value = false
  }
}

// DD-157: Kailo keeps its skeleton until the page declares its header. The
// header itself (category and title) is Kailo's; the surface title is sent
// so the host can reveal the frame. The unavailable state reveals it too.
function publishPage() {
  if (!runtime || typeof runtime.setPage !== 'function') return
  const title = surface.value ? adminSurfaceText(surface.value.title, locale.value) : unavailable.value.title
  try {
    runtime.setPage({ title })
  } catch (error) {
    console.warn('[kailo] admin surface header rejected', error)
  }
}

onMounted(() => {
  void load()
})
watch(() => [surface.value?.key, locale.value, loading.value], () => {
  if (!loading.value) publishPage()
}, { immediate: true })
</script>

<style scoped>
.kailo-admin-surface {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  overflow: auto;
  padding: 24px;
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
}

.kailo-admin-surface__readonly {
  max-width: 720px;
}

.kailo-admin-surface__group + .kailo-admin-surface__group {
  margin-top: 32px;
}

.kailo-admin-surface__group-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--td-text-color-secondary);
}

.kailo-admin-surface__item {
  padding: 12px 0;
  border-top: 1px solid var(--td-component-stroke);
}

.kailo-admin-surface__item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 500;
}

.kailo-admin-surface__badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
}

.kailo-admin-surface__list {
  margin: 0;
}

.kailo-admin-surface__row {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 16px;
  padding: 6px 0;
  border-top: 1px solid var(--td-component-stroke);
  font-size: 13px;
}

.kailo-admin-surface__row:first-child {
  border-top: 0;
}

.kailo-admin-surface__row dt {
  color: var(--td-text-color-primary);
}

.kailo-admin-surface__row dd {
  margin: 0;
  color: var(--td-text-color-secondary);
  overflow-wrap: anywhere;
}

.kailo-admin-surface__empty-line,
.kailo-admin-surface__error-hint {
  margin: 0;
  padding: 12px 0;
  border-top: 1px solid var(--td-component-stroke);
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.kailo-admin-surface__error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.kailo-admin-surface__error-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}

.kailo-admin-surface__unavailable {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

/* The page title is Kailo's header (20 §13.2): embedded settings views keep
   their content but not their own section heading. */
.kailo-admin-surface__editable :deep(.section-header h2),
.kailo-admin-surface__editable :deep(.section-header__title-row h2) {
  display: none;
}
</style>
