import { ExternalLink, MailOpen } from "lucide-react";
import * as React from "react";
import { InboxRow } from "@client-kit/platform/react/inbox-row";
import { InboxListHeader, InboxRowActionButton, InboxReopenStatus } from "@client-kit/platform/react/inbox-surface";
import { useT } from "@client-kit/platform/react/context";

import {
  getInboxTypeLabel,
  type InboxFilter,
  type InboxItem,
} from "@/features/home/lib/inbox";
import { hasRenderedVideoAttachment } from "@/features/messages/lib/videoReviewContext";
import { getThreadReference } from "@/features/messages/lib/threading";
import {
  DraftsPanel,
  type DraftViewItem,
} from "@/features/messages/ui/DraftsPanel";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { cn } from "@/shared/lib/cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { VirtualizedList } from "@/shared/ui/VirtualizedList";

const INBOX_EMPTY_STATE_TITLES: Record<Exclude<InboxFilter, "agent_activity">, string> = {
  all: "No activity yet",
  mention: "No mentions found",
  thread: "No threads found",
  drafts: "No drafts",
};

const INBOX_UNREAD_EMPTY_STATE_TITLES: Record<Exclude<InboxFilter, "agent_activity">, string> = {
  all: "No unread activity",
  mention: "No unread mentions",
  thread: "No unread threads",
  drafts: "No unread drafts",
};

const INBOX_PANE_RIGHT_DIVIDER_CLASS =
  "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-40 after:w-px after:bg-border/35 after:content-['']";

function getInboxVideoReviewCommentRootId(item: InboxItem) {
  const feedItems = [item.item, ...item.groupItems];
  const feedItemById = new Map(
    feedItems.map((feedItem) => [feedItem.id, feedItem]),
  );
  const videoMessageIds = new Set(
    feedItems
      .filter((feedItem) =>
        hasRenderedVideoAttachment({
          body: feedItem.content,
          tags: feedItem.tags,
        }),
      )
      .map((feedItem) => feedItem.id),
  );
  const visited = new Set<string>();
  let ancestorId = getThreadReference(item.item.tags).parentId;

  while (ancestorId && !visited.has(ancestorId)) {
    if (videoMessageIds.has(ancestorId)) return ancestorId;
    visited.add(ancestorId);
    const ancestor = feedItemById.get(ancestorId);
    ancestorId = ancestor ? getThreadReference(ancestor.tags).parentId : null;
  }

  return undefined;
}

type InboxListPaneProps = {
  activeDraftCount: number;
  draftItems: DraftViewItem[];
  doneSet: ReadonlySet<string>;
  filter: InboxFilter;
  items: InboxItem[];
  onFilterChange: (filter: InboxFilter) => void;
  onDeleteDraft: (draftKey: string) => void;
  onMarkRead: (itemId: string) => void;
  onMarkUnread: (itemId: string) => void;
  onOpenDirect: (item: InboxItem) => void;
  onSelect: (itemId: string) => void;
  onSelectDraft: (draftKey: string) => void;
  onUnreadOnlyChange: (checked: boolean) => void;
  selectedConversationId: string | null;
  selectedDraftKey: string | null;
  showRightDivider?: boolean;
  unreadOnly: boolean;
  isReopenPending?: (channelId: string) => boolean;
  isReopenErrored?: (channelId: string) => boolean;
  isReopenUnknown?: (channelId: string) => boolean;
};

