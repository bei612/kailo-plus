// Host adapter for the original shared Inbox detail surface, not a message store.
import { ReasonCode, WebMessageType, WorkspaceMembershipState, type WorkspaceMemberView, type ConversationView, type ConversationParticipant, type WorkspaceVisibility } from "@client-kit/contracts";
import { InboxDetailChannelMembers } from "@client-kit/platform/react/inbox/InboxDetailChannelMembers";
import type { ChannelWorkflowNavigation } from "@client-kit/platform/react/channel-management-sheet";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { InboxMessageRowSurface } from "@client-kit/platform/react/inbox-surface";
import { InboxDetailFrame } from "@client-kit/platform/react/inbox/InboxDetailFrame";
import { InboxDetailMessages } from "@client-kit/platform/react/inbox-detail-messages";
import { MessageActionBarSurface, getThreadReference, useMessageDeleteDialog, type TimelineMessage } from "@client-kit/platform/react/messages";
import { useChannelMessageEdit } from "@client-kit/platform/react/thread";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildMentionClipboardHtml } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import { buildMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { relativeTime } from "@client-kit/platform/format";
import { inboxReply, inboxThread } from "@client-kit/platform/inbox";
import { BffError, isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { bff, deleteMessage, publishChannelTopic, publishMessage, publishConversationMessage, uploadConversationMedia, mediaUrl } from "@/platform/bff-client";
import { Composer, mentionPeopleFromMembers } from "./ChannelPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { MessageAuthorAvatar, MessageAuthorIdentity, useMessageAuthorLabels, type MessageAuthor } from "./MessageAuthorProfile";
import { useMessageReactions } from "./useMessageReactions";
import { initDraftStore, isDraftStoreScope, loadDraftEntry, loadPendingSend, useDraftsSnapshot } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { BffVideoReviewProvider } from "@/features/chat/ui/BffVideoReview";

export function InboxThreadPane({ principalId, workspaceId, channelId, conversation, forum = false, canInteract = true, rootId, selectedEventId, selectionItemId, channelName, senderLabel, members, onBack, onOpen, autoSendDraftKey, restoreDraftKey, replyTargetEventId, onOpenAuthor, onAuthorScopeUnavailable, onPublicationPendingChange, unreadBoundaryEventId, reopen, workspaceVisibility, isDark = false, workflows }: {
  principalId: string; workspaceId: string; rootId: string; selectedEventId: string; channelName: string; senderLabel?: string;
  members: (WorkspaceMemberView | ConversationParticipant)[]; onBack?: () => void; onOpen?: () => void;
  conversation?: ConversationView;
  forum?: boolean;
  channelId?: string;
  selectionItemId?: string | null;
  canInteract?: boolean;
  autoSendDraftKey?: string;
  restoreDraftKey?: string;
  replyTargetEventId?: string;
  onOpenAuthor?: (target: MessageAuthor) => void;
  onAuthorScopeUnavailable?: (workspaceId: string) => void;
  onPublicationPendingChange?: (pending: boolean) => void;
  /** Original InboxDetailPane "New" divider before the first unread event of this context. */
  unreadBoundaryEventId?: string | null;
  /** Original header reopen chip for this context's hidden-DM reopen. */
  reopen?: { pending: boolean; error: boolean; unknown?: boolean; onRetry?: () => void };
  /** Directory visibility of the context Workspace channel (original channel.visibility). */
  workspaceVisibility?: WorkspaceVisibility;
  /** Host theme state for the original channel management overlay. */
  isDark?: boolean;
  /** Host Workflows routes for the context Workspace (original management sheet ingress). */
  workflows?: ChannelWorkflowNavigation;
}) {
  const t = useT(); const locale = useLocale();
  const [selection, setSelection] = useState({ anchor: selectedEventId, root: rootId });
  const { anchor, root: anchorRoot } = selection;
  const replyParent = useRef<string | null>(null);
  const [replyId, setReplyId] = useState<string | null>(replyTargetEventId ?? null);
  const [sending, setSending] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const publication = useRef<{ key: string; parent: string | null; unknown: boolean; edit?: boolean } | null>(null);
  const { editTarget, setEditTarget, handleCancelEdit } = useChannelMessageEdit<TimelineMessage>(JSON.stringify([principalId, conversation?.id ?? workspaceId]));
  const ownProfile = useQuery({queryKey:["platform", "edit-author", principalId], queryFn:()=>bff.profile()});
  const publicationOwner=useMemo(()=>({active:true}),[principalId,conversation?.id,workspaceId]);
  const publicationOwnerRef=useRef(publicationOwner);publicationOwnerRef.current=publicationOwner;
  useEffect(()=>{publicationOwner.active=true;return()=>{publicationOwner.active=false;};},[publicationOwner]);
  const composerContainer = useRef<HTMLDivElement>(null);
  // Original InboxDetailPane ChannelMembersBar: the context channel's roster and management sheet,
  // over the same admitted channel descriptor read (and cache key) as the channel page.
  const queryClient = useQueryClient();
  const descriptorKey = ["platform", "channel-descriptor", principalId, workspaceId] as const;
  const descriptor = useQuery({ queryKey: descriptorKey, enabled: !conversation && canInteract,
    queryFn: () => bff.workspaceChannel(workspaceId), retry: false });
  const channelMembers = conversation
    ? <InboxDetailChannelMembers roster={{kind: "conversation", conversation}} isDark={isDark} currentPrincipalId={principalId}
        channel={{channelId: conversation.channelId, name: channelName, description: "", channelType: "dm", ttlSeconds: null}}
        onCopy={writeTextToClipboard} />
    : descriptor.isSuccess && descriptor.data ? <InboxDetailChannelMembers roster={{kind: "workspace", workspaceId}} isDark={isDark}
        currentPrincipalId={principalId}
        channel={{channelId: descriptor.data.channelId, name: descriptor.data.name, description: descriptor.data.description ?? "",
          channelType: descriptor.data.channelType === "forum" ? "forum" : "stream", visibility: workspaceVisibility,
          ttlSeconds: descriptor.data.ttlSeconds ?? null, topic: descriptor.data.topic, archived: descriptor.data.archived}}
        management={{
          refresh: () => { void queryClient.invalidateQueries({ queryKey: descriptorKey }); },
          publishTopic: async (id, request, idempotencyKey) => { await publishChannelTopic(id, request, idempotencyKey); },
          renderCanvas: (content) => <MessageContent content={content} workspaceId={workspaceId} />,
        }}
        workflows={workflows}
        onCopy={writeTextToClipboard} /> : undefined;
  const currentHeaderDelete = useRef<(() => void) | undefined>(undefined);
  const { thread, messages, contextIds, reactionEvents, denied, interrupted, refresh } = useWorkspaceThread(principalId, workspaceId, anchorRoot, conversation?.id, conversation ? anchor : undefined, true, conversation?.channelId ?? channelId, forum);
  const messageReactions = useMessageReactions({principalId,workspaceId,conversationId:conversation?.id,events:reactionEvents ?? messages,
    available:canInteract && !denied && !interrupted && thread.isSuccess && !thread.isError,refresh});
  // Selection is not publication ownership. Keep the original composer and
  // parent while a send is in flight or UNKNOWN; a URL/history change must not
  // discard that intent. Once confirmed/rejected, apply the latest selection.
  const changingSelection = selectionItemId === selectedEventId && (anchor !== selectedEventId || anchorRoot !== rootId) && !sending && !unresolved && !publication.current;
  if (changingSelection) {
    setSelection({ anchor: selectedEventId, root: rootId });
    setReplyId(replyTargetEventId ?? null);
    setEditTarget(null);
    replyParent.current = null;
  }
  const anchoredMessage = messages.find((message) => message.id === anchor);
  // Original Inbox replies beside the selected event unless an explicit row
  // reply target is chosen. Latch once; live feed updates cannot retarget it.
  if (!changingSelection && replyParent.current === null && anchoredMessage) replyParent.current = inboxThread(anchoredMessage.tags).parentId ?? anchor;
  const unavailable = denied || thread.isError || (thread.isSuccess && !messages.some((event) => event.id === (conversation ? anchor : anchorRoot)));
  const authorLabel = useMessageAuthorLabels({principalId, workspaceId, conversationId: conversation?.id}, messages,
    !unavailable && !interrupted && thread.isSuccess);
  const rows: TimelineMessage[] = messages.map(event => ({id: event.id, pubkey: event.pubkey, signerPubkey:event.pubkey, kind: event.kind,
    body: event.content, tags: event.tags, createdAt: event.createdAt, depth: 0, edited: event.edited,
    author: authorLabel(event, members.find(member => member.pubkeys.includes(event.pubkey))?.displayName),
    time: relativeTime(locale, new Date(event.createdAt * 1000).toISOString()),
    reactions: messageReactions.reactions.get(event.id), ...inboxThread(event.tags)}));
  useEffect(() => {
    if (unavailable || interrupted) onAuthorScopeUnavailable?.(workspaceId);
  }, [unavailable, interrupted, workspaceId, onAuthorScopeUnavailable]);
  const parentId = replyId ?? (conversation ? null : replyParent.current);
  const replyTarget = replyId ? rows.find((message) => message.id === replyId) : undefined;
  const hasReplyParent = parentId !== null && (messages.some((message) => message.id === parentId) || contextIds.has(parentId));
  const supportsInlineReply = anchoredMessage?.kind !== 45001 && anchoredMessage?.kind !== 45003;
  const canUseContext = canInteract && !unavailable && !interrupted && thread.isSuccess && (conversation && parentId === null || hasReplyParent) && (conversation
    ? conversation.state === "ACTIVE" && conversation.channelId === workspaceId && conversation.participantPrincipalIds.includes(principalId)
    : members.some((member) => member.principalId === principalId && "state" in member && member.state === WorkspaceMembershipState.Active));
  // Keep legacy native-key recovery (including pending-only/UNKNOWN) intact.
  // Only a new DM draft joins the binding key already used by the full DM page.
  // Latch once per owner: later record changes must never retarget its editor.
  useDraftsSnapshot();
  const dmDraftOwner = useMemo(() => ({}), [principalId, workspaceId, conversation?.id, restoreDraftKey]);
  const [dmDraft, setDmDraft] = useState<{ owner: object; key: string; scope: string } | null>(null);
  const hasLegacyDmDraft = () => Boolean(loadDraftEntry(workspaceId) || loadPendingSend(workspaceId));
  useEffect(() => {
    if (!conversation || !canUseContext || dmDraft?.owner === dmDraftOwner) return;
    initDraftStore(principalId, window.location.origin);
    const key = restoreDraftKey ?? (hasLegacyDmDraft() ? workspaceId : conversation.id);
    setDmDraft({owner: dmDraftOwner, key, scope: key === conversation.id ? conversation.id : workspaceId});
  }, [dmDraftOwner, dmDraft, canUseContext, principalId, workspaceId, conversation, restoreDraftKey]);
  const activeDmDraft = dmDraft?.owner === dmDraftOwner ? dmDraft : null;
  const dmDraftAvailable = () => !conversation || Boolean(activeDmDraft &&
    isDraftStoreScope(principalId, window.location.origin) &&
    (activeDmDraft.key !== conversation.id || workspaceId === conversation.id || !hasLegacyDmDraft()));
  const canReply = supportsInlineReply && canUseContext && dmDraftAvailable();
  const canManage = Boolean(canUseContext && ownProfile.isSuccess && !ownProfile.isFetching && ownProfile.data?.pubkey);
  const canEdit = (message: TimelineMessage) => canManage && (message.kind === 9 || (forum && (message.kind === 45001 || message.kind === 45003))) && !message.pending && message.signerPubkey === ownProfile.data?.pubkey;
  const deleteDialog = useMessageDeleteDialog(JSON.stringify([principalId, ownProfile.data?.pubkey, conversation?.id ?? workspaceId]),
    canManage && !sending && !unresolved, async message => {
      if (!canEdit(message)) throw new Error(t("inbox.replyUnavailable"));
      const receipt = await deleteMessage(workspaceId, message.id,
        message.kind === 45001 ? WebMessageType.ForumPost : message.kind === 45003 ? WebMessageType.ForumComment : WebMessageType.Stream, conversation?.id);
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
  // Keep the original native Channel reference; a Workspace or Conversation
  // binding ID is not a message-link target and cannot fill a missing channel.
  const messageChannelId = conversation ? conversation.channelId : channelId;
  const copyMessageLink = messageChannelId && canInteract && !unavailable && !interrupted && thread.isSuccess
    ? async (message: TimelineMessage) => {
      const { rootId } = getThreadReference(message.tags ?? []);
      try {
        await writeTextToClipboard(buildMessageLink({ channelId: messageChannelId, messageId: message.id, threadRootId: rootId }));
        if (publicationOwner.active && publicationOwnerRef.current === publicationOwner) toast.success(t("buzz.copiedLink"));
      } catch {
        if (publicationOwner.active && publicationOwnerRef.current === publicationOwner) toast.error(t("buzz.copyFailed"));
      }
    } : undefined;
  const headerDeleteTarget = rows.find(message => message.id === anchor);
  const headerDeletePending = sending || unresolved || deleteDialog.pending || Boolean(editTarget) ||
    Boolean(deleteDialog.unresolvedMessageId && deleteDialog.unresolvedMessageId !== headerDeleteTarget?.id);
  const requestHeaderDelete: (() => void) | undefined = headerDeleteTarget && canEdit(headerDeleteTarget) ? () => {
    if (!publicationOwner.active || publicationOwnerRef.current !== publicationOwner ||
      currentHeaderDelete.current !== requestHeaderDelete || headerDeletePending) return;
    deleteDialog.requestDelete(headerDeleteTarget);
  } : undefined;
  currentHeaderDelete.current = requestHeaderDelete;
  return <BffVideoReviewProvider Composer={Composer} mentionPeople={mentionPeopleFromMembers(members)} principalId={principalId} workspaceId={workspaceId} conversationId={conversation?.id}
    channelName={channelName} channelType={conversation ? "dm" : forum ? "forum" : "stream"} messages={rows}
    available={Boolean(canUseContext)} canSendComment={Boolean(canReply)} onToggleReaction={messageReactions.onToggleReaction} resolveMediaUrl={messageReactions.resolveMediaUrl} refresh={refresh}>
    <InboxDetailFrame headerKey={JSON.stringify([principalId, ownProfile.data?.pubkey, workspaceId, conversation?.id, anchor])}
      header={{title: contextLabel, onBack, onOpen, openLabel: openContextLabel, deletePending: headerDeletePending, onDelete: requestHeaderDelete, reopen, actions: channelMembers}}
      renderMessages={composerOverlayRef => <InboxDetailMessages conversationId={anchorRoot} selectedEventId={anchor} messages={rows} composerOverlayRef={composerOverlayRef}
      unreadBoundaryEventId={unreadBoundaryEventId}
      unavailable={unavailable} interrupted={interrupted} loading={thread.isPending}
      onRetry={!denied ? () => { void thread.refetch(); } : undefined}
      pending={sending || deleteDialog.pending} unknown={unresolved}
      unresolvedDeleteId={deleteDialog.unresolvedMessageId}
      canReply={Boolean(canReply)} canManageMessage={canEdit}
      onReply={target => selectReply(target.id)}
      onEdit={target => {
        setEditTarget(current => current?.id === target.id ? null : target); setReplyId(null);
        requestAnimationFrame(() => composerContainer.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus());
      }}
      onDelete={deleteDialog.requestDelete}
      pagination={!denied && !thread.isError && !interrupted ? {hasMore: thread.hasNextPage, pending: thread.isFetchingNextPage, load: thread.fetchNextPage} : undefined}
      renderMessage={(message, presentation, index) => {
        const event = messages[index]; const author = message.author;
          return <InboxMessageRowSurface {...presentation} isSelected={event.id === anchor}
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
              onCopyLink={copyMessageLink}
              onEdit={presentation.onEdit} onDelete={presentation.onDelete} onReply={presentation.onReply} /> : undefined}
            renderBody={(className) => <div className={className}><MessageContent messageId={event.id} workspaceId={workspaceId} conversationId={conversation?.id} content={event.content} mediaTags={event.tags} /></div>} />;
      }}
    />}
      dialog={deleteDialog.dialog}
      composer={<div ref={composerContainer}>
    {editTarget && canInteract && !unavailable && !interrupted ? <Composer key={`edit:${editTarget.id}`} containerClassName="px-4 pb-4 sm:px-4" workspaceId={conversation ? undefined : workspaceId}
      channelType={conversation ? "dm" : undefined} draftIdentity={principalId} draftChannelId={workspaceId}
      draftKey={`edit:${workspaceId}:${editTarget.id}`} editTarget={editTarget}
      onCancelEdit={!sending && !unresolved ? handleCancelEdit : undefined} onConfirmed={handleCancelEdit}
      onRequestEmptyEditDelete={deleteDialog.requestDelete} disabled={!canEdit(editTarget) || deleteDialog.pending || Boolean(deleteDialog.unresolvedMessageId)}
      mentionPeople={mentionPeopleFromMembers(members)} onSendingChange={setSending}
      onUpload={conversation ? (file, options) => uploadConversationMedia(conversation.id, file, options) : undefined}
      onMediaUrl={conversation ? hash => mediaUrl(workspaceId, hash, conversation.id) : undefined}
      onPublish={async(content, attachments, key, installations, mentionPubkeys)=>{
        if (!publicationOwner.active || publicationOwnerRef.current !== publicationOwner) throw new Error(t("inbox.replyUnavailable"));
        if (!canEdit(editTarget) || deleteDialog.pending || deleteDialog.unresolvedMessageId) throw new Error(t("inbox.replyUnavailable"));
        const prior=publication.current;
        if(prior && (!prior.edit || prior.key!==key || prior.parent!==editTarget.id)) throw new TransportError(t("platform.sendUnknown",{operation:""}));
        publication.current={key,parent:editTarget.id,unknown:prior?.unknown??false,edit:true};
        onPublicationPendingChange?.(true);
        try {
          const receipt=await(conversation ? publishConversationMessage(conversation.id,content,attachments,key,editTarget.id,undefined,mentionPubkeys)
            : publishMessage(workspaceId,content,attachments,key,installations,{editEventId:editTarget.id,mentionPubkeys,
              ...(editTarget.kind === 45001 ? {messageType:WebMessageType.ForumPost} : editTarget.kind === 45003 ? {messageType:WebMessageType.ForumComment} : {})}));
          if(!receipt?.eventId||!receipt.operationId) throw new TransportError(t("platform.sendUnknown",{operation:""}));
          if(!publicationOwner.active||publicationOwnerRef.current!==publicationOwner)return receipt;
          publication.current=null;setUnresolved(false);onPublicationPendingChange?.(false);
          void refresh();return receipt;
        } catch(error) {
          if(!publicationOwner.active||publicationOwnerRef.current!==publicationOwner)throw error;
          const unknown=isOutcomeUnknown(error)||(prior?.unknown===true&&!(error instanceof BffError&&error.reason===ReasonCode.PublishRejected));
          publication.current=unknown?{key,parent:editTarget.id,unknown:true,edit:true}:null;
          setUnresolved(unknown);onPublicationPendingChange?.(unknown);
          if(unknown&&!isOutcomeUnknown(error))throw new TransportError(t("platform.sendUnknown",{operation:""}));
          throw error;
        }
      }} /> : null}
    <div hidden={Boolean(editTarget)}>{conversation && !dmDraftAvailable() ? <p role="status">{t("inbox.replyUnavailable")}</p> : null}{(!conversation || activeDmDraft) ? <Composer key={replyId ?? "default"} containerClassName="px-4 pb-4 sm:px-4" workspaceId={conversation ? undefined : workspaceId} draftChannelId={activeDmDraft?.scope ?? workspaceId} draftIdentity={principalId} draftKey={activeDmDraft?.key ?? restoreDraftKey ?? `thread:${workspaceId}:${anchorRoot}${replyId ? `:${replyId}` : ""}`} autoSendDraftKey={autoSendDraftKey} disabled={!canReply || Boolean(editTarget) || deleteDialog.pending || Boolean(deleteDialog.unresolvedMessageId)}
      channelType={conversation ? "dm" : forum ? "forum" : undefined}
      audienceContext={conversation || !messages.find(event => event.id === anchorRoot) ? null : {type: "thread", rootTags: messages.find(event => event.id === anchorRoot)!.tags}}
      mentionPeople={mentionPeopleFromMembers(members)}
      onUpload={conversation ? (file, options) => uploadConversationMedia(conversation.id, file, options) : undefined}
      onMediaUrl={conversation ? hash => mediaUrl(workspaceId, hash, conversation.id) : undefined}
      onSendingChange={setSending}
      replyTarget={replyTarget ?? null}
      onCancelReply={replyId && !unresolved && !sending ? () => selectReply(null) : undefined}
      placeholder={!supportsInlineReply ? t("inbox.replyUnsupported") : conversation ? t("composer.dmPlaceholder",{name:directMessageSender}) : channelName ? t("inbox.replyToChannelThread",{channel:channelName}) : t("inbox.replyToThread")} linkPreviewTarget={conversation ? { conversationId: conversation.id } : { workspaceId }}
      onPublish={async (content, attachments, idempotencyKey, installations, mentionPubkeys, linkPreviews) => {
        if (!publicationOwner.active || publicationOwnerRef.current !== publicationOwner) throw new Error(t("inbox.replyUnavailable"));
        if (!canReply || !dmDraftAvailable() || deleteDialog.pending || deleteDialog.unresolvedMessageId || (!conversation && !parentId)) throw new Error("Inbox reply parent is unavailable.");
        const prior = publication.current;
        if (prior && (prior.edit || prior.key !== idempotencyKey || prior.parent !== parentId)) throw new TransportError("Inbox reply still has an unresolved intent.");
        publication.current = {key:idempotencyKey, parent:parentId, unknown:prior?.unknown ?? false};
        onPublicationPendingChange?.(true);
        try {
          const receipt = await (conversation ? (linkPreviews
            ? publishConversationMessage(conversation.id, content, attachments, idempotencyKey, undefined, parentId ?? undefined, mentionPubkeys, linkPreviews)
            : publishConversationMessage(conversation.id, content, attachments, idempotencyKey, undefined, parentId ?? undefined, mentionPubkeys))
            : publishMessage(workspaceId, content, attachments, idempotencyKey, installations,
            { messageType: WebMessageType.Stream, parentEventId: parentId ?? undefined, mentionPubkeys, ...linkPreviews }));
          if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Inbox reply has no confirmed receipt.");
          if (!publicationOwner.active || publicationOwnerRef.current !== publicationOwner) return receipt;
          publication.current = null; setUnresolved(false);
          onPublicationPendingChange?.(false);
          void refresh();
          return receipt;
        } catch (error) {
          if (!publicationOwner.active || publicationOwnerRef.current !== publicationOwner) throw error;
          // A later admission refusal cannot disprove the earlier publication.
          const unknown = isOutcomeUnknown(error) || (prior?.unknown === true && !(error instanceof BffError && error.reason === ReasonCode.PublishRejected));
          publication.current = unknown ? {key:idempotencyKey, parent:parentId, unknown:true} : null;
          setUnresolved(unknown);
          onPublicationPendingChange?.(unknown);
          if (unknown && !isOutcomeUnknown(error)) throw new TransportError("Inbox reply still has an unresolved intent.");
          throw error;
        }
      }} /> : null}</div></div>} />
  </BffVideoReviewProvider>;
}
