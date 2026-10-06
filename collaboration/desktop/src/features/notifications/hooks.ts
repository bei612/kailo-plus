import * as React from "react";

import { useHomeFeedQuery } from "@/features/home/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { Channel, FeedItem, HomeFeedResponse } from "@/shared/api/types";
import {
  getDesktopNotificationPermissionState,
  requestDesktopNotificationAccess,
} from "./lib/desktop";
import {
  readStoredSeenFeedIds,
  useFeedDesktopNotifications,
  writeStoredSeenFeedIds,
} from "./use-feed-desktop-notifications";
import {
  buildHomeBadgeFeedItems,
  isHomeBadgeFeedItemUnread,
  shouldCountTowardHomeBadgeSubtotal,
} from "./lib/homeBadge";

export type { DesktopNotificationPermissionState, NotificationSettings } from "@client-kit/platform/react/notifications";
import { useNotificationSettings as useSharedNotificationSettings, type NotificationSettings } from "@client-kit/platform/react/notifications";
const notificationHost = { getPermission: getDesktopNotificationPermissionState, requestPermission: requestDesktopNotificationAccess };
export function useNotificationSettings(pubkey?: string) {
  return useSharedNotificationSettings(pubkey, notificationHost);
}

const HOME_FEED_SEEN_MAX_ITEMS = 500;
const EMPTY_FEED_ID_SET: ReadonlySet<string> = new Set();

function mergeSeenFeedIds(current: string[], nextIds: readonly string[]) {
  const merged = new Set(current);
  let didChange = false;

  for (const id of nextIds) {
    if (merged.has(id)) {
      continue;
    }

    merged.add(id);
    didChange = true;
  }

  if (!didChange) {
    return current;
  }

  const values = [...merged];
  return values.length <= HOME_FEED_SEEN_MAX_ITEMS
    ? values
    : values.slice(values.length - HOME_FEED_SEEN_MAX_ITEMS);
}

