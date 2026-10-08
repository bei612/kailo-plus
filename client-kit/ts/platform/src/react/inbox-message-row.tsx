// Shared from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/home/ui/InboxMessageRow.tsx. Hosts retain admission and reads.
import * as React from "react";
import { cn } from "./profile/buzz/shared/lib/cn";
import { formatItemTimestamp } from "./messages/datetime";
import { formatFullDateTime, formatTime, formatTimeWithoutDayPeriod } from "./messages/dateFormatters";
import { UserAvatar } from "./messages/UserAvatar";
import { useMessageEmoji } from "./messages/useMessageEmoji";
import { UnreadDivider } from "./messages/UnreadDivider";
import { MessageReactions } from "./messages/reactions/MessageReactions";
import { useReactionHandler } from "./messages/reactions/useReactionHandler";
import type { MessageActionBarSurface } from "./messages/MessageActionBarSurface";
import type { MessageRowSurface } from "./messages/MessageRowSurface";
import type { TimelineMessage } from "./messages/types";

type ReactionActionProps = Pick<React.ComponentProps<typeof MessageActionBarSurface>,
  "reactions" | "onReactionSelect" | "onReactionBadgeBurstRequest" | "reactionErrorMessage" | "customEmoji" | "reactionScope" | "resolveMediaUrl">;

export function InboxMessageRowSurface({
  message, isSelected = false, isFocusHighlightVisible = false,
  isContinuation = false, isFirst = false, showUnreadBoundary = false,
  fullTimestampLabel, renderIdentity, renderBody, renderActions,
  onToggleReaction, customEmoji = [], reactionScope, resolveMediaUrl,
}: Pick<React.ComponentProps<typeof MessageRowSurface>,
  "renderIdentity" | "renderBody" | "onToggleReaction" | "customEmoji" | "reactionScope" | "resolveMediaUrl"> & {
  message: TimelineMessage;
  isSelected?: boolean;
  isFocusHighlightVisible?: boolean;
  isContinuation?: boolean;
  isFirst?: boolean;
  showUnreadBoundary?: boolean;
  fullTimestampLabel?: string;
  renderActions?: (reactions: ReactionActionProps) => React.ReactNode;
}) {
  const [badgeBurstEmoji, setBadgeBurstEmoji] = React.useState<string | null>(null);
  const reaction = useReactionHandler(message, onToggleReaction, customEmoji);
  const { emojiOnly } = useMessageEmoji(message.body, message.tags);
  const identity = (node: React.ReactNode, kind: "avatar" | "author") => renderIdentity?.(node, kind) ?? node;
  const absoluteTimestamp = fullTimestampLabel ?? formatFullDateTime(message.createdAt);
  return <div className="relative px-2">
    {showUnreadBoundary ? <UnreadDivider /> : null}
    {isSelected ? <div aria-hidden="true" className={cn(
      "pointer-events-none absolute inset-x-3 inset-y-1 rounded-2xl transition-opacity duration-1000",
      isFocusHighlightVisible ? "bg-primary/[0.07] opacity-100" : "bg-primary/[0.07] opacity-0",
    )} /> : null}
    <article className={cn(
      "group/message relative z-10 mx-1 flex gap-2.5 rounded-2xl px-2 py-conversation-row transition-colors hover:bg-muted/50 focus-within:bg-muted/50",
      isContinuation ? "items-center" : "items-start",
    )} data-message-id={message.id} data-testid={isSelected ? "home-inbox-selected-message" : "home-inbox-context-message"}>
      {renderActions ? <div className={cn("absolute right-2 top-1 z-10", !isFirst && "sm:top-0 sm:-translate-y-1/2")}>
        {renderActions({reactions: reaction.reactions,
          onReactionSelect: reaction.canToggle && !reaction.pending ? reaction.select : undefined,
          onReactionBadgeBurstRequest: reaction.pending ? undefined : setBadgeBurstEmoji,
          reactionErrorMessage: reaction.errorMessage, customEmoji, reactionScope, resolveMediaUrl})}
      </div> : null}
      {isContinuation ? <div aria-hidden="true" className="flex w-9 shrink-0 self-stretch items-start justify-end pt-0.5" title={absoluteTimestamp}>
        <p className="shrink-0 cursor-default whitespace-nowrap text-message-timestamp font-normal tabular-nums text-muted-foreground/55 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
          {formatTimeWithoutDayPeriod(formatTime(message.createdAt))}
        </p>
      </div> : <div className="relative flex shrink-0">{identity(<span className="inline-flex shrink-0"><UserAvatar
        accent={message.accent} avatarUrl={message.avatarUrl ?? null} resolveMediaUrl={resolveMediaUrl}
        className="h-9 w-9 shrink-0" displayName={message.author} shape={message.isAgent ? "squircle" : "circle"} size="md" testId="message-avatar"
      /></span>, "avatar")}</div>}
      <div className="min-w-0 flex-1">
        {isContinuation ? null : <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0" data-testid="message-header">
          {identity(<span className="block max-w-full truncate rounded text-message font-semibold leading-message-author text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" data-testid="message-author">{message.author}</span>, "author")}
          <p className="shrink-0 text-message-timestamp font-normal tabular-nums text-muted-foreground/55" data-testid="inbox-message-timestamp" title={absoluteTimestamp}>
            {formatItemTimestamp(message.createdAt, {withTime: true})}
          </p>
        </div>}
        <div className={isContinuation ? "mt-0" : "mt-conversation-body"} data-testid="message-body">
          {renderBody(cn("max-w-full text-left text-message text-foreground", emojiOnly &&
            "text-4xl leading-tight [&_p]:leading-tight [&_img[data-custom-emoji]]:h-[1.45em] [&_img[data-custom-emoji]]:align-middle [&_button:has(img[data-custom-emoji])]:align-middle"))}
          <MessageReactions canToggle={reaction.canToggle} messageId={message.id}
            onSelect={emoji => { void reaction.select(emoji).catch(() => undefined); }}
            burstEmojiOnRender={badgeBurstEmoji}
            onBurstEmojiRendered={emoji => setBadgeBurstEmoji(current => current === emoji ? null : current)}
            pending={reaction.pending} reactions={reaction.reactions} customEmoji={customEmoji}
            reactionScope={reactionScope} resolveMediaUrl={resolveMediaUrl} />
          {reaction.errorMessage ? <p className="mt-1.5 text-xs text-muted-foreground" role="status">{reaction.errorMessage}</p> : null}
        </div>
      </div>
    </article>
  </div>;
}
