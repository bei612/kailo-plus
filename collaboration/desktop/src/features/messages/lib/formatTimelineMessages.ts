import type { ChannelMember, RelayEvent } from "@/shared/api/types";
import { applyMessageEdits } from "@client-kit/platform/react/messages/messageEdits";

import type { TimelineMessage } from "@/features/messages/types";
import { getThreadReference } from "@/features/messages/lib/threading";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { getMentionTagPubkey } from "@/shared/lib/resolveMentionNames";
import {
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_SYSTEM_MESSAGE,
} from "@/shared/constants/kinds";
import { resolveEventAuthorPubkey } from "@/shared/lib/authors";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { channelRoleMap } from "@/shared/lib/rosterDerivations";
import { formatTime } from "@/features/messages/lib/dateFormatters";

const EMPTY_ROLE_MAP: ReadonlyMap<string, string> = new Map();
const HEX_RE = /^[0-9a-f]+$/i;

/**
 * Kinds that render as their own timeline row: stream messages (9 and the v2
 * form 40002) and relay system rows. Must match CHANNEL_TIMELINE_CONTENT_KINDS:
 * a kind that is fetched and counted as unread but not rendered is a phantom
 * unread.
 */
export function isTimelineContentEvent(event: Pick<RelayEvent, "kind">) {
  return (
    event.kind === KIND_STREAM_MESSAGE ||
    event.kind === KIND_STREAM_MESSAGE_V2 ||
    event.kind === KIND_SYSTEM_MESSAGE
  );
}

/** Ids hidden by relay deletion markers (kind:5 and kind:9005). */
function getDeletedEventIds(events: RelayEvent[]): Set<string> {
  const deletedEventIds = new Set<string>();
  for (const event of events) {
    if (
      event.kind !== KIND_DELETION &&
      event.kind !== KIND_NIP29_DELETE_EVENT
    ) {
      continue;
    }
    for (const tag of event.tags) {
      if (
        tag[0] === "e" &&
        typeof tag[1] === "string" &&
        tag[1].length === 64 &&
        HEX_RE.test(tag[1])
      ) {
        deletedEventIds.add(tag[1]);
      }
    }
  }
  return deletedEventIds;
}

function formatMessageAuthor(
  event: RelayEvent,
  currentPubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
  relaySelfPubkey: string | null | undefined,
) {
  const authorPubkey = resolveEventAuthorPubkey({
    event,
    preferActorTag: true,
    relaySelfPubkey,
    requireChannelTagForPTags: true,
  });

  return resolveUserLabel({
    pubkey: authorPubkey,
    currentPubkey,
    profiles,
    preferResolvedSelfLabel: true,
  });
}

function getAuthorAvatarUrl(input: {
  authorPubkey: string;
  currentPubkey: string | undefined;
  currentUserAvatarUrl: string | null;
  profiles: UserProfileLookup | undefined;
}) {
  const { authorPubkey, currentPubkey, currentUserAvatarUrl, profiles } = input;

  if (currentPubkey === authorPubkey) {
    return currentUserAvatarUrl ?? null;
  }

  return profiles?.[authorPubkey.toLowerCase()]?.avatarUrl ?? null;
}

export function hasLinkPreviewSuppression(
  tags: string[][] | undefined,
): boolean {
  return (
    tags?.some(
      (tag) =>
        tag[0] === "link-preview" && tag[1] === "none" && tag.length === 2,
    ) ?? false
  );
}

