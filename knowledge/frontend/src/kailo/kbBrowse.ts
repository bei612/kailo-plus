// DD-167 (design 20 §15.1, §15.3): the knowledge base list of the Kailo
// shell. The set of knowledge bases a person can see is bounded per space
// and is already held in full by the page (the chat's knowledge base picker
// needs it too), so scopes, search, sorting, counts and pages are computed
// here on the client; counts always reflect the filtered total.

import { GRID_PAGE_SIZES, LIST_PAGE_SIZES, queryEnum, queryInt, querySize, queryText, type RouteQuery } from './listing'

export const KB_SCOPES = ['all', 'mine', 'shared', 'favorites'] as const
export type KbScope = typeof KB_SCOPES[number]
export const KB_SORTS = ['updated', 'name', 'created'] as const
export type KbSort = typeof KB_SORTS[number]
export const KB_VIEWS = ['grid', 'list'] as const
export type KbView = typeof KB_VIEWS[number]

export interface KbEntry {
  id: string
  name: string
  description: string
  kind: 'document' | 'faq'
  wiki: boolean
  /** Documents (document KB) or Q&A pairs (FAQ KB); null when unknown (some shares). */
  count: number | null
  updatedAt: string | null
  createdAt: string | null
  /** Display name of the owner; empty when unknown. */
  ownerName: string
  /** Created by the person looking at the list. */
  ownedByMe: boolean
  /** Reached through a share rather than the person's own space. */
  shared: boolean
  favorite: boolean
  pinned: boolean
  /** Models chosen; opening an unready KB opens its settings. */
  ready: boolean
  processing: boolean
  canManage: boolean
  canDuplicate: boolean
}

export interface KbBrowseState {
  scope: KbScope
  q: string
  sort: KbSort
  view: KbView
  page: number
  size: number
}

export const KB_DEFAULTS = { scope: 'all', sort: 'updated', view: 'grid' } as const

export function defaultSize(view: KbView): number {
  return view === 'grid' ? GRID_PAGE_SIZES[0] : LIST_PAGE_SIZES[0]
}

/** The list view described by the route query (unknown values fall back to defaults). */
export function readKbBrowse(query: RouteQuery): KbBrowseState {
  const view = queryEnum(query.view, KB_VIEWS, KB_DEFAULTS.view)
  return {
    scope: queryEnum(query.scope, KB_SCOPES, KB_DEFAULTS.scope),
    q: queryText(query.q),
    sort: queryEnum(query.sort, KB_SORTS, KB_DEFAULTS.sort),
    view,
    page: queryInt(query.page, 1),
    size: querySize(query.size, view === 'grid' ? GRID_PAGE_SIZES : LIST_PAGE_SIZES, defaultSize(view)),
  }
}

/** Query values for a view, defaults omitted (patchQuery removes them). */
export function kbBrowseQuery(state: KbBrowseState): Record<string, string | number> {
  return { scope: state.scope, q: state.q, sort: state.sort, view: state.view, page: state.page, size: state.size }
}

export function kbBrowseDefaults(view: KbView): Record<string, string | number> {
  return { ...KB_DEFAULTS, page: 1, size: defaultSize(view) }
}

export function inScope(entry: KbEntry, scope: KbScope): boolean {
  switch (scope) {
    case 'mine': return entry.ownedByMe && !entry.shared
    case 'shared': return entry.shared
    case 'favorites': return entry.favorite
    default: return true
  }
}

export function scopeCounts(entries: readonly KbEntry[]): Record<KbScope, number> {
  const out: Record<KbScope, number> = { all: 0, mine: 0, shared: 0, favorites: 0 }
  for (const entry of entries) for (const scope of KB_SCOPES) if (inScope(entry, scope)) out[scope] += 1
  return out
}

function matches(entry: KbEntry, q: string): boolean {
  if (!q) return true
  const needle = q.toLocaleLowerCase()
  return entry.name.toLocaleLowerCase().includes(needle) || entry.description.toLocaleLowerCase().includes(needle)
}

function time(value: string | null): number {
  const t = value ? Date.parse(value) : NaN
  return Number.isFinite(t) ? t : 0
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(['zh-CN', 'en'], { numeric: true, sensitivity: 'base' }) : null

/** Pinned first, then the chosen order (newest first for times, A→Z for names). */
export function sortKbEntries(entries: readonly KbEntry[], sort: KbSort): KbEntry[] {
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (sort === 'name') return collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name)
    const d = sort === 'created' ? time(b.createdAt) - time(a.createdAt) : time(b.updatedAt) - time(a.updatedAt)
    return d !== 0 ? d : a.name.localeCompare(b.name)
  })
}

/** The filtered, ordered collection of a view (before paging). */
export function browseKbEntries(entries: readonly KbEntry[], state: Pick<KbBrowseState, 'scope' | 'q' | 'sort'>): KbEntry[] {
  return sortKbEntries(entries.filter((entry) => inScope(entry, state.scope) && matches(entry, state.q)), state.sort)
}

type RawKb = Record<string, unknown>

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Whether a KB has the models it needs (same rule as the native list page). */
export function kbReady(kb: RawKb): boolean {
  if (!str(kb.summary_model_id)) return false
  const strategy = kb.indexing_strategy as { vector_enabled?: boolean; keyword_enabled?: boolean } | undefined
  const needsEmbedding = !strategy || !!strategy.vector_enabled || !!strategy.keyword_enabled
  return !(needsEmbedding && !str(kb.embedding_model_id))
}

export interface KbEntryContext {
  userId: string
  isFavorite: (id: string) => boolean
  isAdmin: boolean
  isContributor: boolean
}

/**
 * One list entry from a row of the merged list (kbListMerge: own space rows
 * carry isMine: true, shares isMine: false with permission and org_name).
 */
export function toKbEntry(kb: RawKb, ctx: KbEntryContext): KbEntry {
  const id = str(kb.id)
  const shared = kb.isMine === false
  const creator = str(kb.creator_id)
  const ownedByMe = !shared && !!creator && !!ctx.userId && creator === ctx.userId
  const kind = kb.type === 'faq' ? 'faq' : 'document'
  const count = kind === 'faq' ? num(kb.chunk_count) : num(kb.knowledge_count)
  return {
    id,
    name: str(kb.name) || id,
    description: str(kb.description).trim(),
    kind,
    wiki: !!(kb.indexing_strategy as { wiki_enabled?: boolean } | undefined)?.wiki_enabled,
    count,
    updatedAt: str(kb.updated_at_raw) || str(kb.updated_at) || null,
    createdAt: str(kb.created_at) || null,
    ownerName: shared ? str(kb.creator_name) || str(kb.org_name) : str(kb.creator_name),
    ownedByMe,
    shared,
    favorite: ctx.isFavorite(id),
    pinned: !shared && kb.is_pinned === true,
    ready: shared ? true : kbReady(kb),
    processing: kb.isProcessing === true || kb.is_processing === true,
    // A share is managed in its owner's space; here it is opened only.
    canManage: !shared && (ownedByMe || ctx.isAdmin),
    canDuplicate: !shared && ctx.isContributor,
  }
}
