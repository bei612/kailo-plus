// DD-125(6), V-SCN-143: transcript data for Installation `audit` holders.
// History is the Core-read Codex thread (ascending pages); live frames are merged
// by item ID with a completed item never replaced by its start.
import * as React from "react";
import type {
  AgentActiveTurnView,
  AgentTranscriptItem,
  AgentTranscriptPage,
} from "@client-kit/contracts";

import { useBffClient, useUiLocale } from "../context";
import type { TranscriptItem } from "./agentSessionTypes";
import {
  adaptTranscriptItems,
  agentSessionKey,
  type AgentTranscriptEntry,
} from "./agentTranscriptAdapter";
import { useAgentTranscriptHost } from "./host";
import {
  EMPTY_LIVE_SNAPSHOT,
  getLiveTranscriptSnapshot,
  subscribeLiveTranscript,
  type LiveTranscriptSnapshot,
} from "./liveTranscriptStore";

/** Pages followed automatically before an explicit "load more" (ascending order). */
const MAX_AUTO_PAGES = 8;

/** The shared live subscription for one Installation (none when not enabled). */
export function useAgentTranscriptLive(
  installationId: string | null,
  enabled: boolean,
): LiveTranscriptSnapshot {
  const host = useAgentTranscriptHost();
  const target = enabled ? installationId : null;
  const { openStream, scopeKey } = host;
  const subscribe = React.useCallback(
    (listener: () => void) =>
      target === null
        ? () => {}
        : subscribeLiveTranscript(openStream, scopeKey, target, listener),
    [openStream, scopeKey, target],
  );
  const getSnapshot = React.useCallback(
    () =>
      target === null
        ? EMPTY_LIVE_SNAPSHOT
        : getLiveTranscriptSnapshot(scopeKey, target),
    [scopeKey, target],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_LIVE_SNAPSHOT);
}

/**
 * Live items of one Installation across its AgentSessions (the original
 * per-agent `useAgentTranscript`), e.g. for the composer activity headline.
 */
export function useAgentTranscript(
  installationId: string | null,
  enabled: boolean,
  options: { agentName?: string; channelId?: string | null } = {},
): TranscriptItem[] {
  const live = useAgentTranscriptLive(installationId, enabled);
  const locale = useUiLocale();
  const { agentName = "", channelId = null } = options;
  return React.useMemo(() => {
    void locale;
    return adaptTranscriptItems(live.entries, { agentName, channelId });
  }, [agentName, channelId, live.entries, locale]);
}

type LoadedPage = { cursor: string | undefined; page: AgentTranscriptPage };

function validItem(item: AgentTranscriptItem): boolean {
  return Boolean(item) && typeof item.itemId === "string" && item.itemId.length > 0
    && typeof item.turnId === "string" && typeof item.kind === "string"
    && typeof item.nativeType === "string";
}

export function validTranscriptPage(
  page: AgentTranscriptPage,
  installationId: string,
  rootEventId: string,
  projectionGeneration: number,
  usedCursors: readonly (string | undefined)[],
): boolean {
  return Boolean(page) && page.installationId === installationId
    && page.rootEventId === rootEventId && page.projectionGeneration === projectionGeneration
    && Array.isArray(page.items) && page.items.every(validItem)
    && (page.nextCursor === undefined
      || (typeof page.nextCursor === "string" && page.nextCursor.length > 0
        && !usedCursors.includes(page.nextCursor)))
    && (page.activeTurn === undefined
      || (page.activeTurn.installationId === installationId
        && page.activeTurn.rootEventId === rootEventId
        && page.activeTurn.projectionGeneration === projectionGeneration));
}

/** History entries in page order, live entries of the same session merged by item ID. */
export function mergeSessionEntries(
  history: readonly AgentTranscriptEntry[],
  live: LiveTranscriptSnapshot,
  rootEventId: string,
  projectionGeneration: number,
): AgentTranscriptEntry[] {
  const session = agentSessionKey(rootEventId, projectionGeneration);
  const liveById = new Map<string, AgentTranscriptEntry & { completed: boolean }>();
  for (const entry of live.entries) {
    if (agentSessionKey(entry.rootEventId, entry.projectionGeneration) !== session) continue;
    liveById.set(entry.item.itemId, entry);
  }
  const merged: AgentTranscriptEntry[] = [];
  const seen = new Set<string>();
  for (const entry of history) {
    if (seen.has(entry.item.itemId)) continue;
    seen.add(entry.item.itemId);
    const update = liveById.get(entry.item.itemId);
    const settled = entry.item.completedAtMs !== undefined
      || (entry.item.status !== undefined && (entry.item.status as string) !== "IN_PROGRESS");
    merged.push(update && update.completed && !settled ? update : entry);
  }
  for (const [itemId, entry] of liveById) {
    if (!seen.has(itemId)) merged.push(entry);
  }
  return merged;
}

export type AgentSessionTranscriptState = {
  status: "pending" | "ok" | "error";
  error?: unknown;
  items: TranscriptItem[];
  activeTurn?: AgentActiveTurnView;
  threadId?: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  reload: () => void;
  live: LiveTranscriptSnapshot;
  /** A live turn/started for this session without its turn/completed. */
  liveTurnRunning: boolean;
};

