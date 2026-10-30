// DD-170 (.design/20 §16.2): the one list and table presentation for platform pages on Web
// and Desktop. A list always states its size: the footer shows the total, the page and the
// page count, and pages can be turned and resized. Columns are declared, not improvised:
// each column says how it aligns, whether it truncates and whether it sorts. Rows open a
// detail by click or Enter; row actions sit in a fixed trailing column. Raw identifiers,
// wire keys and JSON never become a column of their own (§16.5). The pagination bar is the DD-167 §15.3 bar.
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Search, SearchX, X } from "lucide-react";
import { useT } from "./context";

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZES: readonly number[] = [20, 50, 100];
/** Card grids page by rows of cards (DD-167 §15.3). */
export const CARD_PAGE_SIZES: readonly number[] = [24, 48, 96];

export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Columns that give a comparable value can be sorted from their header. */
  sortValue?: (row: T) => string | number | undefined;
  /** Numbers and amounts align to the end with tabular figures. */
  align?: "start" | "end";
  /** CSS width, for example "9rem" or "30%". Unset columns share the remaining width. */
  width?: string;
  /** One line with an ellipsis; `title` gives the full value on hover. */
  truncate?: boolean;
  title?: (row: T) => string | undefined;
  /** Secondary columns are dropped first on narrow containers (below the sm breakpoint). */
  secondary?: boolean;
};

export type SortState = { key: string; direction: "asc" | "desc" } | null;

/** Page arithmetic shared by tables and card grids. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/** Page numbers to show: first, last, the current page and its neighbours; gaps are null. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  if (page <= 3) [2, 3, 4].forEach((p) => p <= pages && wanted.add(p));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((p) => p >= 1 && wanted.add(p));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push(null);
    out.push(p);
  });
  return out;
}

/**
 * Client-side paging of a complete row set. The page is clamped when the set shrinks (a
 * refresh removed rows) and returns to page 1 when `resetKey` changes (a new filter).
 */
