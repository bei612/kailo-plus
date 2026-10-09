// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/useChannelTyping.ts: original ephemeral state.
// Transport supplies admitted live events; no message/history store is written.
import { getChannelIdFromTags, getThreadReference } from "./threading";
import { resolveEventAuthorPubkey } from "./authors";
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_DIFF, KIND_STREAM_MESSAGE_V2, KIND_TYPING_INDICATOR } from "./thread/kinds";

export type TypingIndicatorEntry = {
  pubkey: string;
  threadHeadId: string | null;
};
type TypingEntry = TypingIndicatorEntry & { expiresAt: number; firstSeenAt: number };
type TypingEvent = {
  pubkey: string; kind: number; created_at: number; tags: string[][];
  id?: string; content?: string; sig?: string;
};
export type TypingState = {
  typing: Record<string, TypingEntry>;
  completed: Record<string, { createdAt: number; suppressUntil: number }>;
};

// Fixed original presentation timings, not a deployment or quota limit.
const TYPING_INDICATOR_TTL_MS = 8_000;
export const TYPING_PRUNE_INTERVAL_MS = 1_000;
const TYPING_POST_MESSAGE_SUPPRESS_MS = 2_000;

export function emptyTypingState(): TypingState {
  return { typing: {}, completed: {} };
}

export function pruneTypingState(state: TypingState, now = Date.now()): TypingState {
  let changed = false;
  const typing: TypingState["typing"] = {};
  const completed: TypingState["completed"] = {};
  for (const [key, entry] of Object.entries(state.typing)) {
    if (entry.expiresAt > now) typing[key] = entry;
    else changed = true;
  }
  for (const [key, entry] of Object.entries(state.completed)) {
    // Once a prior indicator would itself be expired, its completion watermark
    // is no longer needed. Do not retain every author/thread for the session.
    if (Math.max(entry.suppressUntil, entry.createdAt * 1_000 + TYPING_INDICATOR_TTL_MS) > now) completed[key] = entry;
    else changed = true;
  }
  return changed ? { typing, completed } : state;
}

export function receiveTypingEvent(
  state: TypingState, event: TypingEvent, channelId: string, now = Date.now(),
  relaySelfPubkey?: string | null,
): TypingState {
  if (getChannelIdFromTags(event.tags) !== channelId) return state;
  if (![KIND_TYPING_INDICATOR, KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_DIFF, KIND_STREAM_MESSAGE_V2].includes(event.kind)) return state;
  const pruned = pruneTypingState(state, now);
  // Original completion resolves delegated authors only with the active relay
  // identity and a valid event signature; indicators always use their signer.
  const pubkey = event.kind !== KIND_TYPING_INDICATOR && event.id !== undefined
    && event.content !== undefined && event.sig !== undefined
    ? resolveEventAuthorPubkey({
      event: { ...event, id: event.id, content: event.content, sig: event.sig },
      preferActorTag: true, relaySelfPubkey, requireChannelTagForPTags: true,
    }) : event.pubkey.toLowerCase();
  const threadHeadId = getThreadReference(event.tags).parentId;
  const key = `${pubkey}:${threadHeadId ?? "channel"}`;
  if (event.kind !== KIND_TYPING_INDICATOR) {
    const typing = { ...pruned.typing };
    delete typing[key];
    return { typing, completed: { ...pruned.completed, [key]: {
      createdAt: Math.max(pruned.completed[key]?.createdAt ?? 0, event.created_at),
      suppressUntil: now + TYPING_POST_MESSAGE_SUPPRESS_MS,
    } } };
  }
  const expiresAt = Math.min(now + TYPING_INDICATOR_TTL_MS, event.created_at * 1_000 + TYPING_INDICATOR_TTL_MS);
  const completed = pruned.completed[key];
  if (expiresAt <= now || (completed && (completed.suppressUntil > now || event.created_at <= completed.createdAt))) return pruned;
  return { completed: pruned.completed, typing: { ...pruned.typing, [key]: {
    pubkey, threadHeadId, expiresAt, firstSeenAt: pruned.typing[key]?.firstSeenAt ?? now,
  } } };
}

export function typingEntries(state: TypingState): TypingIndicatorEntry[] {
  return Object.values(state.typing)
    .sort((left, right) => left.firstSeenAt - right.firstSeenAt)
    .map(({ pubkey, threadHeadId }) => ({ pubkey, threadHeadId }));
}
