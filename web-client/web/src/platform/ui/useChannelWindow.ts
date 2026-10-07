import { ReasonCode } from "@client-kit/contracts";
import { useReasonText } from "@client-kit/platform/react/context";
import { parseChannelWindowResponse, parseLiveThreadSummary } from "@client-kit/platform/react/forum/channelWindowResponse";
import { getThreadReference, isBroadcastReply } from "@client-kit/platform/react/messages/threading";
import { CHANNEL_AUX_EVENT_KINDS, CHANNEL_TIMELINE_CONTENT_KINDS } from "@client-kit/platform/react/thread/kinds";
import { appendOlderChannelWindow, channelWindowHasMore, channelWindowHistoryExhausted, channelWindowThreadSummaries, emptyChannelWindowStore, flattenChannelWindowEvents, mergeLiveChannelWindowEvent, mergeLiveThreadSummary, replaceNewestChannelWindow, type ChannelWindowStore } from "@client-kit/platform/react/messages/timeline/channelWindowStore";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { bff, openStream, type BuzzEvent } from "@/platform/bff-client";
import { t } from "@/shared/i18n";

const rows: ReadonlySet<number> = new Set(CHANNEL_TIMELINE_CONTENT_KINDS);
const auxiliary: ReadonlySet<number> = new Set(CHANNEL_AUX_EVENT_KINDS);

// Host of Buzz's original channelWindowStore: SSE supplies the authoritative
// head; the existing admitted BFF query continues its exact composite cursor.
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
  const state = useRef({ scope, store, active: false, ready: false, generation: 0, fetching: false });
  if (state.current.scope !== scope) state.current = { scope, store: empty, active: false, ready: false, generation: state.current.generation + 1, fetching: false };
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
    current.active = true;
    current.ready = false;
    current.generation += 1;
    current.fetching = false;
    setLive(false); setDenied(false); setError(false); setFetching(false);
    setStatus(t(archived ? "channel.archived" : "platform.stream.connecting"));
    // Original archived transition stops the subscription without deleting
    // already admitted visible history. The scope fence still clears old scopes.
    if (archived) return () => { current.active = false; };
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
          if (!seen.has(event.id)) { seen.add(event.id); if (ready) receiveLive(event); }
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
          current.ready = false;
          ready = false; snapshotAccepted = false; current.generation += 1;
          current.fetching = false; setFetching(false);
          setLive(false); setStatus(t("platform.stream.reconnecting")); break;
        case "ended":
          current.ready = false;
          ready = false; snapshotAccepted = false; current.generation += 1;
          current.fetching = false; setFetching(false);
          setLive(false); setStatus(t("platform.stream.ended")); break;
      }
    }, conversationId);
    return () => { closed = true; current.active = false; current.generation += 1; stop(); };
  }, [scope, workspaceId, conversationId, channelId, archived, retry, reasonText, empty]);

  const fetchOlder = useCallback(async () => {
    const current = state.current;
    const cursor = current.store.pages.at(-1)?.nextCursor;
    if (!channelId || !live || !current.ready || !current.active || current.fetching || !cursor) return;
    const generation = current.generation;
    current.fetching = true; setFetching(true);
    try {
      const query = { before: cursor.createdAt, beforeId: cursor.eventId };
      const page = await (conversationId ? bff.conversationMessages(conversationId, query) : bff.workspaceMessages(workspaceId, query));
      if (!current.active || state.current !== current || current.generation !== generation) return;
      if (!Array.isArray(page.events)) throw new Error("Invalid channel window");
      const parsed = parseChannelWindowResponse(page.events as BuzzEvent[], channelId, cursor);
      const next = appendOlderChannelWindow(current.store, parsed);
      current.store = next; setProjection({ scope, store: next }); setError(false); setStatus(t("platform.stream.synced"));
    } catch {
      if (current.active && state.current === current && current.generation === generation) { setError(true); setStatus(t("platform.loadFailed")); }
    } finally {
      if (current.active && state.current === current && current.generation === generation) { current.fetching = false; setFetching(false); }
    }
  }, [scope, workspaceId, conversationId, channelId, live]);
  const events = useMemo(() => flattenChannelWindowEvents(store), [store]);
  const threadSummaries = useMemo(() => channelWindowThreadSummaries(store), [store]);
  const authoritativeRowIds = useMemo(() => new Set(store.pages.flatMap(page => page.rows.map(row => row.event.id))), [store]);
  return { events, threadSummaries, authoritativeRowIds, status, live, denied, error,
    fetchOlder, isFetchingOlder: fetching, hasOlderMessages: channelWindowHasMore(store),
    historyExhausted: channelWindowHistoryExhausted(store), retry: () => setRetry(value => value + 1) };
}
