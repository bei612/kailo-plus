<template>
  <!-- DD-167 (20 §15.1): 知识工程 › 知识库 inside the Kailo shell. Toolbar (scopes,
       search, sort, view), card grid or table, pagination; every state in place. -->
  <section class="kb-browse" :class="{ 'is-refreshing': refreshing && entries.length > 0 }">
    <header class="kb-browse__toolbar">
      <div class="kb-browse__toolbar-start">
        <ScopeSegments :model-value="state.scope" :options="scopeOptions" :label="text('kb.scope.label')"
          @update:model-value="(scope) => update({ scope: scope as KbScope, page: 1 })" />
        <label class="kb-browse__search">
          <KailoIcon name="search" class="kb-browse__search-icon" />
          <input v-model="searchText" type="search" :placeholder="text('kb.search')" :aria-label="text('kb.search')"
            @keydown.esc="clearSearch" />
          <button v-if="searchText" type="button" class="kb-browse__search-clear" :aria-label="text('state.clearFilters')"
            @click="clearSearch">
            <KailoIcon name="x" :size="14" />
          </button>
        </label>
      </div>
      <div class="kb-browse__toolbar-end">
        <t-select class="kb-browse__sort" :model-value="state.sort" :options="sortOptions" :aria-label="text('kb.sort.label')"
          auto-width @change="(sort: unknown) => update({ sort: sort as KbSort, page: 1 })" />
        <div class="kb-browse__view" role="radiogroup" :aria-label="text('kb.view.label')">
          <button v-for="view in viewOptions" :key="view.value" type="button" role="radio" class="kb-browse__view-btn"
            :class="{ 'is-active': state.view === view.value }" :aria-checked="state.view === view.value"
            :aria-label="view.label" :title="view.label" @click="setView(view.value)">
            <KailoIcon :name="view.value === 'grid' ? 'grid' : 'list'" />
          </button>
        </div>
      </div>
    </header>

    <div class="kb-browse__progress" :class="{ 'is-active': refreshing && entries.length > 0 }" aria-hidden="true" />

    <div class="kb-browse__body">
      <!-- First read: skeletons shaped like the view. -->
      <template v-if="loading && entries.length === 0 && !error">
        <div v-if="state.view === 'grid'" class="kb-browse__grid" aria-busy="true">
          <div v-for="n in 8" :key="'skel-' + n" class="kb-card kb-card--skeleton">
            <div class="kb-card__head"><span class="skel skel--block" /><span class="skel skel--line" style="width: 55%" /></div>
            <span class="skel skel--line" style="width: 100%" />
            <span class="skel skel--line" style="width: 72%" />
            <div class="kb-card__foot"><span class="skel skel--line" style="width: 40%" /></div>
          </div>
        </div>
        <div v-else class="kb-table" aria-busy="true">
          <div class="kb-table__head"><span v-for="n in 5" :key="n" class="skel skel--line" style="width: 40%" /></div>
          <div v-for="n in 10" :key="'row-' + n" class="kb-table__row kb-table__row--skeleton">
            <span class="skel skel--line" style="width: 60%" /><span class="skel skel--line" style="width: 50%" />
            <span class="skel skel--line" style="width: 40%" /><span class="skel skel--line" style="width: 60%" />
            <span class="skel skel--line" style="width: 50%" />
          </div>
        </div>
      </template>

      <KailoStateView v-else-if="error === 'forbidden'" kind="forbidden" :title="text('kb.forbidden')"
        :description="text('state.forbidden.askAdmin')" />
      <KailoStateView v-else-if="error && entries.length === 0" kind="error" :title="text('kb.error')"
        :description="text(`state.reason.${error}` as UxKey)" :action-label="canRetryError ? text('state.retry') : ''"
        @action="emit('retry')" />

      <template v-else-if="visible.length === 0">
        <KailoStateView v-if="state.q" kind="filtered" compact :title="text('kb.filtered')"
          :description="text('kb.filtered.desc')" :action-label="text('state.clearFilters')" @action="clearSearch" />
        <KailoStateView v-else-if="state.scope === 'favorites'" kind="empty" art="star"
          :title="text('kb.empty.favorites.title')" :description="text('kb.empty.favorites.desc')" />
        <KailoStateView v-else-if="state.scope === 'shared'" kind="empty"
          :title="text('kb.empty.shared.title')" :description="text('kb.empty.shared.desc')" />
        <KailoStateView v-else-if="state.scope === 'mine'" kind="empty" :title="text('kb.empty.title')"
          :description="canCreate ? text('kb.empty.mine') : text('kb.empty.readonly')"
          :action-label="canCreate ? text('kb.create') : ''" action-primary @action="emit('create')" />
        <KailoStateView v-else kind="empty" :title="text('kb.empty.title')"
          :description="canCreate ? text('kb.empty.desc') : text('kb.empty.readonly')"
          :action-label="canCreate ? text('kb.create') : ''" action-primary @action="emit('create')" />
      </template>

      <!-- Card grid. -->
      <div v-else-if="state.view === 'grid'" class="kb-browse__grid">
        <article v-for="entry in pageItems" :key="entry.id" class="kb-card" tabindex="0" role="link"
          :aria-label="entry.name" @click="emit('open', entry)" @keydown.enter.prevent="emit('open', entry)">
          <div class="kb-card__head">
            <span class="kb-card__mark" :class="`kb-card__mark--${entry.kind}`">
              <KailoIcon :name="entry.kind === 'faq' ? 'faq' : 'library'" :size="16" />
            </span>
            <h3 class="kb-card__title" :title="entry.name">{{ entry.name }}</h3>
            <div class="kb-card__actions" @click.stop @keydown.stop>
              <button type="button" class="kb-icon-btn kb-card__star" :class="{ 'is-on': entry.favorite }"
                :aria-pressed="entry.favorite" :aria-label="entry.favorite ? text('kb.unfavorite') : text('kb.favorite')"
                :title="entry.favorite ? text('kb.unfavorite') : text('kb.favorite')" @click="emit('favorite', entry.id)">
                <KailoIcon name="star" />
              </button>
              <t-dropdown :options="menuOptions(entry)" trigger="click" placement="bottom-right"
                :popup-props="{ overlayClassName: 'kb-browse__menu' }" @click="(item: any) => onMenu(entry, item.value)">
                <button type="button" class="kb-icon-btn" :aria-label="text('kb.more')" :title="text('kb.more')">
                  <KailoIcon name="more" />
                </button>
              </t-dropdown>
            </div>
          </div>
          <p class="kb-card__desc" :class="{ 'is-empty': !entry.description }">
            {{ entry.description || text('kb.noDescription') }}
          </p>
          <div class="kb-card__badges">
            <span class="kb-badge">{{ entry.kind === 'faq' ? text('kb.type.faq') : text('kb.type.document') }}</span>
            <span v-if="entry.wiki" class="kb-badge kb-badge--brand">{{ text('kb.type.wiki') }}</span>
            <span v-if="entry.pinned" class="kb-badge"><KailoIcon name="pin" :size="12" />{{ text('kb.pinned') }}</span>
            <span v-if="!entry.ready" class="kb-badge kb-badge--warning">{{ text('kb.notReady') }}</span>
            <span v-else-if="entry.processing" class="kb-badge kb-badge--info">{{ text('kb.processing') }}</span>
          </div>
          <footer class="kb-card__foot">
            <span class="kb-card__meta">
              <span v-if="entry.count !== null">{{ countText(entry) }}</span>
              <span v-if="entry.count !== null && entry.updatedAt" aria-hidden="true">·</span>
              <time v-if="entry.updatedAt" :datetime="entry.updatedAt" :title="absolute(entry.updatedAt)">{{ relative(entry.updatedAt) }}</time>
            </span>
            <span class="kb-owner" :title="ownerText(entry)">
              <span class="kb-owner__avatar" aria-hidden="true">{{ ownerMark(entry) }}</span>
              <span class="kb-owner__name">{{ ownerText(entry) }}</span>
            </span>
          </footer>
        </article>
      </div>

      <!-- Table. -->
      <div v-else class="kb-table" role="table">
        <div class="kb-table__head" role="row">
          <span role="columnheader">{{ text('kb.col.name') }}</span>
          <span role="columnheader">{{ text('kb.col.type') }}</span>
          <span role="columnheader" class="is-num">{{ text('kb.col.items') }}</span>
          <span role="columnheader">{{ text('kb.col.owner') }}</span>
          <span role="columnheader">{{ text('kb.col.updated') }}</span>
          <span role="columnheader" aria-hidden="true" />
        </div>
        <div v-for="entry in pageItems" :key="entry.id" class="kb-table__row" role="row" tabindex="0"
          @click="emit('open', entry)" @keydown.enter.prevent="emit('open', entry)">
          <span class="kb-table__name" role="cell">
            <span class="kb-card__mark kb-card__mark--sm" :class="`kb-card__mark--${entry.kind}`">
              <KailoIcon :name="entry.kind === 'faq' ? 'faq' : 'library'" :size="14" />
            </span>
            <span class="kb-table__title" :title="entry.name">{{ entry.name }}</span>
            <KailoIcon v-if="entry.favorite" name="star" :size="12" class="kb-table__fav" />
          </span>
          <span role="cell" class="kb-table__badges">
            <span class="kb-badge">{{ entry.kind === 'faq' ? text('kb.type.faq') : text('kb.type.document') }}</span>
            <span v-if="entry.wiki" class="kb-badge kb-badge--brand">{{ text('kb.type.wiki') }}</span>
            <span v-if="!entry.ready" class="kb-badge kb-badge--warning">{{ text('kb.notReady') }}</span>
          </span>
          <span role="cell" class="is-num">{{ entry.count ?? '—' }}</span>
          <span role="cell" class="kb-owner" :title="ownerText(entry)">
            <span class="kb-owner__avatar" aria-hidden="true">{{ ownerMark(entry) }}</span>
            <span class="kb-owner__name">{{ ownerText(entry) }}</span>
          </span>
          <span role="cell" class="kb-table__time">
            <time v-if="entry.updatedAt" :datetime="entry.updatedAt" :title="absolute(entry.updatedAt)">{{ relative(entry.updatedAt) }}</time>
            <span v-else>—</span>
          </span>
          <span role="cell" class="kb-table__actions" @click.stop @keydown.stop>
            <t-dropdown :options="menuOptions(entry)" trigger="click" placement="bottom-right"
              :popup-props="{ overlayClassName: 'kb-browse__menu' }" @click="(item: any) => onMenu(entry, item.value)">
              <button type="button" class="kb-icon-btn" :aria-label="text('kb.more')" :title="text('kb.more')">
                <KailoIcon name="more" />
              </button>
            </t-dropdown>
          </span>
        </div>
      </div>

      <p v-if="stillLoading" class="kb-browse__still">{{ text('page.stillLoading') }}</p>
    </div>

    <KailoPagination v-if="!error && visible.length > 0" :total="visible.length" :page="currentPage" :page-size="state.size"
      :sizes="state.view === 'grid' ? GRID_PAGE_SIZES : LIST_PAGE_SIZES"
      @update:page="(page) => update({ page })" @update:page-size="(size) => update({ size, page: 1 })" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ScopeSegments from '../ScopeSegments.vue'
