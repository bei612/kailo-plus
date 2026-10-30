import { ReactNode, useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from 'antd';
import clsx from 'clsx';
import useKailoText from '@/utils/kailoI18n';
import {
  FAILURE_REASON,
  LoadFailure,
  PAGE_SIZES,
  classifyLoadError,
  pageCount,
  pageItems,
} from '@/utils/kailoList';
import type { KailoTextKey } from '@/utils/kailoI18n';
import KailoEmpty from './KailoEmpty';
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CloudOffIcon,
  LockIcon,
  SearchIcon,
} from './KailoIcons';

// DD-167 (`20` §15.3/§15.4): the Kailo list grammar of this component —
// toolbar, pager, skeleton rows, progress bar and the read-failure,
// no-permission and no-match states. Styles: controls.less §24.

/** Toolbar 44: business search and filters left, view options right. */
export function KailoToolbar(props: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('kailo-toolbar', props.className)}>
      <div className="kailo-toolbar__start">{props.left}</div>
      {props.right && <div className="kailo-toolbar__end">{props.right}</div>}
    </div>
  );
}

/** Search box 34 high with a 300 ms debounce; the route keeps the value. */
export function KailoSearch(props: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(props.value);
  const latest = useRef(props.onChange);
  latest.current = props.onChange;
  useEffect(() => setText(props.value), [props.value]);
  useEffect(() => {
    if (text === props.value) return;
    const timer = window.setTimeout(() => latest.current(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <Input
      className="kailo-search"
      allowClear
      value={text}
      placeholder={props.placeholder}
      aria-label={props.placeholder}
      prefix={<SearchIcon className="kailo-search__icon" />}
      onChange={(event) => setText(event.target.value)}
    />
  );
}

interface PagerProps {
  total: number;
  page: number;
  size: number;
  sizes?: readonly number[];
  onChange: (page: number, size: number) => void;
  className?: string;
}

/**
 * Pager 44 under a list: "共 N 条" left; size, "第 x / y 页", previous,
 * page numbers and next right. One page keeps the total only.
 */
export function KailoPagination(props: PagerProps) {
  const { total, page, size, sizes = PAGE_SIZES, onChange } = props;
  const t = useKailoText();
  const pages = pageCount(total, size);
  return (
    <nav
      className={clsx('kailo-pager', props.className)}
      aria-label={t('list.pageOf', { page, pages })}
    >
      <span className="kailo-pager__total">{t('list.total', { total })}</span>
      {pages > 1 || total > sizes[0] ? (
        <div className="kailo-pager__controls">
          <Select
            size="small"
            className="kailo-pager__size"
            value={size}
            dropdownMatchSelectWidth={false}
            onChange={(next) => onChange(1, Number(next))}
            options={sizes.map((value) => ({
              value,
              label: t('list.perPage', { size: value }),
            }))}
          />
          <span className="kailo-pager__position">
            {t('list.pageOf', { page, pages })}
          </span>
          {pages > 1 && (
            <div className="kailo-pager__pages">
              <Button
                size="small"
                type="text"
                className="kailo-pager__step"
                aria-label={t('list.prev')}
                disabled={page <= 1}
                icon={<ChevronLeftIcon />}
                onClick={() => onChange(page - 1, size)}
              />
              {pageItems(page, pages).map((item, index) =>
                item === 'gap' ? (
                  <span key={`gap-${index}`} className="kailo-pager__gap">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={clsx('kailo-pager__page', {
                      'kailo-pager__page--current': item === page,
                    })}
                    aria-current={item === page ? 'page' : undefined}
                    onClick={() => item !== page && onChange(item, size)}
                  >
                    {item}
                  </button>
                ),
              )}
              <Button
                size="small"
                type="text"
                className="kailo-pager__step"
                aria-label={t('list.next')}
                disabled={page >= pages}
                icon={<ChevronRightIcon />}
                onClick={() => onChange(page + 1, size)}
              />
            </div>
          )}
        </div>
      ) : null}
    </nav>
  );
}

/** The list pane's compact pager: "‹ x / y ›" (hidden for one page). */
export function KailoPanePager(props: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  const { page, pages, onChange } = props;
  const t = useKailoText();
  if (pages <= 1) return null;
  return (
    <nav className="kailo-pane-pager" aria-label={t('list.pageOf', { page, pages })}>
      <Button
        size="small"
        type="text"
        aria-label={t('list.prev')}
        disabled={page <= 1}
        icon={<ChevronLeftIcon />}
        onClick={() => onChange(page - 1)}
      />
      <span className="kailo-pane-pager__position">
        {page} / {pages}
      </span>
      <Button
        size="small"
        type="text"
        aria-label={t('list.next')}
        disabled={page >= pages}
        icon={<ChevronRightIcon />}
        onClick={() => onChange(page + 1)}
      />
    </nav>
  );
}

/**
 * Refresh of a shown list (page, sort, filter): 2 px brand bar on top and
 * "仍在载入…" after 10 s; the old rows stay (dimmed by the caller).
 */
export function KailoListProgress(props: { active: boolean }) {
  const { active } = props;
  const t = useKailoText();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!active) return;
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, [active]);
  return (
    <div
      className={clsx('kailo-progress', { 'kailo-progress--active': active })}
      role={active ? 'progressbar' : undefined}
      aria-hidden={!active}
    >
      <span className="kailo-progress__track">
        <span className="kailo-progress__bar" />
      </span>
      {active && slow && (
        <span className="kailo-progress__slow">{t('list.stillLoading')}</span>
      )}
    </div>
  );
}

/** First read of a list: skeleton rows in the table's shape (≤ 10). */
export function KailoSkeletonRows(props: {
  rows: number;
  columns?: number[];
  className?: string;
}) {
  const columns = props.columns || [36, 44, 12, 8];
  const rows = Math.max(1, Math.min(10, props.rows));
  return (
    <div
      className={clsx('kailo-skeleton-list', props.className)}
      aria-busy="true"
    >
      <div className="kailo-skeleton-list__head">
        {columns.map((width, index) => (
          <span
            key={index}
            className="kailo-skeleton-bar kailo-skeleton-bar--head"
            style={{ flexBasis: `${width}%` }}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="kailo-skeleton-list__row">
          {columns.map((width, index) => (
            <span
              key={index}
              className="kailo-skeleton-bar"
              style={{
                flexBasis: `${width}%`,
                maxWidth: `${Math.max(20, width - ((row * 7 + index * 5) % 14))}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Pane skeleton: rows 32 like the thread rows. */
export function KailoPaneSkeleton(props: { rows?: number }) {
  return (
    <div className="kailo-pane-skeleton" aria-busy="true">
      {Array.from({ length: props.rows || 8 }, (_, row) => (
        <span
          key={row}
          className="kailo-skeleton-bar"
          style={{ width: `${88 - ((row * 17) % 40)}%` }}
        />
      ))}
    </div>
  );
}

const FAILURE_ICON = {
  network: CloudOffIcon,
  timeout: ClockIcon,
  unavailable: AlertCircleIcon,
  gone: AlertCircleIcon,
  unknown: AlertCircleIcon,
};

/**
 * Inline read failure (20 §15.4): icon, "未能载入…", the reason category and
 * "重试"; no toast, no redirect. A 403 renders the no-permission state.
 */
export function KailoLoadError(props: {
  error: unknown;
  item: KailoTextKey;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
  /** A page-specific reason in Kailo wording instead of the category. */
  reason?: string;
}) {
  const t = useKailoText();
  const kind: LoadFailure = classifyLoadError(props.error);
  if (kind === 'forbidden')
    return <KailoForbidden item={props.item} className={props.className} />;
  const Icon = FAILURE_ICON[kind];
  const item = t(props.item);
  return (
    <div
      role="alert"
      className={clsx(
        'kailo-load-error',
        { 'kailo-load-error--compact': props.compact },
        props.className,
      )}
    >
      <Icon size={props.compact ? 20 : 32} className="kailo-load-error__icon" />
      <div className="kailo-load-error__title">
        {t('list.loadFailed', { item })}
      </div>
      <div className="kailo-load-error__reason">
        {props.reason || t(FAILURE_REASON[kind])}
      </div>
      {props.onRetry && kind !== 'gone' && (
        <Button size={props.compact ? 'small' : 'middle'} onClick={props.onRetry}>
          {t('list.retry')}
        </Button>
      )}
    </div>
  );
}

/** No permission (403, KAILO_ADMIN_REQUIRED): lock, no retry, no code. */
export function KailoForbidden(props: {
  item: KailoTextKey;
  hint?: string;
  className?: string;
}) {
  const t = useKailoText();
  return (
    <KailoEmpty
      className={clsx('kailo-empty--locked', props.className)}
      icon={LockIcon}
      title={t('list.forbiddenTitle', { item: t(props.item) })}
      description={props.hint || t('list.forbiddenHint')}
    />
  );
}

/** Filter or search found nothing: small empty state and "清除筛选". */
export function KailoNoMatch(props: {
  item: KailoTextKey;
  onClear: () => void;
}) {
  const t = useKailoText();
  return (
    <div className="kailo-no-match">
      <SearchIcon size={24} className="kailo-no-match__icon" />
      <div className="kailo-no-match__title">
        {t('list.noMatch', { item: t(props.item) })}
      </div>
      <div className="kailo-no-match__hint">{t('list.noMatchHint')}</div>
      <Button size="small" onClick={props.onClear}>
        {t('list.clearFilters')}
      </Button>
    </div>
  );
}

/** Segmented control (20 §9): container hover, selected surface + xs shadow. */
export function KailoSegmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="kailo-segmented" role="tablist" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === props.value}
          className={clsx('kailo-segmented__item', {
            'kailo-segmented__item--active': option.value === props.value,
          })}
          onClick={() =>
            option.value !== props.value && props.onChange(option.value)
          }
        >
          {option.label}
          {typeof option.count === 'number' && (
            <span className="kailo-segmented__count">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Relative time with the absolute time on hover (20 §15.3 行). */
export function KailoTime(props: {
  value?: string | null;
  relative: (value: string) => string;
  absolute: (value: string) => string;
}) {
  if (!props.value) return <span className="kailo-row-secondary">—</span>;
  return (
    <span
      className="kailo-row-secondary kailo-num"
      title={props.absolute(props.value)}
    >
      {props.relative(props.value)}
    </span>
  );
}

/**
 * The list card of a page and its states (20 §15.4): first read as skeleton
 * rows; a read failure inline with retry (403: no permission); first-use
 * empty; filtered empty with "清除筛选"; otherwise the table and the pager,
 * dimmed under a progress bar while the next page loads.
 */
export function KailoListFrame(props: {
  item: KailoTextKey;
  loading: boolean;
  refreshing?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isEmpty: boolean;
  noMatch?: boolean;
  onClearFilters?: () => void;
  empty: ReactNode;
  skeletonRows: number;
  skeletonColumns?: number[];
  pager?: ReactNode;
  children: ReactNode;
}) {
  const content = () => {
    if (props.loading)
      return (
        <KailoSkeletonRows
          rows={props.skeletonRows}
          columns={props.skeletonColumns}
        />
      );
    if (props.error)
      return (
        <KailoLoadError
          error={props.error}
          item={props.item}
          onRetry={props.onRetry}
        />
      );
    if (props.isEmpty) return props.empty;
    if (props.noMatch && props.onClearFilters)
      return <KailoNoMatch item={props.item} onClear={props.onClearFilters} />;
    return (
      <>
        {props.children}
        {props.pager}
      </>
    );
  };
  return (
    <div
      className={clsx('kailo-list', {
        'kailo-list--refreshing': props.refreshing,
      })}
      aria-busy={props.loading || props.refreshing || undefined}
    >
      <KailoListProgress active={!!props.refreshing} />
      {content()}
    </div>
  );
}
