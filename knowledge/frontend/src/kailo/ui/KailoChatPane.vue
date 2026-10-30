<template>
  <!-- DD-167 (20 §15.1): the conversation list pane of 知识工程 › 对话 — pane header
       with the total, rows grouped by time, the compact pager "‹ x / y ›", and the
       same states as every Kailo list. Replaces the native sidebar in the shell. -->
  <aside class="chat-pane" :aria-label="text('chat.pane.title')">
    <header class="chat-pane__head">
      <span class="chat-pane__title">{{ text('chat.pane.title') }}</span>
      <span v-if="total > 0" class="chat-pane__count">{{ total }}</span>
      <button type="button" class="chat-pane__icon" :aria-label="text('chat.pane.new')" :title="text('chat.pane.new')"
        @click="newChat">
        <KailoIcon name="plus" />
      </button>
    </header>
    <div class="kailo-progress" :class="{ 'is-active': loading && rows.length > 0 }" aria-hidden="true" />

    <div class="chat-pane__body" :class="{ 'is-paging': loading && rows.length > 0 }">
      <template v-if="loading && rows.length === 0 && !error">
        <div v-for="n in 8" :key="n" class="chat-pane__skeleton"><span class="kailo-skel" :style="{ width: `${50 + (n * 37) % 45}%` }" /></div>
      </template>
      <KailoStateView v-else-if="error" compact :kind="error === 'forbidden' ? 'forbidden' : 'error'"
        :title="error === 'forbidden' ? text('kb.forbidden') : text('chat.pane.error')"
        :description="error === 'forbidden' ? text('state.forbidden.askAdmin') : text(`state.reason.${error}` as UxKey)"
        :action-label="canRetry(error) ? text('state.retry') : ''" @action="load" />
      <KailoStateView v-else-if="rows.length === 0" compact kind="empty" art="chat" :title="text('chat.pane.empty')"
        :description="text('chat.pane.emptyDesc')" />
      <template v-else>
        <section v-for="group in groups" :key="group.key" class="chat-pane__group">
          <h3 class="chat-pane__group-title">{{ group.label }}</h3>
          <div v-for="row in group.items" :key="row.id" class="chat-pane__row" role="link" tabindex="0"
            :class="{ 'is-active': row.id === activeId, 'is-menu-open': menuOpenId === row.id }"
            :aria-current="row.id === activeId ? 'page' : undefined" :title="titleOf(row)"
            @click="open(row)" @keydown.enter.prevent="open(row)">
            <span class="chat-pane__row-title">{{ titleOf(row) }}</span>
            <span class="chat-pane__row-actions" @click.stop @keydown.stop>
              <t-dropdown :options="menuOptions(row)" trigger="click" placement="bottom-right"
                :popup-props="{ overlayClassName: 'chat-pane__menu', onVisibleChange: (v: boolean) => (menuOpenId = v ? row.id : '') }"
                @click="(item: any) => onMenu(row, item.value)">
                <button type="button" class="chat-pane__more" :aria-label="text('chat.pane.more')" :title="text('chat.pane.more')">
                  <KailoIcon name="more" />
                </button>
              </t-dropdown>
            </span>
          </div>
        </section>
      </template>
    </div>

    <KailoPagination v-if="!error && total > 0" compact :total="total" :page="page" :page-size="PANE_PAGE_SIZE"
      @update:page="goPage" />
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { getSessionsList } from '@/api/chat'
import { useMenuStore } from '@/stores/menu'
import {
  SESSION_MUTATION_EVENT,
  removeSession,
  renameSession,
  setSessionPinned,
  type SessionMutationDetail,
} from '@/components/sessionMutations'
import { classifyDateBucket, groupSessionsByDate, type DateBucketKey } from '@/components/sessionGrouping'
import KailoIcon from './KailoIcon.vue'
import KailoPagination from './KailoPagination.vue'
import KailoStateView from './KailoStateView.vue'
import { clampPage, pageCount } from '../listing'
import { canRetry, classifyLoadError, type LoadErrorKind } from '../loadState'
import { askText } from '../prompt'
import { hostConfirm } from '../feedback'
import { ux, type UxKey } from '../uxText'

