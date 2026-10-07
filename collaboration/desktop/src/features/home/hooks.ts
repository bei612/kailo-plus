import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getHomeFeed } from "@/shared/api/tauri";
import { useRelayConnection } from "@/shared/api/useRelayConnection";
import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { loadNativeDmFeed } from "./nativeDmFeed";
import { reconcileFetchedChannelWindow } from "@/features/messages/hooks";
import { channelMessagesKey } from "@/features/messages/lib/messageQueryKeys";
import type { RelayEvent } from "@/shared/api/types";

/** Keeps focused polling at the established 30-second cadence. */
export const HOME_FEED_REFETCH_INTERVAL_MS = 30_000;
/** Suppresses the expensive focus refetch until the home feed is old. */
export const HOME_FEED_FOCUS_STALE_TIME_MS = 5 * 60_000;

/** Focus-refetch policy for the home feed query; consumed by focusRefetchPolicy.test.mjs. */
export const homeFeedFocusRefetchPolicy = {
  staleTime: HOME_FEED_FOCUS_STALE_TIME_MS,
  refetchOnWindowFocus: false,
} as const;

export function useHomeFeedQuery() {
  const session = useNativeSession();
  const queryClient = useQueryClient();
  const connectionState = useRelayConnection();
  const connected = connectionState === "connected";
  const refetchInterval = useFocusedRefetchInterval(
    connected ? HOME_FEED_REFETCH_INTERVAL_MS : false,
  );

  return useQuery({
    queryKey: ["home-feed", session.facts.relayUrl, session.devicePubkey],
    queryFn: async ({signal}) => {
      const home = await getHomeFeed({ limit: 50 });
      signal.throwIfAborted();
      const dm = await loadNativeDmFeed(session, signal);
      signal.throwIfAborted();
      for (const [channelId, events] of dm.windows) {
        const key = channelMessagesKey(channelId);
        queryClient.setQueryData(key, reconcileFetchedChannelWindow(queryClient, channelId, events,
          queryClient.getQueryData<RelayEvent[]>(key) ?? [], signal));
      }
      return { ...home, feed: { ...home.feed, activity: dm.activity } };
    },
    gcTime: 5 * 60 * 1_000,
    // Pause background polling on degraded/stalled/disconnected connections.
    // The relay can't serve the request anyway, and the spurious failures
    // consume quota that the recovery path needs.
    refetchInterval,
    ...homeFeedFocusRefetchPolicy,
  });
}