export function useHomeFeedNotificationState(
  feed: HomeFeedResponse | undefined,
  pubkey: string | undefined,
  settings: NotificationSettings,
  setDesktopEnabled: (enabled: boolean) => Promise<boolean>,
  desktopNotificationsEnabled: boolean,
  isHomeActive: boolean,
  // NIP-RS read marker lookup, shared with the sidebar via AppShell. When
  // provided, channel-backed feed items are treated as read iff their
  // createdAt is at-or-below the channel's read marker; the local
  // seen-set is reserved for items with no channel context. Pass
  // `() => null` to keep the legacy local-only behaviour.
  getChannelReadAt: (channelId: string) => number | null,
  // Invalidation signal for the channel-marker projection; bump triggers
  // recompute. Pass 0 to opt out.
  readStateVersion: number,
  highPriorityChannelIds: ReadonlySet<string>,
  profiles?: UserProfileLookup,
  mutedChannelIds?: ReadonlySet<string>,
  localUnreadFeedIds: ReadonlySet<string> = EMPTY_FEED_ID_SET,
  extraInboxItems: readonly FeedItem[] = [],
  getThreadReadAt: (
    rootId: string,
    channelId?: string | null,
  ) => number | null = () => null,
  // Per-message read marker lookup, shared with channel thread badges. When
  // provided, a thread activity row is treated as read if the specific reply
  // has been revealed in-channel, even if the aggregate `thread:<root>` marker
  // has not been advanced by opening Home.
  getMessageReadAt: (messageId: string) => number | null = () => null,
  channels: ReadonlyArray<Pick<Channel, "id" | "name">> = [],
) {
  useFeedDesktopNotifications(
    feed,
    pubkey,
    settings,
    setDesktopEnabled,
    desktopNotificationsEnabled,
    profiles,
    channels,
  );
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  const [seenFeedIds, setSeenFeedIds] = React.useState<string[]>(() =>
    readStoredSeenFeedIds(normalizedPubkey),
  );
  const currentFeedItems = React.useMemo(() => {
    return buildHomeBadgeFeedItems(feed, extraInboxItems);
  }, [extraInboxItems, feed]);
  const currentFeedIds = React.useMemo(
    () => currentFeedItems.map((item) => item.id),
    [currentFeedItems],
  );

  React.useEffect(() => {
    setSeenFeedIds(readStoredSeenFeedIds(normalizedPubkey));
  }, [normalizedPubkey]);

  React.useEffect(() => {
    writeStoredSeenFeedIds(normalizedPubkey, seenFeedIds);
  }, [normalizedPubkey, seenFeedIds]);

  const markCurrentFeedSeen = React.useEffectEvent(() => {
    setSeenFeedIds((current) => mergeSeenFeedIds(current, currentFeedIds));
  });

  React.useEffect(() => {
    if (!isHomeActive || currentFeedIds.length === 0) {
      return;
    }

    void normalizedPubkey;
    markCurrentFeedSeen();
  }, [currentFeedIds, isHomeActive, normalizedPubkey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: readStateVersion invalidates getChannelReadAt
  return React.useMemo(() => {
    const zero = { homeBadgeCount: 0, homeBadgeCountExcludingHighPriority: 0 };
    if (!settings.homeBadgeEnabled) {
      return zero;
    }

    if (currentFeedItems.length === 0) {
      return zero;
    }

    const seenFeedIdSet = new Set(seenFeedIds);
    let total = 0;
    let excludingHighPriority = 0;
    for (const item of currentFeedItems) {
      const isLocallyUnread = localUnreadFeedIds.has(item.id);
      if (isHomeActive && !isLocallyUnread) {
        continue;
      }
      if (
        item.channelId &&
        mutedChannelIds?.has(item.channelId) &&
        item.category !== "mention"
      ) {
        continue;
      }
      const isUnread = isHomeBadgeFeedItemUnread(item, {
        getChannelReadAt,
        getMessageReadAt,
        getThreadReadAt,
        isLocallyUnread,
        seenFeedIdSet,
      });
      if (!isUnread) continue;
      total++;
      if (
        shouldCountTowardHomeBadgeSubtotal(
          item,
          highPriorityChannelIds,
          isLocallyUnread,
        )
      ) {
        excludingHighPriority++;
      }
    }
    return {
      homeBadgeCount: total,
      homeBadgeCountExcludingHighPriority: excludingHighPriority,
    };
  }, [
    currentFeedItems,
    getChannelReadAt,
    getMessageReadAt,
    getThreadReadAt,
    highPriorityChannelIds,
    isHomeActive,
    localUnreadFeedIds,
    mutedChannelIds,
    readStateVersion,
    seenFeedIds,
    settings.homeBadgeEnabled,
  ]);
}

export function useHomeFeedNotifications(pubkey: string | undefined) {
  const notificationSettings = useNotificationSettings(pubkey);
  const homeFeedQuery = useHomeFeedQuery();
  const refetchHomeFeedForE2e = React.useEffectEvent(() => {
    void homeFeedQuery.refetch();
  });

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleMockHomeFeedUpdate() {
      refetchHomeFeedForE2e();
    }

    window.addEventListener(
      "buzz:e2e-home-feed-updated",
      handleMockHomeFeedUpdate,
    );
    return () => {
      window.removeEventListener(
        "buzz:e2e-home-feed-updated",
        handleMockHomeFeedUpdate,
      );
    };
  }, []);

  const feedItems = React.useMemo(
    () => (homeFeedQuery.data ? homeFeedQuery.data.feed.mentions : []),
    [homeFeedQuery.data],
  );

  const feedProfilesQuery = useUsersBatchQuery(
    feedItems.map((item) => item.pubkey),
    { enabled: feedItems.length > 0 },
  );

  return {
    feedProfilesQuery,
    homeFeedQuery,
    notificationSettings,
  };
}
