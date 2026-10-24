// DD-157 (07 §4.8.7, 20 §13.2): the page header Kailo renders for this
// component. Views describe their header with usePageHeader(); the platform
// frame (views/platform/index.vue) owns the one subscription to the runtime:
// it adds the product tabs, publishes on every route/context change and routes
// Kailo's navigate/action callbacks back to the current view.
//
// Product tabs replace the native left menu: Chat / Knowledge / Agent /
// Artifacts. Shared spaces, members and organizations live only in Kailo.

import { getCurrentInstance, onBeforeUnmount, shallowRef, watch, computed, type ComputedRef } from 'vue'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import type { KailoActionFiles, KailoActionIcon, KailoEmbedRuntime, KailoFileSelection, KailoPage, KailoPageAction, KailoPageItem } from './bridge'

export interface PageCrumb {
  id: string
  label: string
  go: () => void
}

export interface PageAction {
  id: string
  label: string
  variant?: 'primary' | 'secondary' | 'menu'
  icon?: KailoActionIcon
  disabled?: boolean
  busy?: boolean
  /**
   * DD-157 file selection channel: Kailo opens the system file picker inside
   * the user's click and `run` receives the chosen files (a frame cannot open
   * its own picker from a header click — it has no user activation).
   */
  files?: KailoActionFiles
  run: (selection?: KailoFileSelection) => void
}

export interface PageSpec {
  title: string
  breadcrumbs?: PageCrumb[]
  actions?: PageAction[]
}

export type ProductTabId = 'chat' | 'knowledge-bases' | 'agents' | 'artifacts'

interface ProductTab {
  id: ProductTabId
  path: string
  /** Deployment capability the native menu requires for the same entry. */
  capability?: 'agents' | 'settings.sandbox'
}

/** Same business entries and order as the native menu (stores/menu.ts), without organizations/settings/logout. */
export const PRODUCT_TABS: readonly ProductTab[] = [
  { id: 'chat', path: '/platform/creatChat' },
  { id: 'knowledge-bases', path: '/platform/knowledge-bases' },
  { id: 'agents', path: '/platform/agents', capability: 'agents' },
  { id: 'artifacts', path: '/platform/artifacts', capability: 'settings.sandbox' },
]

type Lang = 'zh' | 'en'
type TextKey = ProductTabId | 'newChat' | 'settings' | 'spaces' | 'product'

const TEXT: Record<Lang, Record<TextKey, string>> = {
  zh: {
    chat: '对话',
    'knowledge-bases': '知识库',
    agents: 'Agent',
    artifacts: '产物',
    newChat: '新建对话',
    settings: '设置',
    spaces: '共享空间',
    product: '知识库',
  },
  en: {
    chat: 'Chat',
    'knowledge-bases': 'Knowledge bases',
    agents: 'Agents',
    artifacts: 'Artifacts',
    newChat: 'New chat',
    settings: 'Settings',
    spaces: 'Shared spaces',
    product: 'Knowledge',
  },
}

export function pageText(key: TextKey, locale: string): string {
  return TEXT[/^zh\b/i.test(locale || '') ? 'zh' : 'en'][key]
}

const ROUTE_TAB: Record<string, ProductTabId> = {
  globalCreatChat: 'chat',
  kbCreatChat: 'chat',
  chat: 'chat',
  knowledgeBaseList: 'knowledge-bases',
  knowledgeBaseDetail: 'knowledge-bases',
  agentList: 'agents',
  artifactLibrary: 'artifacts',
}

/** The product tab a route belongs to (settings and others: none). */
export function tabForRoute(name: string): ProductTabId | undefined {
  return ROUTE_TAB[name]
}

/** Routes whose view publishes its own header; the frame waits for it instead of a default. */
export const VIEW_OWNED_ROUTES: ReadonlySet<string> = new Set([
  'knowledgeBaseList',
  'knowledgeBaseDetail',
  'chat',
  'agentList',
])

/** Header for routes without a view-owned header. */
export function defaultSpec(routeName: string, locale: string): PageSpec {
  switch (routeName) {
    case 'globalCreatChat':
    case 'kbCreatChat':
      return { title: pageText('newChat', locale) }
    case 'artifactLibrary':
      return { title: pageText('artifacts', locale) }
    case 'settings':
      return { title: pageText('settings', locale) }
    case 'organizationList':
      return { title: pageText('spaces', locale) }
    default: {
      const tab = tabForRoute(routeName)
      return { title: pageText(tab ?? 'product', locale) }
    }
  }
}

