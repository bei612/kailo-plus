import * as React from "react";
import { InboxMessageRowSurface } from "@client-kit/platform/react/inbox-surface";
import type { TimelineMessage } from "@client-kit/platform/react/messages";
import { useCustomEmojiPalette } from "@/features/messages/lib/useCustomEmojiPalette";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import type { InboxContextMessage } from "@/features/home/lib/inbox";
import { toTimelineMessage } from "@/features/home/lib/inboxViewHelpers";
import { MessageActionBar } from "@/features/messages/ui/MessageActionBar";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { hasLinkPreviewSuppression } from "@/features/messages/lib/formatTimelineMessages";
import type { VideoReviewContext } from "@/shared/ui/VideoPlayer";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";

export type InboxDisplayMessage = InboxContextMessage & { depth: number };

type InboxMessageRowProps = {
  canReply: boolean;
  currentPubkey?: string;
  onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
  channelId?: string | null;
  isContinuation?: boolean;
  isFirst?: boolean;
  isFocusHighlightVisible: boolean;
  message: InboxDisplayMessage;
  onSelectReplyTarget: (message: InboxDisplayMessage) => void;
  profiles?: UserProfileLookup;
  showUnreadBoundary?: boolean;
  videoReviewCommentRootId?: string;
  videoReviewContext?: VideoReviewContext;
};

export function InboxMessageRow({
  canReply, currentPubkey, onToggleReaction, channelId = null,
  isContinuation = false, isFirst = false, isFocusHighlightVisible,
  message, onSelectReplyTarget, profiles, showUnreadBoundary = false,
  videoReviewCommentRootId, videoReviewContext,
}: InboxMessageRowProps) {
  const timelineMessage = React.useMemo(() => toTimelineMessage(message), [message]);
  const imetaByUrl = React.useMemo(() => message.tags ? parseImetaTags(message.tags) : undefined, [message.tags]);
  const customEmoji = useCustomEmojiPalette();
  const community = useActiveCommunity();
  const reactionScope = currentPubkey ? JSON.stringify([community.id, currentPubkey]) : null;
  return <InboxMessageRowSurface message={timelineMessage} isSelected={message.isSelected}
    isFocusHighlightVisible={isFocusHighlightVisible} isContinuation={isContinuation}
    isFirst={isFirst} showUnreadBoundary={showUnreadBoundary} fullTimestampLabel={message.fullTimestampLabel}
    onToggleReaction={onToggleReaction} customEmoji={customEmoji} reactionScope={reactionScope} resolveMediaUrl={rewriteRelayUrl}
    renderIdentity={(node, kind) => <UserProfilePopover pubkey={message.authorPubkey} triggerElement="span"
      triggerClassName={kind === "avatar" ? "shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" : undefined}>{node}</UserProfilePopover>}
    renderActions={canReply || (onToggleReaction && !timelineMessage.pending) ? reactions => <MessageActionBar
      {...reactions} channelId={channelId} message={timelineMessage}
      onReply={canReply ? () => onSelectReplyTarget(message) : undefined} profiles={profiles} /> : undefined}
    renderBody={className => <VideoReviewCommentMarkdown className={className}
      content={message.content} messageId={message.id} linkPreviewsSuppressed={hasLinkPreviewSuppression(timelineMessage.tags)}
      imetaByUrl={imetaByUrl} mentionNames={message.mentionNames} mentionPubkeysByName={message.mentionPubkeysByName}
      videoReviewCommentRootId={videoReviewCommentRootId} videoReviewContext={videoReviewContext} />} />;
}
