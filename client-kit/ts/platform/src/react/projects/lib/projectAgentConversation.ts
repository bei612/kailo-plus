// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectAgentConversation.ts and
// lib/projectAgentSelection.ts, mapped by DD-130(2)(3)(5)(6). The original opened a 1:1 DM
// with the Agent and started an idle managed Agent first. Kailo DMs are HUMAN-only and an
// Agent is triggered only through its ChannelAgentBinding, so the conversation is the
// viewer's top-level message in the Installation's bound channel plus its thread; every
// message is an ordinary @mention admitted by agent.invoke. Nothing here starts, enables
// or installs an Agent.
import type { ProjectsConversationOpener, StoredProjectsAgentConversation } from "./projectAgentConversationStorage";

/** One admitted Installation the viewer may @mention in its bound channel. */
export type ProjectAgentCandidate = {
  installationId: string;
  pubkey: string;
  name: string;
  workspaceId: string;
  channelId: string;
  channelName: string;
};

export type ProjectAgentConversation = {
  agent: ProjectAgentCandidate;
  opener: ProjectsConversationOpener;
};

export type ProjectAgentConversationEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
};

const KIND_STREAM_MESSAGE = 9;
const KIND_STREAM_MESSAGE_V2 = 40002;
const KIND_DELETION = 5;

/**
 * Original pickDefaultProjectsAgent preferred the built-in welcome persona; Kailo has no
 * built-in persona (DD-125(5)), so the first admitted candidate is the default.
 */
export function pickDefaultProjectsAgent<Agent>(agents: readonly Agent[]): Agent | null {
  return agents[0] ?? null;
}

/** Candidates in a stable order: Agent name, then channel name, then Installation. */
export function sortProjectAgentCandidates(candidates: readonly ProjectAgentCandidate[]): ProjectAgentCandidate[] {
  return [...candidates].sort((left, right) =>
    left.name.localeCompare(right.name)
    || left.channelName.localeCompare(right.channelName)
    || left.installationId.localeCompare(right.installationId));
}

/**
 * Restores strictly from the pointer this feature persisted — never infers a conversation
 * from channel history. The Installation must still be one of the viewer's admitted
 * candidates with the same Agent identity, Workspace and bound channel; anything else could
 * show a channel the viewer no longer reads or a different Agent, and is not restorable.
 */
export function restoreProjectsAgentConversation({ stored, candidates }: {
  stored: StoredProjectsAgentConversation | null;
  candidates: readonly ProjectAgentCandidate[];
}): ProjectAgentConversation | null {
  if (!stored) return null;
  const agent = candidates.find(candidate => candidate.installationId === stored.installationId);
  if (!agent || agent.pubkey !== stored.agentPubkey || agent.workspaceId !== stored.workspaceId
    || agent.channelId !== stored.channelId) return null;
  return { agent, opener: stored.opener };
}

/** NIP-10 thread root of an event (marked root, else the single unmarked reference). */
export function conversationThreadRoot(tags: readonly string[][]): string | null {
  const references = tags.filter(tag => tag[0] === "e" && typeof tag[1] === "string");
  const root = references.find(tag => tag[3] === "root");
  if (root) return root[1]!;
  const reply = references.find(tag => tag[3] === "reply");
  if (reply) return reply[1]!;
  return references.length > 0 ? references[0]![1]! : null;
}

/** The opener or a message in its thread. */
export function belongsToConversation(event: { id: string; tags?: readonly string[][] }, opener: ProjectsConversationOpener): boolean {
  if (event.id === opener.eventId) return true;
  return (event.tags ?? []).some(tag => tag[0] === "e" && tag[1] === opener.eventId);
}

/**
 * Chat rows for the inline Projects conversation: plain messages only, the opener and its
 * thread, never the rest of the shared channel, minus author deletions. Chronological:
 * appending the reply read after the root would render every question before every answer.
 */
export function visibleConversationMessages<Event extends ProjectAgentConversationEvent>(
  events: readonly Event[], opener: ProjectsConversationOpener): Event[] {
  const unique = [...new Map(events.map(event => [event.id, event])).values()];
  const deleted = new Set(unique.flatMap(event => event.kind === KIND_DELETION
    ? event.tags.filter(tag => tag[0] === "e" && typeof tag[1] === "string").flatMap(tag => {
      const target = unique.find(candidate => candidate.id === tag[1]);
      // An author deletion only removes the author's own message.
      return target && target.pubkey === event.pubkey ? [tag[1]!] : [];
    }) : []));
  return unique
    .filter(event => (event.kind === KIND_STREAM_MESSAGE || event.kind === KIND_STREAM_MESSAGE_V2)
      && !deleted.has(event.id) && belongsToConversation(event, opener))
    .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id));
}

export type ProjectAgentSendRequest = {
  workspaceId: string;
  channelId: string;
  installationId: string;
  agentPubkey: string;
  content: string;
  /** Other members the viewer @mentioned in the panel composer. */
  mentionPubkeys: string[];
  /** Follow-ups reply to the opener so the whole conversation is one thread. */
  parentEventId?: string;
};

/**
 * The Projects agent submit sequence. The first message is a top-level message in the
 * Agent's bound channel; follow-ups carry `parentEventId = opener.eventId`. The host binds
 * every side effect to the scope it captured (Web: BFF session; Desktop: relay + signer).
 */
export async function submitProjectAgentMessage({ agent, conversation, content, mentionPubkeys, send }: {
  agent: ProjectAgentCandidate;
  conversation: ProjectAgentConversation | null;
  content: string;
  mentionPubkeys: readonly string[];
  send: (request: ProjectAgentSendRequest) => Promise<{ eventId: string }>;
}): Promise<{ eventId: string }> {
  if (conversation && conversation.agent.installationId !== agent.installationId)
    throw new Error("Project Agent conversation mismatch");
  const humans = [...new Set(mentionPubkeys.filter(pubkey => pubkey !== agent.pubkey))].sort();
  const sent = await send({
    workspaceId: agent.workspaceId,
    channelId: agent.channelId,
    installationId: agent.installationId,
    agentPubkey: agent.pubkey,
    content,
    mentionPubkeys: humans,
    ...(conversation ? { parentEventId: conversation.opener.eventId } : {}),
  });
  if (!sent || typeof sent.eventId !== "string" || !/^[0-9a-f]{64}$/.test(sent.eventId))
    throw new Error("Project Agent message receipt mismatch");
  return sent;
}
