// Original Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/messages/lib/formatTimelineMessages.ts reaction projection.
// Input events have already passed the host's Relay/BFF authorization and signature checks.
import type { RelayEvent } from "../../forum/channelWindowResponse";
import type { TimelineReaction } from "../types";
import type { UserProfileLookup } from "../system/identity";
import { truncateNpub } from "../../conversations/pubkey";
import { KIND_REACTION, KIND_DELETION, KIND_NIP29_DELETE_EVENT } from "../thread/kinds";

const HEX_RE = /^[0-9a-f]+$/i;
function getReactionTargetId(tags: string[][]) {
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    const tag = tags[index];
    if (
      tag?.[0] === "e" &&
      typeof tag[1] === "string" &&
      tag[1].length === 64 &&
      HEX_RE.test(tag[1])
    ) {
      return tag[1];
    }
  }

  return null;
}

export function buildMessageReactions<E extends RelayEvent>(
  events: E[],
  currentPubkey?: string,
  profiles?: UserProfileLookup,
  resolveActor: (event: E) => string = event => event.pubkey,
): Map<string, TimelineReaction[]> {
  const currentPubkeyLower = currentPubkey?.toLowerCase();
  const deletedEventIds = new Set(events
    .filter(event => event.kind === KIND_DELETION || event.kind === KIND_NIP29_DELETE_EVENT)
    .flatMap(event => event.tags.filter(tag => tag[0] === "e" && tag[1]?.length === 64 && HEX_RE.test(tag[1])).map(tag => tag[1]!)));
  const reactionPresence = new Map<
    string,
    {
      targetId: string;
      actorPubkey: string;
      emoji: string;
      emojiUrl?: string;
      createdAt: number;
    }
  >();

  for (const event of events) {
    if (event.kind !== KIND_REACTION || deletedEventIds.has(event.id)) {
      continue;
    }

    const targetId = getReactionTargetId(event.tags);
    if (!targetId || deletedEventIds.has(targetId)) {
      continue;
    }

    const actorPubkey = resolveActor(event).toLowerCase();
    const emoji = event.content.trim() || "+";
    // Custom-emoji reaction (NIP-30): content is `:shortcode:` and the URL
    // rides on a matching `["emoji", shortcode, url]` tag.
    let emojiUrl: string | undefined;
    if (emoji.startsWith(":") && emoji.endsWith(":")) {
      const shortcode = emoji.slice(1, -1);
      emojiUrl = event.tags.find(
        (t) => t[0] === "emoji" && t[1] === shortcode && t[2],
      )?.[2];
    }
    const key = `${targetId}:${actorPubkey}:${emoji}`;
    const prev = reactionPresence.get(key);
    reactionPresence.set(key, {
      targetId,
      actorPubkey,
      emoji,
      emojiUrl,
      // Retain the earliest timestamp seen across duplicate deliveries so pill
      // chronology is invariant to input-array order.
      createdAt: prev
        ? Math.min(prev.createdAt, event.created_at)
        : event.created_at,
    });
  }

  // Internal accumulator: TimelineReaction + earliest timestamp for pill ordering.
  type ReactionAccum = TimelineReaction & { earliestCreatedAt: number };
  const reactionsByEventId = new Map<string, Map<string, ReactionAccum>>();
  for (const {
    targetId,
    actorPubkey,
    emoji,
    emojiUrl,
    createdAt,
  } of reactionPresence.values()) {
    const current = reactionsByEventId.get(targetId) ?? new Map();
    const existing = current.get(emoji) ?? {
      emoji,
      emojiUrl,
      count: 0,
      reactedByCurrentUser: false,
      users: [],
      earliestCreatedAt: createdAt,
    };
    if (createdAt < existing.earliestCreatedAt) {
      existing.earliestCreatedAt = createdAt;
    }

    existing.count += 1;
    if (currentPubkeyLower && actorPubkey === currentPubkeyLower) {
      existing.reactedByCurrentUser = true;
    }

    const profile = profiles?.[actorPubkey];
    const displayName =
      currentPubkeyLower && actorPubkey === currentPubkeyLower
        ? "You"
        : profile?.displayName?.trim() ||
          profile?.nip05Handle?.trim() ||
          truncateNpub(actorPubkey);
    existing.users.push({
      pubkey: actorPubkey,
      displayName,
      avatarUrl: profile?.avatarUrl ?? null,
    });

    current.set(emoji, existing);
    reactionsByEventId.set(targetId, current);
  }


  return new Map([...reactionsByEventId].map(([id, reactions]) => [id,
    [...reactions.values()].sort((a, b) => a.earliestCreatedAt - b.earliestCreatedAt || a.emoji.localeCompare(b.emoji))
      .map(({ earliestCreatedAt: _drop, ...pill }) => pill),
  ]));
}
