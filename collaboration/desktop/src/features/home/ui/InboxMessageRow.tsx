import * as React from "react";
import { MessageReactions, useReactionHandler, type TimelineMessage } from "@client-kit/platform/react/messages";
import { useCustomEmojiPalette } from "@/features/messages/lib/useCustomEmojiPalette";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

import type { InboxContextMessage } from "@/features/home/lib/inbox";
import { toTimelineMessage } from "@/features/home/lib/inboxViewHelpers";
import { formatTimeWithoutDayPeriod } from "@/features/messages/lib/dateFormatters";
import { formatItemTimestamp } from "@/shared/lib/datetime";
import { MessageActionBar } from "@/features/messages/ui/MessageActionBar";
import { UnreadDivider } from "@/features/messages/ui/UnreadDivider";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { cn } from "@/shared/lib/cn";
import { hasLinkPreviewSuppression } from "@/features/messages/lib/formatTimelineMessages";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import type { VideoReviewContext } from "@/shared/ui/VideoPlayer";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";

export type InboxDisplayMessage = InboxContextMessage & {
  depth: number;
};

type InboxMessageRowProps = {
  canReply: boolean;
  currentPubkey?: string;
  onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
  /** Channel UUID for "Copy link" — passed straight through to MessageActionBar. */
  channelId?: string | null;
  isContinuation?: boolean;
  isFirst?: boolean;
  isFocusHighlightVisible: boolean;
  message: InboxDisplayMessage;
  onSelectReplyTarget: (message: InboxDisplayMessage) => void;
  /** Resolves the mention identities carried by "Copy message". */
  profiles?: UserProfileLookup;
  showUnreadBoundary?: boolean;
  videoReviewCommentRootId?: string;
  videoReviewContext?: VideoReviewContext;
};

