// DD-121, V-SCN-105/106: admission outcomes of the viewer's own Agent @mentions in a Workspace
// channel. Read-only: the query never retries, re-admits or posts anything; only the sender's own
// messages (signer == own Web pubkey) are tracked, so other members see the timeline unchanged.
import { AgentMentionOutcomeState, type AgentMentionOutcomeView } from "@client-kit/contracts";
import type { AgentMentionStatusEntry, TimelineMessage } from "@client-kit/platform/react/messages";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AGENT_MENTION_OUTCOME_QUERY_LIMIT, queryAgentMentionOutcomes } from "@/platform/bff-client";

/** Refetch cadence while any tracked mention is still PENDING or RUNNING. */
export const AGENT_MENTION_POLL_MS = 5_000;
/**
 * Per message: polling stops this long after it was sent, and PENDING/RUNNING is no longer
 * presented (an unscanned or still-running mention is not claimed as "processing" forever).
 * Terminal DENIED/FAILED stay visible; REPLIED never shows (the reply itself is visible).
 */
export const AGENT_MENTION_POLL_WINDOW_MS = 3 * 60_000;

/** An Agent of this channel from the member's admitted directory (execute use is effective). */
export type MentionableAgent = { pubkey: string; displayName: string; installationId: string };

export type TrackedAgentMention = { eventId: string; sentAtMs: number; agents: readonly MentionableAgent[] };

type MentionSource = Pick<TimelineMessage, "id" | "createdAt" | "signerPubkey" | "kind" | "tags" | "pending">;

const EVENT_ID = /^[0-9a-f]{64}$/;
const MESSAGE_KINDS: ReadonlySet<number> = new Set([9, 40002]);

/** The most recent own top-level/thread messages that p-tag a channel Agent (at most one query page). */
export function trackedAgentMentions(messages: readonly MentionSource[], ownPubkey: string | undefined,
  agents: readonly MentionableAgent[]): TrackedAgentMention[] {
  const own = ownPubkey?.toLowerCase();
  if (!own || agents.length === 0) return [];
  const byPubkey = new Map(agents.map((agent) => [agent.pubkey.toLowerCase(), agent]));
  const tracked = new Map<string, TrackedAgentMention>();
  for (const message of messages) {
    if (tracked.has(message.id) || message.pending || !EVENT_ID.test(message.id) || !MESSAGE_KINDS.has(message.kind ?? -1)
      || message.signerPubkey?.toLowerCase() !== own) continue;
    const mentioned = new Map<string, MentionableAgent>();
    for (const tag of message.tags ?? []) {
      const agent = tag[0] === "p" && tag[1] ? byPubkey.get(tag[1].toLowerCase()) : undefined;
      if (agent) mentioned.set(agent.installationId, agent);
    }
    if (mentioned.size > 0) tracked.set(message.id, { eventId: message.id, sentAtMs: message.createdAt * 1_000, agents: [...mentioned.values()] });
  }
  return [...tracked.values()]
    .sort((left, right) => right.sentAtMs - left.sentAtMs || left.eventId.localeCompare(right.eventId))
    .slice(0, AGENT_MENTION_OUTCOME_QUERY_LIMIT);
}

const rowKey = (eventId: string, installationId: string) => `${eventId}:${installationId}`;
const unsettled = (state: AgentMentionOutcomeState | undefined) => state === undefined || state === AgentMentionOutcomeState.Running;

/** Poll only while a mention inside its window still has a PENDING (no row) or RUNNING Agent. */
export function agentMentionPollingNeeded(tracked: readonly TrackedAgentMention[], outcomes: readonly AgentMentionOutcomeView[] | undefined, now: number): boolean {
  const rows = new Map((outcomes ?? []).map((row) => [rowKey(row.eventId, row.installationId), row.state]));
  return tracked.some((mention) => now < mention.sentAtMs + AGENT_MENTION_POLL_WINDOW_MS
    && mention.agents.some((agent) => unsettled(rows.get(rowKey(mention.eventId, agent.installationId)))));
}

