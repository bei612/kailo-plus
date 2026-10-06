export type RelayEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string };

export type ChannelWindowCursor = { createdAt: number; eventId: string };
export type ChannelWindowThreadSummary = {
  replyCount: number;
  descendantCount: number;
  lastReplyAt: number | null;
  participantPubkeys: string[];
};
export type ChannelWindowRow<E extends RelayEvent = RelayEvent> = {
  event: E;
  thread: ChannelWindowThreadSummary | null;
};
export type LiveThreadSummary = {
  summary: ChannelWindowThreadSummary;
  /** `created_at` of the relay 39005 that carried it — newest wins per root. */
  createdAt: number;
};
export type ChannelWindowPage<E extends RelayEvent = RelayEvent> = {
  startCursor: ChannelWindowCursor | null;
  rows: ChannelWindowRow<E>[];
  aux: E[];
  nextCursor: ChannelWindowCursor | null;
  hasMore: boolean;
};

const KIND_CHANNEL_THREAD_SUMMARY = 39005;
const KIND_CHANNEL_WINDOW_BOUNDS = 39006;
const KIND_DELETION = 5;
const KIND_NIP29_DELETE_EVENT = 9005;
const KIND_STREAM_MESSAGE = 9;
const KIND_STREAM_MESSAGE_V2 = 40002;
const KIND_SYSTEM_MESSAGE = 40099;
export const CHANNEL_AUX_EVENT_KINDS = [
  KIND_DELETION, // 5 — NIP-09 event deletions
  KIND_NIP29_DELETE_EVENT, // 9005 — NIP-29 / Buzz-native deletions
] as const;

// Visible content kinds a channel window / thread returns as their own rows.
// Mirrors the native timeline kind set.
export const CHANNEL_TIMELINE_CONTENT_KINDS = [
  KIND_STREAM_MESSAGE, // 9
  KIND_STREAM_MESSAGE_V2, // 40002
  KIND_SYSTEM_MESSAGE, // 40099 — system rows (join/leave/channel-created)
] as const;

const CONTENT_KINDS = new Set<number>(CHANNEL_TIMELINE_CONTENT_KINDS);
const AUX_KINDS = new Set<number>(CHANNEL_AUX_EVENT_KINDS);

type WireCursor = { created_at: number; id: string };
type BoundsPayload = { has_more: boolean; next_cursor: WireCursor | null };
type SummaryPayload = {
  reply_count: number;
  descendant_count: number;
  last_reply_at: number | null;
  participants: string[];
};

function targetId(event: RelayEvent, tagName: "d" | "e") {
  return event.tags.find((tag) => tag[0] === tagName)?.[1] ?? null;
}

function parseJson<T>(event: RelayEvent, label: string): T {
  try {
    return JSON.parse(event.content) as T;
  } catch {
    throw new Error(`Invalid ${label} event ${event.id}.`);
  }
}

const mapCursor = (cursor: WireCursor | null): ChannelWindowCursor | null =>
  cursor ? { createdAt: cursor.created_at, eventId: cursor.id } : null;

const mapSummary = (payload: SummaryPayload): ChannelWindowThreadSummary => ({
  replyCount: payload.reply_count,
  descendantCount: payload.descendant_count,
  lastReplyAt: payload.last_reply_at,
  participantPubkeys: payload.participants,
});

/**
 * Parse a relay-pushed live `39005` into its root id and summary, or null for
 * anything that is not a well-formed thread summary. Live-path counterpart of
 * the page parsing below — same wire contract, delivered by subscription.
 */
export function parseLiveThreadSummary(
  event: RelayEvent,
): { rootId: string; live: LiveThreadSummary } | null {
  if (event.kind !== KIND_CHANNEL_THREAD_SUMMARY) return null;
  const rootId = targetId(event, "e");
  if (!rootId) return null;
  try {
    return {
      rootId,
      live: {
        summary: mapSummary(JSON.parse(event.content) as SummaryPayload),
        createdAt: event.created_at,
      },
    };
  } catch {
    // A malformed live overlay only skips one badge refresh — drop it.
    return null;
  }
}

function expectedBoundsKey(
  channelId: string,
  startCursor: ChannelWindowCursor | null,
) {
  const suffix = startCursor
    ? `${startCursor.createdAt}:${startCursor.eventId.toLowerCase()}`
    : "head";
  return `${channelId.toLowerCase()}:${suffix}`;
}

/** Partition a flat `/query` response before any cursor or timeline math. */
export function parseChannelWindowResponse<E extends RelayEvent>(
  events: E[],
  channelId: string,
  startCursor: ChannelWindowCursor | null,
  forumPosts = false,
): ChannelWindowPage<E> {
  const rows = events
    .filter((event) => forumPosts ? event.kind === 45001 : CONTENT_KINDS.has(event.kind))
    .map((event) => ({
      event,
      thread: null as ChannelWindowThreadSummary | null,
    }));
  const rowById = new Map(rows.map((row) => [row.event.id, row]));

  for (const event of events) {
    if (event.kind !== KIND_CHANNEL_THREAD_SUMMARY) continue;
    const rootId = targetId(event, "e");
    const row = rootId ? rowById.get(rootId) : undefined;
    if (!row) continue;
    const payload = parseJson<SummaryPayload>(event, "thread summary");
    row.thread = mapSummary(payload);
  }

  const boundsEvents = events.filter(
    (event) => event.kind === KIND_CHANNEL_WINDOW_BOUNDS,
  );
  if (boundsEvents.length !== 1) {
    throw new Error(
      "Channel window response must contain exactly one bounds event.",
    );
  }
  const boundsEvent = boundsEvents[0]!;
  if (
    targetId(boundsEvent, "d") !== expectedBoundsKey(channelId, startCursor)
  ) {
    throw new Error("Channel window bounds do not match the request cursor.");
  }
  const bounds = parseJson<BoundsPayload>(boundsEvent, "window bounds");
  const nextCursor = mapCursor(bounds.next_cursor);
  if (bounds.has_more !== (nextCursor !== null)) {
    throw new Error("Channel window bounds has_more and next_cursor disagree.");
  }

  // Summaries/bounds are metadata, never durable raw timeline events.
  const aux = events.filter((event) => AUX_KINDS.has(event.kind));
  return { startCursor, rows, aux, nextCursor, hasMore: bounds.has_more };
}
