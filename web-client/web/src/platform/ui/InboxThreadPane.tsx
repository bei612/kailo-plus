// Host adapter for the original shared Inbox detail surface, not a message store.
import { ReasonCode, WebMessageType, WorkspaceMembershipState, type WorkspaceMemberView, type ConversationView, type ConversationParticipant } from "@client-kit/contracts";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { InboxDetailHeader } from "@client-kit/platform/react/inbox-surface";
import { MessageRowSurface, MessageActionBarSurface, type TimelineMessage } from "@client-kit/platform/react/messages";
import { buildMentionClipboardHtml } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import { relativeTime, truncatePubkey } from "@client-kit/platform/format";
import { inboxThread } from "@client-kit/platform/inbox";
import { BffError, isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { publishMessage, publishConversationMessage, uploadConversationMedia, mediaUrl } from "@/platform/bff-client";
import { Button } from "@/shared/ui/button";
import { Composer } from "./ChannelPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { MessageAuthorIdentity, type MessageAuthor } from "./MessageAuthorProfile";
import { useMessageReactions } from "./useMessageReactions";

export function InboxThreadPane({ principalId, workspaceId, conversation, canInteract = true, rootId, selectedEventId, channelName, members, onBack, onOpen, autoSendDraftKey, replyTargetEventId, onOpenAuthor, onAuthorScopeUnavailable }: {
  principalId: string; workspaceId: string; rootId: string; selectedEventId: string; channelName: string;
  members: (WorkspaceMemberView | ConversationParticipant)[]; onBack?: () => void; onOpen?: () => void;
  conversation?: ConversationView;
  canInteract?: boolean;
  autoSendDraftKey?: string;
  replyTargetEventId?: string;
  onOpenAuthor?: (target: MessageAuthor) => void;
  onAuthorScopeUnavailable?: (workspaceId: string) => void;
}) {
  const t = useT(); const locale = useLocale();
  const [anchor] = useState(selectedEventId);
  const [anchorRoot] = useState(rootId);
  const replyParent = useRef<string | null>(null);
  const [replyId, setReplyId] = useState<string | null>(replyTargetEventId ?? null);
  const [sending, setSending] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const publication = useRef<{ key: string; parent: string; unknown: boolean } | null>(null);
  const composerContainer = useRef<HTMLDivElement>(null);
  const { thread, messages, contextIds, reactionEvents, denied, interrupted, refresh } = useWorkspaceThread(principalId, workspaceId, anchorRoot, conversation?.id, conversation ? anchor : undefined);
  const messageReactions = useMessageReactions({principalId,workspaceId,conversationId:conversation?.id,events:reactionEvents ?? messages,
    available:canInteract && !denied && !interrupted && thread.isSuccess && !thread.isError,refresh});
  const scroller = useRef<HTMLDivElement>(null);
  const reached = useRef(false);
  const anchoredMessage = messages.find((message) => message.id === anchor);
  // Original Inbox replies beside the selected event unless an explicit row
  // reply target is chosen. Latch once; live feed updates cannot retarget it.
  if (replyParent.current === null && anchoredMessage) replyParent.current = inboxThread(anchoredMessage.tags).parentId ?? anchor;
  useEffect(() => {
    if (reached.current) return;
    const target = scroller.current?.querySelector(`[data-message-id="${anchor}"]`);
    if (target) { target.scrollIntoView({ block: "center" }); reached.current = true; }
    else if (thread.hasNextPage && !thread.isFetchingNextPage && !thread.isError) void thread.fetchNextPage();
  }, [anchor, messages.length, thread.hasNextPage, thread.isFetchingNextPage, thread.isError, thread.fetchNextPage]);
  const unavailable = denied || thread.isError || (thread.isSuccess && !messages.some((event) => event.id === (conversation ? anchor : anchorRoot)));
  useEffect(() => {
    if (unavailable || interrupted) onAuthorScopeUnavailable?.(workspaceId);
  }, [unavailable, interrupted, workspaceId, onAuthorScopeUnavailable]);
  const parentId = replyId ?? replyParent.current;
  const replyTarget = replyId ? messages.find((message) => message.id === replyId) : undefined;
  const canReply = canInteract && !unavailable && !interrupted && thread.isSuccess && parentId !== null && (messages.some((message) => message.id === parentId) || contextIds.has(parentId)) && (conversation
    ? conversation.state === "ACTIVE" && conversation.channelId === workspaceId && conversation.participantPrincipalIds.includes(principalId)
    : members.some((member) => member.principalId === principalId && "state" in member && member.state === WorkspaceMembershipState.Active));
  const selectReply = (id: string | null) => {
    if (!canReply || sending || publication.current) return;
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
  return <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60" data-testid="home-inbox-detail">
    <InboxDetailHeader title={channelName} onBack={onBack} onOpen={onOpen} openLabel={t("inbox.open")} />
    <div ref={scroller} className="-mt-13 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-13">
      {unavailable ? <div role="status" className="p-5">{t("platform.loadFailed")}{!denied ? <Button onClick={() => { void thread.refetch(); }}>{t("platform.refresh")}</Button> : null}</div>
        : thread.isPending ? <p role="status" className="p-5">{t("platform.loading")}</p> : messages.map((event) => {
          const author = members.find((member) => member.pubkeys.includes(event.pubkey))?.displayName || truncatePubkey(event.pubkey);
          const edge = inboxThread(event.tags);
          const message: TimelineMessage = { id:event.id, author, pubkey:event.pubkey, createdAt:event.createdAt,
            body:event.content, time:relativeTime(locale,new Date(event.createdAt*1000).toISOString()),
            depth:0, tags:event.tags, rootId:edge.rootId, parentId:edge.parentId,kind:event.kind,reactions:messageReactions.reactions.get(event.id) };
          return <div key={event.id} data-message-id={event.id}><MessageRowSurface highlighted={event.id === anchor}
            onToggleReaction={messageReactions.onToggleReaction} customEmoji={messageReactions.customEmoji}
            reactionScope={messageReactions.reactionScope} resolveMediaUrl={messageReactions.resolveMediaUrl}
            renderIdentity={onOpenAuthor && !interrupted ? (node) => <MessageAuthorIdentity
              target={{principalId,workspaceId,...(conversation ? {conversationId:conversation.id} : {}),eventId:event.id,pubkey:event.pubkey}}
              onOpen={() => onOpenAuthor({principalId,workspaceId,...(conversation ? {conversationId:conversation.id} : {}),eventId:event.id,pubkey:event.pubkey})}>{node}</MessageAuthorIdentity> : undefined}
            message={message}
            renderActions={!interrupted ? (ref,reactions) => <MessageActionBarSurface ref={ref} {...reactions} message={message} onCopyMessage={copyMessage}
              onReply={canReply && !sending && !unresolved ? (target) => selectReply(target.id) : undefined} /> : undefined}
            renderBody={(className) => <div className={className}><MessageContent workspaceId={workspaceId} conversationId={conversation?.id} content={event.content} mediaTags={event.tags} /></div>} /></div>;
        })}
      {!unavailable && thread.hasNextPage ? <Button disabled={thread.isFetchingNextPage} onClick={() => { void thread.fetchNextPage(); }}>{t("forum.more")}</Button> : null}
    </div>
    <div className="shrink-0" ref={composerContainer}><Composer key={replyId ?? "default"} workspaceId={conversation ? undefined : workspaceId} draftChannelId={workspaceId} draftIdentity={principalId} draftKey={`thread:${workspaceId}:${anchorRoot}${replyId ? `:${replyId}` : ""}`} autoSendDraftKey={autoSendDraftKey} disabled={!canReply}
      mentionPeople={conversation ? members.map(member => ({pubkey:member.pubkeys[0]!,displayName:member.displayName})).filter(member => Boolean(member.pubkey)) : undefined}
      onUpload={conversation ? file => uploadConversationMedia(conversation.id, file) : undefined}
      onMediaUrl={conversation ? hash => mediaUrl(workspaceId, hash, conversation.id) : undefined}
      onSendingChange={setSending}
      replyTarget={replyTarget ? {id:replyTarget.id, body:replyTarget.content, author:members.find((member) => member.pubkeys.includes(replyTarget.pubkey))?.displayName || truncatePubkey(replyTarget.pubkey)} : null}
      onCancelReply={replyId && !unresolved && !sending ? () => selectReply(null) : undefined}
      placeholder={t("inbox.reply")} onPublish={async (content, attachments, idempotencyKey, installations) => {
        if (!canReply || !parentId) throw new Error("Inbox reply parent is unavailable.");
        const prior = publication.current;
        if (prior && (prior.key !== idempotencyKey || prior.parent !== parentId)) throw new TransportError("Inbox reply still has an unresolved intent.");
        publication.current = {key:idempotencyKey, parent:parentId, unknown:prior?.unknown ?? false};
        try {
          const receipt = await (conversation ? publishConversationMessage(conversation.id, content, attachments, idempotencyKey, undefined, parentId)
            : publishMessage(workspaceId, content, attachments, idempotencyKey, installations,
            { messageType: WebMessageType.Stream, parentEventId: parentId }));
          if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Inbox reply has no confirmed receipt.");
          publication.current = null; setUnresolved(false);
          void refresh();
          return receipt;
        } catch (error) {
          // A later admission refusal cannot disprove the earlier publication.
          const unknown = isOutcomeUnknown(error) || (prior?.unknown === true && !(error instanceof BffError && error.reason === ReasonCode.PublishRejected));
          publication.current = unknown ? {key:idempotencyKey, parent:parentId, unknown:true} : null;
          setUnresolved(unknown);
          if (unknown && !isOutcomeUnknown(error)) throw new TransportError("Inbox reply still has an unresolved intent.");
          throw error;
        }
      }} /></div>
  </section>;
}
