import { ReasonCode } from "@client-kit/contracts";
import { BffError } from "@client-kit/platform/transport";
import { useReasonText } from "@client-kit/platform/react/context";
import { parseChannelWindowResponse, parseLiveThreadSummary } from "@client-kit/platform/react/forum/channelWindowResponse";
import { getThreadReference, isBroadcastReply } from "@client-kit/platform/react/messages/threading";
import { CHANNEL_AUX_EVENT_KINDS, CHANNEL_TIMELINE_CONTENT_KINDS } from "@client-kit/platform/react/thread/kinds";
import { KIND_TYPING_INDICATOR } from "@client-kit/platform/react/thread/kinds";
import { emptyTypingState, pruneTypingState, receiveTypingEvent, typingEntries, TYPING_PRUNE_INTERVAL_MS } from "@client-kit/platform/react/messages/typingState";
import { appendOlderChannelWindow, channelWindowHasMore, channelWindowHistoryExhausted, channelWindowThreadSummaries, emptyChannelWindowStore, flattenChannelWindowEvents, mergeLiveChannelWindowEvent, mergeLiveThreadSummary, replaceNewestChannelWindow, type ChannelWindowStore } from "@client-kit/platform/react/messages/timeline/channelWindowStore";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { bff, openStream, type BuzzEvent } from "@/platform/bff-client";
import { t } from "@/shared/i18n";

const rows: ReadonlySet<number> = new Set(CHANNEL_TIMELINE_CONTENT_KINDS);
const auxiliary: ReadonlySet<number> = new Set(CHANNEL_AUX_EVENT_KINDS);