import KailoIcon from './KailoIcon.vue'
import KailoPagination from './KailoPagination.vue'
import KailoStateView from './KailoStateView.vue'
import {
  GRID_PAGE_SIZES, LIST_PAGE_SIZES, absoluteTime, clampPage, monogram, patchQuery, relativeTime, sameQuery, slicePage,
} from '../listing'
import {
  browseKbEntries, defaultSize, kbBrowseDefaults, kbBrowseQuery, readKbBrowse, scopeCounts,
  type KbBrowseState, type KbEntry, type KbScope, type KbSort, type KbView,
} from '../kbBrowse'
import { canRetry, type LoadErrorKind } from '../loadState'
import { ux, type UxKey } from '../uxText'

const props = defineProps<{
  entries: KbEntry[]
  /** First read in progress (nothing to show yet). */
  loading: boolean
  /** A refresh is in progress while older entries are shown. */
  refreshing: boolean
  error: LoadErrorKind | null
  canCreate: boolean
}>()

const emit = defineEmits<{
  (event: 'open', entry: KbEntry): void
  (event: 'create'): void
  (event: 'retry'): void
  (event: 'favorite', id: string): void
  (event: 'pin', id: string): void
  (event: 'duplicate', id: string): void
  (event: 'settings', id: string): void
  (event: 'delete', id: string): void
}>()

