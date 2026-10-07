import { WebMessageType, type WebMessageCursor } from "@client-kit/contracts";
import { useBffClient } from "@client-kit/platform/react/context";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { openStream } from "@/platform/bff-client";
import { inboxEvents, inboxReactionEvents } from "./inbox-events";
import { applyMessageEdits } from "@client-kit/platform/react/messages";

// Both Inbox and the channel thread consume the same admitted query/cache;
// signed events stay in Relay, and this is only a disposable client projection.
export function useWorkspaceThread(principalId: string, workspaceId: string, rootId: string) {
  const client = useBffClient();
  const cache = useQueryClient();
  const [denied, setDenied] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const key = useMemo(() => ["platform", "inbox-thread", principalId, workspaceId, rootId], [principalId, workspaceId, rootId]);
  const thread = useInfiniteQuery({
    queryKey: key, enabled: !denied, initialPageParam: null as WebMessageCursor | null,
    queryFn: async ({ pageParam }) => {
      const page = await client.workspaceMessages(workspaceId, {
        messageType: WebMessageType.Stream, parentEventId: rootId,
        ...(pageParam ? { before: pageParam.createdAt, beforeId: pageParam.eventId } : {}),
      });
      if (!Array.isArray(page.events)) throw new Error("Invalid thread page");
      const cursor = page.nextCursor;
      if (cursor && pageParam && (cursor.createdAt < pageParam.createdAt ||
          (cursor.createdAt === pageParam.createdAt && cursor.eventId <= pageParam.eventId))) {
        throw new Error("Thread cursor did not advance");
      }
      const events = page.events.flatMap((event) => event && typeof event === "object" && "kind" in event && (event.kind === 9 || event.kind === 40002) ? inboxEvents([event], workspaceId, event.kind) : []);
      const edits = inboxEvents(page.events.filter((event) => event && typeof event === "object" && "kind" in event && event.kind === 40003), workspaceId, 40003);
      const deleted = new Set(page.events.flatMap((event) => event && typeof event === "object" && "kind" in event && (event.kind === 5 || event.kind === 9005) && "tags" in event && Array.isArray(event.tags)
        ? event.tags.filter((tag: string[]) => tag[0] === "e").map((tag: string[]) => tag[1]) : []));
      return { events, edits, deleted, reactions:inboxReactionEvents(page.events,workspaceId), nextCursor: cursor };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  useEffect(() => openStream(workspaceId, (frame) => {
    if (frame.type === "event" || frame.type === "snapshot" || frame.type === "live") void cache.invalidateQueries({queryKey: key});
    if (frame.type === "live") setInterrupted(false);
    if (frame.type === "interrupted") setInterrupted(true);
    if (frame.type === "closed") {
      setInterrupted(true);
      if (["scope-revoked", "session-revoked", "identity-revoked"].includes(frame.reason)) {
        setDenied(true); cache.removeQueries({queryKey: key});
      }
    }
  }), [workspaceId, cache, key]);
  const messages = useMemo(() => {
    const deleted = new Set(thread.data?.pages.flatMap((page) => [...page.deleted]));
    const messages = [...new Map(thread.data?.pages.flatMap((page) => page.events).filter((event) => !deleted.has(event.id)).map((event) => [event.id, event])).values()]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return applyMessageEdits(messages, thread.data?.pages.flatMap((page) => page.edits ?? []).filter((event) => !deleted.has(event.id)) ?? []);
  }, [thread.data]);
  const reactionEvents = useMemo(()=>thread.data?.pages.flatMap(page=>[...page.events,...page.reactions]) ?? [],[thread.data]);
  return { thread, messages, reactionEvents, denied, interrupted, refresh: () => cache.invalidateQueries({queryKey: key}) };
}
