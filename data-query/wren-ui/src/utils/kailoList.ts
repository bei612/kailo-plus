// DD-167 (`20` §15.3/§15.4): list paging, route state and read-failure
// classification shared by the business pages. Pure functions (unit-tested
// in kailoList.test.ts); the React parts live in hooks/useListRoute and
// components/kailo/KailoList.
import type { KailoTextKey } from './kailoI18n';

/** Page sizes of a list (20 §15.3); card grids are not used on this component. */
export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;
/** The thread pane pages in fixed steps (compact pager, no size choice). */
export const PANE_PAGE_SIZE = 20;

export type ListDensity = 'comfortable' | 'compact';
export const LIST_DENSITY_KEY = 'appearance.listDensity';

/** Row height of lists and tables for the Kailo list density (40 / 32). */
export function rowHeight(density: ListDensity | string | undefined): number {
  return density === 'compact' ? 32 : 40;
}

export function listDensityOf(value: unknown): ListDensity {
  return value === 'compact' ? 'compact' : 'comfortable';
}

export function pageCount(total: number, size: number): number {
  if (!Number.isFinite(total) || total <= 0 || size <= 0) return 1;
  return Math.ceil(total / size);
}

/** A page past the end returns to the last page (20 §15.3). */
export function clampPage(page: number, total: number, size: number): number {
  const last = pageCount(total, size);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), last);
}

/**
 * Page buttons: all pages up to 7, else first and last with an ellipsis
 * ("gap") on the side(s) away from the current page.
 */
export function pageItems(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const items: (number | 'gap')[] = [1];
  let start = Math.max(2, page - 1);
  let end = Math.min(pages - 1, page + 1);
  if (page <= 3) {
    start = 2;
    end = 5;
  } else if (page >= pages - 2) {
    start = pages - 4;
    end = pages - 1;
  }
  if (start > 2) items.push('gap');
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < pages - 1) items.push('gap');
  items.push(pages);
  return items;
}

export function slicePage<T>(items: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}

type Query = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** Page and size from the route query; unknown values fall back to defaults. */
export function readPaging(
  query: Query,
  defaults: { size?: number; sizes?: readonly number[] } = {},
): { page: number; size: number } {
  const sizes = defaults.sizes || PAGE_SIZES;
  const fallback = defaults.size || DEFAULT_PAGE_SIZE;
  const page = Number.parseInt(first(query.page) || '', 10);
  const size = Number.parseInt(first(query.size) || '', 10);
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    size: sizes.includes(size) ? size : fallback,
  };
}

export function readText(query: Query, key: string): string {
  return (first(query[key]) || '').slice(0, 200);
}

/**
 * The route query after a change of list state: defaults are dropped so a
 * plain list keeps a clean URL; any filter change returns to page 1.
 */
export function nextQuery(
  query: Query,
  change: Record<string, string | number | undefined | null>,
  defaults: { size?: number } = {},
): Query {
  const next: Query = { ...query };
  const filterChanged = Object.keys(change).some(
    (key) => key !== 'page' && key !== 'size',
  );
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined || value === null || value === '')
      delete next[key];
    else next[key] = String(value);
  }
  if ('size' in change || filterChanged) delete next.page;
  if (next.page === '1') delete next.page;
  if (next.size === String(defaults.size || DEFAULT_PAGE_SIZE))
    delete next.size;
  return next;
}

/** Case-insensitive match of a search text against any of the fields. */
export function matchesSearch(
  search: string,
  ...fields: (string | null | undefined | string[])[]
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) =>
    (Array.isArray(field) ? field : [field]).some((value) =>
      (value || '').toLowerCase().includes(needle),
    ),
  );
}

// ---- Read failures (20 §15.4) ---------------------------------------------

export type LoadFailure =
  | 'forbidden'
  | 'network'
  | 'unavailable'
  | 'timeout'
  | 'gone'
  | 'unknown';

const FORBIDDEN_CODES = new Set([
  'KAILO_ADMIN_REQUIRED',
  'KAILO_MANAGED',
  'KAILO_NOT_MEMBER',
  'FORBIDDEN',
  'PERMISSION_DENIED',
  'QUERY_SCOPE_DENIED',
  'NATIVE_PERMISSION_DENIED',
]);

const statusOf = (value: any): number | undefined => {
  const status = value?.statusCode ?? value?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * What kind of failure an Apollo/fetch error is, for the inline error or the
 * no-permission state. Internal codes are never shown to the user.
 */
export function classifyLoadError(error: any): LoadFailure {
  if (!error) return 'unknown';
  const graphQLErrors: any[] = error.graphQLErrors || [];
  for (const item of graphQLErrors) {
    const code = String(item?.extensions?.code || '');
    const status = statusOf(item?.extensions);
    if (FORBIDDEN_CODES.has(code) || status === 403) return 'forbidden';
    if (code === 'RESOURCE_NOT_FOUND' || status === 404) return 'gone';
    if (status === 504 || code === 'POLLING_TIMEOUT') return 'timeout';
  }
  const network = error.networkError;
  if (network) {
    const status = statusOf(network);
    if (status === 403) return 'forbidden';
    if (status === 404) return 'gone';
    if (status === 408 || status === 504) return 'timeout';
    if (status !== undefined && status >= 500) return 'unavailable';
    if (status === undefined) return 'network';
  }
  const message = String(error.message || '');
  if (/timed? ?out|timeout/i.test(message)) return 'timeout';
  if (/failed to fetch|network/i.test(message)) return 'network';
  if (graphQLErrors.length) return 'unavailable';
  return 'unknown';
}

export const FAILURE_REASON: Record<
  Exclude<LoadFailure, 'forbidden'>,
  KailoTextKey
> = {
  network: 'list.reasonNetwork',
  unavailable: 'list.reasonUnavailable',
  timeout: 'list.reasonTimeout',
  gone: 'list.reasonGone',
  unknown: 'list.reasonUnknown',
};

// ---- DD-165 quota refusals --------------------------------------------------

const USAGE_TEXT: Record<string, KailoTextKey> = {
  TENANT_QUOTA_EXHAUSTED: 'usage.tenantExhausted',
  MEMBER_QUOTA_EXHAUSTED: 'usage.memberExhausted',
  QUOTA_NOT_CONFIGURED: 'usage.notConfigured',
};

/**
 * The Kailo wording key of a refused question (07 §4.8.9), chosen from the
 * decision so it follows the Kailo locale; null when not a quota refusal.
 */
export function usageRefusalKey(graphQLError: any): KailoTextKey | null {
  if (graphQLError?.extensions?.code !== 'KAILO_USAGE_REFUSED') return null;
  return (
    USAGE_TEXT[String(graphQLError.extensions.decision)] || 'usage.unavailable'
  );
}

/** Mutations report through a toast; failed reads render in place instead. */
export function isReadOperation(operation: any): boolean {
  const definitions: any[] = operation?.query?.definitions || [];
  const main = definitions.find(
    (definition) => definition?.kind === 'OperationDefinition',
  );
  return !!main && main.operation !== 'mutation';
}
