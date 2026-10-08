// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/useChannelPaneHandlers.ts::handleToggleReaction.
// The native host records only a confirmed addition. The Web host derives the
// same interest from already-admitted Relay events, never a second membership store.
import type { RelayEvent } from "../../forum/channelWindowResponse";
import type { TimelineMessage } from "../types";
import { getThreadReference } from "../threading";
import { getReactionTargetId } from "./buildMessageReactions";
import {
  CHANNEL_MESSAGE_EVENT_KINDS,
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
  KIND_REACTION,
} from "../thread/kinds";

const EVENT_ID = /^[0-9a-f]{64}$/i;

export function threadReactionRoot(message: Pick<TimelineMessage, "id" | "rootId">) {
  const rootId = message.rootId ?? message.id;
  return rootId.trim() ? rootId : null;
}

/** Input belongs to one authorized, signature-checked Relay window/live scope. */
export function reactionThreadInteractionRoots(
  events: readonly RelayEvent[],
  ownPubkeys: ReadonlySet<string>,
  channelId: string,
): ReadonlySet<string> {
  const roots = new Set<string>();
  if (!channelId || ownPubkeys.size === 0) return roots;
  const inScope = (event: RelayEvent, targetScoped = false) => {
    const channels = event.tags.filter((tag) => tag[0] === "h");
    return channels.length === 1
      ? channels[0]?.[1] === channelId
      : targetScoped && channels.length === 0;
  };
  const deleted = new Set(
    events
      .filter(
        (event) =>
          (event.kind === KIND_DELETION && inScope(event, true)) ||
          (event.kind === KIND_NIP29_DELETE_EVENT && inScope(event)),
      )
      .flatMap((event) =>
        event.tags
          .filter((tag) => tag[0] === "e" && EVENT_ID.test(tag[1] ?? ""))
          .map((tag) => tag[1]!),
      ),
  );
  const targets = new Map(
    events
      .filter(
        (event) =>
          (CHANNEL_MESSAGE_EVENT_KINDS as readonly number[]).includes(event.kind) &&
          EVENT_ID.test(event.id) &&
          inScope(event) &&
          !deleted.has(event.id),
      )
      .map((event) => [event.id, event]),
  );

  for (const event of events) {
    if (
      event.kind !== KIND_REACTION ||
      !ownPubkeys.has(event.pubkey) ||
      !EVENT_ID.test(event.id) ||
      !inScope(event, true)
    )
      continue;
    const targetId = getReactionTargetId(event.tags);
    const target = targetId ? targets.get(targetId) : undefined;
    if (!target) continue;
    const rootId = threadReactionRoot({
      id: target.id,
      rootId: getThreadReference(target.tags).rootId,
    });
    // A reply tag alone is not proof of a visible root. Missing or deleted
    // context cannot establish participation in a different/unresolved scope.
    if (rootId && targets.has(rootId)) roots.add(rootId);
    // Removing a reaction does not undo the original once-participated fact.
    // A deletion without its original kind-7 event cannot invent that history.
  }
  return roots;
}
