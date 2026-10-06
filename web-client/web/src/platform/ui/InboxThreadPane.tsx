// Host adapter for the original shared Inbox detail surface, not a message store.
import { WebMessageType, WorkspaceMembershipState, type WebMessageCursor, type WorkspaceMemberView } from "@client-kit/contracts";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { InboxDetailHeader } from "@client-kit/platform/react/inbox-surface";
import { MessageRowSurface } from "@client-kit/platform/react/messages";
import { relativeTime, truncatePubkey } from "@client-kit/platform/format";
import { inboxThread } from "@client-kit/platform/inbox";
import { TransportError } from "@client-kit/platform/transport";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { openStream, publishMessage } from "@/platform/bff-client";
import { Button } from "@/shared/ui/button";
import { Composer } from "./ChannelPane";
import { inboxEvents } from "./inbox-events";

export function InboxThreadPane({ principalId, workspaceId, rootId, selectedEventId, channelName, members, onBack, onOpen }: {
  principalId: string; workspaceId: string; rootId: string; selectedEventId: string; channelName: string;
  members: WorkspaceMemberView[]; onBack?: () => void; onOpen: () => void;
}) {
  const client = useBffClient(); const t = useT(); const locale = useLocale(); const cache = useQueryClient();
  const [anchor] = useState(selectedEventId);
  const replyParent = useRef<string | null>(null);
  const [denied, setDenied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const reached = useRef(false);
  const key = useMemo(() => ["platform", "inbox-thread", principalId, workspaceId, rootId], [principalId, workspaceId, rootId]);
  const thread = useInfiniteQuery({ queryKey: key, enabled: !denied, initialPageParam: null as WebMessageCursor | null,
    queryFn: async ({ pageParam }) => {
      const page = await client.workspaceMessages(workspaceId, { messageType: WebMessageType.Stream, parentEventId: rootId,
        ...(pageParam ? { before: pageParam.createdAt, beforeId: pageParam.eventId } : {}) });
      if (!Array.isArray(page.events)) throw new Error("Invalid Inbox thread page");
      // Core verifies signatures and closes auxiliary targets before returning.
      const events = inboxEvents(page.events.filter((event) => event && typeof event === "object" && "kind" in event && event.kind === 9), workspaceId);
      const deleted = new Set(page.events.flatMap((event) => event && typeof event === "object" && "kind" in event && (event.kind === 5 || event.kind === 9005) && "tags" in event && Array.isArray(event.tags)
        ? event.tags.filter((tag: string[]) => tag[0] === "e").map((tag: string[]) => tag[1]) : []));
      return { events, deleted, nextCursor: page.nextCursor };
    }, getNextPageParam: (page) => page.nextCursor,
  });
  useEffect(() => openStream(workspaceId, (frame) => {
    if (frame.type === "event" || frame.type === "snapshot" || frame.type === "live") void cache.invalidateQueries({ queryKey: key });
    if (frame.type === "closed" && ["scope-revoked", "session-revoked", "identity-revoked"].includes(frame.reason)) {
      setDenied(true); cache.removeQueries({ queryKey: key });
    }
  }), [workspaceId, cache, key]);
  const deleted = new Set(thread.data?.pages.flatMap((page) => [...page.deleted]));
  const messages = [...new Map(thread.data?.pages.flatMap((page) => page.events).filter((event) => !deleted.has(event.id)).map((event) => [event.id, event])).values()]
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
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
  const unavailable = denied || thread.isError || (thread.isSuccess && !messages.some((event) => event.id === rootId));
  const canReply = !unavailable && thread.isSuccess && replyParent.current !== null && members.some((member) => member.principalId === principalId && member.state === WorkspaceMembershipState.Active);
  return <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60" data-testid="home-inbox-detail">
    <InboxDetailHeader title={channelName} onBack={onBack} onOpen={onOpen} openLabel={t("inbox.open")} />
    <div ref={scroller} className="-mt-13 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-13">
      {unavailable ? <div role="status" className="p-5">{t("platform.loadFailed")}{!denied ? <Button onClick={() => { void thread.refetch(); }}>{t("platform.refresh")}</Button> : null}</div>
        : thread.isPending ? <p role="status" className="p-5">{t("platform.loading")}</p> : messages.map((event) => {
          const author = members.find((member) => member.pubkeys.includes(event.pubkey))?.displayName || truncatePubkey(event.pubkey);
          const edge = inboxThread(event.tags);
          return <div key={event.id} data-message-id={event.id}><MessageRowSurface highlighted={event.id === anchor}
            message={{ id: event.id, author, pubkey: event.pubkey, createdAt: event.createdAt, body: event.content,
              time: relativeTime(locale, new Date(event.createdAt * 1000).toISOString()), depth: 0, tags: event.tags,
              rootId: edge.rootId, parentId: edge.parentId }} renderBody={(className) => <div className={className}><MessageContent workspaceId={workspaceId} content={event.content} mediaTags={event.tags} /></div>} /></div>;
        })}
      {!unavailable && thread.hasNextPage ? <Button disabled={thread.isFetchingNextPage} onClick={() => { void thread.fetchNextPage(); }}>{t("forum.more")}</Button> : null}
    </div>
    <Composer workspaceId={workspaceId} draftIdentity={principalId} draftKey={`thread:${workspaceId}:${rootId}`} disabled={!canReply}
      placeholder={t("inbox.reply")} onPublish={async (content, attachments, idempotencyKey, installations) => {
        if (!replyParent.current) throw new Error("Inbox reply parent is unavailable.");
        const receipt = await publishMessage(workspaceId, content, attachments, idempotencyKey, installations,
          { messageType: WebMessageType.Stream, parentEventId: replyParent.current });
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Inbox reply has no confirmed receipt.");
        void cache.invalidateQueries({ queryKey: key });
        return receipt;
      }} />
  </section>;
}