const route = useRoute()
const router = useRouter()
const { locale } = useI18n()
const text = (key: UxKey, params?: Record<string, string | number>) => ux(key, locale.value, params)

// View state lives in the route query (20 §15.3): back/forward and links show the same view.
const state = computed<KbBrowseState>(() => readKbBrowse(route.query as Record<string, string>))

function update(patch: Partial<KbBrowseState>) {
  const next: KbBrowseState = { ...state.value, ...patch }
  const query = patchQuery(route.query as Record<string, string>, kbBrowseQuery(next), kbBrowseDefaults(next.view))
  if (!sameQuery(query, route.query as Record<string, string>)) void router.replace({ query })
}

function setView(view: KbView) {
  if (view !== state.value.view) update({ view, size: defaultSize(view), page: 1 })
}

// Search: 300 ms debounce into the query; a new search starts at page 1.
const searchText = ref(state.value.q)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchText, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (value.trim() !== state.value.q) update({ q: value.trim(), page: 1 })
  }, 300)
})
watch(() => state.value.q, (q) => { if (q !== searchText.value.trim()) searchText.value = q })
function clearSearch() {
  clearTimeout(searchTimer)
  searchText.value = ''
  update({ q: '', page: 1 })
}

const counts = computed(() => scopeCounts(props.entries))
const scopeOptions = computed(() => [
  { value: 'all', label: text('kb.scope.all'), count: counts.value.all },
  { value: 'mine', label: text('kb.scope.mine'), count: counts.value.mine },
  { value: 'shared', label: text('kb.scope.shared'), count: counts.value.shared },
  { value: 'favorites', label: text('kb.scope.favorites'), count: counts.value.favorites },
])
const sortOptions = computed(() => [
  { value: 'updated', label: text('kb.sort.updated') },
  { value: 'name', label: text('kb.sort.name') },
  { value: 'created', label: text('kb.sort.created') },
])
const viewOptions = computed(() => [
  { value: 'grid' as const, label: text('kb.view.grid') },
  { value: 'list' as const, label: text('kb.view.list') },
])

