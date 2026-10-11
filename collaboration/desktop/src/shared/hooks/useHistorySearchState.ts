import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  useHistorySearchState as useSharedHistorySearchState,
  type HistorySearchNavigation,
} from "@client-kit/platform/react/use-history-search-state";
export type { HistorySearchSetterOptions } from "@client-kit/platform/react/use-history-search-state";

export function useHistorySearchState<K extends string>(keys: readonly K[]) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false } as never) as Partial<Record<K, string>>;
  const navigateSearch = React.useCallback(
    (options: HistorySearchNavigation) => { void navigate(options as never); },
    [navigate],
  );
  return useSharedHistorySearchState(keys, search, navigateSearch);
}
