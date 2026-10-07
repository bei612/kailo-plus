import * as React from "react";
import { depthGuideActionsEqual, numberArrayEqual, tagsEqual, reactionsEqual } from "@/features/messages/lib/messageRowEquality";
import { useCustomEmojiPalette } from "../lib/useCustomEmojiPalette";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { assertCanSendMessageToChannel, canSendMessageToChannel } from "@/features/messages/lib/canSendToChannel";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { useChannelNavigation } from "@/shared/context/ChannelNavigationContext";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";
import { resolveMentionProps } from "@/shared/lib/resolveMentionNames";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import type { VideoReviewContext } from "@/shared/ui/VideoPlayer";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { hasLinkPreviewSuppression } from "@/features/messages/lib/formatTimelineMessages";
import { MessageActionBar } from "./MessageActionBar";
import { MessageAuthorIdentity } from "./MessageHeader";
import { SentFromThreadLine } from "./SentFromThreadLine";
import { MessageRowSurface, type ThreadDepthGuideAction } from "@client-kit/platform/react/messages";
export type { ThreadDepthGuideAction } from "@client-kit/platform/react/messages";
type MessageRowProps = {
    channelId?: string | null;
    currentPubkey?: string;
    collapseDepthGuideActions?: ReadonlyArray<ThreadDepthGuideAction>;
    connectDescendants?: boolean;
    depthGuideDepths?: ReadonlyArray<number>;
    highlighted?: boolean;
    highlightDescendantRail?: boolean;
    highlightReplyConnector?: boolean;
    highlightThreadLineDepths?: ReadonlyArray<number>;
    hoverBackground?: boolean;
    actionBarPlacement?: "floating" | "inside";
    collapseDescendantsLabel?: string;
    isFollowingThread?: boolean;
    isContinuation?: boolean;
    isUnread?: boolean;
    layoutVariant?: "default" | "thread-reply";
    message: TimelineMessage;
    onCollapseDepthGuide?: (message: TimelineMessage) => void;
    onCollapseDepthGuideHoverChange?: (
      message: TimelineMessage,
      hovered: boolean,
    ) => void;
    onCollapseDescendants?: (message: TimelineMessage) => void;
    onCollapseDescendantsHoverChange?: (
      message: TimelineMessage,
      hovered: boolean,
    ) => void;
    onFollowThread?: (message: TimelineMessage) => void;
    onMarkUnread?: (message: TimelineMessage) => void;
    onMarkRead?: (message: TimelineMessage) => void;
    onReply?: (message: TimelineMessage) => void;
    onEdit?: (message: TimelineMessage) => void;
    onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
    onSendToChannel?: (message: TimelineMessage) => Promise<void>;
    onUnfollowThread?: (message: TimelineMessage) => void;
    onEntranceComplete?: (messageId: string) => void;
    playEntrance?: boolean;
    profiles?: UserProfileLookup;
    searchQuery?: string;
    showDepthGuides?: boolean;
    videoReviewCommentRootId?: string;
    videoReviewContext?: VideoReviewContext;
};
export const MessageRow = React.memo(function MessageRow(props: MessageRowProps) {
 const {message,channelId,currentPubkey,profiles,searchQuery,videoReviewCommentRootId,videoReviewContext,onSendToChannel} = props;
 const { nonDmChannelNames: channelNames } = useChannelNavigation();
 const customEmoji = useCustomEmojiPalette();
 const community = useActiveCommunity();
 const { mentionNames, mentionPubkeysByName } = React.useMemo(() => resolveMentionProps(message.tags, profiles, message.body), [profiles,message.tags,message.body]);
 const imetaByUrl = React.useMemo(() => message.tags ? parseImetaTags(message.tags) : undefined,[message.tags]);
 const handleSendToChannel = React.useCallback(async(target:TimelineMessage)=>{assertCanSendMessageToChannel(target,currentPubkey);await onSendToChannel?.(target);},[currentPubkey,onSendToChannel]);
 return <MessageRowSurface {...props} resolveMediaUrl={rewriteRelayUrl} customEmoji={customEmoji}
 reactionScope={currentPubkey ? JSON.stringify([community.id,currentPubkey]) : null}
 renderIdentity={message.pubkey ? (node,kind)=>kind === "author" ? <MessageAuthorIdentity pubkey={message.pubkey}>{node}</MessageAuthorIdentity> : <UserProfilePopover pubkey={message.pubkey!}><button className="flex shrink-0 items-start rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" type="button">{node}</button></UserProfilePopover> : undefined}
 renderBody={(className)=><VideoReviewCommentMarkdown channelNames={channelNames} className={className} content={message.body} messageId={message.id} linkPreviewsSuppressed={hasLinkPreviewSuppression(message.tags)} linkPreviewTags={message.tags} imetaByUrl={imetaByUrl} mentionNames={mentionNames} mentionPubkeysByName={mentionPubkeysByName} searchQuery={searchQuery} videoReviewCommentRootId={videoReviewCommentRootId} videoReviewContext={videoReviewContext}/>}
 renderActions={(ref,reactions)=><MessageActionBar {...props} {...reactions} ref={ref} onEdit={message.kind === 9 && message.signerPubkey === currentPubkey && !message.pending ? props.onEdit : undefined} onSendToChannel={onSendToChannel && canSendMessageToChannel(message,currentPubkey) ? handleSendToChannel : undefined}/>}
 reference={<SentFromThreadLine channelId={channelId} tags={message.tags}/>} />;
},
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.pubkey === next.message.pubkey &&
    prev.message.body === next.message.body &&
    prev.message.author === next.message.author &&
    prev.message.avatarUrl === next.message.avatarUrl &&
    prev.message.accent === next.message.accent &&
    // The header timestamp and hover gutter both derive from createdAt (the
    // old `time` prop was the same value pre-formatted; this row reads neither).
    prev.message.createdAt === next.message.createdAt &&
    prev.message.depth === next.message.depth &&
    prev.message.kind === next.message.kind &&
    prev.message.pending === next.message.pending &&
    // Value comparisons, not identity: these arrays are rebuilt with fresh
    // identities on every ingest/refetch even when unchanged — identity
    // checks made every row re-render on every streamed event in an open
    // thread (see messageRowEquality.ts).
    tagsEqual(prev.message.tags, next.message.tags) &&
    reactionsEqual(prev.message.reactions, next.message.reactions) &&
    prev.onToggleReaction === next.onToggleReaction &&
    prev.message.role === next.message.role &&
    prev.currentPubkey === next.currentPubkey &&
    depthGuideActionsEqual(
      prev.collapseDepthGuideActions,
      next.collapseDepthGuideActions,
    ) &&
    prev.collapseDescendantsLabel === next.collapseDescendantsLabel &&
    prev.connectDescendants === next.connectDescendants &&
    numberArrayEqual(prev.depthGuideDepths, next.depthGuideDepths) &&
    prev.highlightDescendantRail === next.highlightDescendantRail &&
    prev.highlighted === next.highlighted &&
    prev.highlightReplyConnector === next.highlightReplyConnector &&
    numberArrayEqual(
      prev.highlightThreadLineDepths,
      next.highlightThreadLineDepths,
    ) &&
    prev.hoverBackground === next.hoverBackground &&
    prev.isContinuation === next.isContinuation &&
    prev.isFollowingThread === next.isFollowingThread &&
    prev.isUnread === next.isUnread &&
    prev.layoutVariant === next.layoutVariant &&
    prev.onCollapseDepthGuide === next.onCollapseDepthGuide &&
    prev.onCollapseDepthGuideHoverChange ===
      next.onCollapseDepthGuideHoverChange &&
    prev.onCollapseDescendants === next.onCollapseDescendants &&
    prev.onCollapseDescendantsHoverChange ===
      next.onCollapseDescendantsHoverChange &&
    prev.onEntranceComplete === next.onEntranceComplete &&
    prev.playEntrance === next.playEntrance &&
    prev.onSendToChannel === next.onSendToChannel &&
    prev.profiles === next.profiles &&
    prev.searchQuery === next.searchQuery &&
    prev.videoReviewCommentRootId === next.videoReviewCommentRootId &&
    prev.videoReviewContext === next.videoReviewContext,
);

MessageRow.displayName = "MessageRow";
