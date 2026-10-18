// Extracted unchanged from the pinned Buzz sidebar implementation; presentation preference only.
// DD-125(5): when the host provides Core CollaborationUserState preferences (Web), the
// group sort is read from and written to `sidebar_sort` instead of this device's store;
// a host without that provider (Desktop today) keeps the original local behavior.
import * as React from "react";
import { useCollaborationPreferences } from "../collaboration-preferences";

import {
  DEFAULT_STORE,
  readChannelSortStore,
  sortModeForGroup,
  storageKey,
  writeChannelSortStore,
  type ChannelSortGroupKey,
  type ChannelSortMode,
  type ChannelSortStore,
} from "./channelSortPreference";

/**
 * Persistent per-group sidebar sort preferences, scoped by pubkey + relay so
 * they don't bleed across identities or communities. Each sidebar grouping
 * carries its own saved Recent/A–Z mode; unset groups default to A–Z. Mirrors
 * changes made in other windows via the storage event.
 */
export function useChannelSortPreference(
  pubkey: string | undefined,
  relayUrl?: string,
): {
  sortModeFor: (group: ChannelSortGroupKey) => ChannelSortMode;
  setSortModeFor: (group: ChannelSortGroupKey, mode: ChannelSortMode) => void;
} {
  const [store, setStore] = React.useState<ChannelSortStore>(() => {
    if (!pubkey) return DEFAULT_STORE;
    return readChannelSortStore(pubkey, relayUrl);
  });

  React.useEffect(() => {
    if (!pubkey) {
      setStore(DEFAULT_STORE);
      return;
    }
    setStore(readChannelSortStore(pubkey, relayUrl));
    const key = storageKey(pubkey, relayUrl);
    const handler = (e: StorageEvent) => {
      if (e.key !== key) return;
      setStore(readChannelSortStore(pubkey, relayUrl));
    };
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
    };
  }, [pubkey, relayUrl]);

  const sortModeFor = React.useCallback(
    (group: ChannelSortGroupKey) => sortModeForGroup(store, group),
    [store],
  );

  const setSortModeFor = React.useCallback(
    (group: ChannelSortGroupKey, mode: ChannelSortMode) => {
      if (!pubkey) return;
      setStore((prev) => {
        const next: ChannelSortStore = {
          ...prev,
          groups: { ...prev.groups, [group]: mode },
        };
        if (!writeChannelSortStore(pubkey, next, relayUrl)) return prev;
        return next;
      });
    },
    [pubkey, relayUrl],
  );

  const core = useCollaborationPreferences();
  const coreSortModeFor = core?.sortModeFor;
  const coreSetSortModeFor = core?.setSortModeFor;
  const coreWritable = core?.writable === true;
  return React.useMemo(() => coreSortModeFor && coreSetSortModeFor ? {
    sortModeFor: (group: ChannelSortGroupKey) => coreSortModeFor(group),
    // Inert while the Core state is unread, pending or unknown; a failed write re-reads it.
    setSortModeFor: (group: ChannelSortGroupKey, mode: ChannelSortMode) => {
      if (coreWritable) void coreSetSortModeFor(group, mode);
    },
  } : { sortModeFor, setSortModeFor }, [coreSortModeFor, coreSetSortModeFor, coreWritable, sortModeFor, setSortModeFor]);
}
