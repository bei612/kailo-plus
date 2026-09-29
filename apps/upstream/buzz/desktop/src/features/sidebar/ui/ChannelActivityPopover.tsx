import * as React from "react";
import { MailOpen } from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { buildInboxItems, type InboxItem } from "@/features/home/lib/inbox";
import { getGroupedInboxItemIds } from "@/features/home/useHomeInboxReadState";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel, FeedItem, InboxFeed } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Markdown } from "@/shared/ui/markdown";
import {
  DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui/popover";
import { UserAvatar } from "@/shared/ui/UserAvatar";

const HOVER_CLOSE_DELAY_MS = 180;
const ACTIVITY_POPOVER_MOTION_STYLE = {
  "--tw-enter-scale": "1",
  "--tw-exit-scale": "1",
} as React.CSSProperties;

function buildChannelActivityFeed(items: FeedItem[]): InboxFeed {
  return {
    mentions: items.filter((item) => item.category === "mention"),
    activity: items.filter((item) => item.category === "activity"),
  };
}

function RowActionButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-4"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function ThreadPreviewRow({
  isAgent,
  item,
  onMarkRead,
  onOpen,
}: {
  isAgent: boolean;
  item: InboxItem;
  onMarkRead: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="group/activity-row relative border-t border-border/50 first:border-t-0"
      data-testid={`channel-activity-item-${item.conversationId}`}
    >
      <button
        aria-label={`Open thread from ${item.senderLabel}`}
        className="absolute inset-0 z-0 w-full text-left"
        onClick={onOpen}
        type="button"
      />
      <div className="pointer-events-none relative z-10 flex min-w-0 items-start gap-2.5 px-3 py-3 transition-colors group-hover/activity-row:bg-muted/50 group-focus-within/activity-row:bg-muted/50">
        <UserAvatar
          avatarUrl={item.avatarUrl}
          className="h-9 w-9 shrink-0"
          displayName={item.senderLabel}
          shape={isAgent ? "squircle" : "circle"}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-4 text-foreground">
              {item.senderLabel}
            </span>
            <span className="shrink-0 text-xs leading-4 text-muted-foreground/70 transition-opacity group-hover/activity-row:opacity-0 group-focus-within/activity-row:opacity-0">
              {item.timestampLabel}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
            <span>Thread</span>
            {item.unreadCount > 1 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.unreadCount} unread</span>
              </>
            ) : null}
          </div>
          <Markdown
            className="inbox-preview-markdown mt-1.5 line-clamp-2 text-sm font-medium leading-5 text-foreground"
            content={item.preview}
            interactive={false}
            mentionNames={item.mentionNames}
          />
        </div>
      </div>
      <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-0.5 rounded-full bg-muted/95 p-0.5 opacity-0 shadow-xs transition-opacity group-hover/activity-row:pointer-events-auto group-hover/activity-row:opacity-100 group-focus-within/activity-row:pointer-events-auto group-focus-within/activity-row:opacity-100">
        <RowActionButton label="Mark as read" onClick={onMarkRead}>
          <MailOpen />
        </RowActionButton>
      </div>
    </div>
  );
}

