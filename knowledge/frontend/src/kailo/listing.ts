// DD-167 (design 20 §15.3): the pure rules of every Kailo list in this
// component — page arithmetic, the page-number strip, route query state,
// list density and relative time. Views only bind these to the DOM.

export type ListDensity = 'comfortable' | 'compact'

/** Row height of lists and tables per Kailo "外观 › 列表密度" (20 §15.3). */
export const ROW_HEIGHT: Readonly<Record<ListDensity, number>> = { comfortable: 40, compact: 32 }

/** Page sizes offered under a list or table. */
export const LIST_PAGE_SIZES: readonly number[] = [20, 50, 100]
/** Page sizes offered under a card grid. */
export const GRID_PAGE_SIZES: readonly number[] = [24, 48, 96]

export function pageCount(total: number, size: number): number {
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  const s = Number.isFinite(size) && size > 0 ? Math.floor(size) : 1
  return Math.max(1, Math.ceil(t / s))
}

/** A page that exists for this total: a page past the end lands on the last one (20 §15.3). */
export function clampPage(page: number, total: number, size: number): number {
  const p = Number.isFinite(page) ? Math.floor(page) : 1
  return Math.min(Math.max(1, p), pageCount(total, size))
}

export type PageToken = number | 'gap-start' | 'gap-end'

/**
 * The page numbers to show: every page up to 7, otherwise the first and last
 * page, the current one with its neighbours, and a gap marker for each
 * skipped run (always 7 slots so the strip does not jump while paging).
 */
export function pageTokens(current: number, count: number): PageToken[] {
  const n = Math.max(1, Math.floor(count))
  const c = Math.min(Math.max(1, Math.floor(current)), n)
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  if (c <= 4) return [1, 2, 3, 4, 5, 'gap-end', n]
  if (c >= n - 3) return [1, 'gap-start', n - 4, n - 3, n - 2, n - 1, n]
  return [1, 'gap-start', c - 1, c, c + 1, 'gap-end', n]
}

/** 1-based position of the first and last item on a page (0, 0 when empty). */
export function pageRange(page: number, size: number, total: number): { from: number; to: number } {
  if (!(total > 0)) return { from: 0, to: 0 }
  const p = clampPage(page, total, size)
  return { from: (p - 1) * size + 1, to: Math.min(total, p * size) }
}

/** The items of one page of a bounded, client-side collection. */
export function slicePage<T>(items: readonly T[], page: number, size: number): T[] {
  const p = clampPage(page, items.length, size)
  return items.slice((p - 1) * size, p * size)
}

type QueryValue = string | null | undefined | (string | null)[]
export type RouteQuery = Record<string, QueryValue>

function single(value: QueryValue): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : undefined
}

/** A positive integer from a query value, else the fallback. */
export function queryInt(value: QueryValue, fallback: number): number {
  const raw = single(value)
  if (!raw || !/^\d{1,6}$/.test(raw)) return fallback
  const n = Number(raw)
  return n >= 1 ? n : fallback
}

/** One of the allowed values from a query value, else the fallback. */
export function queryEnum<T extends string>(value: QueryValue, allowed: readonly T[], fallback: T): T {
  const raw = single(value)
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/** A trimmed search text from a query value (at most 200 characters). */
export function queryText(value: QueryValue): string {
  return (single(value) ?? '').trim().slice(0, 200)
}

/** A page size from the query: only an offered size is accepted. */
export function querySize(value: QueryValue, allowed: readonly number[], fallback: number): number {
  const n = queryInt(value, fallback)
  return allowed.includes(n) ? n : fallback
}

/**
 * The route query with `patch` applied: a value equal to its default (or
 * empty) is removed so the default view keeps a clean URL; other keys of the
 * query are kept untouched.
 */
export function patchQuery(
  query: RouteQuery,
  patch: Record<string, string | number | null | undefined>,
  defaults: Record<string, string | number> = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    const v = single(value)
    if (v !== undefined) out[key] = v
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '' || String(value) === String(defaults[key] ?? '')) delete out[key]
    else out[key] = String(value)
  }
  return out
}

/** True when two flat queries hold the same values. */
export function sameQuery(a: RouteQuery, b: RouteQuery): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (single(a[key]) !== single(b[key])) return false
  return true
}

/** Kailo `appearance.listDensity` value, comfortable unless it says compact. */
export function densityOf(values: Record<string, unknown> | null | undefined): ListDensity {
  return values && values['appearance.listDensity'] === 'compact' ? 'compact' : 'comfortable'
}

function lang(locale: string): 'zh' | 'en' {
  return /^zh\b/i.test(locale || '') ? 'zh' : 'en'
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Absolute local time for a tooltip ("2026年10月30日 14:05" / "Oct 30, 2026, 2:05 PM"). */
export function absoluteTime(value: string | number | Date | null | undefined, locale: string): string {
  const d = toDate(value)
  if (!d) return ''
  return new Intl.DateTimeFormat(lang(locale) === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d)
}

/**
 * Relative time for list rows (20 §15.3): "刚刚", "5 分钟前", "3 天前" up to
 * 30 days, then the date ("10月3日", "2025年12月1日"); English alike.
 */
export function relativeTime(value: string | number | Date | null | undefined, locale: string, now: Date = new Date()): string {
  const d = toDate(value)
  if (!d) return ''
  const l = lang(locale)
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000)
  if (seconds < 45) return l === 'zh' ? '刚刚' : 'Just now'
  const rtf = new Intl.RelativeTimeFormat(l === 'zh' ? 'zh-CN' : 'en-US', { numeric: 'always' })
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (days <= 30) return rtf.format(-days, 'day')
  const sameYear = d.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(l === 'zh' ? 'zh-CN' : 'en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(d)
}

/** Monogram for an avatar without a picture: the first letter or CJK character. */
export function monogram(name: string | null | undefined): string {
  const text = (name || '').trim()
  if (!text) return '?'
  const first = Array.from(text)[0]
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}