export function usePaged<T>(rows: readonly T[], options: { pageSize?: number; resetKey?: string } = {}) {
  const [pageSize, setPageSize] = useState(options.pageSize ?? DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const pages = pageCount(rows.length, pageSize);
  useEffect(() => { setPage(1); }, [options.resetKey]);
  const current = Math.min(page, pages);
  const pageRows = useMemo(() => rows.slice((current - 1) * pageSize, current * pageSize), [rows, current, pageSize]);
  return {
    page: current, pages, pageSize, total: rows.length, pageRows, setPage,
    setPageSize: (size: number) => { setPageSize(size); setPage(1); },
  };
}

const iconButton = "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors duration-[90ms] hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/**
 * The list footer: total, page of pages, page size and page turning. The total is always
 * shown, also on a single page; turning controls appear once there is more than one page.
 */
export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange, pageSizes = PAGE_SIZES, partial, className, testId }: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: readonly number[];
  /** The total counts only what has been loaded so far; more exists on the server. */
  partial?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const t = useT();
  const pages = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, page), pages);
  return <nav aria-label={t("list.pagination")} data-testid={testId ?? "list-pagination"}
    className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground ${className ?? ""}`}>
    <p className="tabular-nums" data-testid="list-total">
      {t("list.total", { total: String(total) })}
      {partial ? <span> · {partial}</span> : null}
    </p>
    <div className="flex flex-wrap items-center gap-3">
      {onPageSizeChange && total > Math.min(...pageSizes) ? <label className="relative inline-flex items-center gap-1.5">
        <span className="sr-only">{t("list.pageSizeLabel")}</span>
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-7 appearance-none rounded-md border border-input bg-background py-0 pl-2 pr-6 text-xs text-foreground shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          {pageSizes.map((size) => <option key={size} value={size}>{t("list.pageSize", { size: String(size) })}</option>)}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 h-3.5 w-3.5" strokeWidth={1.75} />
      </label> : null}
      {pages > 1 ? <span className="tabular-nums" data-testid="list-page">{t("list.pageOf", { page: String(current), pages: String(pages) })}</span> : null}
      {pages > 1 ? <div className="flex items-center gap-0.5">
        <button type="button" className={iconButton} aria-label={t("list.previous")} title={t("list.previous")}
          disabled={current <= 1} onClick={() => onPageChange(current - 1)}>
          <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
        {pageWindow(current, pages).map((p, i) => p === null
          ? <span key={`gap-${i}`} aria-hidden className="px-1">…</span>
          : <button key={p} type="button" aria-label={t("list.pageNumber", { page: String(p) })}
              aria-current={p === current ? "page" : undefined} onClick={() => onPageChange(p)}
              className={`${iconButton} ${p === current ? "bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft hover:text-brand-soft-foreground" : ""}`}>{p}</button>)}
        <button type="button" className={iconButton} aria-label={t("list.next")} title={t("list.next")}
          disabled={current >= pages} onClick={() => onPageChange(current + 1)}>
          <ChevronRight aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div> : null}
    </div>
  </nav>;
}

/** A filter box for a list toolbar. */
export function ListSearch({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  const t = useT();
  return <label className="relative flex h-8 w-full max-w-xs items-center">
    <span className="sr-only">{label ?? t("list.search")}</span>
    <Search aria-hidden className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
    <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder ?? t("list.search")}
      className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/15 [&::-webkit-search-cancel-button]:hidden" />
    {value ? <button type="button" aria-label={t("list.clearSearch")} onClick={() => onChange("")}
      className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground">
      <X aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button> : null}
  </label>;
}

function compare(a: string | number | undefined, b: string | number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}

function SortGlyph({ direction }: { direction: "asc" | "desc" | null }) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  return <Icon aria-hidden className={`h-3 w-3 shrink-0 ${direction ? "text-foreground" : "opacity-0 group-hover/sort:opacity-100"}`} strokeWidth={1.75} />;
}

/**
 * A table over a complete, already authorized row set. Paging, filtering and sorting are
 * local; the footer always states the total. `empty` is shown when there are no rows at
 * all; a filter that matches nothing keeps the table and offers to clear the filter.
 */
export function DataTable<T>({
  rows, columns, rowKey, label, onRowClick, rowActions, rowActionsWidth = "6rem", search, toolbar,
  empty, pageSize, pageSizes = PAGE_SIZES, density = "comfortable", initialSort = null, selectedKey,
  partial, testId,
}: {
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  rowKey: (row: T) => string;
  /** Accessible name of the table. */
  label: string;
  /** Opens the row's detail; the row becomes keyboard reachable. */
  onRowClick?: (row: T) => void;
  /** Trailing per-row actions (buttons or a menu); clicks do not open the row. */
  rowActions?: (row: T) => ReactNode;
  rowActionsWidth?: string;
  /** Local filter: the box searches the text a row returns. */
  search?: { placeholder?: string; text: (row: T) => string };
  /** Extra controls at the end of the toolbar (filters, refresh, the primary action). */
  toolbar?: ReactNode;
  /** Shown instead of the table when there are no rows at all. */
  empty: ReactNode;
  pageSize?: number;
  pageSizes?: readonly number[];
  density?: "comfortable" | "compact";
  initialSort?: SortState;
  selectedKey?: string | null;
  /** The row set is a loaded prefix of a longer server list (see useOffsetCollection). */
  partial?: ReactNode;
  testId?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(initialSort);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q && search ? rows.filter((row) => search.text(row).toLocaleLowerCase().includes(q)) : rows;
  }, [rows, query, search]);
  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !column?.sortValue) return filtered;
    const value = column.sortValue;
    const out = [...filtered].sort((a, b) => compare(value(a), value(b)));
    return sort.direction === "desc" ? out.reverse() : out;
  }, [filtered, sort, columns]);
  const paged = usePaged(sorted, { pageSize, resetKey: `${query}|${sort?.key}|${sort?.direction}` });
  const rowHeight = density === "compact" ? "h-8" : "h-10";
  const cycle = (key: string) => setSort((old) => old?.key !== key ? { key, direction: "asc" }
    : old.direction === "asc" ? { key, direction: "desc" } : null);
  const open = (row: T) => onRowClick?.(row);
  const onKey = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(row); }
  };
  if (rows.length === 0) return <div data-testid={testId}>{toolbar ? <div className="mb-3 flex justify-end gap-2">{toolbar}</div> : null}{empty}</div>;
  return <div className="flex min-w-0 flex-col gap-3" data-testid={testId}>
    {search || toolbar ? <div className="flex flex-wrap items-center justify-between gap-2">
      {search ? <ListSearch value={query} onChange={setQuery} placeholder={search.placeholder} /> : <span />}
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
    </div> : null}
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table aria-label={label} className="w-full min-w-[36rem] table-fixed border-separate border-spacing-0 text-left text-sm">
          <colgroup>
            {columns.map((c) => <col key={c.key} className={c.secondary ? "max-sm:hidden" : undefined} style={c.width ? { width: c.width } : undefined} />)}
            {rowActions ? <col style={{ width: rowActionsWidth }} /> : null}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => {
                const direction = sort?.key === c.key ? sort.direction : null;
                return <th key={c.key} scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}
                  className={`h-9 border-b border-border bg-muted/40 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground ${c.align === "end" ? "text-right" : ""} ${c.secondary ? "max-sm:hidden" : ""}`}>
                  {c.sortValue ? <button type="button" onClick={() => cycle(c.key)}
                    className={`group/sort inline-flex max-w-full items-center gap-1 rounded-sm uppercase hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${c.align === "end" ? "flex-row-reverse" : ""}`}>
                    <span className="truncate">{c.header}</span><SortGlyph direction={direction} />
                  </button> : <span className="block truncate">{c.header}</span>}
                </th>;
              })}
              {rowActions ? <th scope="col" className="h-9 border-b border-border bg-muted/40 px-3 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground"><span className="sr-only">{t("list.actions")}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {paged.pageRows.length === 0 ? <tr><td colSpan={columns.length + (rowActions ? 1 : 0)} className="px-3 py-10 text-center">
              <span className="inline-flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <SearchX aria-hidden className="h-6 w-6" strokeWidth={1.5} />{t("list.noMatch")}
                <button type="button" className="text-brand-text hover:underline" onClick={() => setQuery("")}>{t("list.clearSearch")}</button>
              </span>
            </td></tr> : paged.pageRows.map((row) => {
              const key = rowKey(row);
              const selected = selectedKey === key;
              return <tr key={key} data-row-key={key} aria-selected={selectedKey !== undefined ? selected : undefined}
                tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? () => open(row) : undefined}
                onKeyDown={onRowClick ? (event) => onKey(event, row) : undefined}
                className={`group/row transition-colors duration-[90ms] [&:last-child>td]:border-b-0 ${onRowClick ? "cursor-pointer hover:bg-accent/70 focus-visible:bg-accent/70 focus-visible:outline-hidden" : "hover:bg-accent/40"} ${selected ? "bg-brand-soft hover:bg-brand-soft" : ""}`}>
                {columns.map((c) => <td key={c.key} title={c.title?.(row)}
                  className={`${rowHeight} border-b border-border px-3 py-1.5 align-middle ${c.align === "end" ? "text-right tabular-nums" : ""} ${c.truncate ? "truncate" : "break-words"} ${c.secondary ? "max-sm:hidden" : ""}`}>
                  {c.cell(row)}
                </td>)}
                {rowActions ? <td className={`${rowHeight} border-b border-border px-2 py-1 text-right align-middle`}
                  onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">{rowActions(row)}</div>
                </td> : null}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-3 py-2">
        <Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} pageSizes={pageSizes}
          onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} partial={partial} />
      </div>
    </div>
  </div>;
}

/** Two lines in one cell: the primary text and a muted secondary line (e.g. name over email). */
export function CellStack({ primary, secondary, mono }: { primary: ReactNode; secondary?: ReactNode; mono?: boolean }) {
  return <span className="flex min-w-0 flex-col">
    <span className="truncate font-medium text-foreground">{primary}</span>
    {secondary ? <span className={`truncate text-xs text-muted-foreground ${mono ? "font-mono" : ""}`}>{secondary}</span> : null}
  </span>;
}
