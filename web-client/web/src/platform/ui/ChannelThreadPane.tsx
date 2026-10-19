import { WorkspaceMembershipState, WebMessageType, type WorkspaceMemberView, type ConversationView, type ConversationParticipant } from "@client-kit/contracts";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { ThreadPanelSurface, MessageThreadPanelSkeleton, ThreadRepliesErrorCard, AuxiliaryPanel, MessageThreadPanelHeader, useThreadPanelWidth, buildThreadPanelData, getThreadRouteTarget, useRoutedMessageEdit, ThreadViewModeToggle, useThreadViewModeSwitch, RightAuxiliaryPane } from "@client-kit/platform/react/thread";
import { MessageRowSurface, MessageActionBarSurface, SentFromThreadLine, SentFromThreadLink, canSendMessageToChannel, getThreadReference, isThreadReply, useSendToChannelIntent, type MessageModerationContext, type TimelineMessage } from "@client-kit/platform/react/messages";
import { useCollaborationPreferences } from "@client-kit/platform/react/collaboration-preferences";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { relativeTime } from "@client-kit/platform/format";
import { TransportError } from "@client-kit/platform/transport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageContent, type MessageMention } from "@/features/chat/ui/MessageContent";
import { publishMessage, publishConversationMessage, publishSendToChannel, publishTyping, uploadConversationMedia, mediaUrl } from "@/platform/bff-client";
import { useTypingBroadcast } from "./useTypingBroadcast";
import { Composer, mentionPeopleFromMembers } from "./ChannelPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { MessageAuthorAvatar, MessageAuthorIdentity, useMessageAuthorLabels } from "./MessageAuthorProfile";
import { getThreadPanelLayout } from "@client-kit/platform/react/thread/threadPanelLayout";
import { useMessageReactions } from "./useMessageReactions";
import { BffVideoReviewProvider } from "@/features/chat/ui/BffVideoReview";
import type { TypingIndicatorEntry } from "@client-kit/platform/react/messages/typingState";
import type { ComponentProps, ReactNode } from "react";

