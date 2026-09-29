import * as React from "react";

import { useUnreadOverflow } from "@/features/sidebar/lib/useUnreadOverflow";

type ScrollRef = Parameters<typeof useUnreadOverflow>[0]["scrollRef"];

/**
 * Returns whether any offscreen destination has directed unread activity,
 * which should keep the sidebar overflow control emphasized.
 */
export function hasHighPriorityOverflow(
  offscreenChannelIds: readonly string[],
  highPriorityUnreadChannelIds: ReadonlySet<string>,
) {
  return offscreenChannelIds.some((channelId) =>
    highPriorityUnreadChannelIds.has(channelId),
  );
}

/** Formats the accessible label for a distinct unread destination count. */
export function sidebarOverflowUnreadLabel(count: number) {
  return `${count} unread`;
}

/**
 * Projects unread message and thread activity into offscreen destination sets.
 * Message and preview destinations are unioned and deduplicated; destinations
 * with directed unread activity receive high-priority treatment.
 */
export function useSidebarUnreadOverflow({
  highPriorityUnreadChannelIds,
  previewActivityChannelIds,
  scrollRef,
  unreadChannelIds,
}: {
  highPriorityUnreadChannelIds: ReadonlySet<string>;
  previewActivityChannelIds: ReadonlySet<string>;
  scrollRef: ScrollRef;
  unreadChannelIds: ReadonlySet<string>;
}) {
  const messageChannelIds = React.useMemo(
    () => new Set([...unreadChannelIds, ...previewActivityChannelIds]),
    [previewActivityChannelIds, unreadChannelIds],
  );
  const messageOverflow = useUnreadOverflow({
    scrollRef,
    unreadChannelIds: messageChannelIds,
  });

  return {
    ...messageOverflow,
    hasHighPriorityAbove: hasHighPriorityOverflow(
      messageOverflow.unreadAboveChannelIds,
      highPriorityUnreadChannelIds,
    ),
    hasHighPriorityBelow: hasHighPriorityOverflow(
      messageOverflow.unreadBelowChannelIds,
      highPriorityUnreadChannelIds,
    ),
  };
}
