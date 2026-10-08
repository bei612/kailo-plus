import type { ReadMarkRequest, ConversationView } from "@client-kit/contracts";
import { loadInboxConversations } from "./conversations/hidden-dm-inbox-action";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BffClient } from "../client";
import {
  checkedUserState,
  type CollaborationUserState,
  type InboxEvent,
  inboxReadAt,
  inboxReadContext,
  inboxThread,
  inboxReply,
} from "../inbox";
import { isOutcomeUnknown, TransportError } from "../transport";

/** The two hosts share Core's projection and CAS writer, not a local NIP-RS authority. */
export function useInboxState(client: BffClient) {
  const [state, setState] = useState<CollaborationUserState | null>(null);
  const [failed, setFailed] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [pending, setPending] = useState(false);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [workspaceChannels, setWorkspaceChannels] = useState<ReadonlySet<string>>(new Set());
  const [visibleChannels, setVisibleChannels] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const current = useRef<CollaborationUserState | null>(null);
  const intent = useRef<ReadMarkRequest | null>(null);
  const epoch = useRef(0);
  const writing = useRef(false);
  const queue = useRef(Promise.resolve());
  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    current.current = null;
    setState(null);
    setVisibleChannels(new Set());
    setConversations([]); setWorkspaceChannels(new Set());
    setFailed(false);
    setUnknown(intent.current !== null);
    try {
      const workspaces = await client.workspaces();
      if (generation !== epoch.current) return;
      if (
        !Array.isArray(workspaces) ||
        workspaces.some((workspace) => typeof workspace.id !== "string")
      )
        throw new Error("Invalid Workspace directory");
      const privateChannels = await loadInboxConversations(client, () => generation === epoch.current);
      if (generation !== epoch.current) return;
      const next = checkedUserState(await client.collaborationUserState());
      if (generation !== epoch.current) return;
      // A higher CAS version proves the old request can no longer write. A
      // still-equal version does not prove a late request was never accepted.
      if (intent.current && next.version > intent.current.version) {
        intent.current = null;
        setUnknown(false);
      }
      current.current = next;
      setState(next);
      const workspaceIds = workspaces.filter((workspace) => workspace.isMember === true).map((workspace) => workspace.id);
      setWorkspaceChannels(new Set(workspaceIds)); setConversations(privateChannels);
      setVisibleChannels(new Set([...workspaceIds, ...privateChannels.map(item => item.channelId)]));
    } catch {
      if (generation === epoch.current) setFailed(true);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      if (!writing.current) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      epoch.current += 1;
      current.current = null;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const write = useCallback(
    (contexts: readonly { key: string; seconds: number }[]) => {
      const generation = epoch.current;
      const result = queue.current.then(async () => {
        if (generation !== epoch.current || intent.current || !current.current)
          return false;
        writing.current = true;
        setPending(true);
        for (const context of contexts) {
          if (generation !== epoch.current || !current.current) break;
          const request: ReadMarkRequest = {
            contextKey: context.key,
            lastReadAt: new Date(context.seconds * 1000).toISOString(),
            version: current.current.version,
          };
          intent.current = request;
          try {
            const result = await client.markRead(request);
            if (generation !== epoch.current) break;
            if (result?.version !== request.version + 1)
              throw new TransportError("Invalid user-state CAS response");
            current.current = {
              ...current.current,
              version: result.version,
              readContexts: {
                ...current.current.readContexts,
                [request.contextKey]: request.lastReadAt,
              },
            };
            intent.current = null;
          } catch (error) {
            if (generation !== epoch.current) break;
            if (!isOutcomeUnknown(error)) intent.current = null;
            setUnknown(intent.current !== null);
            current.current = null;
            setState(null);
            setFailed(true);
            break;
          }
        }
        writing.current = false;
        // Writes are serialized by queue, not the read generation. A refresh
        // may fence this ACK but must not leave the write UI locked forever.
        setPending(false);
        if (generation === epoch.current) {
          if (current.current) setState(current.current);
        }
        return generation === epoch.current && current.current !== null && intent.current === null;
      });
      queue.current = result.then(() => undefined);
      return result;
    },
    [client],
  );

  // Rechecking is read-only. Unknown writes are never silently reissued with a
  // fresh version, which could overwrite a newer read position from another end.
  const readAt = useCallback(
    (key: string) => (state ? inboxReadAt(state, key) : null),
    [state],
  );
  // Original sidebar observedUnreadEventReadAt folds channel/msg/thread,
  // unlike the Inbox DM row whose read position is the whole channel.
  const eventReadAt = useCallback((event: InboxEvent) => {
    const root = inboxReply(event.tags) ? inboxThread(event.tags).rootId : null;
    const markers = [event.channelId ? readAt(event.channelId) : null,
      readAt(`msg:${event.id}`), root ? readAt(`thread:${root}`) : null]
      .filter((value): value is number => value !== null);
    return markers.length ? Math.max(...markers) : null;
  }, [readAt]);
  return {
    state,
    failed,
    unknown,
    pending,
    refresh,
    write,
    readAt,
    eventReadAt,
    visibleChannels,
    workspaceChannels,
    conversations,
  };
}

export function inboxReadContexts(items: readonly InboxEvent[], read: boolean) {
  const contexts = new Map<string, number>();
  for (const item of items) {
    const key = inboxReadContext(item);
    if (!key) continue;
    // Core accepts an explicit earlier position too: unread is a real CAS
    // update, never a second client-owned override or an invented endpoint.
    const seconds = item.createdAt - (read ? 0 : 1);
    contexts.set(
      key,
      read
        ? Math.max(contexts.get(key) ?? seconds, seconds)
        : Math.min(contexts.get(key) ?? seconds, seconds),
    );
    if (!read && item.channelType === "dm") {
      contexts.set(`msg:${item.id}`, seconds);
      const root = inboxReply(item.tags) ? inboxThread(item.tags).rootId : null;
      if (root) contexts.set(`thread:${root}`, Math.min(contexts.get(`thread:${root}`) ?? seconds, seconds));
    }
  }
  return [...contexts].map(([key, seconds]) => ({ key, seconds }));
}
