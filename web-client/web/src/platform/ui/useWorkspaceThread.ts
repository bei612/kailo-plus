import { WebMessageType, type WebMessageCursor } from "@client-kit/contracts";
import { useBffClient } from "@client-kit/platform/react/context";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { openStream } from "@/platform/bff-client";
import { inboxEvents, inboxReactionEvents } from "./inbox-events";
import { applyMessageEdits } from "@client-kit/platform/react/messages";
import { parseChannelWindowResponse, type RelayEvent } from "@client-kit/platform/react/forum/channelWindowResponse";

// Both Inbox and the channel thread consume the same admitted query/cache;
// signed events stay in Relay, and this is only a disposable client projection.
export function useWorkspaceThread(principalId: string, workspaceId: string, rootId: string, conversationId?: string, selectedEventId?: string, enabled = true) {
  const client = useBffClient();
  const cache = useQueryClient();
  const [denied, setDenied] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const fullChannel = Boolean(conversationId && selectedEventId);
  const key = useMemo(() => ["platform", "inbox-thread", principalId, workspaceId, rootId, conversationId ?? null, selectedEventId ?? null], [principalId, workspaceId, rootId, conversationId, selectedEventId]);
  const thread = useInfiniteQuery({
    queryKey: key, enabled: enabled && !denied, initialPageParam: null as WebMessageCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const query = {
        messageType: WebMessageType.Stream, ...(!fullChannel ? { parentEventId: rootId } : {}),
        ...(pageParam ? { before: pageParam.createdAt, beforeId: pageParam.eventId } : {}),
      };
      const page = await (conversationId ? client.conversationMessages(conversationId, query) : client.workspaceMessages(workspaceId, query));
      if (!Array.isArray(page.events)) throw new Error("Invalid thread page");
      const cursor = fullChannel
        ? parseChannelWindowResponse(page.events as RelayEvent[], workspaceId, pageParam).nextCursor
        : page.nextCursor;
      if (cursor && pageParam) {
        const order = cursor.createdAt - pageParam.createdAt || cursor.eventId.localeCompare(pageParam.eventId);
        if (fullChannel ? order >= 0 : order <= 0) throw new Error("Message cursor did not advance");
      }
      const raw: unknown[] = [...page.events];
      const contextIds = new Set<string>();
      // Buzz fullChannel merges its selected feed event with the channel window.
      // Re-read an off-window anchor through the existing admitted thread route,
      // including edit/deletion closure; never resurrect its stale feed body.
      if (fullChannel && !pageParam && (selectedEventId !== rootId || !raw.some(event => event && typeof event === "object" && "id" in event && event.id === selectedEventId))) {
        let selectedCursor: WebMessageCursor | undefined;
        let found = false;
        do {
          signal.throwIfAborted();
          const selected = await client.conversationMessages(conversationId!, {
            messageType: WebMessageType.Stream, parentEventId: rootId,
            ...(selectedCursor ? { before: selectedCursor.createdAt, beforeId: selectedCursor.eventId } : {}),
          });
          signal.throwIfAborted();
          if (!Array.isArray(selected.events)) throw new Error("Invalid selected message context");
          for (const event of selected.events) {
            if (!event || typeof event !== "object" || !("kind" in event) || !("id" in event)) continue;
            if (event.kind === 9 || event.kind === 40002) {
              if (typeof event.id === "string") contextIds.add(event.id);
              if (event.id !== selectedEventId) continue;
              found = true;
            }
            raw.push(event);
          }
          const next = selected.nextCursor;
          if (next && selectedCursor && (next.createdAt < selectedCursor.createdAt ||
              (next.createdAt === selectedCursor.createdAt && next.eventId <= selectedCursor.eventId))) throw new Error("Selected message cursor did not advance");
          selectedCursor = next;
        } while (!found && selectedCursor);
        if (!found) throw new Error("Selected message is unavailable");
      }
      signal.throwIfAborted();
      const events = raw.flatMap((event) => event && typeof event === "object" && "kind" in event && (event.kind === 9 || event.kind === 40002) ? inboxEvents([event], workspaceId, event.kind) : []);
      const edits = inboxEvents(raw.filter((event) => event && typeof event === "object" && "kind" in event && event.kind === 40003), workspaceId, 40003);
      const deleted = new Set(raw.flatMap((event) => event && typeof event === "object" && "kind" in event && (event.kind === 5 || event.kind === 9005) && "tags" in event && Array.isArray(event.tags)
        ? event.tags.filter((tag: string[]) => tag[0] === "e").map((tag: string[]) => tag[1]) : []));
      return { events, edits, deleted, contextIds, reactions:inboxReactionEvents(raw,workspaceId), nextCursor: cursor };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  useEffect(() => enabled ? openStream(workspaceId, (frame) => {
    if (frame.type === "event" || frame.type === "snapshot" || frame.type === "live") void cache.invalidateQueries({queryKey: key});
    if (frame.type === "live") setInterrupted(false);
    if (frame.type === "interrupted") setInterrupted(true);
    if (frame.type === "closed") {
      setInterrupted(true);
      if (["scope-revoked", "session-revoked", "identity-revoked", "binding-not-active", "scope-changed"].includes(frame.reason)) {
        setDenied(true); void cache.cancelQueries({queryKey: key}); cache.removeQueries({queryKey: key});
      }
    }
  }, conversationId) : undefined, [workspaceId, conversationId, cache, key, enabled]);
  const messages = useMemo(() => {
    const deleted = new Set(thread.data?.pages.flatMap((page) => [...page.deleted]));
    const messages = [...new Map(thread.data?.pages.flatMap((page) => page.events).filter((event) => !deleted.has(event.id)).map((event) => [event.id, event])).values()]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return applyMessageEdits(messages, thread.data?.pages.flatMap((page) => page.edits ?? []).filter((event) => !deleted.has(event.id)) ?? []);
  }, [thread.data]);
  const reactionEvents = useMemo(()=>thread.data?.pages.flatMap(page=>[...page.events,...page.reactions]) ?? [],[thread.data]);
  const contextIds = useMemo(() => {
    const deleted = new Set(thread.data?.pages.flatMap(page => [...page.deleted]));
    return new Set(thread.data?.pages.flatMap(page => [...page.contextIds]).filter(id => !deleted.has(id)));
  }, [thread.data]);
  return { thread, messages, contextIds, reactionEvents, denied, interrupted, refresh: () => cache.invalidateQueries({queryKey: key}) };
}