/**
 * One AgentSession's transcript: Core pages (`thread/items/list`) plus live
 * frames. A live turn start or completion re-reads the last page so the
 * active turn, its cancel key and any frames missed while offline converge.
 */
export function useAgentSessionTranscript({
  agentName,
  channelId = null,
  enabled,
  installationId,
  projectionGeneration,
  rootEventId,
}: {
  agentName: string;
  channelId?: string | null;
  enabled: boolean;
  installationId: string;
  projectionGeneration: number;
  rootEventId: string;
}): AgentSessionTranscriptState {
  const client = useBffClient();
  const host = useAgentTranscriptHost();
  const locale = useUiLocale();
  const live = useAgentTranscriptLive(installationId, enabled);
  const scope = `${host.scopeKey ?? ""}|${installationId}|${rootEventId}|${projectionGeneration}`;
  const [state, setState] = React.useState<{
    scope: string;
    pages: LoadedPage[];
    status: "pending" | "ok" | "error";
    error?: unknown;
    loadingMore: boolean;
  }>({ scope, pages: [], status: "pending", loadingMore: false });
  const round = React.useRef(0);
  const pagesRef = React.useRef<LoadedPage[]>([]);

  const follow = React.useCallback(
    async (start: LoadedPage[], cursor: string | undefined, budget: number) => {
      const token = ++round.current;
      const pages = [...start];
      let next = cursor;
      let first = true;
      try {
        for (let fetched = 0; fetched < budget && (first || next !== undefined); fetched += 1) {
          first = false;
          const used = pages.map((entry) => entry.cursor);
          const page = await client.agentTranscript(installationId, rootEventId, projectionGeneration, next);
          if (token !== round.current) return;
          if (!validTranscriptPage(page, installationId, rootEventId, projectionGeneration, used)) {
            throw new Error("transcript page outside the requested session");
          }
          pages.push({ cursor: next, page });
          next = page.nextCursor;
        }
        pagesRef.current = pages;
        setState({ scope, pages, status: "ok", loadingMore: false });
      } catch (error) {
        if (token !== round.current) return;
        setState((old) => ({ ...old, scope, status: pages.length > 0 ? "ok" : "error", error, loadingMore: false,
          pages: pages.length > 0 ? pages : old.pages }));
      }
    },
    [client, installationId, projectionGeneration, rootEventId, scope],
  );

  const reload = React.useCallback(() => {
    pagesRef.current = [];
    setState({ scope, pages: [], status: "pending", loadingMore: false });
    void follow([], undefined, MAX_AUTO_PAGES);
  }, [follow, scope]);

  React.useEffect(() => {
    if (!enabled) return;
    reload();
    return () => {
      round.current += 1;
    };
  }, [enabled, reload]);

  // A live turn boundary of this session re-reads the last page in place.
  const session = agentSessionKey(rootEventId, projectionGeneration);
  const sessionTurn = live.turns.find(
    (turn) => agentSessionKey(turn.rootEventId, turn.projectionGeneration) === session,
  );
  const turnSignal = sessionTurn ? `${sessionTurn.turnId}:${sessionTurn.completed}` : "";
  React.useEffect(() => {
    if (!enabled || !turnSignal) return;
    const pages = pagesRef.current;
    const last = pages[pages.length - 1];
    if (!last) return;
    void follow(pages.slice(0, -1), last.cursor, MAX_AUTO_PAGES);
  }, [enabled, follow, turnSignal]);

  const loadMore = React.useCallback(() => {
    const pages = pagesRef.current;
    const next = pages[pages.length - 1]?.page.nextCursor;
    if (next === undefined) return;
    setState((old) => ({ ...old, loadingMore: true }));
    void follow(pages, next, MAX_AUTO_PAGES);
  }, [follow]);

  const current = state.scope === scope ? state : { scope, pages: [], status: "pending" as const, loadingMore: false };
  const lastPage = current.pages[current.pages.length - 1]?.page;
  const history = React.useMemo<AgentTranscriptEntry[]>(
    () => current.pages.flatMap(({ page }) => page.items.map((item) => ({
      item, rootEventId, projectionGeneration,
    }))),
    [current.pages, projectionGeneration, rootEventId],
  );
  const items = React.useMemo(() => {
    void locale;
    return adaptTranscriptItems(
      mergeSessionEntries(history, live, rootEventId, projectionGeneration),
      { agentName, channelId },
    );
  }, [agentName, channelId, history, live, locale, projectionGeneration, rootEventId]);

  return {
    status: current.status,
    error: "error" in current ? current.error : undefined,
    items,
    activeTurn: lastPage?.activeTurn,
    threadId: lastPage?.threadId,
    hasMore: lastPage?.nextCursor !== undefined,
    loadingMore: current.loadingMore,
    loadMore,
    reload,
    live,
    liveTurnRunning: sessionTurn !== undefined && !sessionTurn.completed,
  };
}
