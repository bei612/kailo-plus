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
import { MessageRowSurface, canRemoveLinkPreviews, type ThreadDepthGuideAction } from "@client-kit/platform/react/messages";
import { useUiT } from "@client-kit/platform/react/context";
import { toast } from "sonner";
import { editMessage } from "@/shared/api/tauriMessages";
import { useManagedMessageActions } from "./ownedAgentMessageScope";
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
    onDelete?: (message: TimelineMessage) => void;
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
 const t = useUiT();
 const ownEditable = message.kind === 9 && message.signerPubkey === currentPubkey && !message.pending;
 // DD-142: own messages, or an owned Agent's in a Workspace channel (the same rule as Web).
 const managed = useManagedMessageActions(message, currentPubkey, { onEdit: props.onEdit, onDelete: props.onDelete });
 // Buzz 779af8886caae1317b4de962082429867ab61503 MessageRow.tsx L172-195 removeLinkPreviewsForEveryone
 // (DD-125(5)): the author's own native re-edit with the same body and media plus
 // ["link-preview","none"], on the captured relay and signer; an unknown outcome is resent by the
 // native mutation cache only as the same event, never re-signed.
 const relayUrl = community.relayUrl;
 const removeLinkPreviewsForEveryone = React.useMemo(() => channelId && currentPubkey && relayUrl && props.onEdit && ownEditable
   && canRemoveLinkPreviews(message)
   ? async () => {
     const tags = message.tags ?? [];
     try {
       await editMessage(channelId, message.id, message.body, tags.filter((tag) => tag[0] === "imeta"), [], relayUrl, currentPubkey, true);
     } catch (error) {
       toast.error(t("linkPreview.removeFailed", { reason: error instanceof Error ? error.message : String(error) }));
       throw error;
     }
   } : undefined, [channelId, currentPubkey, relayUrl, props.onEdit, ownEditable, message, t]);
 return <MessageRowSurface {...props} resolveMediaUrl={rewriteRelayUrl} customEmoji={customEmoji}
 reactionScope={currentPubkey ? JSON.stringify([community.id,currentPubkey]) : null}
 renderIdentity={message.pubkey ? (node,kind)=>kind === "author" ? <MessageAuthorIdentity pubkey={message.pubkey}>{node}</MessageAuthorIdentity> : <UserProfilePopover pubkey={message.pubkey!}><button className="flex shrink-0 items-start rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" type="button">{node}</button></UserProfilePopover> : undefined}
 renderBody={(className)=><VideoReviewCommentMarkdown channelNames={channelNames} className={className} content={message.body} messageId={message.id} linkPreviewsSuppressed={hasLinkPreviewSuppression(message.tags)} linkPreviewTags={message.tags} onRemoveLinkPreviewsForEveryone={removeLinkPreviewsForEveryone} imetaByUrl={imetaByUrl} mentionNames={mentionNames} mentionPubkeysByName={mentionPubkeysByName} searchQuery={searchQuery} videoReviewCommentRootId={videoReviewCommentRootId} videoReviewContext={videoReviewContext}/>}
 renderActions={(ref,reactions)=><MessageActionBar {...props} {...reactions} ref={ref} onEdit={managed.onEdit} onDelete={managed.onDelete} onSendToChannel={onSendToChannel && canSendMessageToChannel(message,currentPubkey) ? handleSendToChannel : undefined}/>}
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
    prev.message.edited === next.message.edited &&
    // Value comparisons, not identity: these arrays are rebuilt with fresh
    // identities on every ingest/refetch even when unchanged — identity
    // checks made every row re-render on every streamed event in an open
    // thread (see messageRowEquality.ts).
    tagsEqual(prev.message.tags, next.message.tags) &&
    reactionsEqual(prev.message.reactions, next.message.reactions) &&
    prev.onToggleReaction === next.onToggleReaction &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
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
