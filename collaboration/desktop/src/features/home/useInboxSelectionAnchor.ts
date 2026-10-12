import * as React from "react";
import { useInboxSelectionAnchor as useSharedInboxSelectionAnchor } from "@client-kit/platform/react/use-inbox-selection-anchor";
import { getEventById } from "@/shared/api/tauri";
import type { FeedItem, InboxFeed } from "@/shared/api/types";

// Native transport only. Direct/latch/cold selection belongs to the shared
// original hook; the session and current admitted channels remain host facts.
export function useInboxSelectionAnchor({ feed, selectedEventId, availableChannelIds, scopeKey, ready }: {
  feed: InboxFeed | undefined;
  selectedEventId: string | null;
  availableChannelIds: ReadonlySet<string>;
  scopeKey: unknown;
  ready: boolean;
}) {
  const feedItems = React.useMemo(() => feed ? [...feed.mentions, ...feed.activity] : [], [feed]);
  const selection = useSharedInboxSelectionAnchor<FeedItem>({
    feedItems, selectedEventId, scopeKey, ready,
    membershipKey: [...availableChannelIds].sort().join(","),
    isRetainedVisible: item => item.channelId !== null && availableChannelIds.has(item.channelId),
    recover: async (id, signal) => {
      signal.throwIfAborted();
      const event = await getEventById(id);
      signal.throwIfAborted();
      if (event.id !== id) throw new Error("Inbox anchor identity changed");
      return { id: event.id, kind: event.kind, pubkey: event.pubkey, content: event.content,
        createdAt: event.created_at, tags: event.tags,
        channelId: event.tags.find(tag => tag[0] === "h")?.[1] ?? null,
        channelName: "", channelType: undefined, category: "mention" };
    },
  });
  return { ...selection, feedItems };
}
