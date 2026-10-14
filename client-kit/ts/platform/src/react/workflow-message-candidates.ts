// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/workflowMessageCandidates.ts.
// Host reads are discovery only: every event is re-validated against the exact
// admitted channel before it can label or be selected as trigger_message_id.
import type { RelayEvent } from "./forum/channelWindowResponse";
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_DIFF, KIND_STREAM_MESSAGE_V2 } from "./messages/thread/kinds";

const HEX_EVENT_ID = /^[0-9a-f]{64}$/;
// Original CHANNEL_MESSAGE_EVENT_KINDS (stream, v2, forum post 45001, forum
// comment 45003) plus KIND_STREAM_MESSAGE_DIFF.
const PICKABLE_MESSAGE_KINDS = new Set<number>([
  KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2, 45001, 45003, KIND_STREAM_MESSAGE_DIFF,
]);

export type WorkflowMessageCandidate = {
  id: string;
  pubkey: string | null;
  content: string | null;
  createdAt: number | null;
};

export type WorkflowMessageCandidateInput = {
  id: string;
  pubkey?: string | null;
  content?: string | null;
  createdAt?: number | null;
};

/** Normalize an event ID without accepting alternate encodings. */
export function normalizeMessageEventId(eventId: string): string | null {
  const normalized = eventId.trim().toLowerCase();
  return HEX_EVENT_ID.test(normalized) ? normalized : null;
}

/**
 * Merge candidate sources in priority order. The first occurrence of an event
 * owns both its position and its presentation fields.
 */
export function mergeMessageCandidateSources(
  sources: readonly (readonly WorkflowMessageCandidateInput[])[],
): WorkflowMessageCandidate[] {
  const merged: WorkflowMessageCandidate[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const candidate of source) {
      const id = normalizeMessageEventId(candidate.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push({ id, pubkey: candidate.pubkey ?? null, content: candidate.content ?? null, createdAt: candidate.createdAt ?? null });
    }
  }
  return merged;
}

/** Whether an event is a user-pickable message in exactly the given channel. */
export function isPickableWorkflowMessageEvent(event: RelayEvent, channelId: string): boolean {
  if (!Array.isArray(event.tags)) return false;
  const channels = event.tags.filter((tag) => Array.isArray(tag) && tag[0] === "h");
  return PICKABLE_MESSAGE_KINDS.has(event.kind) && channels.length === 1 && channels[0]?.[1] === channelId;
}

/**
 * Validate any fetched event before it can enrich a deterministic message ID.
 * Transport scoping is not trusted: the event must carry exactly one matching
 * channel tag, use a pickable kind, and match a requested ID when provided.
 */
export function validatedWorkflowMessageCandidate(
  event: RelayEvent | null | undefined,
  { channelId, requestedId }: { channelId: string; requestedId?: string | null },
): WorkflowMessageCandidate | null {
  if (!event || typeof event.id !== "string" || !isPickableWorkflowMessageEvent(event, channelId)) return null;
  const eventId = normalizeMessageEventId(event.id);
  if (!eventId) return null;
  if (requestedId !== undefined && requestedId !== null) {
    const normalizedRequestedId = normalizeMessageEventId(requestedId);
    if (!normalizedRequestedId || eventId !== normalizedRequestedId) return null;
  }
  return {
    id: eventId,
    pubkey: typeof event.pubkey === "string" ? event.pubkey : null,
    content: typeof event.content === "string" ? event.content : null,
    createdAt: Number.isSafeInteger(event.created_at) ? event.created_at : null,
  };
}

/**
 * Validate exact events resolved from search. Search results are discovery
 * hints only and never supply presentation or selection fields unchecked.
 */
export function validateWorkflowMessageSearchResults(
  events: readonly (RelayEvent | null | undefined)[],
  channelId: string,
): WorkflowMessageCandidate[] {
  return events.flatMap((event) => {
    const candidate = validatedWorkflowMessageCandidate(event, { channelId, requestedId: event?.id });
    return candidate ? [candidate] : [];
  });
}