interface SessionRow {
  id: string
  title?: string
  description?: string
  is_pinned?: boolean
  created_at?: string
  updated_at?: string
}

/** Rows per pane page (the pane pager has no size choice). */
const PANE_PAGE_SIZE = 30

const route = useRoute()
const router = useRouter()
const menuStore = useMenuStore()
const { locale } = useI18n()
const text = (key: UxKey, params?: Record<string, string | number>) => ux(key, locale.value, params)

const rows = ref<SessionRow[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref<LoadErrorKind | null>(null)
const menuOpenId = ref('')
let generation = 0

const activeId = computed(() => (route.name === 'chat' ? String(route.params.chatid || '') : ''))
const titleOf = (row: SessionRow) => (row.title || '').trim() || text('chat.pane.untitled')

const groupLabels = computed<Record<DateBucketKey, string>>(() => ({
  pinned: text('chat.group.pinned'),
  today: text('chat.group.today'),
  yesterday: text('chat.group.yesterday'),
  last7Days: text('chat.group.last7Days'),
  last30Days: text('chat.group.last30Days'),
  lastYear: text('chat.group.lastYear'),
  earlier: text('chat.group.earlier'),
} as Record<DateBucketKey, string>))

const groups = computed(() => groupSessionsByDate(rows.value, groupLabels.value,
  (row) => classifyDateBucket(row.updated_at || row.created_at)))

async function load() {
  const current = ++generation
  loading.value = true
  try {
    const res: any = await getSessionsList(page.value, PANE_PAGE_SIZE, 'web')
    if (current !== generation) return
    const count = Number(res?.total) || 0
    const last = pageCount(count, PANE_PAGE_SIZE)
    if (page.value > last && count > 0) {
      page.value = last
      return void load()
    }
    rows.value = Array.isArray(res?.data) ? res.data : []
    total.value = count
    error.value = null
  } catch (e) {
    if (current !== generation) return
    error.value = classifyLoadError(e)
  } finally {
    if (current === generation) loading.value = false
  }
}

function goPage(next: number) {
  page.value = clampPage(next, total.value, PANE_PAGE_SIZE)
  void load()
}

function open(row: SessionRow) {
  if (row.id !== activeId.value) void router.push(`/platform/chat/${row.id}`)
}

function newChat() {
  if (route.name !== 'globalCreatChat') void router.push('/platform/creatChat')
}

function menuOptions(row: SessionRow) {
  return [
    { content: row.is_pinned ? text('chat.pane.unpin') : text('chat.pane.pin'), value: 'pin' },
    { content: text('chat.pane.rename'), value: 'rename', divider: true },
    { content: text('chat.pane.delete'), value: 'delete', theme: 'error' as const },
  ]
}

async function rename(row: SessionRow) {
  const title = await askText({
    title: text('chat.pane.renameTitle'),
    label: text('chat.pane.renameLabel'),
    value: titleOf(row),
    confirmLabel: text('chat.pane.save'),
    cancelLabel: text('chat.pane.cancel'),
    maxLength: 100,
  })
  if (!title || title === row.title) return
  try {
    await renameSession(row.id, title, row.description || '')
    MessagePlugin.success(text('chat.pane.renamed'))
  } catch {
    MessagePlugin.error(text('chat.pane.failed'))
  }
}

async function remove(row: SessionRow) {
  const confirm = { tone: 'danger' as const, title: text('chat.pane.deleteTitle', { name: titleOf(row) }),
    description: text('chat.pane.deleteDesc'), confirmLabel: text('chat.pane.delete'), cancelLabel: text('chat.pane.cancel') }
  const asked = hostConfirm(confirm)
  const confirmed = asked ? await asked : window.confirm(`${confirm.title}\n${confirm.description}`)
  if (!confirmed) return
  try {
    await removeSession(row.id)
    MessagePlugin.success(text('chat.pane.deleted'))
  } catch {
    MessagePlugin.error(text('chat.pane.failed'))
  }
}

function onMenu(row: SessionRow, action: string) {
  menuOpenId.value = ''
  if (action === 'pin') {
    setSessionPinned(row.id, !row.is_pinned).then(() => load(), () => MessagePlugin.error(text('chat.pane.failed')))
  } else if (action === 'rename') void rename(row)
  else if (action === 'delete') void remove(row)
}

// Changes made elsewhere on the page (title generated, renamed, deleted, pinned).
function onMutation(event: Event) {
  const detail = (event as CustomEvent<SessionMutationDetail>).detail
  if (!detail?.sessionId) return
  if (detail.removed) {
    if (detail.sessionId === activeId.value) void router.push('/platform/creatChat')
    void load()
    return
  }
  if (detail.patch) {
    rows.value = rows.value.map((row) => (row.id === detail.sessionId ? { ...row, ...detail.patch } as SessionRow : row))
    if (detail.patch.is_pinned !== undefined) void load()
  }
}

// A new chat started on this page shows up on the first page.
const offStore = menuStore.$onAction(({ name, args, after }) => {
  if (name === 'updataMenuChildren') {
    after(() => { page.value = 1; void load() })
  } else if (name === 'updatasessionTitle') {
    const [sessionId, title] = args as [string, string]
    after(() => { rows.value = rows.value.map((row) => (row.id === sessionId ? { ...row, title } : row)) })
  }
})

// Opening a chat that is not on the shown page keeps the page; the active row is
// simply not highlighted there. Returning from another tab refreshes the counts.
watch(() => route.name, (name, previous) => {
  if (name === 'globalCreatChat' && previous === 'chat') void load()
})

onMounted(() => {
  window.addEventListener(SESSION_MUTATION_EVENT, onMutation)
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener(SESSION_MUTATION_EVENT, onMutation)
  offStore()
  generation++
})
</script>

<style scoped>
.chat-pane {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 264px;
  min-width: 220px;
  max-width: 360px;
  min-height: 0;
  height: 100%;
  border-right: 1px solid var(--kailo-color-border);
  background: var(--kailo-color-background);
  box-sizing: border-box;
}

.chat-pane__head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 16px;
  flex-shrink: 0;
}

