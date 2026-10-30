import { useSyncExternalStore } from 'react';

// DD-169(2)①: the current data source of this browser tab. It is navigation
// state only — every request names it (header, or a query parameter for
// EventSource streams) and the server checks that it exists; it grants and
// hides nothing. Kept per tab (sessionStorage) and remembered as the last
// choice (localStorage) so a new tab opens where the person left off. Null
// means the instance's first data source.

export const DATA_SOURCE_HEADER = 'x-kailo-data-source';
export const DATA_SOURCE_PARAM = 'kailo_data_source';
const STORAGE_KEY = 'kailo.dataQuery.dataSource';

type Listener = () => void;
const listeners = new Set<Listener>();
let current: number | null | undefined;

function valid(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function storage(kind: 'sessionStorage' | 'localStorage'): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[kind];
  } catch {
    return null;
  }
}

function load(): number | null {
  if (current !== undefined) return current;
  current =
    valid(storage('sessionStorage')?.getItem(STORAGE_KEY)) ??
    valid(storage('localStorage')?.getItem(STORAGE_KEY));
  return current;
}

/** The selected data source id, or null for the instance default. */
export function selectedDataSource(): number | null {
  return load();
}

/** Selects a data source (null: back to the default) and notifies views. */
export function selectDataSource(id: number | null) {
  const next = valid(id);
  if (next === load()) return;
  current = next;
  for (const kind of ['sessionStorage', 'localStorage'] as const) {
    const store = storage(kind);
    try {
      if (next === null) store?.removeItem(STORAGE_KEY);
      else store?.setItem(STORAGE_KEY, String(next));
    } catch {
      // storage unavailable (private mode): the selection lives in memory
    }
  }
  listeners.forEach((listener) => listener());
}

export function subscribeDataSource(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Request headers naming the selected data source (none for the default). */
export function dataSourceHeaders(): Record<string, string> {
  const id = selectedDataSource();
  return id ? { [DATA_SOURCE_HEADER]: String(id) } : {};
}

/** A same-origin URL with the selected data source as query parameter. */
export function withDataSourceParam(url: string): string {
  const id = selectedDataSource();
  if (!id) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${DATA_SOURCE_PARAM}=${id}`;
}

export function useSelectedDataSource(): number | null {
  return useSyncExternalStore(
    subscribeDataSource,
    selectedDataSource,
    () => null,
  );
}

/** Tests only. */
export function resetDataSourceSelection() {
  current = undefined;
}