export function formatTimelineMessages(
  events: RelayEvent[],
  currentPubkey: string | undefined,
  currentUserAvatarUrl: string | null,
  profiles?: UserProfileLookup,
  members?: ChannelMember[],
  /** Active relay identity from NIP-11 `self`; absent or malformed fails closed to the signer. */
  relaySelfPubkey?: string | null,
): TimelineMessage[] {
  // Identity-cached: rosters can be 10k+ members and this formatter re-runs
  // on every live message; the map is computed once per distinct roster.
  const roleByPubkey = members ? channelRoleMap(members) : EMPTY_ROLE_MAP;
  const deletedEventIds = getDeletedEventIds(events);
  const visibleEvents = applyMessageEdits(events.filter(
    (event) => isTimelineContentEvent(event) && !deletedEventIds.has(event.id),
  ), events.filter((event) => !deletedEventIds.has(event.id)));
  const eventsById = new Map(visibleEvents.map((event) => [event.id, event]));
  const depthByEventId = new Map<string, number>();
  const resolvingEventIds = new Set<string>();

  function getDepth(event: RelayEvent): number {
    const cached = depthByEventId.get(event.id);
    if (cached !== undefined) {
      return cached;
    }

    if (resolvingEventIds.has(event.id)) {
      return 0;
    }

    const thread = getThreadReference(event.tags);
    if (!thread.parentId) {
      depthByEventId.set(event.id, 0);
      return 0;
    }

    const parent = eventsById.get(thread.parentId);
    if (!parent) {
      const fallbackDepth =
        thread.rootId && thread.rootId !== thread.parentId ? 2 : 1;
      depthByEventId.set(event.id, fallbackDepth);
      return fallbackDepth;
    }

    resolvingEventIds.add(event.id);
    const depth = getDepth(parent) + 1;
    resolvingEventIds.delete(event.id);
    depthByEventId.set(event.id, depth);
    return depth;
  }

  return visibleEvents.map((event) => {
    const authorPubkey = resolveEventAuthorPubkey({
      event,
      preferActorTag: true,
      relaySelfPubkey,
      requireChannelTagForPTags: true,
    });
    const thread = getThreadReference(event.tags);
    return {
      id: event.id,
      renderKey: event.localKey ?? event.id,
      createdAt: event.created_at,
      pubkey: authorPubkey,
      signerPubkey: normalizePubkey(event.pubkey),
      author: formatMessageAuthor(
        event,
        currentPubkey,
        profiles,
        relaySelfPubkey,
      ),
      avatarUrl: getAuthorAvatarUrl({
        authorPubkey,
        currentPubkey,
        currentUserAvatarUrl,
        profiles,
      }),
      role: roleByPubkey.get(authorPubkey.toLowerCase()),
      time: formatTime(event.created_at),
      body: event.content,
      parentId: thread.parentId,
      rootId: thread.rootId,
      depth: getDepth(event),
      accent: currentPubkey === authorPubkey,
      pending: event.pending,
      kind: event.kind,
      tags: event.tags,
    };
  });
}

function extractSystemMessagePubkeys(event: RelayEvent): string[] {
  if (event.kind !== KIND_SYSTEM_MESSAGE) {
    return [];
  }

  try {
    const payload = JSON.parse(event.content);
    const pubkeys: string[] = [];
    if (typeof payload.actor === "string") {
      pubkeys.push(payload.actor.toLowerCase());
    }
    if (typeof payload.target === "string") {
      pubkeys.push(payload.target.toLowerCase());
    }
    return pubkeys;
  } catch {
    return [];
  }
}

export function collectMessageAuthorPubkeys(
  events: RelayEvent[],
  relaySelfPubkey?: string | null,
) {
  const pubkeys = new Set<string>();

  for (const event of events) {
    if (!isTimelineContentEvent(event)) {
      continue;
    }

    if (event.kind === KIND_SYSTEM_MESSAGE) {
      for (const pk of extractSystemMessagePubkeys(event)) {
        pubkeys.add(pk);
      }
    } else {
      pubkeys.add(event.pubkey.toLowerCase());
      pubkeys.add(
        resolveEventAuthorPubkey({
          event,
          preferActorTag: true,
          relaySelfPubkey,
          requireChannelTagForPTags: true,
        }).toLowerCase(),
      );
    }
  }

  return [...pubkeys];
}

export function collectMessageMentionPubkeys(
  events: Array<{ tags?: string[][] }>,
) {
  const pubkeys = new Set<string>();

  for (const event of events) {
    for (const tag of event.tags ?? []) {
      const pubkey = getMentionTagPubkey(tag);
      if (pubkey) {
        pubkeys.add(pubkey);
      }
    }
  }

  return [...pubkeys];
}