export function ChannelThreadPane({ workspaceId, principalId, conversation, selected, restoreDraftKey, autoSendDraftKey, onAutoSendConsumed, routeTargetMessageId, routeActivationId, searchMessageId, searchQuery, members, mentions = [], typingEntries = [], profiles, disabled, onClose, onCopyMessage, onCopyLink, onOpenAuthor, onAuthorScopeUnavailable, isFocusMode = false, useSplitAuxiliaryPane = false, onThreadViewModeChange, channelName = "", channelId, onOpenMessageLink, editTarget, editAuthorPubkey, editBusy = false, onEdit, onCancelEdit, onEditConfirmed, onEditSendingChange, onDelete, onRequestEmptyEditDelete, isMessageUnread, onMarkRead, onMarkUnread, renderAgentMentionStatus, agentPubkeys, ownedAgentPubkeys }: {
  workspaceId: string; principalId: string; selected: TimelineMessage; members: (WorkspaceMemberView | ConversationParticipant)[];
  /** The channel's admitted Agent identities; their messages use the original squircle avatar. */
  agentPubkeys?: ReadonlySet<string>;
  /** Installations the viewer owns in this channel: their replies offer the original Send to channel. */
  ownedAgentPubkeys?: ReadonlySet<string>;
  conversation?: ConversationView;
  typingEntries?: readonly TypingIndicatorEntry[];
  profiles?: ComponentProps<typeof ThreadPanelSurface>["profiles"];
  restoreDraftKey?: string;
  autoSendDraftKey?: string;
  onAutoSendConsumed?: () => void | Promise<void>;
  routeTargetMessageId?: string;
  routeActivationId?: string;
  searchMessageId?: string | null;
  searchQuery?: string;
  disabled: boolean; onClose: () => void; onCopyMessage: (message: TimelineMessage) => void;
  onCopyLink?: (message: TimelineMessage) => void;
  onOpenAuthor?: (message: TimelineMessage) => void;
  onAuthorScopeUnavailable?: () => void;
  isFocusMode?: boolean;
  useSplitAuxiliaryPane?: boolean;
  onThreadViewModeChange?: () => void;
  channelName?: string;
  channelId?: string;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  mentions?: readonly MessageMention[];
  editTarget?: TimelineMessage | null;
  editAuthorPubkey?: string;
  editBusy?: boolean;
  onEdit?: (message: TimelineMessage) => boolean | void;
  onDelete?: (message: TimelineMessage) => void;
  onRequestEmptyEditDelete?: (message: TimelineMessage) => void;
  isMessageUnread?: (message: TimelineMessage) => boolean;
  onMarkRead?: (message: TimelineMessage, messages: readonly TimelineMessage[]) => void;
  onMarkUnread?: (message: TimelineMessage, messages: readonly TimelineMessage[]) => void;
  onCancelEdit?: () => void;
  onEditConfirmed?: (message: TimelineMessage) => void;
  onEditSendingChange?: (sending: boolean) => void;
  /** DD-121: the sender-only Agent @mention outcome line for the viewer's own replies. */
  renderAgentMentionStatus?: (message: TimelineMessage) => ReactNode;
}) {
  const t = useT(); const locale = useLocale();
  const rootId = getThreadReference(selected.tags ?? []).rootId ?? selected.id;
  const {thread, messages, reactionEvents, denied, interrupted, refresh} = useWorkspaceThread(principalId, workspaceId, rootId, conversation?.id, undefined, true, conversation?.channelId);
  const authorLabel = useMessageAuthorLabels({principalId, workspaceId, conversationId: conversation?.id}, messages,
    !denied && !interrupted && thread.isSuccess && !thread.isError);
  const messageReactions = useMessageReactions({principalId,workspaceId,conversationId:conversation?.id,events:reactionEvents ?? messages,
    available:!disabled && !denied && !interrupted && thread.isSuccess && !thread.isError,refresh});
  const restoredDraft = useMemo(() => {
    if (!restoreDraftKey) return null;
    for (const scope of new Set([workspaceId, conversation?.channelId].filter((value): value is string => Boolean(value)))) {
      const prefix = `thread:${scope}:${rootId}`;
      if (restoreDraftKey === prefix) return {key:restoreDraftKey, scope, replyId:rootId};
      const replyId = restoreDraftKey.startsWith(`${prefix}:`) ? restoreDraftKey.slice(prefix.length + 1) : "";
      if (/^[0-9a-f]{64}$/.test(replyId)) return {key:restoreDraftKey, scope, replyId};
    }
    return null;
  }, [restoreDraftKey, workspaceId, conversation?.channelId, rootId]);
  const [replyId, setReplyId] = useState(restoredDraft?.replyId ?? (routeTargetMessageId ? rootId : selected.id));
  const [isSending, setIsSending] = useState(false);
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(routeTargetMessageId === rootId ? null : routeTargetMessageId ?? selected.id);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([selected.id]));
  const expandedTarget = useRef<string | null>(null);
  useEffect(() => { setReplyId(restoredDraft?.replyId ?? (routeTargetMessageId ? rootId : selected.id)); setScrollTargetId(routeTargetMessageId === rootId ? null : routeTargetMessageId ?? selected.id); expandedTarget.current = null; }, [selected.id, routeTargetMessageId, routeActivationId, rootId, restoredDraft]);
  const width = useThreadPanelWidth();
  const resolveExternalScrollTarget = useCallback(() => setScrollTargetId(null), []);
  const { changeThreadViewMode, layoutScrollTargetId, resolveScrollTarget } =
    useThreadViewModeSwitch({
      activeThreadHeadId: rootId,
      externalScrollTargetId: scrollTargetId,
      onExternalTargetResolved: resolveExternalScrollTarget,
      onModeChange: onThreadViewModeChange,
    });
  // Native getThreadReplies traverses the original Relay cursor until complete.
  // Web traverses that same bounded server window, never inventing a time fence.
  useEffect(() => {
    if (!denied && !thread.isError && thread.hasNextPage && !thread.isFetchingNextPage) void thread.fetchNextPage();
  }, [denied, thread.hasNextPage, thread.isFetchingNextPage, thread.isError, thread.fetchNextPage]);
  const rows = useMemo(() => messages.map((event): TimelineMessage => {
    const edge = getThreadReference(event.tags);
    return {id: event.id, pubkey: event.pubkey, signerPubkey: event.pubkey, kind: event.kind, createdAt: event.createdAt,
      author: authorLabel(event, members.find((member) => member.pubkeys.includes(event.pubkey))?.displayName),
      body: event.content, tags: event.tags, rootId: edge.rootId, parentId: edge.parentId, depth: 0, reactions:messageReactions.reactions.get(event.id),
      edited: event.edited, isAgent: agentPubkeys?.has(event.pubkey.toLowerCase()) === true,
      time: relativeTime(locale, new Date(event.createdAt * 1000).toISOString())};
  }), [messages, members, locale, messageReactions.reactions, authorLabel, agentPubkeys]);
  useEffect(() => {
    const targetId = routeTargetMessageId ?? selected.id;
    if (expandedTarget.current === targetId) return;
    const messageById = new Map(rows.map(row => [row.id, row]));
    const target = messageById.get(targetId);
    if (!target) return;
    const route = target.parentId ? getThreadRouteTarget(target, messageById) : {expandedReplyIds:new Set<string>()};
    if (!route) return;
    expandedTarget.current = targetId;
    setExpanded((old) => new Set([...old, ...route.expandedReplyIds]));
  }, [rows, selected.id, routeTargetMessageId, routeActivationId]);
  const data = useMemo(() => buildThreadPanelData(rows, rootId, replyId, expanded), [rows, rootId, replyId, expanded]);
  // Original MessageThreadPanel typing: the thread head is the reply tag and its own root (if
  // any) the root tag, whichever nested message is being answered (DD-120(1)).
  const typingHeadId = data.threadHead?.id ?? null;
  const typingHeadRootId = data.threadHead?.rootId ?? null;
  const notifyThreadTyping = useTypingBroadcast(typingHeadId
    ? `thread:${conversation ? `conversation:${conversation.id}` : `workspace:${workspaceId}`}:${typingHeadId}` : null,
  () => typingHeadId ? publishTyping(conversation ? { conversationId: conversation.id } : { workspaceId },
    { parentEventId: typingHeadId, rootEventId: typingHeadRootId }) : Promise.resolve());
  const unavailable = denied || thread.isError || (thread.isSuccess && !data.threadHead);
  // DD-125(2): the original Report message and moderator items on thread messages.
  const moderation = useMemo<MessageModerationContext | undefined>(() => disabled || unavailable || interrupted ? undefined
    : { scope: conversation ? { conversationId: conversation.id } : { workspaceId }, selfPubkey: editAuthorPubkey },
  [disabled, unavailable, interrupted, conversation, workspaceId, editAuthorPubkey]);
  useEffect(() => {
    if (unavailable || interrupted) onAuthorScopeUnavailable?.();
  }, [unavailable, interrupted, onAuthorScopeUnavailable]);
  useEffect(() => {
    if ((unavailable || interrupted || disabled) && editTarget) onCancelEdit?.();
  }, [unavailable, interrupted, disabled, editTarget, onCancelEdit]);
  const loading = thread.isPending || thread.hasNextPage || thread.isFetchingNextPage;
  const currentMember = members.find(member => member.principalId === principalId);
  const ownPubkeys = useMemo(() => new Set(members.find(member => member.principalId === principalId)?.pubkeys ?? []),
    [members, principalId]);
  // DD-125(1): the original thread follow (MessageThreadPanel head action) over Core
  // CollaborationUserState. The head shows isNotifiedForThread: an explicit follow, or the
  // original implicit interest (authored, replied or mentioned) unless the thread is muted.
  const preferences = useCollaborationPreferences();
  const implicitInterest = rows.some(row => ownPubkeys.has(row.signerPubkey ?? "") ||
    (row.tags ?? []).some(tag => tag[0] === "p" && ownPubkeys.has(tag[1] ?? "")));
  const threadFollowAvailable = Boolean(preferences?.writable) && !unavailable && !interrupted && !loading;
  const isFollowingThread = preferences?.isNotifiedForThread(rootId, implicitInterest) === true;
  const followThread = useCallback(() => { void preferences?.followThread(rootId); }, [preferences, rootId]);
  const unfollowThread = useCallback(() => { void preferences?.unfollowThread(rootId); }, [preferences, rootId]);
  // Original useStableSendToChannel + canSendMessageToChannel: settled kind 9 replies of the
  // viewer or of an Agent they own. Core re-reads the reply and decides (DD-125(1), DD-81).
  const sendToChannel = useSendToChannelIntent(useCallback((sourceEventId: string, key: string) =>
    publishSendToChannel(conversation ? { conversationId: conversation.id } : { workspaceId }, sourceEventId, key),
  [conversation, workspaceId]));
  const memberActive = conversation
    ? conversation.state === "ACTIVE" && conversation.channelId === channelId && conversation.participantPrincipalIds.includes(principalId) && Boolean(currentMember)
    : currentMember && "state" in currentMember && currentMember.state === WorkspaceMembershipState.Active;
  const canReply = !disabled && !unavailable && !interrupted && !loading &&
    rows.some((row) => row.id === replyId) && Boolean(memberActive);
  const canEdit =
    canReply &&
    Boolean(editAuthorPubkey) &&
    Boolean(currentMember?.pubkeys.includes(editAuthorPubkey!));
  const canSaveEdit = Boolean(
    editTarget &&
      canEdit &&
      rows.some(
        (row) =>
          row.id === editTarget.id && row.kind === 9 && row.signerPubkey === editAuthorPubkey,
      ),
  );
  const handleSendingChange = useCallback(
    (sending: boolean) => {
      setIsSending(sending);
      if (editTarget) onEditSendingChange?.(sending);
    },
    [editTarget, onEditSendingChange],
  );
  const handleSelectReplyTarget = useCallback(
    (message: TimelineMessage) => {
      setReplyId((current) => (current === message.id ? rootId : message.id));
      onCancelEdit?.();
    },
    [onCancelEdit, rootId],
  );
  const { handleEditLastOwnThreadMessage } = useRoutedMessageEdit({
    activeChannelId: JSON.stringify([principalId, workspaceId]),
    channelIsCovered: false,
    currentPubkey: editAuthorPubkey,
    editTarget: editTarget ? {id: editTarget.id, isThreadReply: isThreadReply(editTarget.tags ?? [])} : null,
    isSinglePanelView: false,
    mainMessages: rows.filter(row => !row.parentId && row.kind === 9),
    onCloseThread: onClose,
    onEdit: canEdit && !editBusy && onEdit ? (message) => {if (onEdit(message) !== false) setReplyId(rootId);} : undefined,
    threadHeadMessage: data.threadHead?.kind === 9 ? data.threadHead : undefined,
    threadMessages: rows.filter(row => row.parentId !== null && row.parentId !== undefined && row.kind === 9),
    useFocusThreadDrawer: isFocusMode,
  });
  const headerLeading = useSplitAuxiliaryPane
    ? <ThreadViewModeToggle onChange={changeThreadViewMode} /> : undefined;
  const panelLayout = {...getThreadPanelLayout({headerLeading,isFocusDrawer:isFocusMode,isSinglePanelView:false,useSplitAuxiliaryPane}), onClose, widthPx: width.widthPx,
    onResizeStart: width.onResizeStart, onResetWidth: width.onResetWidth, canResetWidth: width.canReset};
  // Presentation changes cannot unmount a composer holding an uncertain write.
  const wrapThreadPanel = (panel: ReactNode) =>
      <RightAuxiliaryPane active={useSplitAuxiliaryPane && !isFocusMode} canResetWidth={width.canReset} onResetWidth={width.onResetWidth}
        onResizeStart={width.onResizeStart} testId="message-thread-panel" widthPx={width.widthPx}>
        {panel}
      </RightAuxiliaryPane>;
  if (denied || !data.threadHead) {
    if (!unavailable) return wrapThreadPanel(<MessageThreadPanelSkeleton {...panelLayout} />);
    return wrapThreadPanel(<AuxiliaryPanel {...panelLayout}
      header={<MessageThreadPanelHeader headerLeading={headerLeading} isFocusMode={isFocusMode} isSinglePanelView={panelLayout.isSinglePanelView ?? false} onClose={onClose} />}>
      <ThreadRepliesErrorCard onRetry={denied ? undefined : () => {void thread.refetch();}} />
    </AuxiliaryPanel>);
  }
  return wrapThreadPanel(<BffVideoReviewProvider Composer={Composer} mentionPeople={mentionPeopleFromMembers(members)} principalId={principalId} workspaceId={workspaceId} conversationId={conversation?.id} channelName={channelName} channelType={conversation ? "dm" : "stream"}
    messages={rows} available={canReply} onToggleReaction={messageReactions.onToggleReaction} resolveMediaUrl={messageReactions.resolveMediaUrl} refresh={refresh}>
    <ThreadPanelSurface {...panelLayout} channelId={workspaceId} channelName={channelName}
    profiles={profiles} currentPubkey={editAuthorPubkey}
    threadTypingPubkeys={canReply ? typingEntries.filter(entry => entry.threadHeadId === data.threadHead?.id && !profiles?.[entry.pubkey]?.isAgent).map(entry => entry.pubkey) : []}
    disabled={!canReply} isSending={isSending} threadHead={data.threadHead} threadReplies={data.visibleReplies}
    replyTargetMessage={data.replyTargetMessage} scrollTargetId={layoutScrollTargetId ?? scrollTargetId}
    scrollTargetHighlights={!layoutScrollTargetId}
    searchMessageId={searchMessageId} searchQuery={searchQuery}
    onScrollTargetResolved={resolveScrollTarget} onScrollTargetSettled={resolveScrollTarget} onCancelReply={() => setReplyId(rootId)}
    onSelectReplyTarget={handleSelectReplyTarget}
    onExpandReplies={(message) => setExpanded((prior) => {const next = new Set(prior); if (!next.delete(message.id)) next.add(message.id); return next;})}
    threadRepliesPending={loading} threadRepliesError={unavailable}
    onRetryThreadReplies={denied ? undefined : () => {void thread.refetch();}}
    renderRow={(row) => <MessageRowSurface {...row} layoutVariant="thread-reply"
      agentMentionStatus={renderAgentMentionStatus?.(row.message)}
      reference={<SentFromThreadLine channelId={channelId} tags={row.message.tags}
        renderLink={(link, threadExcerpt) => <SentFromThreadLink link={link}
          channelLabel={channelName || link.channelId.slice(0, 8)} threadExcerpt={threadExcerpt}
          interactive={!unavailable && !interrupted && Boolean(onOpenMessageLink)} onOpenMessageLink={onOpenMessageLink} />} />}
      onToggleReaction={messageReactions.onToggleReaction} customEmoji={messageReactions.customEmoji}
      reactionScope={messageReactions.reactionScope} resolveMediaUrl={messageReactions.resolveMediaUrl}
      renderIdentity={row.message.pubkey && !unavailable && !interrupted ? (node,kind) => {
        const target={principalId,workspaceId,conversationId:conversation?.id,eventId:row.message.id,pubkey:row.message.pubkey!};
        const identity=kind === "avatar" ? <div className="relative shrink-0"><MessageAuthorAvatar target={target}
          profile={{value:authorLabel.profile(row.message.id)}}
          accent={row.message.accent} className="shrink-0" displayName={row.message.author}
          shape={row.message.isAgent ? "squircle" : "circle"} testId="message-avatar" /></div>
          : node;
        return onOpenAuthor ? <MessageAuthorIdentity target={target} onOpen={() => onOpenAuthor(row.message)}>{identity}</MessageAuthorIdentity> : identity;
      } : undefined}
      renderBody={(className) => <div className={className}><MessageContent messageId={row.message.id} workspaceId={workspaceId} conversationId={conversation?.id} content={row.message.body} mediaTags={row.message.tags}
        searchQuery={row.searchQuery}
        mentions={unavailable || interrupted || disabled ? mentions.map(({renderProfile: _profile, ...mention}) => mention) : mentions} /></div>}
      renderActions={(ref,reactions) => <MessageActionBarSurface ref={ref} {...reactions} message={row.message} onCopyMessage={onCopyMessage}
        onCopyLink={onCopyLink} moderation={moderation}
        isFollowingThread={row.message.id === rootId ? isFollowingThread : undefined}
        onFollowThread={row.message.id === rootId && threadFollowAvailable && !isFollowingThread ? followThread : undefined}
        onUnfollowThread={row.message.id === rootId && threadFollowAvailable && isFollowingThread ? unfollowThread : undefined}
        onSendToChannel={row.message.id !== rootId && !disabled && !unavailable && !interrupted && Boolean(memberActive) &&
          canSendMessageToChannel(row.message, ownPubkeys, ownedAgentPubkeys) ? sendToChannel : undefined}
        isUnread={isMessageUnread?.(row.message)}
        onMarkRead={!disabled && !unavailable && !interrupted && !loading && onMarkRead ? message => onMarkRead(message, rows) : undefined}
        onMarkUnread={!disabled && !unavailable && !interrupted && !loading && onMarkUnread ? message => onMarkUnread(message, rows) : undefined}
        onDelete={canEdit && !editBusy && row.message.kind === 9 && row.message.signerPubkey === editAuthorPubkey ? onDelete : undefined}
        onEdit={canEdit && !editBusy && onEdit && row.message.kind === 9 && row.message.signerPubkey === editAuthorPubkey
          ? (message) => {if (onEdit(message) !== false) setReplyId(rootId);} : undefined}
        onReply={canReply ? handleSelectReplyTarget : undefined} />} />}
    renderComposer={(composer) => <Composer key={editTarget ? `edit:${editTarget.id}` : replyId} workspaceId={conversation ? undefined : workspaceId} draftIdentity={principalId}
      channelType={conversation ? "dm" : "stream"}
      onUpload={conversation ? (file, options) => uploadConversationMedia(conversation.id, file, options) : undefined}
      onMediaUrl={conversation ? hash => mediaUrl(workspaceId, hash, conversation.id) : undefined}
      audienceContext={editTarget || !data.threadHead?.tags ? null : {type: "thread", rootTags: data.threadHead.tags}}
      editTarget={editTarget ?? undefined} onCancelEdit={onCancelEdit}
      onRequestEmptyEditDelete={onRequestEmptyEditDelete}
      onEditLastOwnMessage={handleEditLastOwnThreadMessage}
      onConfirmed={editTarget ? () => onEditConfirmed?.(editTarget) : undefined}
      mentionPeople={mentionPeopleFromMembers(members)}
      draftKey={editTarget ? `edit:${workspaceId}:${editTarget.id}` : restoredDraft?.replyId === replyId ? restoredDraft.key : `thread:${workspaceId}:${rootId}:${replyId}`}
      autoSendDraftKey={autoSendDraftKey} onAutoSendConsumed={onAutoSendConsumed}
      draftChannelId={restoredDraft?.replyId === replyId ? restoredDraft.scope : workspaceId} disabled={composer.disabled || Boolean(editTarget && !canSaveEdit)}
      onSendingChange={handleSendingChange}
      onTyping={editTarget ? undefined : notifyThreadTyping}
      containerClassName={composer.containerClassName} layoutMode="dock"
      replyTarget={editTarget ? null : composer.replyTarget} onCancelReply={editTarget ? undefined : composer.onCancelReply}
      placeholder={t("thread.replyTo", {author: data.threadHead!.author})}
      onPublish={async (content, attachments, idempotencyKey, installations, mentionPubkeys) => {
        if (!canReply || (editTarget && !canSaveEdit)) throw new Error("Thread admission is unavailable");
        const receipt = await (conversation
          ? publishConversationMessage(conversation.id, content, attachments, idempotencyKey, editTarget?.id, editTarget ? undefined : replyId, mentionPubkeys)
          : publishMessage(workspaceId, content, attachments, idempotencyKey, installations,
            editTarget ? {editEventId: editTarget.id, mentionPubkeys} : {messageType: WebMessageType.Stream, parentEventId: replyId, mentionPubkeys}));
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Reply has no confirmed receipt.");
        void refresh(); return receipt;
      }} />}
  /></BffVideoReviewProvider>);
}