const visible = computed(() => browseKbEntries(props.entries, state.value))
const currentPage = computed(() => clampPage(state.value.page, visible.value.length, state.value.size))
const pageItems = computed(() => slicePage(visible.value, currentPage.value, state.value.size))

// A page past the end (deleted items, a stale link) lands on the last page.
watch([currentPage, () => props.loading], ([page, loading]) => {
  if (!loading && props.entries.length > 0 && page !== state.value.page) update({ page })
})

const canRetryError = computed(() => !!props.error && canRetry(props.error))

// Over 10 s of refreshing: say so in place (20 §15.4).
const stillLoading = ref(false)
let slowTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.refreshing || props.loading, (busy) => {
  clearTimeout(slowTimer)
  stillLoading.value = false
  if (busy) slowTimer = setTimeout(() => { stillLoading.value = true }, 10_000)
}, { immediate: true })
onBeforeUnmount(() => { clearTimeout(slowTimer); clearTimeout(searchTimer) })

const relative = (iso: string) => relativeTime(iso, locale.value)
const absolute = (iso: string) => absoluteTime(iso, locale.value)
const countText = (entry: KbEntry) => text(entry.kind === 'faq' ? 'kb.items.faq' : 'kb.items.document', { n: entry.count ?? 0 })
const ownerText = (entry: KbEntry) => (entry.ownedByMe ? text('kb.owner.me') : entry.ownerName || text('kb.owner.unknown'))
const ownerMark = (entry: KbEntry) => monogram(ownerText(entry))

