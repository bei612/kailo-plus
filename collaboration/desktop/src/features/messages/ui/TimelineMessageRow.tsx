import * as React from "react";

import type { MainTimelineEntry } from "@/features/messages/lib/threadPanel";
import { THREAD_REPLY_ROW_MARGIN_INLINE_REM } from "@/features/messages/lib/threadTreeLayout";
import type { buildVideoReviewContextForMessage } from "@/features/messages/lib/videoReviewContext";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { cn } from "@/shared/lib/cn";
import { MessageRow } from "./MessageRow";
import { MessageThreadSummaryRow } from "./MessageThreadSummaryRow";
import { SystemMessageRow } from "./SystemMessageRow";

type SystemRowProps = {
  onToggleReaction?: React.ComponentProps<typeof MessageRow>["onToggleReaction"];
  currentPubkey?: string;
  entries?: MainTimelineEntry[];
  entry?: MainTimelineEntry;
  footer: React.ReactNode;
  profiles?: UserProfileLookup;
};

export function SystemRow({
  onToggleReaction,
  currentPubkey,
  entries,
  entry,
  footer,
  profiles,
}: SystemRowProps) {
  const systemEntries = entries ?? (entry ? [entry] : []);
  const firstEntry = systemEntries[0];
  const groupedMessages = React.useMemo(
    () => entries?.map((systemEntry) => systemEntry.message),
    [entries],
  );
  if (!firstEntry) return null;

  return (
    <div className="flex flex-col gap-1 pb-2.5">
      <SystemMessageRow
        onToggleReaction={onToggleReaction}
        groupedMessages={groupedMessages}
        message={firstEntry.message}
        currentPubkey={currentPubkey}
        profiles={profiles}
      />
      {footer}
    </div>
  );
}

type MessageRowItemProps = {
  currentPubkey?: string;
  onToggleReaction?: React.ComponentProps<typeof MessageRow>["onToggleReaction"];
  channelId?: string | null;
  entry: MainTimelineEntry;
  followThreadById?: (rootId: string) => void;
  footer: React.ReactNode;
  highlightedMessageId?: string | null;
  isContinuation?: boolean;
  isFollowedByContinuation?: boolean;
  isFollowingThreadById?: (rootId: string) => boolean;
  isUnread?: boolean;
  playEntrance?: boolean;
  onEntranceComplete?: (messageId: string) => void;
  onMarkUnread?: (message: TimelineMessage) => void;
  onMarkRead?: (message: TimelineMessage) => void;
  onReply?: (message: TimelineMessage) => void;
  onEdit?: (message: TimelineMessage) => void;
  onOpenThread?: (message: TimelineMessage) => void;
  profiles?: UserProfileLookup;
  searchActiveMessageId?: string | null;
  searchMatchingMessageIds?: Set<string>;
  searchQuery?: string;
  threadUnreadCounts?: ReadonlyMap<string, number>;
  unfollowThreadById?: (rootId: string) => void;
  videoReviewContext: ReturnType<typeof buildVideoReviewContextForMessage>;
};

export function MessageRowItem({
  currentPubkey,
  onToggleReaction,
  channelId,
  entry,
  followThreadById,
  footer,
  highlightedMessageId,
  isContinuation = false,
  isFollowedByContinuation = false,
  isFollowingThreadById,
  isUnread,
  playEntrance = false,
  onEntranceComplete,
  onMarkUnread,
  onMarkRead,
  onReply,
  onEdit,
  onOpenThread,
  profiles,
  searchActiveMessageId,
  searchMatchingMessageIds,
  searchQuery,
  threadUnreadCounts,
  unfollowThreadById,
  videoReviewContext,
}: MessageRowItemProps) {
  const { message, summary } = entry;

  if (summary && onOpenThread) {
    const isHighlighted = message.id === highlightedMessageId;
    return (
      <div
        className={cn(
          "group/message relative mx-1 mb-1 flex flex-col gap-0 rounded-2xl px-0 py-1 transition-colors hover:bg-muted/50 focus-within:bg-muted/50",
          isHighlighted &&
            "-mx-4 px-4 before:absolute before:-inset-y-1.5 before:inset-x-0 before:animate-[route-target-highlight-fade_2s_ease-out_forwards] before:bg-primary/10 before:content-[''] motion-reduce:before:animate-none sm:-mx-6 sm:px-6",
        )}
      >
        <MessageRow
          currentPubkey={currentPubkey}
          onToggleReaction={onToggleReaction}
          channelId={channelId}
          highlighted={false}
          hoverBackground={false}
          isFollowingThread={
            isFollowingThreadById
              ? isFollowingThreadById(message.id)
              : undefined
          }
          isUnread={isUnread}
          isContinuation={isContinuation}
          playEntrance={playEntrance}
          onEntranceComplete={onEntranceComplete}
          message={message}
          onFollowThread={
            followThreadById ? () => followThreadById(message.id) : undefined
          }
          onMarkRead={onMarkRead}
          onMarkUnread={onMarkUnread}
          onReply={onReply}
              onEdit={onEdit}
          onUnfollowThread={
            unfollowThreadById
              ? () => unfollowThreadById(message.id)
              : undefined
          }
          profiles={profiles}
          showDepthGuides={false}
          videoReviewContext={videoReviewContext}
        />
        <MessageThreadSummaryRow
          depth={message.depth}
          message={message}
          onOpenThread={onOpenThread}
          showDepthGuides={false}
          summary={summary}
          summaryIndentOffsetRem={-THREAD_REPLY_ROW_MARGIN_INLINE_REM}
          unreadCount={threadUnreadCounts?.get(message.id)}
        />
        {footer}
      </div>
    );
  }

  const isSearchMatch = searchMatchingMessageIds?.has(message.id) ?? false;
  const isSearchActive = message.id === searchActiveMessageId;

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        isFollowedByContinuation ? "pb-0" : "pb-2.5",
      )}
    >
      <MessageRow
        currentPubkey={currentPubkey}
        onToggleReaction={onToggleReaction}
        channelId={channelId}
        highlighted={message.id === highlightedMessageId || isSearchActive}
        isContinuation={isContinuation}
        isUnread={isUnread}
        playEntrance={playEntrance}
        onEntranceComplete={onEntranceComplete}
        message={message}
        onMarkRead={onMarkRead}
        onMarkUnread={onMarkUnread}
        onReply={onReply}
              onEdit={onEdit}
        profiles={profiles}
        searchQuery={isSearchMatch ? searchQuery : undefined}
        showDepthGuides={false}
        videoReviewContext={videoReviewContext}
      />
      {footer}
    </div>
  );
}
