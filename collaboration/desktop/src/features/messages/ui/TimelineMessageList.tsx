import * as React from "react";
import { VirtualizedTimelineRows } from "@client-kit/platform/react/messages/timeline/VirtualizedTimelineRows";
export type { TimelineVirtualizerApi } from "@client-kit/platform/react/messages/timeline/VirtualizedTimelineRows";

import { formatDayGroupLabel } from "@/shared/lib/datetime";
import {
  buildTimelineDayGroups,
  buildTimelineItems,
  getTimelineItemKey,
  type TimelineNonDayItem,
} from "@/features/messages/lib/timelineItems";
import { buildMainTimelineEntries } from "@/features/messages/lib/threadPanel";
import { buildVideoReviewContextsByMessageId } from "@/features/messages/lib/videoReviewContext";
import { cn } from "@/shared/lib/cn";
import { DayDivider } from "./DayDivider";
import { MessageRowItem, SystemRow } from "./TimelineMessageRow";
import { TimelineRowShell } from "./TimelineRowShell";
import { UnreadDivider } from "./UnreadDivider";

import type { TimelineMessageListProps } from "@client-kit/platform/react/messages/timeline/types";

export const TimelineMessageList = React.memo(function TimelineMessageList({
  channelId,
  channelName,
  currentPubkey,
  firstUnreadMessageId = null,
  followThreadById,
  highlightedMessageId = null,
  isFollowingThreadById,
  isMessageUnreadById,
  entranceMessageId = null,
  onEntranceMessageComplete,
  messageFooters,
  mainEntries,
  threadSummaries,
  messages,
  onMarkUnread,
  onMarkRead,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  onOpenThread,
  isSendingVideoReviewComment = false,
  onSendVideoReviewComment,
  profiles,
  searchActiveMessageId = null,
  searchMatchingMessageIds,
  searchQuery,
  stickyDayDividers = true,
  threadUnreadCounts,
  unfollowThreadById,
  leadingContent,
  historyExhausted = false,
  useVirtualizer = false,
  onStartReached,
  onAtBottomStateChange,
  onVirtualizerApiChange,
  onVirtualizerRangeChanged,
  onVirtualizerScrollerChange,
}: TimelineMessageListProps) {
  const entries = React.useMemo(
    () =>
      mainEntries ??
      buildMainTimelineEntries(messages, undefined, threadSummaries, profiles),
    [mainEntries, messages, profiles, threadSummaries],
  );
  // Contexts are memoized per message id so MessageRow/Markdown memo
  // comparisons hold across unrelated timeline re-renders (typing
  // indicators, presence updates) — a fresh context object per render would
  // defeat the memo and re-render every video message on every pass.
  const videoReviewContextById = React.useMemo(() => {
    return buildVideoReviewContextsByMessageId({
      channelId,
      channelName,
      isSendingVideoReviewComment,
      messages,
      onSendVideoReviewComment,
      profiles,
    });
  }, [
    channelId,
    channelName,
    isSendingVideoReviewComment,
    messages,
    onSendVideoReviewComment,
    profiles,
  ]);

  // The flattened item stream, memoized on the entries and the unread boundary
  // (the unread divider is its own item, so it shifts subsequent rows).
  const itemsResult = React.useMemo(
    () => buildTimelineItems(entries, firstUnreadMessageId),
    [entries, firstUnreadMessageId],
  );
  const dayGroups = React.useMemo(
    () => buildTimelineDayGroups(itemsResult.items),
    [itemsResult.items],
  );

  const renderItem = React.useCallback(
    (item: TimelineNonDayItem) => {
      switch (item.kind) {
        case "unread-divider":
          return <UnreadDivider />;
        case "system":
          return (
            <SystemRow
              onToggleReaction={onToggleReaction}
              currentPubkey={currentPubkey}
              entry={item.entry}
              footer={messageFooters?.[item.entry.message.id] ?? null}
              profiles={profiles}
            />
          );
        case "system-group":
          return (
            <SystemRow
              onToggleReaction={onToggleReaction}
              currentPubkey={currentPubkey}
              entries={item.entries}
              footer={item.entries.map(
                (entry) => messageFooters?.[entry.message.id] ?? null,
              )}
              profiles={profiles}
            />
          );
        case "message":
          return (
            <MessageRowItem
              currentPubkey={currentPubkey}
              onToggleReaction={onToggleReaction}
              channelId={channelId}
              entry={item.entry}
              followThreadById={followThreadById}
              footer={messageFooters?.[item.entry.message.id] ?? null}
              highlightedMessageId={highlightedMessageId}
              isContinuation={item.isContinuation}
              isFollowedByContinuation={item.isFollowedByContinuation}
              isFollowingThreadById={isFollowingThreadById}
              isUnread={isMessageUnreadById?.(item.entry.message.id)}
              playEntrance={item.entry.message.id === entranceMessageId}
              onEntranceComplete={onEntranceMessageComplete}
              onMarkRead={onMarkRead}
              onMarkUnread={onMarkUnread}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onOpenThread={onOpenThread}
              profiles={profiles}
              searchActiveMessageId={searchActiveMessageId}
              searchMatchingMessageIds={searchMatchingMessageIds}
              searchQuery={searchQuery}
              threadUnreadCounts={threadUnreadCounts}
              unfollowThreadById={unfollowThreadById}
              videoReviewContext={videoReviewContextById.get(
                item.entry.message.id,
              )}
            />
          );
      }
    },
    [
      channelId,
      currentPubkey,
      followThreadById,
      highlightedMessageId,
      isFollowingThreadById,
      isMessageUnreadById,
      entranceMessageId,
      onEntranceMessageComplete,
      messageFooters,
      onMarkRead,
      onMarkUnread,
      onReply,
      onToggleReaction,
      onEdit,
      onDelete,
      onOpenThread,
      profiles,
      searchActiveMessageId,
      searchMatchingMessageIds,
      searchQuery,
      threadUnreadCounts,
      unfollowThreadById,
      videoReviewContextById,
    ],
  );

  if (useVirtualizer) {
    return (
      <VirtualizedTimelineRows
        dayGroups={dayGroups}
        historyExhausted={historyExhausted}
        leadingContent={leadingContent}
        onAtBottomStateChange={onAtBottomStateChange}
        onStartReached={onStartReached}
        onVirtualizerApiChange={onVirtualizerApiChange}
        onVirtualizerRangeChanged={onVirtualizerRangeChanged}
        onVirtualizerScrollerChange={onVirtualizerScrollerChange}
        renderItem={renderItem}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {dayGroups.map((group) => (
        <section
          className={cn(
            "relative flex flex-col",
            group.headingTimestamp !== null &&
              "before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-border/35 before:content-['']",
          )}
          data-day-label={
            group.headingTimestamp === null
              ? undefined
              : formatDayGroupLabel(group.headingTimestamp)
          }
          data-testid="message-timeline-day-group"
          key={group.key}
        >
          {group.headingTimestamp === null ? null : (
            <DayDivider
              label={formatDayGroupLabel(group.headingTimestamp)}
              sticky={stickyDayDividers}
            />
          )}
          {group.items.map((item) => (
            <TimelineRowShell item={item} key={getTimelineItemKey(item)}>
              {renderItem(item)}
            </TimelineRowShell>
          ))}
        </section>
      ))}
    </div>
  );
});
