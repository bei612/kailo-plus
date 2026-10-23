import { InboxEmptyDetail } from "@client-kit/platform/react/inbox-surface";
import { InboxDetailFrame } from "@client-kit/platform/react/inbox/InboxDetailFrame";
import { InboxDetailMessages } from "@client-kit/platform/react/inbox-detail-messages";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { useChannelMessageEdit } from "@client-kit/platform/react/thread";
import { useMessageDeleteDialog } from "@client-kit/platform/react/messages";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { classifyRelayPublishFailure } from "@/shared/api/relayPublishOutcome";
import * as React from "react";

import type {
  InboxContextMessage,
  InboxItem,
  InboxReply,
} from "@/features/home/lib/inbox";
import { formatInboxTypeLabel } from "@/features/home/lib/inbox";
import {
  hasInboxThreadContext,
  toTimelineMessage,
} from "@/features/home/lib/inboxViewHelpers";
import {
  type InboxDisplayMessage,
  InboxMessageRow,
} from "@/features/home/ui/InboxMessageRow";
import { DesktopAgentAuthorFacts } from "@/features/messages/ui/DesktopAgentAuthorFacts";
import type { TimelineMessage } from "@/features/messages/types";
import { formatTime } from "@/features/messages/lib/dateFormatters";
import {
  buildVideoReviewPresentationByMessageId,
  hasRenderedVideoAttachment,
} from "@/features/messages/lib/videoReviewContext";
import { getThreadReference } from "@/features/messages/lib/threading";
import { handleTimelineMentionCopy } from "@/features/messages/lib/timelineMentionCopy";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import type { UserProfileSummary } from "@/shared/api/types";
import { VideoReviewNavigationProvider } from "@/shared/ui/VideoReviewNavigation";

const EMPTY_CONTEXT_MESSAGES: InboxContextMessage[] = [];
const EMPTY_REPLIES: InboxReply[] = [];

type InboxDetailPaneProps = {
  canReply: boolean;
  editScopeKey: string;
  canManageMessages: boolean;
  onEditSave: (message: TimelineMessage, content: string, mentions: string[], media: string[][]) => Promise<void>;
  onDeleteMessage: (message: TimelineMessage) => Promise<void>;
  currentPubkey?: string;
  onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
  disabledReplyReason?: string | null;
  isSendingReply?: boolean;
  isSinglePanelView?: boolean;
  hasThreadContextLoadError?: boolean;
  isThreadContextLoading?: boolean;
  item: InboxItem | null;
  messages?: InboxContextMessage[];
  profiles?: Record<string, UserProfileSummary>;
  replies?: InboxReply[];
  contextChannelName?: string | null;
  /**
   * The event anchor: the specific event ID the user selected or navigated to
   * via `?item=`. Used for message highlighting and as the stable identity for
   * scroll/focus effects. Does NOT change when a live reply advances the
   * representative `item.id`.
   */
  selectedEventId: string | null;
  unreadBoundaryEventId?: string | null;
  /**
   * The default reply-parent event ID derived from the latched anchor's tags
   * in HomeView (`parentId ?? anchor.id`). Populated once the anchor is found
   * in feedItems and held until a new anchor is selected. Used as fallback
   * when the anchor event has been displaced from the current `groupItems`
   * (e.g. a very old anchor evicted by a newer representative).
   */
  latchedDefaultParentId?: string | null;
  onBack?: () => void;
  canOpenContext?: boolean;
  /** Original header reopen chip (home-inbox-reopen-status) for this context's hidden-DM reopen. */
  reopenStatus?: { pending: boolean; error: boolean; unknown?: boolean };
  /** Original header ChannelMembersBar for the context channel (host-resolved roster). */
  headerActions?: React.ReactNode;
  onOpenContext: (
    channelId: string,
    messageId: string,
    threadRootId?: string | null,
  ) => void;
  onSendReply: (input: {
    content: string;
    mediaTags?: string[][];
    mentionPubkeys: string[];
    parentEventId: string | null;
  }) => Promise<void>;
};

export function InboxDetailPane(props: InboxDetailPaneProps) {
  return (
    <VideoReviewNavigationProvider>
      <InboxMessageDetailPane {...props} />
    </VideoReviewNavigationProvider>
  );
}