export function InboxMessageRow({
  canReply,
  currentPubkey,
  onToggleReaction,
  channelId = null,
  isContinuation = false,
  isFirst = false,
  isFocusHighlightVisible,
  message,
  onSelectReplyTarget,
  profiles,
  showUnreadBoundary = false,
  videoReviewCommentRootId,
  videoReviewContext,
}: InboxMessageRowProps) {
  const timelineMessage = React.useMemo(
    () => toTimelineMessage(message),
    [message],
  );
  const imetaByUrl = React.useMemo(
    () => (message.tags ? parseImetaTags(message.tags) : undefined),
    [message.tags],
  );
  const customEmoji = useCustomEmojiPalette();
  const community = useActiveCommunity();
  const reactionScope = currentPubkey ? JSON.stringify([community.id, currentPubkey]) : null;
  const [badgeBurstEmoji, setBadgeBurstEmoji] = React.useState<string | null>(null);
  const { reactions, canToggle: canToggleReactions, pending: reactionPending,
    errorMessage: reactionErrorMessage, select: handleReactionSelect } =
    useReactionHandler(timelineMessage, onToggleReaction, customEmoji);
  const hoverTimestampLabel = formatTimeWithoutDayPeriod(
    message.timeLabel ?? message.fullTimestampLabel,
  );
  // Derived here rather than plumbed in with the message: the thread pane has no
  // day divider to supply the date, and deriving on render means a row does not
  // keep saying "Today" after midnight. `fullTimestampLabel` stays the absolute
  // value behind the hover title.
  const timestampLabel = formatItemTimestamp(message.createdAt, {
    withTime: true,
  });
  const timestampNode = (
    <p
      className="shrink-0 text-message-timestamp font-normal tabular-nums text-muted-foreground/55"
      data-testid="inbox-message-timestamp"
      title={message.fullTimestampLabel}
    >
      {timestampLabel}
    </p>
  );

  return (
    <div className="relative px-2">
      {showUnreadBoundary ? <UnreadDivider /> : null}
      {message.isSelected ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-3 inset-y-1 rounded-2xl transition-opacity duration-1000",
            isFocusHighlightVisible
              ? "bg-primary/[0.07] opacity-100"
              : "bg-primary/[0.07] opacity-0",
          )}
        />
      ) : null}
      <article
        className={cn(
          "group/message relative z-10 mx-1 flex gap-2.5 rounded-2xl px-2 py-conversation-row transition-colors hover:bg-muted/50 focus-within:bg-muted/50",
          isContinuation ? "items-center" : "items-start",
        )}
        data-message-id={message.id}
        data-testid={
          message.isSelected
            ? "home-inbox-selected-message"
            : "home-inbox-context-message"
        }
      >
        {canReply || canToggleReactions ? (
          <div
            className={cn(
              "absolute right-2 top-1 z-10",
              !isFirst && "sm:top-0 sm:-translate-y-1/2",
            )}
          >
            <MessageActionBar
              channelId={channelId}
              message={timelineMessage}
              onReply={canReply ? () => onSelectReplyTarget(message) : undefined}
              onReactionSelect={canToggleReactions && !reactionPending ? handleReactionSelect : undefined}
              onReactionBadgeBurstRequest={reactionPending ? undefined : setBadgeBurstEmoji}
              reactionErrorMessage={reactionErrorMessage}
              reactions={reactions}
              customEmoji={customEmoji}
              reactionScope={reactionScope}
              resolveMediaUrl={rewriteRelayUrl}
              profiles={profiles}
            />
          </div>
        ) : null}

        {isContinuation ? (
          <div
            aria-hidden="true"
            className="flex w-9 shrink-0 self-stretch items-start justify-end pt-0.5"
            title={message.fullTimestampLabel}
          >
            <p className="shrink-0 cursor-default whitespace-nowrap text-message-timestamp font-normal tabular-nums text-muted-foreground/55 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
              {hoverTimestampLabel}
            </p>
          </div>
        ) : (
          // flex, not a line box: while the avatar fallback is still empty (its
          // 200ms delay) an inline-flex child sits on the text baseline and the
          // wrapper grows by the descender gap, so every row above the fold
          // shrinks when initials appear and the pane's scroll position jumps.
          <div className="relative flex shrink-0">
            <UserProfilePopover
              pubkey={message.authorPubkey}
              triggerClassName="shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              triggerElement="span"
            >
              <span className="inline-flex shrink-0">
                <UserAvatar
                  avatarUrl={message.avatarUrl}
                  className="h-9 w-9 shrink-0"
                  displayName={message.authorLabel}
                  size="md"
                />
              </span>
            </UserProfilePopover>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {isContinuation ? null : (
            <div
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0"
              data-testid="message-header"
            >
              <UserProfilePopover
                pubkey={message.authorPubkey}
                triggerElement="span"
              >
                <span
                  className="block max-w-full truncate rounded text-message font-semibold leading-message-author text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="message-author"
                >
                  {message.authorLabel}
                </span>
              </UserProfilePopover>
              {timestampNode}
            </div>
          )}

          <div
            className={isContinuation ? "mt-0" : "mt-conversation-body"}
            data-testid="message-body"
          >
            <VideoReviewCommentMarkdown
              className="max-w-full text-left text-message text-foreground"
              content={message.content}
              messageId={message.id}
              linkPreviewsSuppressed={hasLinkPreviewSuppression(
                timelineMessage.tags,
              )}
              imetaByUrl={imetaByUrl}
              mentionNames={message.mentionNames}
              mentionPubkeysByName={message.mentionPubkeysByName}
              videoReviewCommentRootId={videoReviewCommentRootId}
              videoReviewContext={videoReviewContext}
            />
            <MessageReactions
              canToggle={canToggleReactions}
              messageId={message.id}
              onSelect={(emoji) => { void handleReactionSelect(emoji).catch(() => undefined); }}
              burstEmojiOnRender={badgeBurstEmoji}
              onBurstEmojiRendered={(emoji) => setBadgeBurstEmoji(current => current === emoji ? null : current)}
              pending={reactionPending}
              reactions={reactions}
              customEmoji={customEmoji}
              reactionScope={reactionScope}
              resolveMediaUrl={rewriteRelayUrl}
            />
            {reactionErrorMessage ? <p className="mt-1.5 text-xs text-muted-foreground" role="status">{reactionErrorMessage}</p> : null}
          </div>
        </div>
      </article>
    </div>
  );
}
