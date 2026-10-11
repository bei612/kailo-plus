import * as React from "react";

/**
 * URL-search-param-backed UI state, so it lives in the history stack:
 * back/forward restores the value a given entry carried, and reloads
 * restore it from the URL.
 *
 * Patch calls made synchronously within one event handler are coalesced
 * into a single navigation, so each user action produces exactly one
 * history entry even when a handler updates several keys.
 */

export type HistorySearchSetterOptions = {
  /** Rewrite the current entry instead of pushing a new one. */
  replace?: boolean;
};

export type HistorySearchNavigation = {
  to: ".";
  search: (previousSearch: Record<string, unknown>) => Record<string, unknown>;
  replace: boolean;
  resetScroll: false;
};

export function useHistorySearchState<K extends string>(
  keys: readonly K[],
  search: Partial<Record<K, string>>,
  navigate: (options: HistorySearchNavigation) => void,
) {

  const values = {} as Record<K, string | null>;
  for (const key of keys) {
    values[key] = search[key] ?? null;
  }

  const currentValuesRef = React.useRef(values);
  currentValuesRef.current = values;
  const keysRef = React.useRef(keys);
  keysRef.current = keys;

  const pendingRef = React.useRef<{
    patch: Partial<Record<K, string | null>>;
    replace: boolean;
  } | null>(null);

  const applyPatch = React.useCallback(
    (
      patch: Partial<Record<K, string | null>>,
      options?: HistorySearchSetterOptions,
    ) => {
      const pending = pendingRef.current;
      if (pending) {
        Object.assign(pending.patch, patch);
        pending.replace = pending.replace || Boolean(options?.replace);
        return;
      }

      pendingRef.current = {
        patch: { ...patch },
        replace: Boolean(options?.replace),
      };
      queueMicrotask(() => {
        const flush = pendingRef.current;
        pendingRef.current = null;
        if (!flush) {
          return;
        }

        const currentValues = currentValuesRef.current;
        const isChanged = keysRef.current.some(
          (key) =>
            flush.patch[key] !== undefined &&
            (flush.patch[key] ?? null) !== currentValues[key],
        );
        if (!isChanged) {
          return;
        }

        navigate({
          to: ".",
          search: (previousSearch: Record<string, unknown>) => {
            const nextSearch = { ...previousSearch };
            for (const key of keysRef.current) {
              const value = flush.patch[key];
              if (value === undefined) {
                continue;
              }
              if (value === null) {
                delete nextSearch[key];
              } else {
                nextSearch[key] = value;
              }
            }
            return nextSearch;
          },
          replace: flush.replace,
          resetScroll: false,
        });
      });
    },
    [navigate],
  );

  return { applyPatch, values };
}