function menuOptions(entry: KbEntry) {
  const options: Array<{ content: string; value: string; divider?: boolean; theme?: 'error' }> = [
    { content: text('kb.menu.open'), value: 'open' },
  ]
  if (!entry.shared) options.push({ content: entry.pinned ? text('kb.menu.unpin') : text('kb.menu.pin'), value: 'pin' })
  options.push({ content: entry.favorite ? text('kb.unfavorite') : text('kb.favorite'), value: 'favorite' })
  if (entry.canDuplicate) options.push({ content: text('kb.menu.duplicate'), value: 'duplicate' })
  if (entry.canManage) {
    options.push({ content: text('kb.menu.settings'), value: 'settings' })
    options[options.length - 1].divider = true
    options.push({ content: text('kb.menu.delete'), value: 'delete', theme: 'error' })
  }
  return options
}

function onMenu(entry: KbEntry, action: string) {
  switch (action) {
    case 'open': emit('open', entry); break
    case 'pin': emit('pin', entry.id); break
    case 'favorite': emit('favorite', entry.id); break
    case 'duplicate': emit('duplicate', entry.id); break
    case 'settings': emit('settings', entry.id); break
    case 'delete': emit('delete', entry.id); break
  }
}
</script>

<style scoped>
.kb-browse {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 16px 24px 0;
  position: relative;
}

.kb-browse__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding-bottom: 12px;
  flex-wrap: wrap;
}

.kb-browse__toolbar-start,
.kb-browse__toolbar-end {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.kb-browse__search {
  position: relative;
  display: flex;
  align-items: center;
  width: 240px;
  height: 34px;
  padding: 0 8px 0 32px;
  border: 1px solid var(--kailo-color-line-strong);
  border-radius: var(--kailo-radius-md);
  background: var(--kailo-color-background);
  transition: border-color var(--kailo-duration-fast) var(--kailo-ease-standard),
    box-shadow var(--kailo-duration-fast) var(--kailo-ease-standard);
}

.kb-browse__search:focus-within {
  border-color: var(--kailo-color-brand);
  box-shadow: 0 0 0 3px hsl(var(--kailo-hsl-primary) / 0.15);
}

.kb-browse__search-icon {
  position: absolute;
  left: 10px;
  color: var(--kailo-color-muted-foreground);
}

.kb-browse__search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--kailo-color-foreground);
  font: 400 var(--kailo-text-body)/20px var(--kailo-font-sans);
}

.kb-browse__search input::placeholder { color: var(--kailo-color-muted-foreground); }
.kb-browse__search input::-webkit-search-cancel-button { display: none; }

.kb-browse__search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--kailo-radius-sm);
  background: transparent;
  color: var(--kailo-color-muted-foreground);
  cursor: pointer;
}

.kb-browse__search-clear:hover { background: var(--kailo-color-hover); color: var(--kailo-color-foreground); }

.kb-browse__sort { min-width: 120px; }

.kb-browse__view {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--kailo-radius-lg);
  background: var(--kailo-color-hover);
}

.kb-browse__view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: var(--kailo-radius-md);
  background: transparent;
  color: var(--kailo-color-muted-foreground);
  cursor: pointer;
}

.kb-browse__view-btn:hover { color: var(--kailo-color-foreground); }

.kb-browse__view-btn.is-active {
  background: var(--kailo-color-background);
  color: var(--kailo-color-foreground);
  box-shadow: var(--kailo-shadow-xs);
}

.kb-browse__progress {
  position: relative;
  height: 2px;
  margin: 0 -24px;
  overflow: hidden;
}

