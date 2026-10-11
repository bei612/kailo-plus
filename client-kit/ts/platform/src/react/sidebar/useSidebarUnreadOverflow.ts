import { getLocale, translate } from "../../i18n";
// Shared from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/lib/useSidebarUnreadOverflow.ts.
// Both hosts supply the same admitted ConversationList projection; Core remains the read authority.
import * as React from "react";

import { useUnreadOverflow } from "./useUnreadOverflow";
import type { UnreadDmPreview } from "./MoreUnreadButton";

export type ConversationUnreadEntry = { channelId: string; preview?: UnreadDmPreview };
const NO_CONVERSATION_UNREAD: readonly ConversationUnreadEntry[] = [];

/** Only a scoped presentation handoff from the actual DM rows to their scroll host. */
export function useConversationUnreadProjection(scope: object) {
  const currentScope = React.useRef(scope);
  currentScope.current = scope;
  const [projection, setProjection] = React.useState({ scope, entries: NO_CONVERSATION_UNREAD });
  const onUnreadChange = React.useCallback((entries: readonly ConversationUnreadEntry[]) => {
    if (currentScope.current !== scope) return;
    setProjection(current => current.scope === scope && current.entries.length === entries.length &&
      current.entries.every((entry, index) => {
        const next = entries[index];
        if (!next) return false;
        return entry.channelId === next.channelId && entry.preview?.accessibleLabel === next.preview?.accessibleLabel &&
          entry.preview?.label === next.preview?.label && entry.preview?.avatarUrl === next.preview?.avatarUrl &&
          entry.preview?.isAgent === next.preview?.isAgent &&
          entry.preview?.author?.conversationId === next.preview?.author?.conversationId &&
          entry.preview?.author?.eventId === next.preview?.author?.eventId &&
          entry.preview?.author?.pubkey === next.preview?.author?.pubkey;
      }) ? current : { scope, entries });
  }, [scope]);
  const entries = projection.scope === scope ? projection.entries : NO_CONVERSATION_UNREAD;
  const dmChannelIds = React.useMemo(() => new Set(entries.map(entry => entry.channelId)), [entries]);
  return { entries, dmChannelIds, onUnreadChange };
}

type ScrollRef = Parameters<typeof useUnreadOverflow>[0]["scrollRef"];

/**
 * Returns whether any offscreen destination has directed unread activity,
 * which should keep the sidebar overflow control emphasized.
 */
export function hasHighPriorityOverflow(
  offscreenChannelIds: readonly string[],
  highPriorityUnreadChannelIds: ReadonlySet<string>,
  dmChannelIds: ReadonlySet<string> = new Set(),
) {
  return offscreenChannelIds.some((channelId) =>
      dmChannelIds.has(channelId) || highPriorityUnreadChannelIds.has(channelId),
  );
}

/** Formats the accessible label for a distinct unread destination count. */
export function sidebarOverflowUnreadLabel(count: number) {
  return translate(getLocale(), "sidebar.unreadCount", { count });
}

/**
 * Projects unread message and thread activity into offscreen destination sets.
 * Message and preview destinations are unioned and deduplicated; destinations
 * with directed unread activity receive high-priority treatment.
 */
export function useSidebarUnreadOverflow({
  dmChannelIds,
  highPriorityUnreadChannelIds,
  previewActivityChannelIds,
  scrollRef,
  unreadChannelIds,
}: {
  dmChannelIds: ReadonlySet<string>;
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
    unreadMessageBelowChannelIds: messageOverflow.unreadBelowChannelIds,
    hasHighPriorityAbove: hasHighPriorityOverflow(
      messageOverflow.unreadAboveChannelIds,
      highPriorityUnreadChannelIds,
      dmChannelIds,
    ),
    hasHighPriorityBelow: hasHighPriorityOverflow(
      messageOverflow.unreadBelowChannelIds,
      highPriorityUnreadChannelIds,
      dmChannelIds,
    ),
  };
}