function InboxMessageDetailPane({
  canReply,
  editScopeKey, canManageMessages, onEditSave, onDeleteMessage,
  currentPubkey,
  onToggleReaction,
  disabledReplyReason,
  isSendingReply = false,
  hasThreadContextLoadError = false,
  isThreadContextLoading = false,
  item,
  messages = EMPTY_CONTEXT_MESSAGES,
  profiles,
  replies = EMPTY_REPLIES,
  contextChannelName = null,
  selectedEventId,
  unreadBoundaryEventId = null,
  latchedDefaultParentId = null,
  onBack,
  canOpenContext = true,
  reopenStatus,
  headerActions,
  onOpenContext,
  onSendReply,
}: InboxDetailPaneProps) {
  const t = useT();
  const locale = useLocale();
  const detailPaneRef = React.useRef<HTMLElement | null>(null);
  const currentHeaderDelete = React.useRef<(() => void) | undefined>(undefined);
  currentHeaderDelete.current = undefined;
  const [replyTargetId, setReplyTargetId] = React.useState<string | null>(null);
  const {editTarget, setEditTarget, handleCancelEdit}=useChannelMessageEdit<TimelineMessage>(editScopeKey);
  const owner=React.useMemo(()=>({active:true}),[editScopeKey]);
  React.useEffect(()=>{owner.active=true;return()=>{owner.active=false;};},[owner]);
  const [editState,setEditState]=React.useState<{owner:object;pending:boolean;unknown:boolean}|null>(null);
  const editing=editState?.owner===owner&&editState.pending;
  const unresolved=editState?.owner===owner&&editState.unknown;
  const canEdit=(message:TimelineMessage)=>canManageMessages&&!hasThreadContextLoadError&&!isThreadContextLoading&&[9,45001,45003].includes(message.kind??0)&&!message.pending&&message.signerPubkey===currentPubkey;
  const deleteDialog=useMessageDeleteDialog(editScopeKey,canManageMessages&&!editing&&!unresolved&&!isSendingReply,
    async message=>{
      if(!canEdit(message))throw new Error(t("inbox.replyUnavailable"));
      try {await onDeleteMessage(message);} catch(error) {
        if(classifyRelayPublishFailure(error)?.kind==="outcomeUnknown")throw new TransportError(t("platform.sendUnknown",{operation:""}));
        throw error;
      }
    },message=>setEditTarget(current=>current?.id===message.id?null:current));
  const saveEdit=async(content:string,mentions:string[],media:string[][]=[])=>{
    if(!editTarget||!canEdit(editTarget)||editing||deleteDialog.pending||deleteDialog.unresolvedMessageId)throw new Error(t("inbox.replyUnavailable"));
    const captured=editTarget;
    setEditState({owner,pending:true,unknown:Boolean(unresolved)});
    try {
      await onEditSave(captured,content,mentions,media);
      if(owner.active){setEditState(null);setEditTarget(current=>current?.id===captured.id?null:current);}
    } catch(error) {
      const outcome=classifyRelayPublishFailure(error);
      const unknown=isOutcomeUnknown(error)||outcome?.kind==="outcomeUnknown"||(unresolved&&outcome?.kind!=="rejected");
      if(owner.active)setEditState({owner,pending:false,unknown:Boolean(unknown)});
      if(unknown&&!isOutcomeUnknown(error))throw new TransportError(t("platform.sendUnknown",{operation:""}));
      throw error;
    }
  };
  // The stable conversation ID: does not change when the representative latest
  // event advances. All lifecycle effects (reply target reset, focus highlight,
  // scroll centering) key on this.
  const conversationId = item?.conversationId ?? null;
  // Build the plain, non-virtualized timeline the shared hook anchors against.
  // Live arrivals rerun its layout compensation without changing the target.

  const displayMessages = React.useMemo<InboxDisplayMessage[]>(() => {
    const selectedMessage = messages.find((message) => message.isSelected);
    const pendingReplyMessages: InboxDisplayMessage[] = replies.map(
      (reply) => ({
        ...reply,
        depth: reply.depth ?? (selectedMessage?.depth ?? 0) + 1,
        isSelected: false,
        mentionNames: [],
      }),
    );

    if (messages.length > 0) {
      return [...messages, ...pendingReplyMessages];
    }
    if (!item) return pendingReplyMessages;

    const threadReference = getThreadReference(item.item.tags);
    return [
      {
        authorLabel: item.senderLabel,
        authorPubkey: item.item.pubkey,
        avatarUrl: item.avatarUrl,
        content: item.preview,
        createdAt: item.item.createdAt,
        depth: 0,
        fullTimestampLabel: item.fullTimestampLabel,
        id: item.id,
        isSelected: true,
        mentionNames: item.mentionNames,
        mentionPubkeysByName: item.mentionPubkeysByName,
        parentId: threadReference.parentId,
        rootId: threadReference.rootId,
        tags: item.item.tags,
        timeLabel: formatTime(item.item.createdAt),
      },
      ...pendingReplyMessages,
    ];
  }, [item, messages, replies]);
  const videoReviewMessages = React.useMemo(
    () => displayMessages.map(toTimelineMessage),
    [displayMessages],
  );
  const handleSendVideoReviewComment = React.useCallback(
    (
      message: TimelineMessage,
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      parentEventId?: string,
    ) =>
      onSendReply({
        content,
        mediaTags,
        mentionPubkeys,
        parentEventId: parentEventId ?? message.id,
      }),
    [onSendReply],
  );
  const videoReviewPresentation = React.useMemo(
    () =>
      buildVideoReviewPresentationByMessageId(
        {
          channelId: item?.item.channelId,
          channelName: contextChannelName ?? item?.channelLabel ?? undefined,
          channelType: item?.item.channelType === "stream" || item?.item.channelType === "forum" || item?.item.channelType === "dm" ? item.item.channelType : null,
          isSendingVideoReviewComment: isSendingReply,
          messages: videoReviewMessages,
          onSendVideoReviewComment: canReply
            ? handleSendVideoReviewComment
            : undefined,
          onToggleReaction,
          profiles,
        },
        hasRenderedVideoAttachment,
      ),
    [
      canReply,
      contextChannelName,
      handleSendVideoReviewComment,
      isSendingReply,
      onToggleReaction,
      item,
      profiles,
      videoReviewMessages,
    ],
  );
  const focusComposer = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const textarea =
        detailPaneRef.current?.querySelector<HTMLTextAreaElement>(
          '[data-testid="message-input"]',
        );
      textarea?.focus();
    });
  }, []);

  React.useEffect(() => {
    void conversationId;
    setReplyTargetId(null);
  }, [conversationId]);
  const editConversation=React.useRef(conversationId);
  React.useEffect(()=>{
    if(editConversation.current!==conversationId&&!editing&&!unresolved){editConversation.current=conversationId;handleCancelEdit();}
  },[conversationId,editing,unresolved,handleCancelEdit]);

  // Capture the default composer reply parent from the selected-event anchor
  // when the conversation first opens (or when the user explicitly navigates
  // to a different event anchor). Reset only when conversationId/selectedEventId
  // changes so that a live incoming message does not silently retarget the
  // in-progress reply, preserving PR #1714 same-depth semantics.
  //
  // Design: no render-phase ref mutations. `item` and `latchedDefaultParentId`
  // are explicit deps. A committed ref (`parentCapturedRef`) written only inside
  // effects prevents live-update re-runs from overwriting a value that was
  // already captured for the current (conversationId, selectedEventId) pair.
  const [capturedDefaultParentId, setCapturedDefaultParentId] = React.useState<
    string | null
  >(null);
  // Written only inside committed effects — never during render.
  const parentCapturedRef = React.useRef(false);

  // Reset when the user navigates to a different conversation or event anchor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: parentCapturedRef is a ref (not a reactive value); conversationId and selectedEventId are the intentional reset triggers
  React.useEffect(() => {
    parentCapturedRef.current = false;
    setCapturedDefaultParentId(null);
  }, [conversationId, selectedEventId]);

  // Capture the default parent once per (conversation, anchor) pair. The effect
  // also fires when `item` or `latchedDefaultParentId` changes, but the
  // `parentCapturedRef` guard prevents overwriting a value that was already
  // resolved for the current anchor. The one exception: when the anchor is not
  // in groupItems and `latchedDefaultParentId` was null on the first run, we
  // defer capture until the latch arrives (parentCapturedRef stays false so
  // the null→resolved transition of latchedDefaultParentId triggers re-capture).
  // biome-ignore lint/correctness/useExhaustiveDependencies: conversationId is derived from item but listed explicitly as a self-documenting reset signal; parentCapturedRef is a ref
  React.useEffect(() => {
    if (parentCapturedRef.current) {
      return;
    }
    if (!item) {
      setCapturedDefaultParentId(null);
      return;
    }
    // Look for the anchored event inside groupItems first (it may be an older
    // non-representative event), then fall back to the representative item.
    const anchoredEvent =
      selectedEventId != null
        ? item.groupItems.find((gi) => gi.id === selectedEventId)
        : null;
    if (anchoredEvent) {
      // Anchor found in groupItems — derive parent from its tags. Mark as
      // captured so live feed advances don't retarget the reply.
      const defaultParent =
        getThreadReference(anchoredEvent.tags).parentId ?? anchoredEvent.id;
      setCapturedDefaultParentId(defaultParent);
      parentCapturedRef.current = true;
      return;
    }
    // Anchor is not in groupItems (evicted from feed window). Use the latched
    // default parent from HomeView, which was captured when the event was still
    // present in feedItems. If the latch is not yet available (null), use the
    // representative fallback but do NOT mark as captured — the null→resolved
    // transition of latchedDefaultParentId will fire this effect again with the
    // correct value.
    if (latchedDefaultParentId != null) {
      setCapturedDefaultParentId(latchedDefaultParentId);
      parentCapturedRef.current = true;
      return;
    }
    // Latch not yet available; install the representative fallback without
    // marking as captured so the true latch value replaces it when it arrives.
    const fallback =
      getThreadReference(item.item.tags ?? []).parentId ?? item.id;
    setCapturedDefaultParentId(fallback);
  }, [conversationId, selectedEventId, item, latchedDefaultParentId]);

  if (!item) return <InboxEmptyDetail />;

  const isDirectMessage = item.item.channelType === "dm";
  const composerChannelType =
    item.item.channelType === "dm" ||
    item.item.channelType === "stream" ||
    item.item.channelType === "forum"
      ? item.item.channelType
      : null;
  const replyTarget =
    displayMessages.find((message) => message.id === replyTargetId) ?? null;
  // Explicit sub-message reply wins. Otherwise use the captured default parent
  // (derived from the selected-event anchor at conversation entry), which does
  // not change when a live incoming message advances the representative item.
  const composerParentEventId =
    replyTarget?.id ?? (isDirectMessage ? null : (capturedDefaultParentId ?? item.id));
  const composerReplyTarget =
    replyTarget && replyTarget.id !== item.id
      ? {
          author: replyTarget.authorLabel,
          body: replyTarget.content,
          id: replyTarget.id,
        }
      : null;
  const channelContextName = contextChannelName ?? item.channelLabel;
  const isThreadContext = !isDirectMessage && hasInboxThreadContext(item, messages);
  const contextLabel = isThreadContext
    ? channelContextName
      ? t("inbox.detailThreadIn", { channel: channelContextName })
      : t("inbox.threadLabel")
    : isDirectMessage
      ? t("inbox.detailDmWith", { sender: item.senderLabel })
      : channelContextName
        ? t("inbox.detailMessageIn", { channel: channelContextName })
        : formatInboxTypeLabel(item, locale);
  const contextChannelId = item.item.channelId;
  const sourceEventId = selectedEventId ?? item.id;
  const contextThreadRootId = isThreadContext ? item.conversationId : null;
  const openContextLabel = isThreadContext
    ? t("inbox.openFullThread")
    : isDirectMessage ? t("inbox.openConversation") : t("inbox.open");
  const headerDeleteTarget = videoReviewMessages.find(message => message.id === sourceEventId);
  const headerDeletePending = Boolean(editing || unresolved || isSendingReply || editTarget || deleteDialog.pending ||
    (deleteDialog.unresolvedMessageId && deleteDialog.unresolvedMessageId !== headerDeleteTarget?.id));
  const requestHeaderDelete: (() => void) | undefined = headerDeleteTarget && canEdit(headerDeleteTarget) ? () => {
    if (!owner.active || currentHeaderDelete.current !== requestHeaderDelete || headerDeletePending) return;
    deleteDialog.requestDelete(headerDeleteTarget);
  } : undefined;
  currentHeaderDelete.current = requestHeaderDelete;

  const handleSelectReplyTarget = (message: InboxDisplayMessage) => {
    if(editing||unresolved||deleteDialog.pending||deleteDialog.unresolvedMessageId)return;
    handleCancelEdit();
    setReplyTargetId((currentReplyTargetId) =>
      currentReplyTargetId === message.id ? null : message.id,
    );
    focusComposer();
  };

  return (
    <InboxDetailFrame
      sectionRef={detailPaneRef}
      headerKey={JSON.stringify([editScopeKey, currentPubkey, sourceEventId])}
      header={{ title: contextLabel, onBack, openLabel: openContextLabel,
        fallbackTitle: item.fullTimestampLabel, deletePending: headerDeletePending, onDelete: requestHeaderDelete,
        onOpen: contextChannelId && canOpenContext ? () => onOpenContext(contextChannelId, sourceEventId, contextThreadRootId) : undefined,
        reopen: reopenStatus ? { ...reopenStatus,
          onRetry: contextChannelId ? () => onOpenContext(contextChannelId, sourceEventId, contextThreadRootId) : undefined } : undefined,
        actions: headerActions }}
      renderMessages={(composerOverlayRef) => <DesktopAgentAuthorFacts channelId={isDirectMessage ? null : contextChannelId}><InboxDetailMessages
          conversationId={conversationId} selectedEventId={selectedEventId}
          messages={videoReviewMessages} unreadBoundaryEventId={unreadBoundaryEventId}
          loading={isThreadContextLoading} contextError={hasThreadContextLoadError}
          composerOverlayRef={composerOverlayRef} onCopy={handleTimelineMentionCopy}
          pending={Boolean(editing || deleteDialog.pending)} unknown={Boolean(unresolved)}
          sending={isSendingReply} unresolvedDeleteId={deleteDialog.unresolvedMessageId}
          canReply={canReply} canManageMessage={canEdit}
          onReply={message => { const target = displayMessages.find(row => row.id === message.id); if (target) handleSelectReplyTarget(target); }}
          onEdit={target => { setEditTarget(current => current?.id === target.id ? null : target); setReplyTargetId(null); focusComposer(); }}
          onDelete={deleteDialog.requestDelete}
          renderMessage={(message, presentation, index) => <InboxMessageRow
            {...presentation} canReply={Boolean(presentation.onReply)}
            currentPubkey={currentPubkey} onToggleReaction={onToggleReaction}
            channelId={item.item.channelId} message={displayMessages[index]}
            onSelectReplyTarget={() => presentation.onReply?.(message)}
            profiles={profiles}
            videoReviewCommentRootId={videoReviewPresentation.commentRootIdsByMessageId.get(message.id)}
            videoReviewContext={videoReviewPresentation.contextsByMessageId.get(message.id)}
          />}
        /></DesktopAgentAuthorFacts>}
      composer={<>
            {editTarget&&canEdit(editTarget) ? <MessageComposer key={`edit:${editTarget.id}`}
              channelId={item.item.channelId} channelType={composerChannelType}
              channelName={item.channelLabel ?? t("inbox.channelFallback")} containerClassName="px-4 pb-4 sm:px-4"
              editTarget={editTarget} profiles={profiles} disabled={!canEdit(editTarget)||deleteDialog.pending||Boolean(deleteDialog.unresolvedMessageId)}
              isSending={Boolean(editing)} onCancelEdit={!editing&&!unresolved?handleCancelEdit:undefined}
              onRequestEmptyEditDelete={deleteDialog.requestDelete} onSend={saveEdit} showBackgroundUploadProgress={false}/> : null}
            <div hidden={Boolean(editTarget)}>
            <MessageComposer
              channelId={item.item.channelId}
              channelType={composerChannelType}
              audienceContext={isDirectMessage ? null : {type: "thread", rootTags: messages.find(message => message.id === item.conversationId)?.tags ?? item.groupItems.find(message => message.id === item.conversationId)?.tags ?? []}}
              channelName={item.channelLabel ?? t("inbox.channelFallback")}
              containerClassName="px-4 pb-4 sm:px-4"
              disabled={!canReply || Boolean(editTarget) || deleteDialog.pending || Boolean(deleteDialog.unresolvedMessageId)}
              draftKey={isDirectMessage ? item.item.channelId ?? item.conversationId : `thread:${item.conversationId}`}
              isSending={isSendingReply}
              onCancelReply={
                composerReplyTarget ? () => setReplyTargetId(null) : undefined
              }
              onSend={(content, mentionPubkeys, mediaTags) =>
                onSendReply({
                  content,
                  mediaTags,
                  mentionPubkeys,
                  parentEventId: composerParentEventId,
                })
              }
              placeholder={
                canReply
                  ? isDirectMessage
                    ? t("composer.dmPlaceholder", { name: item.senderLabel })
                    : item.channelLabel
                      ? t("inbox.replyToChannelThread", { channel: item.channelLabel })
                      : t("inbox.replyToThread")
                  : (disabledReplyReason ??
                    t("inbox.replyUnavailable"))
              }
              replyTarget={composerReplyTarget}
            />
            </div>
      </>}
      dialog={deleteDialog.dialog}
    />
  );
}