.kb-browse__progress.is-active::after {
  content: '';
  position: absolute;
  top: 0;
  left: -40%;
  width: 40%;
  height: 100%;
  background: var(--kailo-color-brand);
  animation: kb-progress 1.1s var(--kailo-ease-in-out) infinite;
}

@keyframes kb-progress {
  to { left: 100%; }
}

.kb-browse__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 12px 0 24px;
  transition: opacity var(--kailo-duration-base) var(--kailo-ease-standard);
}

.kb-browse.is-refreshing .kb-browse__body { opacity: 0.6; }

.kb-browse__still {
  margin: 12px 0 0;
  color: var(--kailo-color-muted-foreground);
  font: 400 var(--kailo-text-caption)/16px var(--kailo-font-sans);
  text-align: center;
}

/* Cards (20 §9: raised, line, radius 12, no shadow at rest; hover sm + 1 px lift). */
.kb-browse__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 16px;
  align-content: start;
}

.kb-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--kailo-color-border);
  border-radius: var(--kailo-radius-xl);
  background: var(--kailo-color-card);
  cursor: pointer;
  outline: none;
  transition: box-shadow var(--kailo-duration-fast) var(--kailo-ease-standard),
    transform var(--kailo-duration-fast) var(--kailo-ease-standard),
    border-color var(--kailo-duration-fast) var(--kailo-ease-standard);
}

.kb-card:hover {
  box-shadow: var(--kailo-shadow-sm);
  transform: translateY(-1px);
}

.kb-card:focus-visible { box-shadow: var(--kailo-focus-ring); }

.kb-card--skeleton { cursor: default; }
.kb-card--skeleton:hover { box-shadow: none; transform: none; }

.kb-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.kb-card__mark {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--kailo-radius-lg);
  background: var(--kailo-color-selected);
  color: var(--kailo-color-selected-foreground);
}

.kb-card__mark--sm {
  width: 24px;
  height: 24px;
  border-radius: var(--kailo-radius-md);
}

.kb-card__mark--faq {
  background: var(--kailo-color-info-soft);
  color: var(--kailo-color-info-text);
}

.kb-card__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--kailo-color-foreground);
  font: 600 var(--kailo-text-headline)/22px var(--kailo-font-sans);
  letter-spacing: -0.006em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-card__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: -6px;
}

.kb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--kailo-radius-md);
  background: transparent;
  color: var(--kailo-color-muted-foreground);
  cursor: pointer;
  transition: background-color var(--kailo-duration-fast) var(--kailo-ease-standard),
    color var(--kailo-duration-fast) var(--kailo-ease-standard),
    opacity var(--kailo-duration-fast) var(--kailo-ease-standard);
}

.kb-icon-btn:hover { background: var(--kailo-color-hover); color: var(--kailo-color-foreground); }
.kb-icon-btn:focus-visible { outline: none; box-shadow: var(--kailo-focus-ring); }

.kb-card__star { opacity: 0; }
.kb-card:hover .kb-card__star,
.kb-card:focus-within .kb-card__star,
.kb-card__star.is-on { opacity: 1; }
.kb-card__star.is-on { color: var(--kailo-color-brand); }
.kb-card__star.is-on :deep(path) { fill: currentColor; }

.kb-card__desc {
  display: -webkit-box;
  min-height: 40px;
  margin: 0;
  overflow: hidden;
  color: var(--kailo-color-text-secondary);
  font: 400 var(--kailo-text-callout)/20px var(--kailo-font-sans);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.kb-card__desc.is-empty { color: var(--kailo-color-muted-foreground); }

.kb-card__badges,
.kb-table__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 20px;
}

.kb-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--kailo-radius-sm);
  background: var(--kailo-color-hover);
  color: var(--kailo-color-text-secondary);
  font: 500 var(--kailo-text-caption)/20px var(--kailo-font-sans);
  white-space: nowrap;
}

