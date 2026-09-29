import * as React from "react";

import {
  boundStarStore,
  DEFAULT_STORE,
  readChannelStarsStore,
  starredChannelIdsFromStore,
  storageKey,
  writeChannelStarsStore,
  type ChannelStarEntry,
  type ChannelStarStore,
} from "./channelStarsStorage";

/**
 * Per-identity starred channels, persisted in localStorage and mirrored
 * across windows via the storage event.
 */
export function useChannelStars(pubkey: string | undefined): {
  starredChannelIds: Set<string>;
  starChannel: (channelId: string) => void;
  unstarChannel: (channelId: string) => void;
} {
  const [store, setStore] = React.useState<ChannelStarStore>(() => {
    if (!pubkey) {
      return DEFAULT_STORE;
    }
    return readChannelStarsStore(pubkey);
  });

  React.useEffect(() => {
    if (!pubkey) {
      setStore(DEFAULT_STORE);
      return;
    }
    setStore(readChannelStarsStore(pubkey));
    const key = storageKey(pubkey);
    const handler = (e: StorageEvent) => {
      if (e.key !== key) {
        return;
      }
      setStore(readChannelStarsStore(pubkey));
    };
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
    };
  }, [pubkey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: store.channels is the relevant dep — the outer store identity can change without channels changing
  const starredChannelIds = React.useMemo(
    () => starredChannelIdsFromStore(store),
    [store.channels],
  );

  const setStarState = React.useCallback(
    (channelId: string, starred: boolean) => {
      if (!pubkey) return;
      const entry: ChannelStarEntry = {
        starred,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      setStore((prev) => {
        const next = boundStarStore(
          {
            version: 1,
            channels: { ...prev.channels, [channelId]: entry },
          },
          channelId,
        );
        if (!writeChannelStarsStore(pubkey, next)) return prev;
        return next;
      });
    },
    [pubkey],
  );

  const starChannel = React.useCallback(
    (channelId: string) => setStarState(channelId, true),
    [setStarState],
  );
  const unstarChannel = React.useCallback(
    (channelId: string) => setStarState(channelId, false),
    [setStarState],
  );

  return {
    starredChannelIds,
    starChannel,
    unstarChannel,
  };
}
