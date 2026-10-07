import {
  formatInboxFullTimestamp,
  type InboxContextMessage,
  type InboxFilter,
  type InboxItem,
} from "@/features/home/lib/inbox";
import {
  getChannelIdFromTags,
  getThreadReference,
  isBroadcastReply,
} from "@/features/messages/lib/threading";
import type { TimelineMessage } from "@/features/messages/types";
import type {
  FeedItem,
  RelayEvent,
  UserProfileSummary,
} from "@/shared/api/types";
import { resolveMentionProps } from "@/shared/lib/resolveMentionNames";
import { matchesInbox } from "@client-kit/platform/inbox";

function hasThreadReplyTags(tags: string[][]) {
  const thread = getThreadReference(tags);
  return thread.parentId !== null && !isBroadcastReply(tags);
}

export function hasInboxThreadContext(
  item: Pick<InboxItem, "groupItems" | "item">,
  contextMessages: readonly Pick<InboxContextMessage, "tags">[] = [],
) {
  return [item.item, ...item.groupItems, ...contextMessages].some((event) =>
    hasThreadReplyTags(event.tags ?? []),
  );
}

export function matchesInboxFilter(
  item: {
    categories: readonly string[];
    groupItems?: readonly FeedItem[];
    item?: FeedItem;
  },
  filter: InboxFilter,
  ownedAgentPubkeys?: ReadonlySet<string>,
) {
  return matchesInbox(
    {
      ...item,
      groupItems: [
        ...(item.item ? [item.item] : []),
        ...(item.groupItems ?? []),
      ],
    },
    filter,
    ownedAgentPubkeys,
  );
}

export function matchesInboxAllView(item: {
  categories: readonly string[];
  groupItems?: readonly FeedItem[];
  item?: FeedItem;
}): boolean {
  return matchesInboxFilter(item, "all");
}

export function getContextMessageDepth(
  event: RelayEvent,
  eventById: ReadonlyMap<string, RelayEvent>,
): number {
  let depth = 0;
  let parentId = getThreadReference(event.tags).parentId;
  const seen = new Set<string>([event.id]);

  while (parentId && eventById.has(parentId) && !seen.has(parentId)) {
    depth += 1;
    seen.add(parentId);
    parentId = getThreadReference(eventById.get(parentId)?.tags ?? []).parentId;
  }

  return depth;
}

export function isInboxThreadContextEvent(
  event: RelayEvent,
  selection: {
    selectedChannelId: string | null;
    selectedEventId: string;
    selectedParentId: string | null;
    selectedThreadRootId: string | null;
  },
): boolean {
  if (
    selection.selectedChannelId &&
    getChannelIdFromTags(event.tags) !== selection.selectedChannelId
  ) {
    return false;
  }

  if (event.id === selection.selectedEventId) {
    return true;
  }

  if (
    selection.selectedThreadRootId &&
    event.id === selection.selectedThreadRootId
  ) {
    return true;
  }

  if (selection.selectedParentId && event.id === selection.selectedParentId) {
    return true;
  }

  const thread = getThreadReference(event.tags);
  return (
    (selection.selectedThreadRootId !== null &&
      (thread.rootId === selection.selectedThreadRootId ||
        thread.parentId === selection.selectedThreadRootId)) ||
    thread.parentId === selection.selectedEventId
  );
}

/**
 * Maps a formatted timeline message into the inbox detail pane's context
 * message shape.
 */
export function toInboxContextMessage(
  message: TimelineMessage,
  context: {
    eventById: ReadonlyMap<string, RelayEvent>;
    fallbackAuthorPubkey: string;
    profiles: Record<string, UserProfileSummary> | undefined;
    selectedItemId: string;
  },
): InboxContextMessage {
  const event = context.eventById.get(message.id);
  const authorPubkey =
    message.pubkey ?? event?.pubkey ?? context.fallbackAuthorPubkey;
  const { mentionNames, mentionPubkeysByName } = resolveMentionProps(
    message.tags ?? [],
    context.profiles,
    message.body,
  );
  return {
    id: message.id,
    authorLabel: message.author,
    authorPubkey,
    avatarUrl: message.avatarUrl ?? null,
    content: message.body,
    createdAt: message.createdAt,
    depth: event
      ? getContextMessageDepth(event, context.eventById)
      : message.depth,
    fullTimestampLabel: formatInboxFullTimestamp(message.createdAt),
    isSelected: message.id === context.selectedItemId,
    mentionNames: mentionNames ?? [],
    mentionPubkeysByName,
    tags: message.tags,
    timeLabel: message.time,
    reactions: message.reactions,
    pending: message.pending,
  };
}

/**
 * Converts an inbox context message back into the `TimelineMessage` shape
 * the shared message components consume.
 */
export function toTimelineMessage(
  message: InboxContextMessage,
): TimelineMessage {
  const threadReference = getThreadReference(message.tags ?? []);
  return {
    id: message.id,
    author: message.authorLabel,
    avatarUrl: message.avatarUrl,
    body: message.content,
    createdAt: message.createdAt,
    depth: message.depth,
    parentId: message.parentId ?? threadReference.parentId,
    pubkey: message.authorPubkey,
    rootId: message.rootId ?? threadReference.rootId,
    tags: message.tags,
    time: message.timeLabel ?? message.fullTimestampLabel,
    reactions: message.reactions,
    pending: message.pending,
  };
}