.kb-badge--brand { background: var(--kailo-color-selected); color: var(--kailo-color-selected-foreground); }
.kb-badge--warning { background: var(--kailo-color-warning-soft); color: var(--kailo-color-warning-text); }
.kb-badge--info { background: var(--kailo-color-info-soft); color: var(--kailo-color-info-text); }

.kb-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--kailo-color-border);
}

.kb-card__meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--kailo-color-muted-foreground);
  font: 400 var(--kailo-text-caption)/16px var(--kailo-font-sans);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.kb-owner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--kailo-color-text-secondary);
  font: 400 var(--kailo-text-caption)/16px var(--kailo-font-sans);
}

.kb-owner__avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 28%;
  background: var(--kailo-color-selected);
  color: var(--kailo-color-selected-foreground);
  font: 600 var(--kailo-text-overline)/1 var(--kailo-font-sans);
}

.kb-owner__name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Table (20 §9 / §15.3): row height from Kailo list density, Overline header. */
.kb-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--kailo-color-border);
  border-radius: var(--kailo-radius-xl);
  background: var(--kailo-color-card);
  overflow: hidden;
}

.kb-table__head,
.kb-table__row {
  display: grid;
  grid-template-columns: minmax(220px, 2.4fr) minmax(120px, 1fr) 88px minmax(120px, 1fr) 120px 44px;
  align-items: center;
  gap: 12px;
  padding: 0 12px 0 16px;
}

.kb-table__head {
  height: 36px;
  border-bottom: 1px solid var(--kailo-color-border);
  color: var(--kailo-color-muted-foreground);
  font: 600 var(--kailo-text-overline)/14px var(--kailo-font-sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.kb-table__row {
  min-height: var(--kailo-list-row, 40px);
  border-bottom: 1px solid var(--kailo-color-border);
  color: var(--kailo-color-text-secondary);
  font: 400 var(--kailo-text-callout)/20px var(--kailo-font-sans);
  cursor: pointer;
  outline: none;
  transition: background-color var(--kailo-duration-fast) var(--kailo-ease-standard);
}

.kb-table__row:last-child { border-bottom: 0; }
.kb-table__row:hover { background: var(--kailo-color-hover); }
.kb-table__row:focus-visible { box-shadow: inset var(--kailo-focus-ring); }
.kb-table__row--skeleton { cursor: default; }

.kb-table .is-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.kb-table__name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.kb-table__title {
  min-width: 0;
  overflow: hidden;
  color: var(--kailo-color-foreground);
  font: 500 var(--kailo-text-body)/20px var(--kailo-font-sans);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-table__fav { color: var(--kailo-color-brand); }
.kb-table__fav :deep(path) { fill: currentColor; }

.kb-table__time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.kb-table__actions {
  display: flex;
  justify-content: flex-end;
}

.kb-table__row .kb-table__actions .kb-icon-btn { opacity: 0; }
.kb-table__row:hover .kb-table__actions .kb-icon-btn,
.kb-table__row:focus-within .kb-table__actions .kb-icon-btn { opacity: 1; }

/* Skeleton pieces (20 §9: page-level loading is a skeleton). */
.skel {
  display: block;
  border-radius: var(--kailo-radius-sm);
  background: var(--kailo-color-hover);
  animation: kb-skel 1.6s linear infinite;
}

.skel--line { height: 12px; }
.skel--block { width: 32px; height: 32px; border-radius: var(--kailo-radius-lg); flex-shrink: 0; }

@keyframes kb-skel {
  50% { opacity: 0.55; }
}

@media (max-width: 760px) {
  .kb-browse { padding: 12px 16px 0; }
  .kb-browse__search { width: 180px; }
  .kb-table__head,
  .kb-table__row { grid-template-columns: minmax(180px, 1fr) 88px 44px; }
  .kb-table__head > :nth-child(2), .kb-table__row > :nth-child(2),
  .kb-table__head > :nth-child(4), .kb-table__row > :nth-child(4),
  .kb-table__head > :nth-child(5), .kb-table__row > :nth-child(5) { display: none; }
}
</style>
