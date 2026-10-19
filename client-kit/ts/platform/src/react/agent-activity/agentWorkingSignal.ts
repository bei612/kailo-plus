// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/agentWorkingSignal.ts (+ the ActiveChannelTurnSummary shape and the
// per-channel turn aggregation of activeAgentTurnsStore.ts::getActiveTurnsByChannel).
//
// Unified "agent is working" signal, same merge rule as the original:
//   1. Turn-derived work is primary. Kailo Agents publish no 24200 observer frames (DD-125(6));
//      the primary input is the audited AgentActiveTurnPage that Core gives Installation `audit`
//      holders (anchor = the native turn start, never the local clock when it is known).
//   2. Agent 20002 typing (Core signs it as the AGENT while a turn runs) is the fallback that
//      every member sees, anchored to first-seen typing like the original.
// The channel key is the host's channel identity (the Web uses the Workspace ID of the route).
// Reporters always send the full current set for one channel; an empty set clears it.
import * as React from "react";

export type ActiveChannelTurnSummary = {
  channelId: string;
  anchorAt: number;
  agentCount: number;
  agentPubkeys: string[];
  agentNames?: string[];
};

export type AgentWorkingSource = "turn" | "typing" | "none";

export type AgentWorkingChannel = {
  channelId: string;
  /** Anchor for elapsed displays (native turn start / first typing). */
  anchorAt: number;
  source: Exclude<AgentWorkingSource, "none">;
};

export type AgentWorkingState = {
  working: boolean;
  source: AgentWorkingSource;
  channels: AgentWorkingChannel[];
};

export type WorkingChannelSummary = ActiveChannelTurnSummary & {
  source: Exclude<AgentWorkingSource, "none">;
};

/** One audited running turn as reported for a channel. */
export type ReportedAgentTurn = { agentPubkey: string; anchorAt: number };

/** Display facts of the channel's admitted Agents (Installation directory, never kind:0 is_agent). */
export type WorkingAgentInfo = {
  pubkey: string;
  name: string;
  /** Installation `audit`: the original "View activity" entry is offered. */
  canOpenActivity: boolean;
};

const IDLE_STATE: AgentWorkingState = { working: false, source: "none", channels: [] };

