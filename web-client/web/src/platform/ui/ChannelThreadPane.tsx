import { WorkspaceMembershipState, WebMessageType, type WorkspaceMemberView } from "@client-kit/contracts";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { ThreadPanelSurface, MessageThreadPanelSkeleton, ThreadRepliesErrorCard, AuxiliaryPanel, MessageThreadPanelHeader, useThreadPanelWidth, buildThreadPanelData, getThreadRouteTarget, useRoutedMessageEdit } from "@client-kit/platform/react/thread";
import { MessageRowSurface, MessageActionBarSurface, getThreadReference, isThreadReply, type TimelineMessage } from "@client-kit/platform/react/messages";
import { relativeTime, truncatePubkey } from "@client-kit/platform/format";
import { TransportError } from "@client-kit/platform/transport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageContent, type MessageMention } from "@/features/chat/ui/MessageContent";
import { publishMessage } from "@/platform/bff-client";
import { Composer, mentionPeopleFromMembers } from "./ChannelPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { MessageAuthorAvatar, MessageAuthorIdentity } from "./MessageAuthorProfile";
import { getThreadPanelLayout } from "@client-kit/platform/react/thread/threadPanelLayout";
import { useMessageReactions } from "./useMessageReactions";

export function ChannelThreadPane({ workspaceId, principalId, selected, routeTargetMessageId, members, mentions = [], disabled, onClose, onCopyMessage, onCopyLink, onOpenAuthor, onAuthorScopeUnavailable, isFocusMode = false, channelName = "", editTarget, editAuthorPubkey, editBusy = false, onEdit, onCancelEdit, onEditConfirmed, onEditSendingChange, onDelete, onRequestEmptyEditDelete, isMessageUnread, onMarkRead, onMarkUnread }: {
  workspaceId: string; principalId: string; selected: TimelineMessage; members: WorkspaceMemberView[];
  routeTargetMessageId?: string;
  disabled: boolean; onClose: () => void; onCopyMessage: (message: TimelineMessage) => void;
  onCopyLink?: (message: TimelineMessage) => void;
  onOpenAuthor?: (message: TimelineMessage) => void;
  onAuthorScopeUnavailable?: () => void;
  isFocusMode?: boolean;
  channelName?: string;
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
}) {
  const t = useT(); const locale = useLocale();
  const rootId = getThreadReference(selected.tags ?? []).rootId ?? selected.id;
  const {thread, messages, reactionEvents, denied, interrupted, refresh} = useWorkspaceThread(principalId, workspaceId, rootId);
  const messageReactions = useMessageReactions({principalId,workspaceId,events:reactionEvents ?? messages,
    available:!disabled && !denied && !interrupted && thread.isSuccess && !thread.isError,refresh});
  const [replyId, setReplyId] = useState(routeTargetMessageId ? rootId : selected.id);
  const [isSending, setIsSending] = useState(false);
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(routeTargetMessageId === rootId ? null : routeTargetMessageId ?? selected.id);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([selected.id]));
  const expandedTarget = useRef<string | null>(null);
  useEffect(() => { setReplyId(routeTargetMessageId ? rootId : selected.id); setScrollTargetId(routeTargetMessageId === rootId ? null : routeTargetMessageId ?? selected.id); expandedTarget.current = null; }, [selected.id, routeTargetMessageId, rootId]);
  const width = useThreadPanelWidth();
  // Native getThreadReplies traverses the original Relay cursor until complete.
  // Web traverses that same bounded server window, never inventing a time fence.
  useEffect(() => {
    if (!denied && !thread.isError && thread.hasNextPage && !thread.isFetchingNextPage) void thread.fetchNextPage();
  }, [denied, thread.hasNextPage, thread.isFetchingNextPage, thread.isError, thread.fetchNextPage]);
  const rows = useMemo(() => messages.map((event): TimelineMessage => {
    const edge = getThreadReference(event.tags);
    return {id: event.id, pubkey: event.pubkey, signerPubkey: event.pubkey, kind: event.kind, createdAt: event.createdAt,
      author: members.find((member) => member.pubkeys.includes(event.pubkey))?.displayName || truncatePubkey(event.pubkey),
      body: event.content, tags: event.tags, rootId: edge.rootId, parentId: edge.parentId, depth: 0, reactions:messageReactions.reactions.get(event.id),
      time: relativeTime(locale, new Date(event.createdAt * 1000).toISOString())};
  }), [messages, members, locale, messageReactions.reactions]);
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
  }, [rows, selected.id, routeTargetMessageId]);
  const data = useMemo(() => buildThreadPanelData(rows, rootId, replyId, expanded), [rows, rootId, replyId, expanded]);
  const unavailable = denied || thread.isError || (thread.isSuccess && !data.threadHead);
  useEffect(() => {
    if (unavailable || interrupted) onAuthorScopeUnavailable?.();
  }, [unavailable, interrupted, onAuthorScopeUnavailable]);
  useEffect(() => {
    if ((unavailable || interrupted || disabled) && editTarget) onCancelEdit?.();
  }, [unavailable, interrupted, disabled, editTarget, onCancelEdit]);
  const loading = thread.isPending || thread.hasNextPage || thread.isFetchingNextPage;
  const canReply = !disabled && !unavailable && !interrupted && !loading &&
    rows.some((row) => row.id === replyId) &&
    members.some((member) => member.principalId === principalId && member.state === WorkspaceMembershipState.Active);
  const canEdit =
    canReply &&
    Boolean(editAuthorPubkey) &&
    members.some(
      (member) =>
        member.principalId === principalId &&
        member.state === WorkspaceMembershipState.Active &&
        member.pubkeys.includes(editAuthorPubkey!),
    );
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
    useFocusThreadDrawer: false,
  });
  const panelLayout = {...getThreadPanelLayout({isFocusDrawer:isFocusMode,isSinglePanelView:false,useSplitAuxiliaryPane:false}), onClose, widthPx: width.widthPx,
    onResizeStart: width.onResizeStart, onResetWidth: width.onResetWidth, canResetWidth: width.canReset};
  if (denied || !data.threadHead) {
    if (!unavailable) return <MessageThreadPanelSkeleton {...panelLayout} />;
    return <AuxiliaryPanel {...panelLayout}
      header={<MessageThreadPanelHeader isFocusMode={isFocusMode} isSinglePanelView={panelLayout.isSinglePanelView ?? false} onClose={onClose} />}>
      <ThreadRepliesErrorCard onRetry={denied ? undefined : () => {void thread.refetch();}} />
    </AuxiliaryPanel>;
  }
  return <ThreadPanelSurface {...panelLayout} channelId={workspaceId} channelName={channelName}
    disabled={!canReply} isSending={isSending} threadHead={data.threadHead} threadReplies={data.visibleReplies}
    replyTargetMessage={data.replyTargetMessage} scrollTargetId={scrollTargetId}
    onScrollTargetResolved={() => setScrollTargetId(null)} onCancelReply={() => setReplyId(rootId)}
    onSelectReplyTarget={handleSelectReplyTarget}
    onExpandReplies={(message) => setExpanded((prior) => {const next = new Set(prior); if (!next.delete(message.id)) next.add(message.id); return next;})}
    threadRepliesPending={loading} threadRepliesError={unavailable}
    onRetryThreadReplies={denied ? undefined : () => {void thread.refetch();}}
    renderRow={(row) => <MessageRowSurface {...row} layoutVariant="thread-reply"
      onToggleReaction={messageReactions.onToggleReaction} customEmoji={messageReactions.customEmoji}
      reactionScope={messageReactions.reactionScope} resolveMediaUrl={messageReactions.resolveMediaUrl}
      renderIdentity={row.message.pubkey && !unavailable && !interrupted ? (node,kind) => {
        const target={principalId,workspaceId,eventId:row.message.id,pubkey:row.message.pubkey!};
        const identity=kind === "avatar" ? <div className="relative shrink-0"><MessageAuthorAvatar target={target}
          accent={row.message.accent} className="shrink-0" displayName={row.message.author} testId="message-avatar" /></div> : node;
        return onOpenAuthor ? <MessageAuthorIdentity target={target} onOpen={() => onOpenAuthor(row.message)}>{identity}</MessageAuthorIdentity> : identity;
      } : undefined}
      renderBody={(className) => <div className={className}><MessageContent workspaceId={workspaceId} content={row.message.body} mediaTags={row.message.tags}
        mentions={unavailable || interrupted || disabled ? mentions.map(({renderProfile: _profile, ...mention}) => mention) : mentions} /></div>}
      renderActions={(ref,reactions) => <MessageActionBarSurface ref={ref} {...reactions} message={row.message} onCopyMessage={onCopyMessage}
        onCopyLink={onCopyLink}
        isUnread={isMessageUnread?.(row.message)}
        onMarkRead={!disabled && !unavailable && !interrupted && !loading && onMarkRead ? message => onMarkRead(message, rows) : undefined}
        onMarkUnread={!disabled && !unavailable && !interrupted && !loading && onMarkUnread ? message => onMarkUnread(message, rows) : undefined}
        onDelete={canEdit && !editBusy && row.message.kind === 9 && row.message.signerPubkey === editAuthorPubkey ? onDelete : undefined}
        onEdit={canEdit && !editBusy && onEdit && row.message.kind === 9 && row.message.signerPubkey === editAuthorPubkey
          ? (message) => {if (onEdit(message) !== false) setReplyId(rootId);} : undefined}
        onReply={canReply ? handleSelectReplyTarget : undefined} />} />}
    renderComposer={(composer) => <Composer key={editTarget ? `edit:${editTarget.id}` : replyId} workspaceId={workspaceId} draftIdentity={principalId}
      editTarget={editTarget ?? undefined} onCancelEdit={onCancelEdit}
      onRequestEmptyEditDelete={onRequestEmptyEditDelete}
      onEditLastOwnMessage={handleEditLastOwnThreadMessage}
      onConfirmed={editTarget ? () => onEditConfirmed?.(editTarget) : undefined}
      mentionPeople={mentionPeopleFromMembers(members)}
      draftKey={editTarget ? `edit:${workspaceId}:${editTarget.id}` : `thread:${workspaceId}:${rootId}:${replyId}`}
      draftChannelId={workspaceId} disabled={composer.disabled || Boolean(editTarget && !canSaveEdit)}
      onSendingChange={handleSendingChange}
      containerClassName={composer.containerClassName} layoutMode="dock"
      replyTarget={editTarget ? null : composer.replyTarget} onCancelReply={editTarget ? undefined : composer.onCancelReply}
      placeholder={t("thread.replyTo", {author: data.threadHead!.author})}
      onPublish={async (content, attachments, idempotencyKey, installations, mentionPubkeys) => {
        if (!canReply || (editTarget && !canSaveEdit)) throw new Error("Thread admission is unavailable");
        const receipt = await publishMessage(workspaceId, content, attachments, idempotencyKey, installations,
          editTarget ? {editEventId: editTarget.id, mentionPubkeys} : {messageType: WebMessageType.Stream, parentEventId: replyId, mentionPubkeys});
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Reply has no confirmed receipt.");
        void refresh(); return receipt;
      }} />}
  />;
}