export function ChannelActivityPopover({
  channel,
  children,
}: {
  channel: Channel;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const {
    clearChannelUnreadSource,
    getChannelActivityItemReadAt,
    locallyUnreadFeedItems,
    markMessageRead,
    markThreadRead,
    unreadThreadFeedItems,
    feedItemState,
  } = useAppShell();
  const { undoUnread } = feedItemState;
  const identityQuery = useIdentityQuery();
  const { goChannel } = useAppNavigation();

  const unreadChannelFeedItems = React.useMemo(() => {
    return unreadThreadFeedItems.filter(
      (item) => item.channelId === channel.id,
    );
  }, [channel.id, unreadThreadFeedItems]);
  const profilePubkeys = React.useMemo(
    () => [...new Set(unreadChannelFeedItems.map((item) => item.pubkey))],
    [unreadChannelFeedItems],
  );
  const profilesQuery = useUsersBatchQuery(open ? profilePubkeys : [], {
    enabled: open,
  });
  const profiles = profilesQuery.data?.profiles;
  const activityReadAtByMessageId = React.useMemo(
    () =>
      new Map(
        unreadChannelFeedItems.map((item) => [
          item.id,
          getChannelActivityItemReadAt(item),
        ]),
      ),
    [getChannelActivityItemReadAt, unreadChannelFeedItems],
  );
  const activityItems = React.useMemo(() => {
    if (!open) return [];
    return buildInboxItems({
      channels: [channel],
      currentPubkey: identityQuery.data?.pubkey,
      feed: buildChannelActivityFeed(unreadChannelFeedItems),
      getMessageReadAt: (messageId) =>
        activityReadAtByMessageId.get(messageId) ?? null,
      profiles,
    });
  }, [
    channel,
    activityReadAtByMessageId,
    identityQuery.data?.pubkey,
    open,
    profiles,
    unreadChannelFeedItems,
  ]);
  const hasContent = unreadChannelFeedItems.length > 0;

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);
  const openWithDelay = React.useCallback(() => {
    if (!hasContent) return;
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS);
  }, [clearHoverTimer, hasContent]);
  const openImmediately = React.useCallback(() => {
    if (!hasContent) return;
    clearHoverTimer();
    setOpen(true);
  }, [clearHoverTimer, hasContent]);
  const closeWithDelay = React.useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimer]);
  const keepOpen = React.useCallback(() => {
    clearHoverTimer();
  }, [clearHoverTimer]);

  React.useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);
  React.useEffect(() => {
    if (!hasContent) {
      setOpen(false);
    }
  }, [hasContent]);

  const clearUnreadOverride = React.useCallback(
    (item: InboxItem) => {
      const clearedItemIds = new Set(getGroupedInboxItemIds(item));
      for (const itemId of clearedItemIds) {
        undoUnread(itemId);
      }
      const channelId = item.item.channelId ?? null;
      const hasAnotherChannelOverride = locallyUnreadFeedItems.some(
        (feedItem) =>
          feedItem.channelId === channelId && !clearedItemIds.has(feedItem.id),
      );
      if (channelId && !hasAnotherChannelOverride) {
        clearChannelUnreadSource(channelId, "inbox");
      }
    },
    [clearChannelUnreadSource, locallyUnreadFeedItems, undoUnread],
  );

  const handleMarkRead = React.useCallback(
    (item: InboxItem) => {
      clearUnreadOverride(item);
      for (const reply of item.groupItems) {
        markMessageRead(reply.id, reply.createdAt);
      }
      markThreadRead(item.conversationId, item.latestActivityAt);
    },
    [clearUnreadOverride, markMessageRead, markThreadRead],
  );

  if (!hasContent) {
    return children;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover/focus events bubble from the nested channel button while the wrapper keeps the preview interactive. */}
      <div
        className="w-full min-w-0"
        onBlur={closeWithDelay}
        onContextMenu={() => setOpen(false)}
        onFocus={openImmediately}
        onMouseEnter={openWithDelay}
        onMouseLeave={closeWithDelay}
      >
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      </div>
      <PopoverContent
        align="start"
        className="w-96 overflow-hidden p-0"
        data-testid={`channel-activity-popover-${channel.name}`}
        onFocusCapture={keepOpen}
        onMouseEnter={keepOpen}
        onMouseLeave={closeWithDelay}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="right"
        sideOffset={0}
        style={ACTIVITY_POPOVER_MOTION_STYLE}
      >
        <section
          aria-label="Channel activity"
          className="flex max-h-96 min-h-0 flex-col overflow-hidden"
        >
          <h3
            className="relative z-20 shrink-0 border-b border-border/70 bg-background/95 px-3 py-2 text-sm font-semibold text-foreground backdrop-blur-md supports-[backdrop-filter]:bg-background/90"
            data-testid="channel-activity-header"
          >
            Channel activity
          </h3>
          <div
            className="buzz-channel-activity-scrollbar min-h-0 overflow-y-auto overscroll-contain"
            data-testid="channel-activity-scroll"
          >
            {activityItems.length > 0
              ? activityItems.map((item) => (
                  <ThreadPreviewRow
                    isAgent={
                      profiles?.[normalizePubkey(item.item.pubkey)]?.isAgent ===
                      true
                    }
                    item={item}
                    key={item.conversationId}
                    onMarkRead={() => handleMarkRead(item)}
                    onOpen={() => {
                      clearUnreadOverride(item);
                      setOpen(false);
                      void goChannel(channel.id, {
                        messageId: item.id,
                        threadRootId: item.conversationId,
                      });
                    }}
                  />
                ))
              : null}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}