/** Per own message, one status entry per mentioned Agent (DD-121 (1): no row yet → PENDING). */
export function agentMentionEntries(tracked: readonly TrackedAgentMention[], outcomes: readonly AgentMentionOutcomeView[],
  agents: readonly MentionableAgent[], now: number, fallbackName: string): Map<string, AgentMentionStatusEntry[]> {
  const byInstallation = new Map(agents.map((agent) => [agent.installationId, agent]));
  const result = new Map<string, AgentMentionStatusEntry[]>();
  for (const mention of tracked) {
    const inWindow = now < mention.sentAtMs + AGENT_MENTION_POLL_WINDOW_MS;
    const rows = outcomes.filter((row) => row.eventId === mention.eventId);
    const entries: AgentMentionStatusEntry[] = [];
    for (const agent of mention.agents) {
      const row = rows.find((candidate) => candidate.installationId === agent.installationId);
      const state = row?.state ?? "PENDING";
      if ((state === "PENDING" || state === AgentMentionOutcomeState.Running) && !inWindow) continue;
      entries.push({ key: agent.installationId, name: agent.displayName, state, reasonCode: row?.reasonCode, delegable: true });
    }
    // Core may report an outcome for an Installation that left this member's directory (e.g. use
    // was withdrawn after sending); only its terminal refusal/failure is shown, never "processing".
    for (const row of rows) {
      if (mention.agents.some((agent) => agent.installationId === row.installationId)
        || (row.state !== AgentMentionOutcomeState.Denied && row.state !== AgentMentionOutcomeState.Failed)) continue;
      const agent = byInstallation.get(row.installationId);
      entries.push({ key: row.installationId, name: agent?.displayName ?? fallbackName, state: row.state, reasonCode: row.reasonCode, delegable: agent !== undefined });
    }
    if (entries.length > 0) result.set(mention.eventId, entries);
  }
  return result;
}

export function useAgentMentionOutcomes({ workspaceId, principalId, ownPubkey, agents, messages, enabled, fallbackName }: {
  workspaceId: string;
  principalId: string;
  ownPubkey: string | undefined;
  agents: readonly MentionableAgent[];
  messages: readonly MentionSource[];
  enabled: boolean;
  fallbackName: string;
}): { entriesFor: (eventId: string) => AgentMentionStatusEntry[] | undefined } {
  const tracked = useMemo(() => enabled ? trackedAgentMentions(messages, ownPubkey, agents) : [], [enabled, messages, ownPubkey, agents]);
  const eventIds = useMemo(() => tracked.map((mention) => mention.eventId).sort(), [tracked]);
  const query = useQuery({
    queryKey: ["platform", "agent-mention-outcomes", principalId, workspaceId, eventIds],
    enabled: enabled && eventIds.length > 0,
    retry: false,
    queryFn: () => queryAgentMentionOutcomes(workspaceId, eventIds),
    // A newly sent message changes the key; keep the same scope's rows so earlier statuses stay
    // put and the new mention shows PENDING at once. Rows only ever match requested event IDs.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === principalId && previousQuery.queryKey[3] === workspaceId ? previous : undefined,
    refetchInterval: (current) =>
      agentMentionPollingNeeded(tracked, current.state.data?.outcomes, Date.now()) ? AGENT_MENTION_POLL_MS : false,
  });
  // Re-render when the next tracked window closes so PENDING/RUNNING stop being presented.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = tracked.map((mention) => mention.sentAtMs + AGENT_MENTION_POLL_WINDOW_MS).filter((deadline) => deadline > now)
      .reduce<number | undefined>((earliest, deadline) => earliest === undefined || deadline < earliest ? deadline : earliest, undefined);
    if (next === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [tracked, now]);
  const outcomes = enabled && eventIds.length > 0 ? query.data?.outcomes : undefined;
  // Every poll result advances the clock as well; a stale clock only errs toward "in window"
  // until the timer above fires.
  const clock = Math.max(now, query.dataUpdatedAt);
  const byMessage = useMemo(() => outcomes ? agentMentionEntries(tracked, outcomes, agents, clock, fallbackName) : undefined,
    [outcomes, tracked, agents, clock, fallbackName]);
  return { entriesFor: (eventId) => byMessage?.get(eventId) };
}
