// Host adapter for the original shared Inbox detail surface, not a message store.
import { ReasonCode, WebMessageType, WorkspaceMembershipState, type WorkspaceMemberView, type ConversationView, type ConversationParticipant } from "@client-kit/contracts";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { InboxDetailHeader, InboxMessageRowSurface, useInboxFocusHighlight } from "@client-kit/platform/react/inbox-surface";
import { MessageActionBarSurface, hasSameMessageAuthor, isWithinGroupingWindow, startsNewMessageGroup, useMessageDeleteDialog, type TimelineMessage } from "@client-kit/platform/react/messages";
import { useChannelMessageEdit } from "@client-kit/platform/react/thread";
import { useQuery } from "@tanstack/react-query";
import { buildMentionClipboardHtml } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import { relativeTime } from "@client-kit/platform/format";
import { inboxReply, inboxThread } from "@client-kit/platform/inbox";
import { BffError, isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { bff, deleteMessage, publishMessage, publishConversationMessage, uploadConversationMedia, mediaUrl } from "@/platform/bff-client";
import { Button } from "@/shared/ui/button";
import { Composer, mentionPeopleFromMembers } from "./ChannelPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { MessageAuthorAvatar, MessageAuthorIdentity, useMessageAuthorLabels, type MessageAuthor } from "./MessageAuthorProfile";
import { useMessageReactions } from "./useMessageReactions";
import { BffVideoReviewProvider } from "@/features/chat/ui/BffVideoReview";

export function InboxThreadPane({ principalId, workspaceId, channelId, conversation, canInteract = true, rootId, selectedEventId, selectionItemId, channelName, senderLabel, members, onBack, onOpen, autoSendDraftKey, restoreDraftKey, replyTargetEventId, onOpenAuthor, onAuthorScopeUnavailable, onPublicationPendingChange }: {
  principalId: string; workspaceId: string; rootId: string; selectedEventId: string; channelName: string; senderLabel?: string;
  members: (WorkspaceMemberView | ConversationParticipant)[]; onBack?: () => void; onOpen?: () => void;
  conversation?: ConversationView;
  channelId?: string;
  selectionItemId?: string | null;
  canInteract?: boolean;
  autoSendDraftKey?: string;
  restoreDraftKey?: string;
  replyTargetEventId?: string;
  onOpenAuthor?: (target: MessageAuthor) => void;
  onAuthorScopeUnavailable?: (workspaceId: string) => void;
  onPublicationPendingChange?: (pending: boolean) => void;
}) {
  const t = useT(); const locale = useLocale();
  const [selection, setSelection] = useState({ anchor: selectedEventId, root: rootId });
  const { anchor, root: anchorRoot } = selection;
  const isFocusHighlightVisible = useInboxFocusHighlight(anchorRoot);
  const replyParent = useRef<string | null>(null);
  const [replyId, setReplyId] = useState<string | null>(replyTargetEventId ?? null);
  const [sending, setSending] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const publication = useRef<{ key: string; parent: string | null; unknown: boolean; edit?: boolean } | null>(null);
  const { editTarget, setEditTarget, handleCancelEdit } = useChannelMessageEdit<TimelineMessage>(JSON.stringify([principalId, conversation?.id ?? workspaceId]));
  const ownProfile = useQuery({queryKey:["platform", "edit-author", principalId], queryFn:()=>bff.profile()});
  const editOwner=useMemo(()=>({active:true}),[principalId,conversation?.id,workspaceId]);
  const editOwnerRef=useRef(editOwner);editOwnerRef.current=editOwner;
  useEffect(()=>{editOwner.active=true;return()=>{editOwner.active=false;};},[editOwner]);
  const composerContainer = useRef<HTMLDivElement>(null);
  const { thread, messages, contextIds, reactionEvents, denied, interrupted, refresh } = useWorkspaceThread(principalId, workspaceId, anchorRoot, conversation?.id, conversation ? anchor : undefined, true, conversation?.channelId ?? channelId);
  const messageReactions = useMessageReactions({principalId,workspaceId,conversationId:conversation?.id,events:reactionEvents ?? messages,
    available:canInteract && !denied && !interrupted && thread.isSuccess && !thread.isError,refresh});
  const scroller = useRef<HTMLDivElement>(null);
  const reached = useRef(false);
  // Selection is not publication ownership. Keep the original composer and
  // parent while a send is in flight or UNKNOWN; a URL/history change must not
  // discard that intent. Once confirmed/rejected, apply the latest selection.
  const changingSelection = selectionItemId === selectedEventId && (anchor !== selectedEventId || anchorRoot !== rootId) && !sending && !unresolved && !publication.current;
  if (changingSelection) {
    setSelection({ anchor: selectedEventId, root: rootId });
    setReplyId(replyTargetEventId ?? null);
    setEditTarget(null);
    replyParent.current = null;
    reached.current = false;
  }
  const anchoredMessage = messages.find((message) => message.id === anchor);
  // Original Inbox replies beside the selected event unless an explicit row
  // reply target is chosen. Latch once; live feed updates cannot retarget it.
  if (!changingSelection && replyParent.current === null && anchoredMessage) replyParent.current = inboxThread(anchoredMessage.tags).parentId ?? anchor;
  useEffect(() => {
    if (reached.current) return;
    const target = scroller.current?.querySelector(`[data-message-id="${anchor}"]`);
    if (target) { target.scrollIntoView({ block: "center" }); reached.current = true; }
    else if (thread.hasNextPage && !thread.isFetchingNextPage && !thread.isError) void thread.fetchNextPage();
  }, [anchor, messages.length, thread.hasNextPage, thread.isFetchingNextPage, thread.isError, thread.fetchNextPage]);
  const unavailable = denied || thread.isError || (thread.isSuccess && !messages.some((event) => event.id === (conversation ? anchor : anchorRoot)));
  const authorLabel = useMessageAuthorLabels({principalId, workspaceId, conversationId: conversation?.id}, messages,
    !unavailable && !interrupted && thread.isSuccess);
  const rows: TimelineMessage[] = messages.map(event => ({id: event.id, pubkey: event.pubkey, signerPubkey:event.pubkey, kind: event.kind,
    body: event.content, tags: event.tags, createdAt: event.createdAt, depth: 0,
    author: authorLabel(event, members.find(member => member.pubkeys.includes(event.pubkey))?.displayName),
    time: relativeTime(locale, new Date(event.createdAt * 1000).toISOString()),
    reactions: messageReactions.reactions.get(event.id), ...inboxThread(event.tags)}));
  useEffect(() => {
    if (unavailable || interrupted) onAuthorScopeUnavailable?.(workspaceId);
  }, [unavailable, interrupted, workspaceId, onAuthorScopeUnavailable]);
  const parentId = replyId ?? (conversation ? null : replyParent.current);
  const replyTarget = replyId ? rows.find((message) => message.id === replyId) : undefined;
  const hasReplyParent = parentId !== null && (messages.some((message) => message.id === parentId) || contextIds.has(parentId));
  const canReply = canInteract && !unavailable && !interrupted && thread.isSuccess && (conversation && parentId === null || hasReplyParent) && (conversation
    ? conversation.state === "ACTIVE" && conversation.channelId === workspaceId && conversation.participantPrincipalIds.includes(principalId)
    : members.some((member) => member.principalId === principalId && "state" in member && member.state === WorkspaceMembershipState.Active));
  const canManage = Boolean(canReply && ownProfile.isSuccess && !ownProfile.isFetching && ownProfile.data?.pubkey);
  const canEdit = (message: TimelineMessage) => canManage && message.kind === 9 && !message.pending && message.signerPubkey === ownProfile.data?.pubkey;
  const deleteDialog = useMessageDeleteDialog(JSON.stringify([principalId, ownProfile.data?.pubkey, conversation?.id ?? workspaceId]),
    canManage && !sending && !unresolved, async message => {
      if (!canEdit(message)) throw new Error(t("inbox.replyUnavailable"));
      const receipt = await deleteMessage(workspaceId, message.id, WebMessageType.Stream, conversation?.id);
      if (!receipt?.eventId || !receipt.operationId) throw new TransportError(t("platform.sendUnknown", {operation:""}));
    }, message => {
      setEditTarget(current=>current?.id === message.id ? null : current);
      void refresh();
    });
  const isThreadContext = !conversation && messages.some(message => inboxReply(message.tags));
  const directMessageSender = senderLabel ?? (anchoredMessage ? authorLabel(anchoredMessage,
    members.find(member => member.pubkeys.includes(anchoredMessage.pubkey))?.displayName) : "");
  const contextLabel = isThreadContext
    ? channelName ? t("inbox.detailThreadIn", {channel:channelName}) : t("inbox.threadLabel")
    : conversation ? t("inbox.detailDmWith", {sender:directMessageSender})
      : channelName ? t("inbox.detailMessageIn", {channel:channelName}) : channelName;
  const openContextLabel = isThreadContext ? t("inbox.openFullThread") : conversation ? t("inbox.openConversation") : t("inbox.open");
  const selectReply = (id: string | null) => {
    if (!canReply || sending || publication.current || deleteDialog.pending || deleteDialog.unresolvedMessageId) return;
    handleCancelEdit();
    setReplyId((current) => current === id ? null : id);
    // Same original Inbox focus transfer; wait for the restored draft editor.
    requestAnimationFrame(() => composerContainer.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus());
  };
  const copyMessage = async (message: TimelineMessage) => {
    const tagged = new Set(message.tags?.filter((tag) => tag[0] === "p").map((tag) => tag[1]));
    const identities = members.flatMap((member) => member.pubkeys.filter((key) => tagged.has(key)).map((pubkey) => ({pubkey, label:member.displayName})));
    const html = buildMentionClipboardHtml({identities, text:message.body});
    try {
      await (html && typeof ClipboardItem !== "undefined"
        ? navigator.clipboard.write([new ClipboardItem({"text/plain":new Blob([message.body], {type:"text/plain"}), "text/html":new Blob([html], {type:"text/html"})})])
        : navigator.clipboard.writeText(message.body));
      toast.success(t("buzz.copiedMessage"));
    } catch { toast.error(t("buzz.copyFailed")); }
  };
  return <BffVideoReviewProvider Composer={Composer} mentionPeople={mentionPeopleFromMembers(members)} principalId={principalId} workspaceId={workspaceId} conversationId={conversation?.id}
    channelName={channelName} channelType={conversation ? "dm" : "stream"} messages={rows}
    available={Boolean(canReply)} onToggleReaction={messageReactions.onToggleReaction} resolveMediaUrl={messageReactions.resolveMediaUrl} refresh={refresh}>
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60" data-testid="home-inbox-detail">
    <InboxDetailHeader title={contextLabel} onBack={onBack} onOpen={onOpen} openLabel={openContextLabel} />
    <div ref={scroller} className="-mt-13 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-13">
      {unavailable ? <div role="status" className="p-5">{t("platform.loadFailed")}{!denied ? <Button onClick={() => { void thread.refetch(); }}>{t("platform.refresh")}</Button> : null}</div>
        : thread.isPending ? <p role="status" className="p-5">{t("platform.loading")}</p> : messages.map((event, index) => {
          const message = rows[index];
          const author = message.author;
          const previous = messages[index - 1];
          // Original InboxDetailPane keeps the first context boundary distinct.
          const isContinuation = index !== 1 && !startsNewMessageGroup(event)
            && hasSameMessageAuthor(previous, event) && isWithinGroupingWindow(previous?.createdAt, event.createdAt);
          return <InboxMessageRowSurface key={event.id} isSelected={event.id === anchor}
            isFocusHighlightVisible={isFocusHighlightVisible} isContinuation={isContinuation} isFirst={index === 0}
            onToggleReaction={messageReactions.onToggleReaction} customEmoji={messageReactions.customEmoji}
            reactionScope={messageReactions.reactionScope} resolveMediaUrl={messageReactions.resolveMediaUrl}
            renderIdentity={!interrupted ? (node,kind) => {
              const target={principalId,workspaceId,...(conversation ? {conversationId:conversation.id} : {}),eventId:event.id,pubkey:event.pubkey};
              const identity=kind === "avatar" ? <span className="inline-flex shrink-0"><MessageAuthorAvatar
                target={target} profile={{value:authorLabel.profile(event.id)}} className="h-9 w-9 shrink-0" displayName={author} size="md" testId="message-avatar" /></span>
                : node;
              return onOpenAuthor ? <MessageAuthorIdentity target={target} onOpen={() => onOpenAuthor(target)}>{identity}</MessageAuthorIdentity> : identity;
            } : undefined}
            message={message}
            renderActions={!interrupted ? reactions => <MessageActionBarSurface {...reactions} message={message} onCopyMessage={copyMessage}
              onEdit={canEdit(message) && !sending && !unresolved && !deleteDialog.pending && !deleteDialog.unresolvedMessageId ? target=>{
                setEditTarget(current=>current?.id===target.id?null:target);setReplyId(null);
                requestAnimationFrame(()=>composerContainer.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus());
              } : undefined}
              onDelete={canEdit(message) && !sending && !unresolved && !deleteDialog.pending && (!deleteDialog.unresolvedMessageId || deleteDialog.unresolvedMessageId===message.id) ? deleteDialog.requestDelete : undefined}
              onReply={canReply && !sending && !unresolved && !deleteDialog.pending && !deleteDialog.unresolvedMessageId ? (target) => selectReply(target.id) : undefined} /> : undefined}
            renderBody={(className) => <div className={className}><MessageContent messageId={event.id} workspaceId={workspaceId} conversationId={conversation?.id} content={event.content} mediaTags={event.tags} /></div>} />;
        })}
      {!unavailable && thread.hasNextPage ? <Button disabled={thread.isFetchingNextPage} onClick={() => { void thread.fetchNextPage(); }}>{t("forum.more")}</Button> : null}
    </div>
    <div className="shrink-0" ref={composerContainer}>
    {editTarget && canInteract && !unavailable && !interrupted ? <Composer key={`edit:${editTarget.id}`} workspaceId={conversation ? undefined : workspaceId}
      channelType={conversation ? "dm" : undefined} draftIdentity={principalId} draftChannelId={workspaceId}
      draftKey={`edit:${workspaceId}:${editTarget.id}`} editTarget={editTarget}
      onCancelEdit={!sending && !unresolved ? handleCancelEdit : undefined} onConfirmed={handleCancelEdit}
      onRequestEmptyEditDelete={deleteDialog.requestDelete} disabled={!canEdit(editTarget) || deleteDialog.pending || Boolean(deleteDialog.unresolvedMessageId)}
      mentionPeople={mentionPeopleFromMembers(members)} onSendingChange={setSending}
      onUpload={conversation ? file => uploadConversationMedia(conversation.id, file) : undefined}
      onMediaUrl={conversation ? hash => mediaUrl(workspaceId, hash, conversation.id) : undefined}
      onPublish={async(content, attachments, key, installations, mentionPubkeys)=>{
        if (!canEdit(editTarget) || deleteDialog.pending || deleteDialog.unresolvedMessageId) throw new Error(t("inbox.replyUnavailable"));
        const prior=publication.current;
        if(prior && (!prior.edit || prior.key!==key || prior.parent!==editTarget.id)) throw new TransportError(t("platform.sendUnknown",{operation:""}));
        publication.current={key,parent:editTarget.id,unknown:prior?.unknown??false,edit:true};
        onPublicationPendingChange?.(true);
        try {
          const receipt=await(conversation ? publishConversationMessage(conversation.id,content,attachments,key,editTarget.id,undefined,mentionPubkeys)
            : publishMessage(workspaceId,content,attachments,key,installations,{editEventId:editTarget.id,mentionPubkeys}));
          if(!receipt?.eventId||!receipt.operationId) throw new TransportError(t("platform.sendUnknown",{operation:""}));
          if(!editOwner.active||editOwnerRef.current!==editOwner)return receipt;
          publication.current=null;setUnresolved(false);onPublicationPendingChange?.(false);
          void refresh();return receipt;
        } catch(error) {
          if(!editOwner.active||editOwnerRef.current!==editOwner)throw error;
          const unknown=isOutcomeUnknown(error)||(prior?.unknown===true&&!(error instanceof BffError&&error.reason===ReasonCode.PublishRejected));
          publication.current=unknown?{key,parent:editTarget.id,unknown:true,edit:true}:null;
          setUnresolved(unknown);onPublicationPendingChange?.(unknown);
          if(unknown&&!isOutcomeUnknown(error))throw new TransportError(t("platform.sendUnknown",{operation:""}));
          throw error;
        }
      }} /> : null}
    <div hidden={Boolean(editTarget)}><Composer key={replyId ?? "default"} workspaceId={conversation ? undefined : workspaceId} draftChannelId={workspaceId} draftIdentity={principalId} draftKey={restoreDraftKey ?? (conversation ? workspaceId : `thread:${workspaceId}:${anchorRoot}${replyId ? `:${replyId}` : ""}`)} autoSendDraftKey={autoSendDraftKey} disabled={!canReply || Boolean(editTarget) || deleteDialog.pending || Boolean(deleteDialog.unresolvedMessageId)}
      channelType={conversation ? "dm" : undefined}
      audienceContext={conversation || !messages.find(event => event.id === anchorRoot) ? null : {type: "thread", rootTags: messages.find(event => event.id === anchorRoot)!.tags}}
      mentionPeople={mentionPeopleFromMembers(members)}
      onUpload={conversation ? file => uploadConversationMedia(conversation.id, file) : undefined}
      onMediaUrl={conversation ? hash => mediaUrl(workspaceId, hash, conversation.id) : undefined}
      onSendingChange={setSending}
      replyTarget={replyTarget ?? null}
      onCancelReply={replyId && !unresolved && !sending ? () => selectReply(null) : undefined}
      placeholder={conversation ? t("composer.dmPlaceholder",{name:directMessageSender}) : channelName ? t("inbox.replyToChannelThread",{channel:channelName}) : t("inbox.replyToThread")} onPublish={async (content, attachments, idempotencyKey, installations, mentionPubkeys) => {
        if (!canReply || deleteDialog.pending || deleteDialog.unresolvedMessageId || (!conversation && !parentId)) throw new Error("Inbox reply parent is unavailable.");
        const prior = publication.current;
        if (prior && (prior.edit || prior.key !== idempotencyKey || prior.parent !== parentId)) throw new TransportError("Inbox reply still has an unresolved intent.");
        publication.current = {key:idempotencyKey, parent:parentId, unknown:prior?.unknown ?? false};
        onPublicationPendingChange?.(true);
        try {
          const receipt = await (conversation ? publishConversationMessage(conversation.id, content, attachments, idempotencyKey, undefined, parentId ?? undefined, mentionPubkeys)
            : publishMessage(workspaceId, content, attachments, idempotencyKey, installations,
            { messageType: WebMessageType.Stream, parentEventId: parentId ?? undefined, mentionPubkeys }));
          if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Inbox reply has no confirmed receipt.");
          publication.current = null; setUnresolved(false);
          onPublicationPendingChange?.(false);
          void refresh();
          return receipt;
        } catch (error) {
          // A later admission refusal cannot disprove the earlier publication.
          const unknown = isOutcomeUnknown(error) || (prior?.unknown === true && !(error instanceof BffError && error.reason === ReasonCode.PublishRejected));
          publication.current = unknown ? {key:idempotencyKey, parent:parentId, unknown:true} : null;
          setUnresolved(unknown);
          onPublicationPendingChange?.(unknown);
          if (unknown && !isOutcomeUnknown(error)) throw new TransportError("Inbox reply still has an unresolved intent.");
          throw error;
        }
      }} /></div></div>
    {deleteDialog.dialog}
  </section></BffVideoReviewProvider>;
}