function squash(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** Display text within the runtime's limits (whitespace collapsed, ellipsis when clipped). */
export function clipText(value: unknown, max: number): string {
  const text = squash(value).replace(/[\u0000-\u001f\u007f]/g, '')
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** `<input accept>` values Kailo's picker takes (07 §4.8.7): 1–200 of [A-Za-z0-9.+-/*, ]. */
const ACCEPT = /^[A-Za-z0-9.+\-/*, ]{1,200}$/

/**
 * The picker options in the runtime's shape. An accept list the picker cannot
 * take (too long, unusual characters) is left out — the picker then offers
 * every file and the view's own type filter still applies.
 */
export function pickerFiles(files: KailoActionFiles): KailoActionFiles {
  const out: KailoActionFiles = {}
  const accept = typeof files.accept === 'string' ? files.accept.replace(/\s+/g, '') : ''
  if (accept && ACCEPT.test(accept)) out.accept = accept
  if (files.multiple) out.multiple = true
  if (files.directory) out.directory = true
  return out
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 256 && !/[\u0000-\u001f\u007f]/.test(id)
}

function itemsOf(list: readonly { id: string; label: string }[] | undefined, max: number, labelMax: number): KailoPageItem[] {
  const out: KailoPageItem[] = []
  for (const item of list ?? []) {
    const label = clipText(item.label, labelMax)
    if (validId(item.id) && label) out.push({ id: item.id, label })
  }
  return out.length > max ? out.slice(out.length - max) : out
}

/**
 * The header in the runtime's shape (20 §13.2): never throws on content — long
 * labels are clipped, empty entries dropped, at most 8 ancestors (the nearest
 * kept), 8 tabs, 8 actions and one primary (extra primaries become secondary).
 */
export function toKailoPage(
  spec: PageSpec,
  tabs: readonly KailoPageItem[],
  activeTab: string | undefined,
  fallbackTitle: string,
): KailoPage {
  const title = clipText(spec.title, 120) || clipText(fallbackTitle, 120)
  const breadcrumbs = itemsOf(spec.breadcrumbs, 8, 80)
  const pageTabs = itemsOf(tabs, 8, 40)
  let primary = false
  const actions: KailoPageAction[] = []
  for (const action of spec.actions ?? []) {
    const label = clipText(action.label, 40)
    if (!validId(action.id) || !label || actions.length >= 8) continue
    let variant = action.variant ?? 'secondary'
    if (variant === 'primary') {
      if (primary) variant = 'secondary'
      primary = true
    }
    const out: KailoPageAction = { id: action.id, label, variant }
    if (action.icon) out.icon = action.icon
    if (action.files) out.files = pickerFiles(action.files)
    if (action.disabled) out.disabled = true
    if (action.busy) out.busy = true
    actions.push(out)
  }
  const page: KailoPage = { title, breadcrumbs, tabs: pageTabs, actions }
  if (activeTab && pageTabs.some((tab) => tab.id === activeTab)) page.activeTab = activeTab
  return page
}

// ---------------------------------------------------------------------------
// View registration: the most recently set-up view owns the header.

interface Owner {
  route: string
  spec: ComputedRef<PageSpec | null>
}

const owner = shallowRef<Owner | null>(null)

/**
 * Declares the current view's header. `build` returns null while the view's
 * content is not ready (Kailo keeps its skeleton until the first header).
 * Call from a routed view's setup; a no-op outside the Kailo shell.
 */
export function usePageHeader(routeName: string, build: () => PageSpec | null): void {
  if (!getCurrentInstance()) return
  const entry: Owner = { route: routeName, spec: computed(build) }
  owner.value = entry
  onBeforeUnmount(() => {
    if (owner.value === entry) owner.value = null
  })
}

export interface PageShellDeps {
  runtime: KailoEmbedRuntime
  router: Router
  route: RouteLocationNormalizedLoaded
  locale: () => string
  /** Whether a deployment capability is available (stores/deploymentCapabilities). */
  supports: (capability: string | undefined) => boolean
}

/** Product tabs visible in this deployment. */
export function visibleTabs(locale: string, supports: (capability: string | undefined) => boolean): KailoPageItem[] {
  return PRODUCT_TABS.filter((tab) => supports(tab.capability)).map((tab) => ({ id: tab.id, label: pageText(tab.id, locale) }))
}

/**
 * Publishes the header for every route/context change and dispatches Kailo's
 * callbacks. Call once from the platform frame's setup. Returns a stop function.
 */
export function installPageShell(deps: PageShellDeps): () => void {
  const { runtime, router, route } = deps
  if (typeof runtime.setPage !== 'function') return () => {}
  let published: PageSpec | null = null

  const publish = () => {
    const name = String(route.name ?? '')
    const current = owner.value
    let spec: PageSpec | null
    if (current && current.route === name) spec = current.spec.value
    else if (VIEW_OWNED_ROUTES.has(name)) spec = null
    else spec = defaultSpec(name, deps.locale())
    if (!spec) return
    published = spec
    const page = toKailoPage(spec, visibleTabs(deps.locale(), deps.supports), tabForRoute(name), pageText('product', deps.locale()))
    try {
      runtime.setPage!(page)
    } catch (error) {
      console.warn('[kailo] page header rejected', error)
    }
  }

  const stopWatch = watch(
    () => [route.name, route.fullPath, owner.value, owner.value?.spec.value, deps.locale(), visibleTabs(deps.locale(), deps.supports).length],
    publish,
    { immediate: true },
  )

  const offNavigate = runtime.onNavigate?.((target) => {
    if (target.kind === 'tab') {
      const tab = PRODUCT_TABS.find((entry) => entry.id === target.id)
      if (tab && route.path !== tab.path) void router.push(tab.path)
      return
    }
    published?.breadcrumbs?.find((crumb) => crumb.id === target.id)?.go()
  })
  const offAction = runtime.onAction?.((id, selection) => {
    const action = published?.actions?.find((entry) => entry.id === id)
    if (!action || action.disabled || action.busy) return
    // Only file actions take a selection; the runtime already checked its shape.
    action.run(action.files && selection && selection.files.length ? selection : undefined)
  })

  return () => {
    stopWatch()
    offNavigate?.()
    offAction?.()
  }
}