.chat-pane__title {
  color: var(--kailo-color-muted-foreground);
  font: 600 var(--kailo-text-overline)/14px var(--kailo-font-sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chat-pane__count {
  color: var(--kailo-color-muted-foreground);
  font: 500 var(--kailo-text-caption)/16px var(--kailo-font-sans);
  font-variant-numeric: tabular-nums;
}

.chat-pane__icon,
.chat-pane__more {
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

.chat-pane__icon { margin-left: auto; }

.chat-pane__icon:hover,
.chat-pane__more:hover {
  background: var(--kailo-color-hover);
  color: var(--kailo-color-foreground);
}

.chat-pane__icon:focus-visible,
.chat-pane__more:focus-visible {
  outline: none;
  box-shadow: var(--kailo-focus-ring);
}

.chat-pane__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px 8px;
  transition: opacity var(--kailo-duration-base) var(--kailo-ease-standard);
}

.chat-pane__body.is-paging { opacity: 0.6; }

.chat-pane__group + .chat-pane__group { margin-top: 12px; }

.chat-pane__group-title {
  margin: 0;
  padding: 8px 8px 4px;
  color: var(--kailo-color-muted-foreground);
  font: 600 var(--kailo-text-overline)/14px var(--kailo-font-sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chat-pane__row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 4px 0 8px;
  border-radius: var(--kailo-radius-md);
  color: var(--kailo-color-foreground);
  font: 500 var(--kailo-text-callout)/20px var(--kailo-font-sans);
  cursor: pointer;
  outline: none;
  transition: background-color var(--kailo-duration-fast) var(--kailo-ease-standard);
}

.chat-pane__row:hover,
.chat-pane__row.is-menu-open { background: var(--kailo-color-hover); }

.chat-pane__row.is-active {
  background: var(--kailo-color-selected);
  color: var(--kailo-color-selected-foreground);
}

.chat-pane__row:focus-visible { box-shadow: inset var(--kailo-focus-ring); }

.chat-pane__row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-pane__row .chat-pane__more { opacity: 0; }
.chat-pane__row:hover .chat-pane__more,
.chat-pane__row:focus-within .chat-pane__more,
.chat-pane__row.is-menu-open .chat-pane__more { opacity: 1; }
.chat-pane__row.is-active .chat-pane__more { color: currentColor; }

.chat-pane__skeleton {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 8px;
}
</style>
