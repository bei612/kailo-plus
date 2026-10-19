// DD-125(6): one shared live subscription per Installation (ref-counted), fed by
// the host SSE seam. Frames are kept only in memory while someone is subscribed
// and are dropped with the last subscriber; history comes from pages.
import type { AgentTranscriptEvent } from "@client-kit/contracts";

import type {
  AgentTranscriptStreamOpener,
  AgentTranscriptStreamState,
} from "../../client";
import { agentSessionKey, type AgentTranscriptEntry } from "./agentTranscriptAdapter";

export type LiveTranscriptEntry = AgentTranscriptEntry & { completed: boolean };

export type LiveTurn = {
  rootEventId: string;
  projectionGeneration: number;
  turnId: string;
  /** Native turn/started time; absent when the frame carried none. */
  startedAtMs?: number;
  completed: boolean;
};

export type LiveTranscriptSnapshot = {
  state: AgentTranscriptStreamState | "unavailable";
  reason?: string;
  entries: readonly LiveTranscriptEntry[];
  turns: readonly LiveTurn[];
  /** Bumps on every applied frame; consumers refresh pages on turn changes. */
  turnVersion: number;
};

/** Original MAX_OBSERVER_EVENTS-style cap for the in-memory live window. */
const MAX_LIVE_ENTRIES = 500;

export const EMPTY_LIVE_SNAPSHOT: LiveTranscriptSnapshot = {
  state: "unavailable",
  entries: [],
  turns: [],
  turnVersion: 0,
};

type Channel = {
  refs: number;
  close: (() => void) | null;
  entries: Map<string, LiveTranscriptEntry>;
  turns: Map<string, LiveTurn>;
  listeners: Set<() => void>;
  snapshot: LiveTranscriptSnapshot;
};

const channels = new Map<string, Channel>();

function channelKey(scopeKey: string | undefined, installationId: string) {
  return `${scopeKey ?? ""}|${installationId}`;
}

function publish(channel: Channel, patch: Partial<LiveTranscriptSnapshot>) {
  channel.snapshot = {
    ...channel.snapshot,
    entries: [...channel.entries.values()],
    turns: [...channel.turns.values()],
    ...patch,
  };
  for (const listener of channel.listeners) listener();
}

/** Apply one forwarded frame; a completed item is never replaced by a late start. */
export function applyTranscriptEvent(
  entries: Map<string, LiveTranscriptEntry>,
  turns: Map<string, LiveTurn>,
  event: AgentTranscriptEvent,
): boolean {
  const session = agentSessionKey(event.rootEventId, event.projectionGeneration);
  const phase: string = event.phase;
  if (phase === "ITEM_STARTED" || phase === "ITEM_COMPLETED") {
    if (!event.item) return false;
    const key = `${session}:${event.item.itemId}`;
    const completed = phase === "ITEM_COMPLETED";
    if (!completed && entries.get(key)?.completed) return false;
    entries.delete(key);
    entries.set(key, {
      item: event.item,
      rootEventId: event.rootEventId,
      projectionGeneration: event.projectionGeneration,
      completed,
    });
    while (entries.size > MAX_LIVE_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    return true;
  }
  if (phase === "TURN_STARTED" || phase === "TURN_COMPLETED") {
    turns.set(session, {
      rootEventId: event.rootEventId,
      projectionGeneration: event.projectionGeneration,
      turnId: event.turnId,
      startedAtMs:
        phase === "TURN_STARTED"
          ? event.atMs
          : turns.get(session)?.turnId === event.turnId
            ? turns.get(session)?.startedAtMs
            : undefined,
      completed: phase === "TURN_COMPLETED",
    });
    return true;
  }
  return false;
}

export function subscribeLiveTranscript(
  opener: AgentTranscriptStreamOpener | undefined,
  scopeKey: string | undefined,
  installationId: string,
  listener: () => void,
): () => void {
  const key = channelKey(scopeKey, installationId);
  let channel = channels.get(key);
  if (!channel) {
    channel = {
      refs: 0,
      close: null,
      entries: new Map(),
      turns: new Map(),
      listeners: new Set(),
      snapshot: { ...EMPTY_LIVE_SNAPSHOT, state: opener ? "connecting" : "unavailable" },
    };
    channels.set(key, channel);
  }
  const current = channel;
  current.refs += 1;
  current.listeners.add(listener);
  if (current.refs === 1 && opener) {
    current.close = opener(
      installationId,
      (event) => {
        if (channels.get(key) !== current) return;
        if (!applyTranscriptEvent(current.entries, current.turns, event)) return;
        const phase: string = event.phase;
        const turnChanged = phase === "TURN_STARTED" || phase === "TURN_COMPLETED";
        publish(current, turnChanged ? { turnVersion: current.snapshot.turnVersion + 1 } : {});
      },
      (state, reason) => {
        if (channels.get(key) !== current) return;
        publish(current, { state, reason });
      },
    );
  }
  return () => {
    current.listeners.delete(listener);
    current.refs -= 1;
    if (current.refs > 0) return;
    channels.delete(key);
    current.close?.();
    current.close = null;
  };
}

export function getLiveTranscriptSnapshot(
  scopeKey: string | undefined,
  installationId: string,
): LiveTranscriptSnapshot {
  return channels.get(channelKey(scopeKey, installationId))?.snapshot ?? EMPTY_LIVE_SNAPSHOT;
}
