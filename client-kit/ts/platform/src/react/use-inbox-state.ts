import type { ReadMarkRequest, ConversationView, UserStateVersion } from "@client-kit/contracts";
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
import {
  isOutcomeUnknown,
  isRateLimited,
  RATE_LIMITED_QUERY_RETRIES,
  rateLimitRetryMs,
  TransportError,
} from "../transport";

/** DD-156(2): a window focus re-reads the Inbox state at most once per this interval. */
export const FOCUS_REFRESH_MIN_INTERVAL_MS = 30_000;

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
  // The identity whose confirmed state is on screen; another client never inherits it.
  const owner = useRef<BffClient | null>(null);
  const lastRefresh = useRef(Number.NEGATIVE_INFINITY);
  const limitedRetry = useRef<{ timer?: ReturnType<typeof setTimeout>; attempts: number }>({ attempts: 0 });
  const [rateLimited, setRateLimited] = useState(false);
  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    lastRefresh.current = Date.now();
    if (limitedRetry.current.timer !== undefined) {
      clearTimeout(limitedRetry.current.timer);
      limitedRetry.current.timer = undefined;
    }
    // DD-156(2): a re-read keeps the confirmed state on screen and replaces it on success;
    // only another identity, or a real failure below, clears it.
    if (owner.current !== client) {
      owner.current = client;
      current.current = null;
      setState(null);
      setVisibleChannels(new Set());
      setConversations([]); setWorkspaceChannels(new Set());
    }
    setFailed(false);
    setUnknown(intent.current !== null);
    try {
      // The three reads start together: a read mark's re-read from another consumer shares the
      // same in-flight user-state read instead of issuing a second one (DD-156(2)).
      const [workspaces, privateChannels, userState] = await Promise.all([
        client.workspaces(),
        loadInboxConversations(client, () => generation === epoch.current),
        client.collaborationUserState(),
      ]);
      if (generation !== epoch.current) return;
      if (
        !Array.isArray(workspaces) ||
        workspaces.some((workspace) => typeof workspace.id !== "string")
      )
        throw new Error("Invalid Workspace directory");
      const next = checkedUserState(userState);
      // A higher CAS version proves the old request can no longer write. A
      // still-equal version does not prove a late request was never accepted.
      if (intent.current && next.version > intent.current.version) {
        intent.current = null;
        setUnknown(false);
      }
      // A read that started before an acknowledged write never rolls the CAS version back.
      const adopted = current.current && current.current.version > next.version ? current.current : next;
      current.current = adopted;
      setState(adopted);
      const workspaceIds = workspaces.filter((workspace) => workspace.isMember === true).map((workspace) => workspace.id);
      setWorkspaceChannels(new Set(workspaceIds)); setConversations(privateChannels);
      setVisibleChannels(new Set([...workspaceIds, ...privateChannels.map(item => item.channelId)]));
      limitedRetry.current.attempts = 0;
      setRateLimited(false);
    } catch (error) {
      if (generation !== epoch.current) return;
      // DD-156(3): LIMIT/RATE_LIMITED is definitely unprocessed, not a failed or unknown read.
      // Keep what is on screen and re-read after Retry-After, a bounded number of times.
      if (isRateLimited(error) && limitedRetry.current.attempts < RATE_LIMITED_QUERY_RETRIES) {
        limitedRetry.current.attempts += 1;
        setRateLimited(true);
        limitedRetry.current.timer = setTimeout(() => {
          limitedRetry.current.timer = undefined;
          if (generation === epoch.current) void refresh();
        }, rateLimitRetryMs(error) ?? 1_000);
        return;
      }
      limitedRetry.current.attempts = 0;
      setRateLimited(false);
      current.current = null;
      setState(null);
      setVisibleChannels(new Set());
      setConversations([]); setWorkspaceChannels(new Set());
      setFailed(true);
    }
  }, [client]);
  // Within the focus interval only the admitted directory (Workspaces and private channels) is
  // re-read, so a revoked scope still leaves the screen; the read state is kept as confirmed.
  // Any failure falls back to the full re-read, which reports it.
  const refreshScope = useCallback(async () => {
    const generation = epoch.current;
    try {
      const [workspaces, privateChannels] = await Promise.all([
        client.workspaces(),
        loadInboxConversations(client, () => generation === epoch.current),
      ]);
      if (generation !== epoch.current) return;
      if (
        !Array.isArray(workspaces) ||
        workspaces.some((workspace) => typeof workspace.id !== "string")
      )
        throw new Error("Invalid Workspace directory");
      const workspaceIds = workspaces.filter((workspace) => workspace.isMember === true).map((workspace) => workspace.id);
      setWorkspaceChannels(new Set(workspaceIds)); setConversations(privateChannels);
      setVisibleChannels(new Set([...workspaceIds, ...privateChannels.map(item => item.channelId)]));
    } catch {
      if (generation === epoch.current) void refresh();
    }
  }, [client, refresh]);
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      if (writing.current) return;
      // DD-156(2): the read state is re-read on focus at most once per interval; switching
      // windows back and forth does not re-read the whole Inbox state each time.
      if (Date.now() - lastRefresh.current >= FOCUS_REFRESH_MIN_INTERVAL_MS) void refresh();
      else void refreshScope();
    };
    window.addEventListener("focus", onFocus);
    const retry = limitedRetry.current;
    return () => {
      epoch.current += 1;
      current.current = null;
      owner.current = null;
      if (retry.timer !== undefined) clearTimeout(retry.timer);
      retry.timer = undefined;
      retry.attempts = 0;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, refreshScope]);

  const write = useCallback(
    (contexts: readonly { key: string; seconds: number }[]) => {
      const generation = epoch.current;
      const result = queue.current.then(async () => {
        if (generation !== epoch.current || intent.current || !current.current)
          return false;
        writing.current = true;
        setPending(true);
        let limited = false;
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
            // DD-156(3): a rate-limited write was definitely not processed. The confirmed state
            // stays as it is and the write is never re-sent automatically.
            if (isRateLimited(error)) { limited = true; break; }
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
        return !limited && generation === epoch.current && current.current !== null && intent.current === null;
      });
      queue.current = result.then(() => undefined);
      return result;
    },
    [client],
  );

  // DD-125 preference writes share the same CAS and queue as read marks. `send`
  // receives the version it must present; on its ACK the acknowledged change is
  // projected locally (the same rule Core applied), or, without a local rule, the
  // state is re-read without clearing what is on screen. A conflict or failure
  // re-reads the authority; nothing is reissued with a fresher version.
  const update = useCallback(
    (
      // The authority the write is based on: the same snapshot its version comes from.
      send: (version: number, state: CollaborationUserState) => Promise<UserStateVersion>,
      patch?: (state: CollaborationUserState, now: string) => CollaborationUserState,
    ) => {
      const generation = epoch.current;
      const result = queue.current.then(async () => {
        if (generation !== epoch.current || intent.current || !current.current) return false;
        const version = current.current.version;
        writing.current = true;
        setPending(true);
        try {
          const ack = await send(version, current.current);
          if (generation !== epoch.current) return false;
          if (ack?.version !== version + 1) throw new TransportError("Invalid user-state CAS response");
          if (!current.current) return false;
          if (patch) {
            current.current = { ...patch(current.current, new Date().toISOString()), version: ack.version };
            setState(current.current);
          } else {
            const next = checkedUserState(await client.collaborationUserState());
            if (generation !== epoch.current) return false;
            if (next.version >= ack.version) {
              current.current = next;
              setState(next);
            } else {
              void refresh();
            }
          }
          return true;
        } catch {
          if (generation === epoch.current) void refresh();
          return false;
        } finally {
          writing.current = false;
          setPending(false);
        }
      });
      queue.current = result.then(() => undefined);
      return result;
    },
    [client, refresh],
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
    /** DD-156(3): the last re-read was rate limited and is retried after Retry-After. */
    rateLimited,
    unknown,
    pending,
    refresh,
    write,
    update,
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