// Host of Buzz's original channelWindowStore: SSE supplies the authoritative
// head; archived channels read that same head through the admitted BFF query.
// The existing query continues its exact composite cursor in either case.
// No separate history, summary or unread authority is introduced here.
export function useChannelWindow({ workspaceId, conversationId, principalId, channelId, archived = false, onLiveEvent, onClosed }: {
  workspaceId: string; conversationId?: string; principalId: string; channelId?: string;
  archived?: boolean; onLiveEvent?: (event: BuzzEvent) => void; onClosed?: () => void;
}) {
  const scope = JSON.stringify([principalId, workspaceId, conversationId, channelId]);
  const reasonText = useReasonText();
  const empty = useMemo(emptyChannelWindowStore, [scope]);
  const [projection, setProjection] = useState({ scope, store: empty });
  const store = projection.scope === scope ? projection.store : empty;
  const [typingProjection, setTypingProjection] = useState({ scope, typing: emptyTypingState() });
  const state = useRef({ scope, store, typing: emptyTypingState(), active: false, ready: false, generation: 0, fetching: false });
  if (state.current.scope !== scope) state.current = { scope, store: empty, typing: emptyTypingState(), active: false, ready: false, generation: state.current.generation + 1, fetching: false };
  const [status, setStatus] = useState(t("platform.stream.connecting"));
  const [live, setLive] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [retry, setRetry] = useState(0);
  const receiveLive = useEffectEvent((event: BuzzEvent) => onLiveEvent?.(event));
  const refreshMetadata = useEffectEvent(() => onClosed?.());

  useEffect(() => {
    let closed = false;
    const current = state.current;
    const publishTyping = (typing = emptyTypingState()) => {
      current.typing = typing;
      setTypingProjection({ scope, typing });
    };
    publishTyping();
    current.active = true;
    current.ready = false;
    current.generation += 1;
    current.fetching = false;
    setLive(false); setDenied(false); setError(false); setFetching(false);
    setStatus(t(archived ? "channel.archived" : "platform.stream.connecting"));
    // Buzz keeps archived channel history readable, but never enables writes.
    // Retain already visible rows while refreshing through the same fresh BFF
    // admission as every older page. This is not a live/subscription grant.
    if (archived) {
      const generation = current.generation;
      if (channelId) void (async () => {
        try {
          const page = await (conversationId ? bff.conversationMessages(conversationId) : bff.workspaceMessages(workspaceId));
          if (closed || !current.active || state.current !== current || current.generation !== generation) return;
          if (!Array.isArray(page.events)) throw new Error("Invalid channel window");
          const parsed = parseChannelWindowResponse(page.events as BuzzEvent[], channelId, null);
          current.store = replaceNewestChannelWindow(current.store, parsed);
          current.ready = true;
          setProjection({ scope, store: current.store });
        } catch (cause) {
          if (closed || !current.active || state.current !== current || current.generation !== generation) return;
          // Never retain an old window after a fresh scope/binding refusal.
          if (cause instanceof BffError) {
            current.store = emptyChannelWindowStore();
            setProjection({ scope, store: current.store });
          }
          setError(true); setStatus(t("platform.loadFailed"));
        }
      })();
      return () => { closed = true; current.active = false; current.generation += 1; };
    }
    current.store = empty;
    setProjection({ scope, store: empty });
    if (!channelId) return () => { current.active = false; };
    let ready = false;
    let snapshotAccepted = false;
    const seen = new Set<string>();
    const publish = (next: ChannelWindowStore) => {
      current.store = next;
      setProjection({ scope, store: next });
    };
    const stop = openStream(workspaceId, (frame) => {
      if (closed || !current.active || state.current !== current) return;
      switch (frame.type) {
        case "snapshot":
          publishTyping();
          current.ready = false;
          ready = false;
          snapshotAccepted = false;
          current.generation += 1; // invalidate any older-page response from the previous head
          current.fetching = false; setFetching(false);
          try {
            const page = parseChannelWindowResponse(frame.events, channelId, null);
            publish(replaceNewestChannelWindow(current.store, page));
            for (const event of frame.events) seen.add(event.id);
            snapshotAccepted = true; setError(false); setDenied(false);
          } catch {
            publish(emptyChannelWindowStore()); setLive(false); setError(true); setStatus(t("platform.loadFailed"));
          }
          break;
        case "event": {
          if (!snapshotAccepted) break;
          const event = frame.event;
          // Ephemeral events never become rows, notifications or retained IDs.
          if (event.kind === KIND_TYPING_INDICATOR) {
            if (ready) publishTyping(receiveTypingEvent(current.typing, event, channelId));
            break;
          }
          if (!seen.has(event.id)) {
            seen.add(event.id);
            if (ready) {
              const typing = receiveTypingEvent(current.typing, event, channelId);
              if (typing !== current.typing) publishTyping(typing);
              receiveLive(event);
            }
          }
          const summary = parseLiveThreadSummary(event);
          if (summary) { publish(mergeLiveThreadSummary(current.store, summary.rootId, summary.live)); break; }
          const isRow = rows.has(event.kind);
          // Original useChannelSubscription: non-broadcast replies belong to
          // the independently admitted thread, not a new top-level live row.
          if (isRow && getThreadReference(event.tags).parentId && !isBroadcastReply(event.tags)) break;
          if (isRow || auxiliary.has(event.kind)) publish(mergeLiveChannelWindowEvent(current.store, event, isRow));
          break;
        }
        case "live":
          ready = snapshotAccepted;
          current.ready = snapshotAccepted;
          setLive(snapshotAccepted);
          if (snapshotAccepted) setStatus(t("platform.stream.synced"));
          break;
        case "closed":
          publishTyping();
          current.ready = false;
          ready = false; snapshotAccepted = false; setLive(false); refreshMetadata();
          current.generation += 1; current.fetching = false; setFetching(false);
          if (["session-revoked", "scope-revoked", "identity-revoked"].includes(frame.reason)) {
            current.active = false;
            publish(emptyChannelWindowStore()); setDenied(true); setFetching(false);
            setStatus(reasonText(frame.reason === "session-revoked" ? ReasonCode.SessionNotActive : ReasonCode.PermissionDenied));
          } else {
            if (frame.reason === "binding-not-active" || frame.reason === "scope-changed") {
              publish(emptyChannelWindowStore()); setDenied(true);
            }
            setStatus(`${t("platform.stream.reconnecting")}（${frame.reason}）`);
          }
          break;
        case "interrupted":
          publishTyping();
          current.ready = false;
          ready = false; snapshotAccepted = false; current.generation += 1;
          current.fetching = false; setFetching(false);
          setLive(false); setStatus(t("platform.stream.reconnecting")); break;
        case "ended":
          publishTyping();
          current.ready = false;
          ready = false; snapshotAccepted = false; current.generation += 1;
          current.fetching = false; setFetching(false);
          setLive(false); setStatus(t("platform.stream.ended")); break;
      }
    }, conversationId);
    return () => { closed = true; current.active = false; current.generation += 1; stop(); };
  }, [scope, workspaceId, conversationId, channelId, archived, retry, reasonText, empty]);

  const typingState = typingProjection.scope === scope ? typingProjection.typing : emptyTypingState();
  const hasTypingState = Object.keys(typingState.typing).length > 0 || Object.keys(typingState.completed).length > 0;
  useEffect(() => {
    if (!live || !hasTypingState) return;
    const current = state.current;
    const timer = globalThis.setInterval(() => {
      if (!current.active || !current.ready || state.current !== current) return;
      const typing = pruneTypingState(current.typing);
      if (typing !== current.typing) {
        current.typing = typing;
        setTypingProjection({ scope, typing });
      }
    }, TYPING_PRUNE_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [scope, live, hasTypingState]);

  const fetchOlder = useCallback(async () => {
    const current = state.current;
    const cursor = current.store.pages.at(-1)?.nextCursor;
    if (!channelId || (!archived && !live) || !current.ready || !current.active || current.fetching || !cursor) return;
    const generation = current.generation;
    current.fetching = true; setFetching(true);
    try {
      const query = { before: cursor.createdAt, beforeId: cursor.eventId };
      const page = await (conversationId ? bff.conversationMessages(conversationId, query) : bff.workspaceMessages(workspaceId, query));
      if (!current.active || state.current !== current || current.generation !== generation) return;
      if (!Array.isArray(page.events)) throw new Error("Invalid channel window");
      const parsed = parseChannelWindowResponse(page.events as BuzzEvent[], channelId, cursor);
      const next = appendOlderChannelWindow(current.store, parsed);
      current.store = next; setProjection({ scope, store: next }); setError(false); setStatus(t(archived ? "channel.archived" : "platform.stream.synced"));
    } catch (cause) {
      if (current.active && state.current === current && current.generation === generation) {
        if (archived && cause instanceof BffError) {
          current.ready = false;
          current.store = emptyChannelWindowStore();
          setProjection({ scope, store: current.store });
        }
        setError(true); setStatus(t("platform.loadFailed"));
      }
    } finally {
      if (current.active && state.current === current && current.generation === generation) { current.fetching = false; setFetching(false); }
    }
  }, [scope, workspaceId, conversationId, channelId, archived, live]);
  const events = useMemo(() => flattenChannelWindowEvents(store), [store]);
  const threadSummaries = useMemo(() => channelWindowThreadSummaries(store), [store]);
  const authoritativeRowIds = useMemo(() => new Set(store.pages.flatMap(page => page.rows.map(row => row.event.id))), [store]);
  return { events, threadSummaries, authoritativeRowIds, status, live, denied, error,
    typing: live && !archived && !denied ? typingEntries(typingState) : [],
    isLoading: !error && !live && store.pages.length === 0,
    fetchOlder, isFetchingOlder: fetching, hasOlderMessages: channelWindowHasMore(store),
    historyExhausted: channelWindowHistoryExhausted(store), retry: () => setRetry(value => value + 1) };
}
