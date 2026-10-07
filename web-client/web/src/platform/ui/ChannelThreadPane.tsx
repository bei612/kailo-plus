import { WorkspaceMembershipState, WebMessageType, type WorkspaceMemberView } from "@client-kit/contracts";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { ThreadPanelSurface, MessageThreadPanelSkeleton, ThreadRepliesErrorCard, AuxiliaryPanel, MessageThreadPanelHeader, useThreadPanelWidth, buildThreadPanelData } from "@client-kit/platform/react/thread";
import { MessageRowSurface, MessageActionBarSurface, getThreadReference, type TimelineMessage } from "@client-kit/platform/react/messages";
import { relativeTime, truncatePubkey } from "@client-kit/platform/format";
import { TransportError } from "@client-kit/platform/transport";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { publishMessage } from "@/platform/bff-client";
import { Composer } from "./ChannelPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { MessageAuthorIdentity } from "./MessageAuthorProfile";
import { getThreadPanelLayout } from "@client-kit/platform/react/thread/threadPanelLayout";

export function ChannelThreadPane({ workspaceId, principalId, selected, members, disabled, onClose, onCopyMessage, onCopyLink, onOpenAuthor, onAuthorScopeUnavailable, isFocusMode = false, channelName = "" }: {
  workspaceId: string; principalId: string; selected: TimelineMessage; members: WorkspaceMemberView[];
  disabled: boolean; onClose: () => void; onCopyMessage: (message: TimelineMessage) => void;
  onCopyLink?: (message: TimelineMessage) => void;
  onOpenAuthor?: (message: TimelineMessage) => void;
  onAuthorScopeUnavailable?: () => void;
  isFocusMode?: boolean;
  channelName?: string;
}) {
  const t = useT(); const locale = useLocale();
  const rootId = getThreadReference(selected.tags ?? []).rootId ?? selected.id;
  const {thread, messages, denied, interrupted, refresh} = useWorkspaceThread(principalId, workspaceId, rootId);
  const [replyId, setReplyId] = useState(selected.id);
  const [isSending, setIsSending] = useState(false);
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(selected.id);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([selected.id]));
  const expandedTarget = useRef<string | null>(null);
  useEffect(() => { setReplyId(selected.id); setScrollTargetId(selected.id); expandedTarget.current = null; }, [selected.id]);
  const width = useThreadPanelWidth();
  // Native getThreadReplies traverses the original Relay cursor until complete.
  // Web traverses that same bounded server window, never inventing a time fence.
  useEffect(() => {
    if (!denied && !thread.isError && thread.hasNextPage && !thread.isFetchingNextPage) void thread.fetchNextPage();
  }, [denied, thread.hasNextPage, thread.isFetchingNextPage, thread.isError, thread.fetchNextPage]);
  const rows = useMemo(() => messages.map((event): TimelineMessage => {
    const edge = getThreadReference(event.tags);
    return {id: event.id, pubkey: event.pubkey, kind: event.kind, createdAt: event.createdAt,
      author: members.find((member) => member.pubkeys.includes(event.pubkey))?.displayName || truncatePubkey(event.pubkey),
      body: event.content, tags: event.tags, rootId: edge.rootId, parentId: edge.parentId, depth: 0,
      time: relativeTime(locale, new Date(event.createdAt * 1000).toISOString())};
  }), [messages, members, locale]);
  useEffect(() => {
    if (expandedTarget.current === selected.id || !rows.some((row) => row.id === selected.id)) return;
    const ancestors = new Set<string>();
    let id: string | null | undefined = selected.id;
    while (id && !ancestors.has(id)) {
      ancestors.add(id);
      id = rows.find((row) => row.id === id)?.parentId;
    }
    expandedTarget.current = selected.id;
    setExpanded((old) => new Set([...old, ...ancestors]));
  }, [rows, selected.id]);
  const data = useMemo(() => buildThreadPanelData(rows, rootId, replyId, expanded), [rows, rootId, replyId, expanded]);
  const unavailable = denied || thread.isError || (thread.isSuccess && !data.threadHead);
  useEffect(() => {
    if (unavailable || interrupted) onAuthorScopeUnavailable?.();
  }, [unavailable, interrupted, onAuthorScopeUnavailable]);
  const loading = thread.isPending || thread.hasNextPage || thread.isFetchingNextPage;
  const canReply = !disabled && !unavailable && !interrupted && !loading &&
    rows.some((row) => row.id === replyId) &&
    members.some((member) => member.principalId === principalId && member.state === WorkspaceMembershipState.Active);
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
    onSelectReplyTarget={(message) => setReplyId(message.id)}
    onExpandReplies={(message) => setExpanded((prior) => {const next = new Set(prior); if (!next.delete(message.id)) next.add(message.id); return next;})}
    threadRepliesPending={loading} threadRepliesError={unavailable}
    onRetryThreadReplies={denied ? undefined : () => {void thread.refetch();}}
    renderRow={(row) => <MessageRowSurface {...row} layoutVariant="thread-reply"
      renderIdentity={row.message.pubkey && onOpenAuthor && !unavailable && !interrupted ? (node) => <MessageAuthorIdentity
        target={{principalId,workspaceId,eventId:row.message.id,pubkey:row.message.pubkey!}}
        onOpen={() => onOpenAuthor(row.message)}>{node}</MessageAuthorIdentity> : undefined}
      renderBody={(className) => <div className={className}><MessageContent workspaceId={workspaceId} content={row.message.body} mediaTags={row.message.tags} /></div>}
      renderActions={(ref) => <MessageActionBarSurface ref={ref} message={row.message} onCopyMessage={onCopyMessage}
        onCopyLink={onCopyLink}
        onReply={canReply ? (message) => setReplyId(message.id) : undefined} />} />}
    renderComposer={(composer) => <Composer key={replyId} workspaceId={workspaceId} draftIdentity={principalId}
      draftKey={`thread:${workspaceId}:${rootId}:${replyId}`} disabled={composer.disabled} onSendingChange={setIsSending}
      containerClassName={composer.containerClassName} layoutMode="dock"
      replyTarget={composer.replyTarget} onCancelReply={composer.onCancelReply}
      placeholder={t("thread.replyTo", {author: data.threadHead!.author})}
      onPublish={async (content, attachments, idempotencyKey, installations) => {
        if (!canReply) throw new Error("Thread admission is unavailable");
        const receipt = await publishMessage(workspaceId, content, attachments, idempotencyKey, installations,
          {messageType: WebMessageType.Stream, parentEventId: replyId});
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Reply has no confirmed receipt.");
        void refresh(); return receipt;
      }} />}
  />;
}