export function InboxListPane({
  activeDraftCount,
  draftItems,
  doneSet,
  filter,
  items,
  onFilterChange,
  onDeleteDraft,
  onMarkRead,
  onMarkUnread,
  onOpenDirect,
  onSelect,
  onSelectDraft,
  onUnreadOnlyChange,
  selectedConversationId,
  selectedDraftKey,
  showRightDivider = false,
  unreadOnly,
  isReopenPending,
  isReopenErrored,
  isReopenUnknown,
}: InboxListPaneProps) {
  const t = useT();
  const isDrafts = filter === "drafts";
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const unreadVisibleItemCount = React.useMemo(
    () =>
      items.reduce((count, item) => count + (doneSet.has(item.id) ? 0 : 1), 0),
    [doneSet, items],
  );
  const handleMarkAllRead = React.useCallback(() => {
    for (const item of items) {
      if (!doneSet.has(item.id)) {
        onMarkRead(item.id);
      }
    }
  }, [doneSet, items, onMarkRead]);

  const renderItem = (item: InboxItem) => {
    const isSelected = item.conversationId === selectedConversationId;
    const isDone = doneSet.has(item.id);
    const isReopening = Boolean(item.item.channelId && isReopenPending?.(item.item.channelId));
    const canOpen = Boolean(item.item.channelId) && !isReopening;
    const openLabel = isReopening ? t("inbox.reopening") : canOpen ? "Open in channel" : "No channel link";
    const typeLabel = getInboxTypeLabel(item);
    const videoReviewCommentRootId = getInboxVideoReviewCommentRootId(item);
    const row = (
      <InboxRow
        id={item.id}
        selected={isSelected}
        read={isDone}
        openLabel={`Open inbox item from ${item.senderLabel}`}
        onSelect={() => onSelect(item.id)}
        timestamp={item.timestampLabel}
        unread={
          item.unreadCount > 1 ? (
            <span data-testid="home-inbox-unread-count">
              {item.unreadCount} unread
            </span>
          ) : null
        }
        label={item.item.channelType === "dm" ? t("inbox.dmFrom", { sender: item.senderLabel }) : typeLabel.text}
        channel={typeLabel.channelLabel}
        avatar={
          <UserProfilePopover
            pubkey={item.item.pubkey}
            triggerClassName="shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            triggerElement="span"
            triggerTestId={`home-inbox-avatar-${item.id}`}
          >
            <span className="inline-flex shrink-0">
              <UserAvatar
                avatarUrl={item.avatarUrl}
                className="h-9 w-9"
                displayName={item.senderLabel}
                size="md"
              />
            </span>
          </UserProfilePopover>
        }
        sender={
          <UserProfilePopover pubkey={item.item.pubkey} triggerElement="span">
            <span className="block max-w-full truncate rounded text-sm font-semibold leading-4 text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              {item.senderLabel}
            </span>
          </UserProfilePopover>
        }
        preview={
          <><VideoReviewCommentMarkdown
            className="inbox-preview-markdown text-inherit"
            content={item.preview}
            interactive={false}
            mentionNames={item.mentionNames}
            videoReviewCommentRootId={videoReviewCommentRootId}
          /><InboxReopenStatus id={item.id} pending={isReopening} error={Boolean(item.item.channelId && isReopenErrored?.(item.item.channelId))} unknown={Boolean(item.item.channelId && isReopenUnknown?.(item.item.channelId))} onRetry={() => onOpenDirect(item)}/></>
        }
        actions={
          <>
            {isDone ? (
              <InboxRowActionButton
                label="Mark unread"
                onClick={() => onMarkUnread(item.id)}
              >
                <MailOpen className="!h-4 !w-4" />
              </InboxRowActionButton>
            ) : (
              <InboxRowActionButton
                label="Mark as read"
                onClick={() => onMarkRead(item.id)}
              >
                <MailOpen className="!h-4 !w-4" />
              </InboxRowActionButton>
            )}
            <InboxRowActionButton
              disabled={!canOpen}
              label={openLabel}
              onClick={() => onOpenDirect(item)}
            >
              <ExternalLink className="!h-4 !w-4" />
            </InboxRowActionButton>
          </>
        }
      />
    );

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {isDone ? (
            <ContextMenuItem onClick={() => onMarkUnread(item.id)}>
              <MailOpen className="h-4 w-4" />
              Mark unread
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => onMarkRead(item.id)}>
              <MailOpen className="h-4 w-4" />
              Mark as read
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!canOpen}
            onClick={() => {
              if (canOpen) {
                onOpenDirect(item);
              }
            }}
          >
            <ExternalLink className="h-4 w-4" />
            {openLabel}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <section
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60",
        showRightDivider && INBOX_PANE_RIGHT_DIVIDER_CLASS,
      )}
    >
      <InboxListHeader filter={filter} onFilterChange={onFilterChange} activeDraftCount={activeDraftCount}
        unreadOnly={unreadOnly} onUnreadOnlyChange={onUnreadOnlyChange} unreadCount={unreadVisibleItemCount}
        onMarkAllRead={handleMarkAllRead} />

      {isDrafts ? (
        <div
          className="-mt-13 flex min-h-0 flex-1 flex-col overflow-hidden pt-13"
          data-testid="home-inbox-drafts"
        >
          <DraftsPanel
            items={draftItems}
            onDeleteDraft={onDeleteDraft}
            onSelectDraft={onSelectDraft}
            selectedDraftKey={selectedDraftKey}
          />
        </div>
      ) : (
        <div
          className="-mt-13 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pt-13"
          data-testid="home-inbox-list"
          ref={scrollRef}
        >
          {items.length > 0 ? (
            <VirtualizedList
              estimateSize={96}
              getItemKey={(item) =>
                `${item.item.channelId ?? ""}:${item.conversationId}`
              }
              items={items}
              renderItem={(item) => renderItem(item)}
              scrollRef={scrollRef}
            />
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center px-6 text-center">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {filter === "agent_activity" ? t(unreadOnly ? "inbox.agentUnreadEmpty" : "inbox.agentEmpty") : unreadOnly
                    ? INBOX_UNREAD_EMPTY_STATE_TITLES[filter]
                    : INBOX_EMPTY_STATE_TITLES[filter]}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {unreadOnly
                    ? "Turn off Show unread only to see read activity."
                    : filter === "all"
                      ? "New activity will appear here."
                      : "Switch back to All to see other activity."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