export function normalizePubkey(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

// channelId → (normalized pubkey → first-seen ms)
const typingByChannel = new Map<string, Map<string, number>>();
// channelId → (normalized pubkey → turn anchor ms)
const turnsByChannel = new Map<string, Map<string, number>>();
// channelId → (normalized pubkey → admitted Agent display facts)
const agentsByChannel = new Map<string, Map<string, WorkingAgentInfo>>();

const listeners = new Set<() => void>();
const stateCache = new Map<string, AgentWorkingState>();
let channelsCache: WorkingChannelSummary[] | null = null;
const channelPubkeysCache = new Map<string, string[]>();

function invalidateCaches() {
  stateCache.clear();
  channelsCache = null;
  channelPubkeysCache.clear();
}

function notify() {
  invalidateCaches();
  for (const listener of listeners) listener();
}

export function subscribeAgentWorkingSignal(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameKeys(current: Map<string, unknown> | undefined, next: Map<string, unknown>) {
  return (current?.size ?? 0) === next.size && [...next.keys()].every((key) => current?.has(key));
}

/**
 * Mirror the current Agent typing pubkeys for a channel (original reportChannelBotTyping).
 * First-seen timestamps are preserved across re-reports so elapsed anchors stay stable.
 */
export function reportChannelBotTyping(channelId: string, pubkeys: readonly string[]) {
  const current = typingByChannel.get(channelId);
  const next = new Map<string, number>();
  const now = Date.now();
  for (const pubkey of pubkeys) {
    const key = normalizePubkey(pubkey);
    next.set(key, current?.get(key) ?? now);
  }
  if (sameKeys(current, next)) return;
  if (next.size === 0) typingByChannel.delete(channelId);
  else typingByChannel.set(channelId, next);
  notify();
}

/** Replace the audited running turns of one channel (the turn-primary input). */
export function reportChannelActiveTurns(channelId: string, turns: readonly ReportedAgentTurn[]) {
  const current = turnsByChannel.get(channelId);
  const next = new Map<string, number>();
  for (const turn of turns) {
    const key = normalizePubkey(turn.agentPubkey);
    const prior = next.get(key);
    next.set(key, prior === undefined ? turn.anchorAt : Math.min(prior, turn.anchorAt));
  }
  if (sameKeys(current, next) && [...next].every(([key, at]) => current?.get(key) === at)) return;
  if (next.size === 0) turnsByChannel.delete(channelId);
  else turnsByChannel.set(channelId, next);
  notify();
}

/** The channel's admitted Agents, used for names and the "View activity" entry. */
export function reportChannelAgents(channelId: string, agents: readonly WorkingAgentInfo[]) {
  const current = agentsByChannel.get(channelId);
  const next = new Map(agents.map((agent) => [normalizePubkey(agent.pubkey), { ...agent, pubkey: normalizePubkey(agent.pubkey) }]));
  const unchanged = sameKeys(current, next) && [...next].every(([key, agent]) => {
    const prior = current?.get(key);
    return prior?.name === agent.name && prior.canOpenActivity === agent.canOpenActivity;
  });
  if (unchanged) return;
  if (next.size === 0) agentsByChannel.delete(channelId);
  else agentsByChannel.set(channelId, next);
  notify();
}

export function getWorkingAgentInfo(channelId: string, pubkey: string): WorkingAgentInfo | undefined {
  return agentsByChannel.get(channelId)?.get(normalizePubkey(pubkey));
}

function turnSummaries(): ActiveChannelTurnSummary[] {
  return [...turnsByChannel].map(([channelId, turns]) => ({
    channelId,
    anchorAt: Math.min(...turns.values()),
    agentCount: turns.size,
    agentPubkeys: [...turns.keys()],
  }));
}

function computeAgentWorkingState(agentPubkey: string, channelId: string | null): AgentWorkingState {
  const key = normalizePubkey(agentPubkey);
  const channels: AgentWorkingChannel[] = [];
  const turnChannelIds = new Set<string>();
  for (const [turnChannelId, turns] of turnsByChannel) {
    const anchorAt = turns.get(key);
    if (anchorAt === undefined) continue;
    channels.push({ channelId: turnChannelId, anchorAt, source: "turn" });
    turnChannelIds.add(turnChannelId);
  }
  for (const [typingChannelId, entries] of typingByChannel) {
    if (turnChannelIds.has(typingChannelId)) continue;
    const since = entries.get(key);
    if (since !== undefined) channels.push({ channelId: typingChannelId, anchorAt: since, source: "typing" });
  }
  if (channels.length === 0) return IDLE_STATE;
  channels.sort((a, b) => a.channelId.localeCompare(b.channelId));
  const scoped = channelId === null ? channels : channels.filter((channel) => channel.channelId === channelId);
  const source: AgentWorkingSource = scoped.some((channel) => channel.source === "turn")
    ? "turn"
    : scoped.length > 0 ? "typing" : "none";
  return { working: source !== "none", source, channels };
}

export function getAgentWorkingState(agentPubkey: string | null | undefined, channelId: string | null = null): AgentWorkingState {
  if (!agentPubkey) return IDLE_STATE;
  const cacheKey = `${normalizePubkey(agentPubkey)}|${channelId ?? ""}`;
  const cached = stateCache.get(cacheKey);
  if (cached) return cached;
  const state = computeAgentWorkingState(agentPubkey, channelId);
  stateCache.set(cacheKey, state);
  return state;
}

function namesFor(channelId: string, pubkeys: readonly string[]): string[] {
  return pubkeys.flatMap((pubkey) => {
    const name = getWorkingAgentInfo(channelId, pubkey)?.name;
    return name ? [name] : [];
  });
}

/**
 * All channels with Agent work in progress, merged turn-primary: typing-only Agents fold into an
 * existing turn summary; typing-only channels are anchored to first-seen typing.
 */
export function getWorkingChannels(): WorkingChannelSummary[] {
  if (channelsCache) return channelsCache;
  const byChannel = new Map<string, WorkingChannelSummary>();
  for (const summary of turnSummaries()) byChannel.set(summary.channelId, { ...summary, source: "turn" });
  for (const [channelId, entries] of typingByChannel) {
    const existing = byChannel.get(channelId);
    if (existing) {
      const known = new Set(existing.agentPubkeys);
      const merged = [...existing.agentPubkeys, ...[...entries.keys()].filter((pubkey) => !known.has(pubkey))];
      if (merged.length !== existing.agentPubkeys.length) {
        byChannel.set(channelId, { ...existing, agentPubkeys: merged, agentCount: merged.length });
      }
      continue;
    }
    byChannel.set(channelId, {
      channelId,
      anchorAt: Math.min(...entries.values()),
      agentCount: entries.size,
      agentPubkeys: [...entries.keys()],
      source: "typing",
    });
  }
  const result = [...byChannel.values()]
    .map((summary) => ({ ...summary, agentNames: namesFor(summary.channelId, summary.agentPubkeys) }))
    .sort((a, b) => a.channelId.localeCompare(b.channelId));
  channelsCache = result;
  return result;
}

const EMPTY_PUBKEYS: string[] = [];

/** Normalized pubkeys of every Agent working in the channel (turns ∪ typing fallback). */
export function getWorkingAgentPubkeysForChannel(channelId: string | null | undefined): string[] {
  if (!channelId) return EMPTY_PUBKEYS;
  const cached = channelPubkeysCache.get(channelId);
  if (cached) return cached;
  const merged = new Set<string>([
    ...(turnsByChannel.get(channelId)?.keys() ?? []),
    ...(typingByChannel.get(channelId)?.keys() ?? []),
  ]);
  const result = merged.size === 0 ? EMPTY_PUBKEYS : [...merged].sort();
  channelPubkeysCache.set(channelId, result);
  return result;
}

export function useAgentWorking(agentPubkey: string | null | undefined, channelId: string | null = null): AgentWorkingState {
  return React.useSyncExternalStore(subscribeAgentWorkingSignal, () => getAgentWorkingState(agentPubkey, channelId),
    () => getAgentWorkingState(agentPubkey, channelId));
}

export function useWorkingChannels(): WorkingChannelSummary[] {
  return React.useSyncExternalStore(subscribeAgentWorkingSignal, getWorkingChannels, getWorkingChannels);
}

export function useChannelWorkingAgentPubkeys(channelId: string | null | undefined): string[] {
  return React.useSyncExternalStore(subscribeAgentWorkingSignal, () => getWorkingAgentPubkeysForChannel(channelId),
    () => getWorkingAgentPubkeysForChannel(channelId));
}

/** Original community-switch reset; the Web calls it when the session scope changes. */
export function resetAgentWorkingSignal() {
  typingByChannel.clear();
  turnsByChannel.clear();
  agentsByChannel.clear();
  notify();
}
