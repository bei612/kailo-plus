// Host adapter for the original shared Inbox detail surface, not a message store.
import { WebMessageType, WorkspaceMembershipState, type WorkspaceMemberView } from "@client-kit/contracts";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { InboxDetailHeader } from "@client-kit/platform/react/inbox-surface";
import { MessageRowSurface } from "@client-kit/platform/react/messages";
import { relativeTime, truncatePubkey } from "@client-kit/platform/format";
import { inboxThread } from "@client-kit/platform/inbox";
import { TransportError } from "@client-kit/platform/transport";
import { useEffect, useRef, useState } from "react";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { publishMessage } from "@/platform/bff-client";
import { Button } from "@/shared/ui/button";
import { Composer } from "./ChannelPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { MessageAuthorIdentity, type MessageAuthor } from "./MessageAuthorProfile";

export function InboxThreadPane({ principalId, workspaceId, rootId, selectedEventId, channelName, members, onBack, onOpen, autoSendDraftKey, replyTargetEventId, onOpenAuthor, onAuthorScopeUnavailable }: {
  principalId: string; workspaceId: string; rootId: string; selectedEventId: string; channelName: string;
  members: WorkspaceMemberView[]; onBack?: () => void; onOpen: () => void;
  autoSendDraftKey?: string;
  replyTargetEventId?: string;
  onOpenAuthor?: (target: MessageAuthor) => void;
  onAuthorScopeUnavailable?: (workspaceId: string) => void;
}) {
  const t = useT(); const locale = useLocale();
  const [anchor] = useState(selectedEventId);
  const replyParent = useRef<string | null>(null);
  const { thread, messages, denied, interrupted, refresh } = useWorkspaceThread(principalId, workspaceId, rootId);
  const scroller = useRef<HTMLDivElement>(null);
  const reached = useRef(false);
  const anchoredMessage = messages.find((message) => message.id === anchor);
  // Original Inbox replies beside the selected event unless an explicit row
  // reply target is chosen. Latch once; live feed updates cannot retarget it.
  if (replyParent.current === null && anchoredMessage) replyParent.current = replyTargetEventId ?? inboxThread(anchoredMessage.tags).parentId ?? anchor;
  useEffect(() => {
    if (reached.current) return;
    const target = scroller.current?.querySelector(`[data-message-id="${anchor}"]`);
    if (target) { target.scrollIntoView({ block: "center" }); reached.current = true; }
    else if (thread.hasNextPage && !thread.isFetchingNextPage && !thread.isError) void thread.fetchNextPage();
  }, [anchor, messages.length, thread.hasNextPage, thread.isFetchingNextPage, thread.isError, thread.fetchNextPage]);
  const unavailable = denied || thread.isError || (thread.isSuccess && !messages.some((event) => event.id === rootId));
  useEffect(() => {
    if (unavailable || interrupted) onAuthorScopeUnavailable?.(workspaceId);
  }, [unavailable, interrupted, workspaceId, onAuthorScopeUnavailable]);
  const canReply = !unavailable && !interrupted && thread.isSuccess && replyParent.current !== null && messages.some((message) => message.id === replyParent.current) && members.some((member) => member.principalId === principalId && member.state === WorkspaceMembershipState.Active);
  return <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60" data-testid="home-inbox-detail">
    <InboxDetailHeader title={channelName} onBack={onBack} onOpen={onOpen} openLabel={t("inbox.open")} />
    <div ref={scroller} className="-mt-13 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-13">
      {unavailable ? <div role="status" className="p-5">{t("platform.loadFailed")}{!denied ? <Button onClick={() => { void thread.refetch(); }}>{t("platform.refresh")}</Button> : null}</div>
        : thread.isPending ? <p role="status" className="p-5">{t("platform.loading")}</p> : messages.map((event) => {
          const author = members.find((member) => member.pubkeys.includes(event.pubkey))?.displayName || truncatePubkey(event.pubkey);
          const edge = inboxThread(event.tags);
          return <div key={event.id} data-message-id={event.id}><MessageRowSurface highlighted={event.id === anchor}
            renderIdentity={onOpenAuthor && !interrupted ? (node) => <MessageAuthorIdentity
              target={{principalId,workspaceId,eventId:event.id,pubkey:event.pubkey}}
              onOpen={() => onOpenAuthor({principalId,workspaceId,eventId:event.id,pubkey:event.pubkey})}>{node}</MessageAuthorIdentity> : undefined}
            message={{ id: event.id, author, pubkey: event.pubkey, createdAt: event.createdAt, body: event.content,
              time: relativeTime(locale, new Date(event.createdAt * 1000).toISOString()), depth: 0, tags: event.tags,
              rootId: edge.rootId, parentId: edge.parentId }} renderBody={(className) => <div className={className}><MessageContent workspaceId={workspaceId} content={event.content} mediaTags={event.tags} /></div>} /></div>;
        })}
      {!unavailable && thread.hasNextPage ? <Button disabled={thread.isFetchingNextPage} onClick={() => { void thread.fetchNextPage(); }}>{t("forum.more")}</Button> : null}
    </div>
    <Composer workspaceId={workspaceId} draftIdentity={principalId} draftKey={`thread:${workspaceId}:${rootId}${replyTargetEventId ? `:${replyTargetEventId}` : ""}`} autoSendDraftKey={autoSendDraftKey} disabled={!canReply}
      placeholder={t("inbox.reply")} onPublish={async (content, attachments, idempotencyKey, installations) => {
        if (!replyParent.current) throw new Error("Inbox reply parent is unavailable.");
        const receipt = await publishMessage(workspaceId, content, attachments, idempotencyKey, installations,
          { messageType: WebMessageType.Stream, parentEventId: replyParent.current });
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Inbox reply has no confirmed receipt.");
        void refresh();
        return receipt;
      }} />
  </section>;
}
